import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import {
  PANAMAX_DEFAULT_DELAY,
  PANAMAX_DEFAULT_POLL_INTERVAL,
  PANAMAX_DEFAULT_PORT,
  PLATFORM_NAME,
  PLUGIN_NAME,
  PLUGIN_VERSION,
} from './settings';
import { PanamaxClient, validatePanamaxHost } from './panamaxClient';
import {
  PanamaxDeviceAccessory,
  PanamaxIndividualOutletAccessory,
  PanamaxMasterSwitchAccessory,
  PanamaxDeviceConfig,
  resolveOutletControlMode,
  resolveOrderedOutlets,
  sanitizeHomeKitName,
} from './platformAccessory';

export interface NormalizedPlatformConfig {
  name: string;
  platform: string;
  devices: PanamaxDeviceConfig[];
}

function parseIntegerOption(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.min(max, Math.max(min, Math.round(parsed)));
    }
  }
  return fallback;
}

/**
 * Safely normalizes raw Homebridge PlatformConfig into strongly typed Panamax settings
 * without throwing on malformed or partial entries.
 */
export function normalizePlatformConfig(config: PlatformConfig | undefined): NormalizedPlatformConfig {
  const safeConfig = config && typeof config === 'object' ? config : ({ platform: PLATFORM_NAME } as PlatformConfig);
  const name = sanitizeHomeKitName(typeof safeConfig.name === 'string' ? safeConfig.name : undefined, 'Panamax 43xx');
  const platform = typeof safeConfig.platform === 'string' && safeConfig.platform.trim()
    ? safeConfig.platform.trim()
    : PLATFORM_NAME;

  const rawDevices = Array.isArray(safeConfig.devices) ? safeConfig.devices : [];
  const devices: PanamaxDeviceConfig[] = [];

  for (const [index, entry] of rawDevices.entries()) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const raw = entry as Partial<PanamaxDeviceConfig>;
    const deviceName = sanitizeHomeKitName(raw.name, `Panamax Unit ${index + 1}`);
    const host = typeof raw.host === 'string' ? raw.host.trim() : '';
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
    const accessoryMode: 'device' | 'individual' = raw.accessoryMode === 'individual' ? 'individual' : 'device';

    devices.push({
      ...raw,
      name: deviceName,
      id,
      host,
      port: parseIntegerOption(raw.port, PANAMAX_DEFAULT_PORT, 1, 65535),
      pollInterval: parseIntegerOption(raw.pollInterval, PANAMAX_DEFAULT_POLL_INTERVAL, 2, 3600),
      delay: parseIntegerOption(raw.delay, PANAMAX_DEFAULT_DELAY, 0, 300),
      accessoryMode,
      outletControlMode: resolveOutletControlMode(raw as PanamaxDeviceConfig),
      enableRebootButtons: Boolean(raw.enableRebootButtons),
    });
  }

  return { name, platform, devices };
}

export class Panamax43xxPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly registeredPlatformName: string;
  private readonly clients: PanamaxClient[] = [];
  private readonly normalizedConfig: NormalizedPlatformConfig;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.normalizedConfig = normalizePlatformConfig(this.config);
    this.registeredPlatformName = this.config?.platform
      ? String(this.config.platform).split('.').pop() || PLATFORM_NAME
      : PLATFORM_NAME;

    this.log.info(`Initializing Panamax 43xx Platform v${PLUGIN_VERSION}: "${this.normalizedConfig.name}"`);

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      for (const client of this.clients) {
        client.stop();
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const devices = this.normalizedConfig.devices;
    const activeUUIDs = new Set<string>();

    if (devices.length === 0) {
      this.log.warn('No Panamax devices configured. Please check your Homebridge configuration.');
      return;
    }

    this.log.info(`Discovering and registering ${devices.length} configured Panamax device(s)...`);

    for (const [deviceIndex, deviceConfig] of devices.entries()) {
      if (!deviceConfig.host) {
        this.log.warn(`Device #${deviceIndex + 1} (${deviceConfig.name || 'Unnamed'}) is missing host IP or address. Skipping.`);
        continue;
      }

      const validation = validatePanamaxHost(deviceConfig.host);
      if (!validation.valid) {
        this.log.error(`Device #${deviceIndex + 1} (${deviceConfig.name || deviceConfig.host}) — ${validation.reason}. Skipping.`);
        continue;
      }

      try {
        // Ensure every device has an identifiable unique name
        const deviceName = deviceConfig.name;
        const deviceIdentifier = deviceConfig.id || deviceName;
        const mode = deviceConfig.accessoryMode || 'device';
        const controlMode = resolveOutletControlMode(deviceConfig);
        const port = deviceConfig.port || PANAMAX_DEFAULT_PORT;

        this.log.info(
          `[${deviceName}] Configuring unit at ${deviceConfig.host}:${port} (Mode: ${mode}, Control: ${controlMode})`,
        );

        // Initialize persistent TCP client for this physical Panamax device
        const client = new PanamaxClient(
          {
            host: deviceConfig.host,
            port,
            pollInterval: deviceConfig.pollInterval || PANAMAX_DEFAULT_POLL_INTERVAL,
            delay: deviceConfig.delay !== undefined ? deviceConfig.delay : PANAMAX_DEFAULT_DELAY,
          },
          this.log,
        );
        this.clients.push(client);
        client.start();

        if (mode === 'device') {
          // UNIFIED DEVICE MODE (Default & Recommended)
          // Publishes 1 single clean accessory per Panamax unit
          const deviceUuid = this.api.hap.uuid.generate(`panamax:device:${deviceIdentifier}`);
          activeUUIDs.add(deviceUuid);

          const existingAccessory = this.accessories.find((acc) => acc.UUID === deviceUuid);

          if (existingAccessory) {
            this.log.info(`[${deviceName}] Restoring existing device accessory from cache: "${existingAccessory.displayName}"`);
            existingAccessory.displayName = deviceName;
            new PanamaxDeviceAccessory(this, existingAccessory, client, { ...deviceConfig, name: deviceName });
            this.api.updatePlatformAccessories([existingAccessory]);
          } else {
            this.log.info(`[${deviceName}] Registering new unified device accessory: "${deviceName}"`);
            const accessory = new this.api.platformAccessory(deviceName, deviceUuid);
            new PanamaxDeviceAccessory(this, accessory, client, { ...deviceConfig, name: deviceName });
            this.api.registerPlatformAccessories(PLUGIN_NAME, this.registeredPlatformName, [accessory]);
            this.accessories.push(accessory);
          }
        } else {
          // INDIVIDUAL OUTLETS MODE
          // Publishes outlets 1..8 in strict numeric order (Outlet 1 first, Outlet 8 last) and/or Master Switch
          const exposeOutlets = controlMode === 'outletsAndMaster' || controlMode === 'outletsOnly';
          const exposeMaster = controlMode === 'outletsAndMaster' || controlMode === 'masterOnly';

          if (exposeOutlets) {
            const orderedOutlets = resolveOrderedOutlets(deviceConfig);

            for (const outlet of orderedOutlets) {
              const outletUuid = this.api.hap.uuid.generate(`panamax:${deviceIdentifier}:outlet:${outlet.index}`);
              activeUUIDs.add(outletUuid);

              const displayName = `${deviceName} ${outlet.name || `Outlet ${outlet.index}`}`;
              const existing = this.accessories.find((acc) => acc.UUID === outletUuid);

              if (existing) {
                this.log.info(`[${deviceName}] Restoring individual outlet accessory from cache: "${existing.displayName}"`);
                existing.displayName = displayName;
                new PanamaxIndividualOutletAccessory(this, existing, client, { ...deviceConfig, name: deviceName }, outlet);
                this.api.updatePlatformAccessories([existing]);
              } else {
                this.log.info(`[${deviceName}] Adding individual outlet accessory: "${displayName}"`);
                const accessory = new this.api.platformAccessory(displayName, outletUuid);
                new PanamaxIndividualOutletAccessory(this, accessory, client, { ...deviceConfig, name: deviceName }, outlet);
                this.api.registerPlatformAccessories(PLUGIN_NAME, this.registeredPlatformName, [accessory]);
                this.accessories.push(accessory);
              }
            }
          }

          if (exposeMaster) {
            const masterUuid = this.api.hap.uuid.generate(`panamax:${deviceIdentifier}:master`);
            activeUUIDs.add(masterUuid);

            const masterDisplayName = `${deviceName} All Outlets`;
            const existingMaster = this.accessories.find((acc) => acc.UUID === masterUuid);

            if (existingMaster) {
              this.log.info(`[${deviceName}] Restoring master switch accessory from cache: "${existingMaster.displayName}"`);
              existingMaster.displayName = masterDisplayName;
              new PanamaxMasterSwitchAccessory(this, existingMaster, client, { ...deviceConfig, name: deviceName });
              this.api.updatePlatformAccessories([existingMaster]);
            } else {
              this.log.info(`[${deviceName}] Adding master switch accessory: "${masterDisplayName}"`);
              const accessory = new this.api.platformAccessory(masterDisplayName, masterUuid);
              new PanamaxMasterSwitchAccessory(this, accessory, client, { ...deviceConfig, name: deviceName });
              this.api.registerPlatformAccessories(PLUGIN_NAME, this.registeredPlatformName, [accessory]);
              this.accessories.push(accessory);
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.log.error(`Device #${deviceIndex + 1} (${deviceConfig.name || deviceConfig.host}) failed to initialize: ${message}. Skipping.`);
      }
    }

    // Clean up stale or legacy accessories from previous versions
    const staleAccessories = this.accessories.filter((acc) => !activeUUIDs.has(acc.UUID));
    if (staleAccessories.length > 0) {
      this.log.info(`Cleaning up ${staleAccessories.length} stale/legacy accessories from cache.`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, this.registeredPlatformName, staleAccessories);
    }
  }
}
