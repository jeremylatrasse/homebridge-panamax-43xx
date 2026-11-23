# Building & Maintaining `homebridge-panamax-43xx`

This guide documents everything required to build, extend, test, version, and release `homebridge-panamax-43xx` across Node.js, Homebridge Config UI X, Xcode, and GitHub.

---

## 1. Architecture & File Map

| Path | Role |
| :--- | :--- |
| [src/index.ts](src/index.ts) | Homebridge CommonJS entry point (`export = (api) => ...`), registering `Panamax43xx` and legacy alias `Panamax4320`. |
| [src/settings.ts](src/settings.ts) | Defines `PLUGIN_NAME` (`homebridge-panamax-43xx`), `PLATFORM_NAME` (`Panamax43xx`), `PANAMAX_DEFAULT_PORT` (`23`), `PANAMAX_DEFAULT_POLL_INTERVAL` (`10`), `PANAMAX_DEFAULT_DELAY` (`30`), and `PLUGIN_VERSION`. |
| [src/platform.ts](src/platform.ts) | `Panamax43xxPlatform` (`DynamicPlatformPlugin`), config normalization (`normalizePlatformConfig`), unified vs. individual accessory registration, stale cached-accessory cleanup, and graceful client shutdown. |
| [src/platformAccessory.ts](src/platformAccessory.ts) | `PanamaxDeviceAccessory` (unified 1-accessory layout), `PanamaxIndividualOutletAccessory`, `PanamaxMasterSwitchAccessory`, `resolveOutletControlMode`, `resolveOrderedOutlets`, and `sanitizeHomeKitName`. |
| [src/panamaxClient.ts](src/panamaxClient.ts) | `PanamaxClient`: raw TCP/Telnet socket lifecycle (port `23`), Telnet IAC (`0xFF`) byte stripping, ASCII BlueBOLT protocol parser (`M4315-PRO` and `M4320-PRO`), `validatePanamaxHost`, serialized command queue, hardware switching delay suppression, and unified heartbeat state machine. |
| [config.schema.json](config.schema.json) | Homebridge Config UI X schema (`pluginAlias` must equal `PLATFORM_NAME`). |
| [test-panamax.mjs](test-panamax.mjs) | Node unit, config normalization, schema slider audit, mock TCP/Telnet server, and mock Homebridge platform test suite executed against compiled `dist/` via `npm test`. |
| [homebridge-panamax-43xx/main.swift](homebridge-panamax-43xx/main.swift) | macOS Swift diagnostic CLI (`--host`, `--port`, `--status`, `--id`, `--faults`, `--switch`, `--raw`) built by the Xcode project. |
| [.githooks/](.githooks/) & [Makefile](Makefile) | Tracked local git hooks (`pre-commit`, `post-commit`, `pre-push`) installed into `.git/hooks/` via `make hooks`. |
| [dist/](dist/) | **Tracked in git** compiled output for zero-compile GitHub installations. |

---

## 2. Core Design Rules (Do Not Break)

### A. Zero-Compile GitHub Installs
Homebridge users often install directly from GitHub (`npm install git+https://github.com/jeremylatrasse/homebridge-panamax-43xx.git`) on systems without `typescript` or `devDependencies`.
1. **Always commit updated `dist/` files** whenever `src/` changes. (`.gitignore` intentionally keeps `dist/` tracked.)
2. **Keep `"dependencies": {}` empty** in `package.json`. Use Node.js built-ins (`node:net`, `node:events`, `node:fs`, `node:path`) and put `@types/node`, `homebridge`, and `typescript` in `devDependencies`.
3. **Never add `"prepare"` or `"postinstall"` scripts** in `package.json`—they run during `npm install` on target Homebridge hosts and can fail in restricted environments. Use `"prepublishOnly": "npm run compile"` instead.
4. **Keep CommonJS entry export** (`export = (api: API) => ...`) in `src/index.ts`, and resolve scoped platform names safely in `src/platform.ts`:
   ```ts
   this.registeredPlatformName = this.config?.platform
     ? String(this.config.platform).split('.').pop() || PLATFORM_NAME
     : PLATFORM_NAME;
   ```

### B. Child Bridge & Hardware Resilience
* Never throw uncaught exceptions during startup or `didFinishLaunching` if a Panamax unit is offline, unreachable, or misconfigured (`validatePanamaxHost()` logs a clear error and skips invalid hosts, and per-device initialization in `discoverDevices()` is wrapped in `try/catch`).
* `normalizePlatformConfig()` safely coerces and bounds `port` (`1`–`65535`), `pollInterval` (`2`–`3600`), and `delay` (`0`–`300`) so partial or malformed configs never crash the Child Bridge.
* Heartbeat probing begins lazily once an outlet/power command is issued, and transitions cleanly between expected `ON` and expected `OFF` states without spamming logs when a unit is offline.
* On Homebridge `shutdown`, stop all `PanamaxClient` instances (`client.stop()` clears `pollTimer`, `reconnectTimer`, `heartbeatTimer`, and all `confirmationTimers`, and destroys open TCP sockets).

---

## 3. Panamax BlueBOLT TCP/Telnet Protocol & State Machine (`src/panamaxClient.ts`)

`PanamaxClient` connects to the Panamax M4315-PRO / M4320-PRO BlueBOLT network card over raw TCP/Telnet (default port `23`), strips Telnet IAC (`0xFF`) negotiation bytes, and serializes outgoing commands (`80 ms` spacing) through `sendQueue`.

### Command & Notification Rules

| Direction | Frame / Command | Meaning & Required Behavior |
| :--- | :--- | :--- |
| **TX (Handshake)** | `!SET_FEEDBACK ON\r` (fallback `!FEEDBACK ON\r`), `?ID\r`, `?OUTLETSTAT\r` | Sent immediately on TCP connect to enable unsolicited feedback and sync initial identity and outlet states. |
| **TX (Heartbeat / Poll)** | `?OUTLETSTAT\r` | Polled every `pollInterval` (default `10s`, minimum `2s`) while heartbeat probing is active. |
| **TX (Outlet Control)** | `!SWITCH <1-8> <ON\|OFF>\r` | Switches a single outlet, updates optimistic state, activates switching delay window (`delay`, default `30s`), and schedules a post-delay verification `?OUTLETSTAT\r`. |
| **TX (Master Control)** | `!ALL_ON\r` / `!ALL_OFF\r` | Switches all 8 outlets simultaneously with optimistic HomeKit updates and switching delay protection. |
| **TX (Reboot)** | `!REBOOT_1\r` / `!REBOOT_2\r` | Triggers Panamax Reboot 1 or Reboot 2 power-cycle sequences. |
| **TX (Diagnostics)** | `?ID\r`, `?FIRMWARE\r`, `?FAULTSTAT\r` | Queries unit model, firmware version, and power/breaker/wiring fault states. |
| **RX (Outlet State)** | `$OUTLET<1-8> = <ON\|OFF>` | Updates `status.outlets[n]` and emits `outletChange(n, state)`. Suppressed while an outlet is inside an active switching delay window unless it already matches the target state. |
| **RX (Identity)** | `$PANAMAX`, `$MAX 4315-PRO`, `$M4315-PRO`, `$MAX 4320-PRO`, `$M4320-PRO`, `$FIRMWARE: <ver>` | Updates `status.model` / `status.firmware` and emits `info(status)`. |
| **RX (Faults)** | `$<NAME> = <OK\|FAULT>` | Updates `status.faults[name]` (e.g. `PWR`, `BREAKER`, `WIRE FAULT`) and emits `fault(status.faults)`. |

---

## 4. HomeKit Accessories & UUID Stability (`src/platformAccessory.ts`)

### Accessory Modes
* **Unified Device Mode (`accessoryMode: "device"`, Default):** Publishes **1 accessory per Panamax unit** on the platform's single Child Bridge, containing:
  * Outlets 1–8 in strict numeric order (`Outlet 1` through `Outlet 8`) as `Service.Outlet` (with `On` + `OutletInUse`) or `Service.Switch`, controlled by `outletControlMode` (`outletsAndMaster`, `outletsOnly`, `masterOnly`).
  * Optional Master Switch (`subtype: "master"`, `Service.Switch`) toggling all 8 outlets.
  * Optional Reboot 1 / Reboot 2 momentary switches (`subtype: "reboot-1"`, `"reboot-2"`), auto-resetting to `OFF` after 1 second.
* **Individual Mode (`accessoryMode: "individual"`):** Publishes separate HomeKit accessories for each outlet (`1..8`) and/or the Master switch.

### Critical Apple Home Rules
* **Do NOT set `ServiceLabelIndex` on outlet services:** `ServiceLabelIndex` causes Apple Home.app to overwrite custom outlet names with generic `Outlet 1`–`Outlet 8` labels. Always remove `ServiceLabelIndex` if present and populate `ConfiguredName` with `.onGet(() => name)`.
* **Rename-Friendly Subtypes:** Outlet subtypes include the sanitized configured name (`outlet-${i}-${outletDisplayName}`) so renaming an outlet in Homebridge assigns a fresh HAP instance ID (`iid`) and forces Apple Home to adopt the new name.
* **UUID Stability:** Never alter the UUID seed formats so existing Apple Home room assignments, scenes, and automations remain intact across upgrades:
  * Unified device: `panamax:device:${deviceIdentifier}`
  * Individual outlet: `panamax:${deviceIdentifier}:outlet:${outlet.index}`
  * Individual master: `panamax:${deviceIdentifier}:master`

---

## 5. `config.schema.json` & Config UI X Rules

Homebridge Config UI X uses `@ng-formworks/core`, which automatically renders any bounded `"integer"` or `"number"` field (with `"minimum"` and `"maximum"`) as a **range slider** (`<input type="range">`) instead of a numeric text box.

* **Mandatory Rule:** Every numeric field (`"type": "integer"` or `"type": "number"`) in `config.schema.json` that defines `"minimum"` AND `"maximum"` **must** include:
  ```json
  "x-schema-form": {
    "type": "number"
  }
  ```
* Never use `"widget": "range"` or `"type": "range"`.
* Never add `"format": "hostname"` to `host` (it causes Config UI X to reject valid 4-octet IPv4 addresses); use the strict 4-octet IPv4 / RFC 1123 hostname `"pattern"` regex instead.
* Keep `pluginAlias` (`"Panamax43xx"`) identical to `PLATFORM_NAME` in `src/settings.ts`.

### Slider Audit Command
Run this from the project root after any `config.schema.json` edit to verify valid JSON and zero unintended sliders (should print an empty table; also enforced automatically by `npm test`):

```bash
node -e '
const fs = require("fs");
const root = JSON.parse(fs.readFileSync("config.schema.json", "utf8"));
const hits = [];
function walk(node, path) {
  if (!node || typeof node !== "object") return;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  const isBounded = Object.hasOwn(node, "minimum") && Object.hasOwn(node, "maximum");
  const isSliderType = types.includes("integer") || types.includes("number");
  const hasOverride = Boolean(
    node["x-schema-form"]?.type ||
    node["x-schema-form"]?.widget?.component ||
    typeof node["x-schema-form"]?.widget === "string" ||
    node.widget?.component ||
    typeof node.widget === "string"
  );
  if (isBounded && isSliderType && !hasOverride && path !== "schema.properties._bridge.properties.port") {
    hits.push({ path, type: node.type, minimum: node.minimum, maximum: node.maximum });
  }
  if (node.properties && typeof node.properties === "object") {
    for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.properties.${k}`);
  }
  if (node.items) {
    if (Array.isArray(node.items)) node.items.forEach((v, i) => walk(v, `${path}.items[${i}]`));
    else walk(node.items, `${path}.items`);
  }
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (Array.isArray(node[key])) node[key].forEach((v, i) => walk(v, `${path}.${key}[${i}]`));
  }
}
walk(root.schema, "schema");
console.table(hits);
if (hits.length > 0) process.exit(1);
'
```

---

## 6. Local Development, Testing & Xcode Workflow

### Node / TypeScript Commands
```bash
npm install          # Install devDependencies locally
npm run compile      # Compile src/ -> dist/ via tsc
npm run watch        # Incremental compile during development
npm test             # Compiles TypeScript and runs test-panamax.mjs
make hooks           # Install tracked .githooks/* into .git/hooks/
```

### Checklist When Modifying Features or Config
1. Update TypeScript source in `src/`.
2. If adding or changing config keys:
   * Update `normalizePlatformConfig()` / types in `src/platform.ts` and `src/platformAccessory.ts`.
   * Update `config.schema.json` (remembering `"x-schema-form": { "type": "number" }` for bounded numbers/integers).
   * Update the Configuration Parameters table in `README.md`.
3. Add or update assertions in `test-panamax.mjs`.
4. Run `npm test` (which rebuilds `dist/` and runs all unit, mock-socket, platform, and slider audit tests).
5. Verify `git status` includes updated `dist/` files alongside `src/`.

### Xcode Workflow (`⌘B` / `⌘R`)
* Opening `homebridge-panamax-43xx.xcodeproj` provides a macOS build & diagnostic environment:
  * **Build (`⌘B`)** compiles TypeScript (`src/` → `dist/`), installs local git hooks (`make hooks`), and builds the Swift CLI target.
  * [homebridge-panamax-43xx/main.swift](homebridge-panamax-43xx/main.swift) provides a native macOS diagnostic CLI (`--host`, `--port`, `--status`, `--id`, `--faults`, `--switch`, `--raw`).

---

## 7. Git Versioning, Hooks & Release Pipeline

### Local Git Hooks (`.githooks/` & `.git/hooks/`)
This repository uses local hooks (`pre-commit`, `post-commit`, `pre-push`, installed via `make hooks`) to keep versions and `dist/` synchronized across npm and Xcode:
* **`pre-commit`:** Automatically unstages local-only Xcode files, increments the patch version in `package.json`, `package-lock.json`, and `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` inside `homebridge-panamax-43xx.xcodeproj/project.pbxproj`, recompiles `dist/`, and stages `package.json`, `package-lock.json`, and `dist/`.
* **`post-commit`:** Ensures partial/IDE commits (e.g., Xcode Source Control UI) include the bumped version files and compiled `dist/`, and creates/updates the local `vX.Y.Z` tag.
* **`pre-push`:** Verifies that `HEAD` has an incremented version relative to the remote branch before pushing.
* **Bypass bumping when needed** (e.g., amending or keeping an explicit version):
  ```bash
  SKIP_VERSION_BUMP=1 git commit -m "..."
  ```

### GitHub Actions & npm OIDC Trusted Publishing (`.github/workflows/bump-version.yml`)
* On every push to `main` / `master` (except `chore(release):` or `[skip ci]` commits) or manual `workflow_dispatch`, CI runs on **Node 24** (`actions/checkout@v7` + `actions/setup-node@v7`, shipping with `npm >= 11.5.1`), executes `npm ci && npm test`, creates/updates the `vX.Y.Z` git tag matching `package.json`, and automatically publishes to npm via **GitHub OIDC Trusted Publishing** with **SLSA provenance attestation** (`https://slsa.dev/provenance/v1`).
* **Trusted Publisher Settings on npmjs.com** (`https://www.npmjs.com/package/homebridge-panamax-43xx/access`):
  * A brand-new package must be published manually once (e.g., a bootstrap release or initial `npm publish --access public`) before npmjs.com exposes the Trusted Publisher settings.
  * Provider: **GitHub Actions**
  * Organization or user: `jeremylatrasse`
  * Repository: `homebridge-panamax-43xx`
  * Workflow filename: `bump-version.yml`
  * Environment name: *(leave blank)*
  * **Allow npm publish** must be enabled in the Trusted Publisher section on npmjs.com.
* **Important Workflow Rules for OIDC Publishing:**
  * Keep `permissions: { contents: write, id-token: write }` on the workflow.
  * Do **not** pass `registry-url` to `actions/setup-node` unconditionally or write an empty `//registry.npmjs.org/:_authToken=` entry to `~/.npmrc`—an empty token interferes with OIDC Trusted Publishing. Only write `_authToken` if an optional fallback `NPM_TOKEN` secret is explicitly set.
  * Compare the exact stdout of `npm view "${PKG_NAME}@${PKG_VERSION}" version` against `$PKG_VERSION` (`[ "$PUBLISHED_VER" = "$PKG_VERSION" ]`) rather than relying only on `npm view`'s exit code (some npm versions exit `0` with empty stdout for unpublished versions).
  * Allow ~2–3 minutes for npm's CDN to propagate newly published versions to `npm view` / `latest` after a successful CI publish.
  * **Do not** add a second unconditional `npm version patch` step in CI while local `pre-commit` hooks are active, or every commit will be double-bumped.

### Publishing to npm & `homebridge/verified` Checklist
1. Inspect what will be included in the npm tarball (`.npmignore` and `package.json` `files` exclude `src/`, tests, Xcode project, `.github/`, `.githooks/`, `Makefile`, and `MAINTAINING.md`):
   ```bash
   npm pack --dry-run
   ```
2. Run `npm test` and confirm clean `git status`.
3. Push to `main`—GitHub Actions automatically runs tests, tags `vX.Y.Z`, and publishes to npm with OIDC SLSA provenance (or run `npm publish --access public` manually if ever needed).
4. Before submitting or updating `github.com/homebridge/verified`:
   * Published publicly on npm with `"homebridge-plugin"` in `package.json` `keywords`.
   * Valid `config.schema.json` at root, `pluginAlias` matching `src/settings.ts`, and zero slider fields.
   * Child Bridge safe when any Panamax unit is offline or misconfigured.
   * `README.md` documents installation, Child Bridge pairing, and configuration options.
