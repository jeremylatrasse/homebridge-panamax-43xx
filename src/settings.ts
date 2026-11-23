import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Name of the platform registered in Homebridge.
 * This matches the platform name used in config.json and config.schema.json.
 */
export const PLATFORM_NAME = 'Panamax43xx';

/**
 * Name of the npm package.
 * This matches the name in package.json.
 */
export const PLUGIN_NAME = 'homebridge-panamax-43xx';

/**
 * Default Panamax BlueBOLT TCP / Telnet port.
 */
export const PANAMAX_DEFAULT_PORT = 23;

/**
 * Default status polling interval in seconds.
 */
export const PANAMAX_DEFAULT_POLL_INTERVAL = 10;

/**
 * Default hardware switching delay window in seconds.
 */
export const PANAMAX_DEFAULT_DELAY = 30;

function readPluginVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {
    // Ignore read errors and fall back to default version string
  }
  return '0.0.0';
}

/**
 * Current plugin version read from package.json.
 */
export const PLUGIN_VERSION = readPluginVersion();
