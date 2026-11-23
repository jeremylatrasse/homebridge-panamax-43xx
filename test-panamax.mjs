import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as net from 'node:net';

import {
  PANAMAX_DEFAULT_DELAY,
  PANAMAX_DEFAULT_POLL_INTERVAL,
  PANAMAX_DEFAULT_PORT,
  PLATFORM_NAME,
  PLUGIN_NAME,
  PLUGIN_VERSION,
} from './dist/settings.js';
import { PanamaxClient, validatePanamaxHost } from './dist/panamaxClient.js';
import { normalizePlatformConfig, Panamax43xxPlatform } from './dist/platform.js';
import {
  resolveOrderedOutlets,
  resolveOutletControlMode,
  sanitizeHomeKitName,
} from './dist/platformAccessory.js';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const schema = JSON.parse(readFileSync('./config.schema.json', 'utf8'));

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  log: () => {},
  success: () => {},
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('Running homebridge-panamax-43xx test suite...');

  // ---------------------------------------------------------------------------
  // 1. Settings & package metadata
  // ---------------------------------------------------------------------------
  assert.strictEqual(PLUGIN_NAME, pkg.name);
  assert.strictEqual(PLATFORM_NAME, schema.pluginAlias);
  assert.strictEqual(PLUGIN_VERSION, pkg.version);
  assert.strictEqual(PANAMAX_DEFAULT_PORT, 23);
  assert.strictEqual(PANAMAX_DEFAULT_POLL_INTERVAL, 10);
  assert.strictEqual(PANAMAX_DEFAULT_DELAY, 30);
  assert.deepStrictEqual(pkg.dependencies, {});
  assert.strictEqual(pkg.scripts.prepare, undefined);
  assert.strictEqual(pkg.scripts.postinstall, undefined);
  assert.strictEqual(pkg.scripts.prepublishOnly, 'npm run compile');
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.includes('homebridge-plugin'));
  console.log('  ✓ Settings & package.json rules');

  // ---------------------------------------------------------------------------
  // 2. Host validation (IPv4 4-octet & RFC 1123 hostnames)
  // ---------------------------------------------------------------------------
  assert.strictEqual(validatePanamaxHost('192.168.1.50').valid, true);
  assert.strictEqual(validatePanamaxHost('10.0.0.1').valid, true);
  assert.strictEqual(validatePanamaxHost('panamax.local').valid, true);
  assert.strictEqual(validatePanamaxHost('rack-pdu-01.home.arpa').valid, true);
  assert.strictEqual(validatePanamaxHost('192.168.50').valid, false);
  assert.strictEqual(validatePanamaxHost('10.0.0').valid, false);
  assert.strictEqual(validatePanamaxHost('1.2.3.4.5').valid, false);
  assert.strictEqual(validatePanamaxHost('256.1.1.1').valid, false);
  assert.strictEqual(validatePanamaxHost('192.168.01.1').valid, false);
  assert.strictEqual(validatePanamaxHost('bad..host').valid, false);
  assert.strictEqual(validatePanamaxHost('').valid, false);

  assert.throws(
    () => new PanamaxClient({ host: '192.168.50', port: 23 }, silentLogger),
    /Invalid IPv4 address/,
  );
  console.log('  ✓ Host validation & constructor guards');

  // ---------------------------------------------------------------------------
  // 3. Config schema validation & Config UI X Slider Audit
  // ---------------------------------------------------------------------------
  assert.strictEqual(schema.pluginType, 'platform');
  assert.strictEqual(schema.pluginAlias, PLATFORM_NAME);

  const hostSchema = schema.schema.properties.devices.items.properties.host;
  assert.strictEqual(hostSchema.format, undefined, 'host must NOT set format: hostname');
  const hostPattern = new RegExp(hostSchema.pattern);
  assert.strictEqual(hostPattern.test('192.168.1.50'), true);
  assert.strictEqual(hostPattern.test('panamax.local'), true);
  assert.strictEqual(hostPattern.test('192.168.50'), false);
  assert.strictEqual(hostPattern.test('10.0.0'), false);
  assert.deepStrictEqual(schema.schema.properties.devices.items.required, ['host']);

  // Slider audit walker (matches MAINTAINING.md Section 5)
  const sliderHits = [];
  const explicitRanges = [];
  function walkSchema(node, nodePath) {
    if (!node || typeof node !== 'object') return;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    const isBounded = Object.hasOwn(node, 'minimum') && Object.hasOwn(node, 'maximum');
    const isSliderType = types.includes('integer') || types.includes('number');
    const hasOverride = Boolean(
      node['x-schema-form']?.type ||
      node['x-schema-form']?.widget?.component ||
      typeof node['x-schema-form']?.widget === 'string' ||
      node.widget?.component ||
      typeof node.widget === 'string',
    );

    if (
      node['x-schema-form']?.type === 'range' ||
      node['x-schema-form']?.widget === 'range' ||
      node.widget === 'range'
    ) {
      explicitRanges.push(nodePath);
    }

    if (isBounded && isSliderType && !hasOverride && nodePath !== 'schema.properties._bridge.properties.port') {
      sliderHits.push({ path: nodePath, type: node.type, minimum: node.minimum, maximum: node.maximum });
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const [k, v] of Object.entries(node.properties)) {
        walkSchema(v, `${nodePath}.properties.${k}`);
      }
    }
    if (node.items) {
      if (Array.isArray(node.items)) {
        node.items.forEach((v, i) => walkSchema(v, `${nodePath}.items[${i}]`));
      } else {
        walkSchema(node.items, `${nodePath}.items`);
      }
    }
    for (const key of ['oneOf', 'anyOf', 'allOf']) {
      if (Array.isArray(node[key])) {
        node[key].forEach((v, i) => walkSchema(v, `${nodePath}.${key}[${i}]`));
      }
    }
  }
  walkSchema(schema.schema, 'schema');
  assert.deepStrictEqual(sliderHits, [], `Unintended slider fields detected: ${JSON.stringify(sliderHits)}`);
  assert.deepStrictEqual(explicitRanges, [], `Explicit range widgets detected: ${JSON.stringify(explicitRanges)}`);
  console.log('  ✓ config.schema.json validation & Slider Audit (0 sliders)');

  // ---------------------------------------------------------------------------
  // 4. Config normalization & outlet helper unit tests
  // ---------------------------------------------------------------------------
  assert.strictEqual(sanitizeHomeKitName('  AV\tReceiver\u0007  ', 'Outlet 1'), 'AV Receiver');
  assert.strictEqual(sanitizeHomeKitName('   ', 'Fallback'), 'Fallback');

  assert.strictEqual(resolveOutletControlMode({ name: 'U', host: '1.2.3.4' }), 'outletsAndMaster');
  assert.strictEqual(
    resolveOutletControlMode({ name: 'U', host: '1.2.3.4', enableAllOutletsSwitch: false }),
    'outletsOnly',
  );
  assert.strictEqual(
    resolveOutletControlMode({ name: 'U', host: '1.2.3.4', outletControlMode: 'masterOnly' }),
    'masterOnly',
  );

  const ordered = resolveOrderedOutlets({
    name: 'Rack',
    host: '192.168.1.50',
    outlet1: { name: 'AV Receiver', accessoryType: 'Outlet' },
    outlet3: { name: 'Subwoofer', accessoryType: 'Switch' },
    outlets: [{ index: 8, name: 'Legacy Amp', accessoryType: 'Switch' }],
  });
  assert.strictEqual(ordered.length, 8);
  assert.deepStrictEqual(ordered.map((o) => o.index), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.strictEqual(ordered[0].name, 'AV Receiver');
  assert.strictEqual(ordered[1].name, 'Outlet 2');
  assert.strictEqual(ordered[2].name, 'Subwoofer');
  assert.strictEqual(ordered[2].accessoryType, 'Switch');
  assert.strictEqual(ordered[7].name, 'Legacy Amp');
  assert.strictEqual(ordered[7].accessoryType, 'Switch');

  const normalized = normalizePlatformConfig({
    platform: 'homebridge-panamax-43xx.Panamax43xx',
    name: '  Home Rack  ',
    devices: [
      null,
      {
        name: '  M4315 Unit ',
        host: ' 192.168.1.51 ',
        port: '99999',
        pollInterval: 1,
        delay: -5,
        accessoryMode: 'invalid',
      },
    ],
  });
  assert.strictEqual(normalized.name, 'Home Rack');
  assert.strictEqual(normalized.devices.length, 1);
  assert.strictEqual(normalized.devices[0].host, '192.168.1.51');
  assert.strictEqual(normalized.devices[0].port, 65535);
  assert.strictEqual(normalized.devices[0].pollInterval, 2);
  assert.strictEqual(normalized.devices[0].delay, 0);
  assert.strictEqual(normalized.devices[0].accessoryMode, 'device');
  console.log('  ✓ Config normalization & outlet helpers');

  // ---------------------------------------------------------------------------
  // 5. Mock Panamax TCP / Telnet server integration tests
  // ---------------------------------------------------------------------------
  const receivedCommands = [];
  const outletStates = [false, false, false, false, false, false, false, false, false];
  let activeServerSocket = null;

  const mockServer = net.createServer((socket) => {
    activeServerSocket = socket;
    // Send Telnet IAC negotiation bytes followed by welcome banner
    socket.write(Buffer.from([0xFF, 0xFB, 0x01, 0xFF, 0xFD, 0x03]));

    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('ascii');
      let idx;
      while ((idx = buf.search(/[\r\n]/)) !== -1) {
        const cmd = buf.substring(0, idx).trim();
        buf = buf.substring(idx + 1);
        if (!cmd) continue;
        receivedCommands.push(cmd);

        if (cmd === '?ID') {
          socket.write('$PANAMAX\r$M4315-PRO\r$FIRMWARE: 2.1\r');
        } else if (cmd === '?OUTLETSTAT') {
          for (let i = 1; i <= 8; i++) {
            socket.write(`$OUTLET${i} = ${outletStates[i] ? 'ON' : 'OFF'}\r`);
          }
        } else if (cmd === '?FAULTSTAT') {
          socket.write('$PWR = OK\r$BREAKER = OK\r$WIRE FAULT = FAULT\r');
        } else if (cmd.startsWith('!SWITCH ')) {
          const m = cmd.match(/^!SWITCH\s+([1-8])\s+(ON|OFF)$/);
          if (m) {
            const num = Number(m[1]);
            const target = m[2] === 'ON';
            // Simulate hardware lag: report stale opposite state first
            socket.write(`$OUTLET${num} = ${target ? 'OFF' : 'ON'}\r`);
            outletStates[num] = target;
          }
        } else if (cmd === '!ALL_ON') {
          for (let i = 1; i <= 8; i++) outletStates[i] = true;
        } else if (cmd === '!ALL_OFF') {
          for (let i = 1; i <= 8; i++) outletStates[i] = false;
        }
      }
    });
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const { port: mockPort } = mockServer.address();

  const client = new PanamaxClient(
    { host: '127.0.0.1', port: mockPort, pollInterval: 60, delay: 1, timeout: 2 },
    silentLogger,
  );

  const infoEvents = [];
  const faultEvents = [];
  const outletEvents = [];
  client.on('info', (s) => infoEvents.push({ ...s }));
  client.on('fault', (f) => faultEvents.push({ ...f }));
  client.on('outletChange', (idx, state) => outletEvents.push({ idx, state }));

  try {
    // Switching outlet 1 ON initiates connection, handshake, and delay window
    await client.setOutlet(1, true);
    await sleep(150);

    // Handshake commands sent on connect
    assert.ok(receivedCommands.includes('!SET_FEEDBACK ON'));
    assert.ok(receivedCommands.includes('?ID'));
    assert.ok(receivedCommands.includes('?OUTLETSTAT'));
    assert.ok(receivedCommands.includes('!SWITCH 1 ON'));

    // Model (M4315-PRO) and firmware parsed cleanly after IAC stripping
    assert.strictEqual(client.status.model, 'M4315-PRO');
    assert.strictEqual(client.status.firmware, '2.1');
    assert.ok(infoEvents.length >= 2);

    // Stale OFF report during switching delay window must be suppressed
    assert.strictEqual(client.status.outlets[1], true);

    // Unsolicited broadcast for another outlet updates state immediately
    activeServerSocket.write('$OUTLET4 = ON\r');
    await sleep(60);
    assert.strictEqual(client.status.outlets[4], true);
    assert.ok(outletEvents.some((e) => e.idx === 4 && e.state === true));

    // Fault status parsing
    await client.queryFaults();
    await sleep(60);
    assert.strictEqual(client.status.faults?.PWR, 'OK');
    assert.strictEqual(client.status.faults?.['WIRE FAULT'], 'FAULT');
    assert.ok(faultEvents.length >= 1);

    // Master ALL_ON, ALL_OFF, and Reboot commands
    await client.setAllOn();
    assert.ok(receivedCommands.includes('!ALL_ON'));
    assert.strictEqual(client.status.outlets.slice(1).every(Boolean), true);

    await client.setAllOff();
    assert.ok(receivedCommands.includes('!ALL_OFF'));
    assert.strictEqual(client.status.outlets.slice(1).every((s) => !s), true);

    await client.triggerReboot1();
    await client.triggerReboot2();
    assert.ok(receivedCommands.includes('!REBOOT_1'));
    assert.ok(receivedCommands.includes('!REBOOT_2'));
  } finally {
    client.stop();
    await new Promise((resolve) => mockServer.close(resolve));
  }
  console.log('  ✓ Mock TCP/Telnet server protocol & state machine tests');

  // ---------------------------------------------------------------------------
  // 6. Mock Homebridge Platform & Child Bridge resilience tests
  // ---------------------------------------------------------------------------
  class FakeCharacteristic {
    constructor(name) {
      this.name = name;
      this.value = null;
    }
    onSet(fn) { this._onSet = fn; return this; }
    onGet(fn) { this._onGet = fn; return this; }
    updateValue(v) { this.value = v; return this; }
  }

  class FakeService {
    constructor(UUID, displayName, subtype) {
      this.UUID = UUID;
      this.displayName = displayName;
      this.subtype = subtype;
      this.chars = new Map();
    }
    setCharacteristic(key, val) {
      const c = this.getCharacteristic(key);
      c.value = val;
      return this;
    }
    updateCharacteristic(key, val) {
      return this.setCharacteristic(key, val);
    }
    getCharacteristic(key) {
      if (!this.chars.has(key)) this.chars.set(key, new FakeCharacteristic(key));
      return this.chars.get(key);
    }
    testCharacteristic(key) {
      return this.chars.has(key);
    }
    addOptionalCharacteristic(key) {
      return this.getCharacteristic(key);
    }
    removeCharacteristic(char) {
      this.chars.delete(char.name);
    }
  }

  class FakePlatformAccessory {
    constructor(displayName, UUID) {
      this.displayName = displayName;
      this.UUID = UUID;
      this.services = [new FakeService('AccessoryInformation', displayName)];
    }
    getService(type) {
      const uuid = typeof type === 'string' ? type : type.UUID;
      return this.services.find((s) => s.UUID === uuid);
    }
    getServiceById(type, subtype) {
      const uuid = typeof type === 'string' ? type : type.UUID;
      return this.services.find((s) => s.UUID === uuid && s.subtype === subtype);
    }
    addService(type, name, subtype) {
      const uuid = typeof type === 'string' ? type : type.UUID;
      const svc = new FakeService(uuid, name, subtype);
      this.services.push(svc);
      return svc;
    }
    removeService(service) {
      this.services = this.services.filter((s) => s !== service);
    }
  }

  const fakeApi = new EventEmitter();
  const registeredAccessories = [];
  const unregisteredAccessories = [];

  fakeApi.hap = {
    Service: {
      AccessoryInformation: { UUID: 'AccessoryInformation' },
      Outlet: { UUID: 'Outlet' },
      Switch: { UUID: 'Switch' },
    },
    Characteristic: {
      Name: 'Name',
      ConfiguredName: 'ConfiguredName',
      ServiceLabelIndex: 'ServiceLabelIndex',
      Manufacturer: 'Manufacturer',
      Model: 'Model',
      SerialNumber: 'SerialNumber',
      FirmwareRevision: 'FirmwareRevision',
      On: 'On',
      OutletInUse: 'OutletInUse',
    },
    HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
    HapStatusError: class HapStatusError extends Error {},
    uuid: { generate: (seed) => `uuid:${seed}` },
  };
  fakeApi.platformAccessory = FakePlatformAccessory;
  fakeApi.registerPlatformAccessories = (_plugin, _platform, accs) => {
    registeredAccessories.push(...accs);
  };
  fakeApi.updatePlatformAccessories = () => {};
  fakeApi.unregisterPlatformAccessories = (_plugin, _platform, accs) => {
    unregisteredAccessories.push(...accs);
  };

  const platform = new Panamax43xxPlatform(
    silentLogger,
    {
      platform: 'homebridge-panamax-43xx.Panamax43xx',
      name: 'Test Panamax Platform',
      devices: [
        // Invalid host should be skipped safely without crashing Child Bridge
        { name: 'Bad Host Unit', host: '192.168.50' },
        // Valid unified device with outlets + master + reboot buttons
        {
          name: 'AV Rack 4320',
          id: 'rack-01',
          host: '192.168.1.50',
          accessoryMode: 'device',
          outletControlMode: 'outletsAndMaster',
          enableRebootButtons: true,
          outlet1: { name: 'AV Receiver', accessoryType: 'Outlet' },
          outlet2: { name: 'Subwoofer', accessoryType: 'Switch' },
        },
        // Valid individual masterOnly device
        {
          name: 'Living Room 4315',
          id: 'lr-02',
          host: '192.168.1.51',
          accessoryMode: 'individual',
          outletControlMode: 'masterOnly',
        },
      ],
    },
    fakeApi,
  );

  // Add a stale cached accessory to confirm cleanup
  platform.configureAccessory(new FakePlatformAccessory('Stale Unit', 'uuid:stale'));

  assert.strictEqual(platform.registeredPlatformName, PLATFORM_NAME);
  fakeApi.emit('didFinishLaunching');

  assert.strictEqual(registeredAccessories.length, 2);
  assert.strictEqual(unregisteredAccessories.length, 1);
  assert.strictEqual(unregisteredAccessories[0].UUID, 'uuid:stale');

  const unifiedAcc = registeredAccessories.find((a) => a.UUID === 'uuid:panamax:device:rack-01');
  assert.ok(unifiedAcc, 'Unified device accessory registered with stable UUID');
  // 1 AccessoryInformation + 8 outlets + 1 master + 2 reboot buttons = 12 services
  assert.strictEqual(unifiedAcc.services.length, 12);
  const outlet1Svc = unifiedAcc.getServiceById(fakeApi.hap.Service.Outlet, 'outlet-1-AV Receiver');
  assert.ok(outlet1Svc, 'Outlet 1 uses rename-friendly subtype and Outlet service');
  assert.strictEqual(outlet1Svc.testCharacteristic('ServiceLabelIndex'), false);
  assert.strictEqual(outlet1Svc.getCharacteristic('ConfiguredName').value, 'AV Receiver');
  const outlet2Svc = unifiedAcc.getServiceById(fakeApi.hap.Service.Switch, 'outlet-2-Subwoofer');
  assert.ok(outlet2Svc, 'Outlet 2 uses Switch service when configured');

  const masterOnlyAcc = registeredAccessories.find((a) => a.UUID === 'uuid:panamax:lr-02:master');
  assert.ok(masterOnlyAcc, 'Individual masterOnly accessory registered with stable UUID');

  // Graceful shutdown stops all clients cleanly
  fakeApi.emit('shutdown');
  console.log('  ✓ Platform discovery, UUID stability & Child Bridge resilience');

  console.log('✅ All homebridge-panamax-43xx tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
