"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Panamax43xxPlatform = void 0;
const settings_1 = require("./settings");
const panamaxClient_1 = require("./panamaxClient");
const platformAccessory_1 = require("./platformAccessory");
class Panamax43xxPlatform {
    log;
    config;
    api;
    Service;
    Characteristic;
    accessories = [];
    clients = [];
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.log.info(`Initializing Panamax 43xx Platform: "${this.config.name || 'Panamax 43xx'}"`);
        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
        this.api.on('shutdown', () => {
            for (const client of this.clients) {
                client.stop();
            }
        });
    }
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    discoverDevices() {
        const devices = this.config.devices || [];
        const activeUUIDs = new Set();
        const registeredPlatformName = this.config.platform
            ? String(this.config.platform).split('.').pop() || settings_1.PLATFORM_NAME
            : settings_1.PLATFORM_NAME;
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
            // Ensure every device has an identifiable unique name
            const deviceName = deviceConfig.name?.trim() || `Panamax Unit ${deviceIndex + 1}`;
            const deviceIdentifier = deviceConfig.id?.trim() || deviceName;
            const mode = deviceConfig.accessoryMode || 'device';
            const controlMode = (0, platformAccessory_1.resolveOutletControlMode)(deviceConfig);
            this.log.info(`[${deviceName}] Configuring unit at ${deviceConfig.host}:${deviceConfig.port || 23} (Mode: ${mode}, Control: ${controlMode})`);
            // Initialize persistent TCP client for this physical Panamax device
            const client = new panamaxClient_1.PanamaxClient({
                host: deviceConfig.host,
                port: deviceConfig.port || 23,
                pollInterval: deviceConfig.pollInterval || 10,
                delay: deviceConfig.delay !== undefined ? deviceConfig.delay : 30,
            }, this.log);
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
                    new platformAccessory_1.PanamaxDeviceAccessory(this, existingAccessory, client, { ...deviceConfig, name: deviceName });
                    this.api.updatePlatformAccessories([existingAccessory]);
                }
                else {
                    this.log.info(`[${deviceName}] Registering new unified device accessory: "${deviceName}"`);
                    const accessory = new this.api.platformAccessory(deviceName, deviceUuid);
                    new platformAccessory_1.PanamaxDeviceAccessory(this, accessory, client, { ...deviceConfig, name: deviceName });
                    this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, registeredPlatformName, [accessory]);
                    this.accessories.push(accessory);
                }
            }
            else {
                // INDIVIDUAL OUTLETS MODE
                // Publishes outlets 1..8 in strict numeric order (Outlet 1 first, Outlet 8 last) and/or Master Switch
                const exposeOutlets = controlMode === 'outletsAndMaster' || controlMode === 'outletsOnly';
                const exposeMaster = controlMode === 'outletsAndMaster' || controlMode === 'masterOnly';
                if (exposeOutlets) {
                    const orderedOutlets = (0, platformAccessory_1.resolveOrderedOutlets)(deviceConfig);
                    for (const outlet of orderedOutlets) {
                        const outletUuid = this.api.hap.uuid.generate(`panamax:${deviceIdentifier}:outlet:${outlet.index}`);
                        activeUUIDs.add(outletUuid);
                        const displayName = `${deviceName} ${outlet.name || `Outlet ${outlet.index}`}`;
                        const existing = this.accessories.find((acc) => acc.UUID === outletUuid);
                        if (existing) {
                            this.log.info(`[${deviceName}] Restoring individual outlet accessory from cache: "${existing.displayName}"`);
                            existing.displayName = displayName;
                            new platformAccessory_1.PanamaxIndividualOutletAccessory(this, existing, client, { ...deviceConfig, name: deviceName }, outlet);
                            this.api.updatePlatformAccessories([existing]);
                        }
                        else {
                            this.log.info(`[${deviceName}] Adding individual outlet accessory: "${displayName}"`);
                            const accessory = new this.api.platformAccessory(displayName, outletUuid);
                            new platformAccessory_1.PanamaxIndividualOutletAccessory(this, accessory, client, { ...deviceConfig, name: deviceName }, outlet);
                            this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, registeredPlatformName, [accessory]);
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
                        new platformAccessory_1.PanamaxMasterSwitchAccessory(this, existingMaster, client, { ...deviceConfig, name: deviceName });
                        this.api.updatePlatformAccessories([existingMaster]);
                    }
                    else {
                        this.log.info(`[${deviceName}] Adding master switch accessory: "${masterDisplayName}"`);
                        const accessory = new this.api.platformAccessory(masterDisplayName, masterUuid);
                        new platformAccessory_1.PanamaxMasterSwitchAccessory(this, accessory, client, { ...deviceConfig, name: deviceName });
                        this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, registeredPlatformName, [accessory]);
                        this.accessories.push(accessory);
                    }
                }
            }
        }
        // Clean up stale or legacy accessories from previous versions
        const staleAccessories = this.accessories.filter((acc) => !activeUUIDs.has(acc.UUID));
        if (staleAccessories.length > 0) {
            this.log.info(`Cleaning up ${staleAccessories.length} stale/legacy accessories from cache.`);
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, registeredPlatformName, staleAccessories);
        }
    }
}
exports.Panamax43xxPlatform = Panamax43xxPlatform;
//# sourceMappingURL=platform.js.map