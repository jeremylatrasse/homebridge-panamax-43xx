"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PanamaxMasterSwitchAccessory = exports.PanamaxIndividualOutletAccessory = exports.PanamaxDeviceAccessory = void 0;
exports.resolveOutletControlMode = resolveOutletControlMode;
exports.resolveOrderedOutlets = resolveOrderedOutlets;
function resolveOutletControlMode(deviceConfig) {
    if (deviceConfig.outletControlMode === 'outletsAndMaster' ||
        deviceConfig.outletControlMode === 'outletsOnly' ||
        deviceConfig.outletControlMode === 'masterOnly') {
        return deviceConfig.outletControlMode;
    }
    if (deviceConfig.enableAllOutletsSwitch === false) {
        return 'outletsOnly';
    }
    return 'outletsAndMaster';
}
function resolveOrderedOutlets(deviceConfig) {
    const ordered = [];
    const legacyOutlets = Array.isArray(deviceConfig.outlets) ? deviceConfig.outlets : [];
    for (let i = 1; i <= 8; i++) {
        const fixedKey = `outlet${i}`;
        const fixed = deviceConfig[fixedKey];
        const legacy = legacyOutlets.find((o) => o.index === i) || legacyOutlets[i - 1];
        const name = fixed?.name?.trim() || legacy?.name?.trim() || `Outlet ${i}`;
        const accessoryType = fixed?.accessoryType || legacy?.accessoryType || 'Outlet';
        ordered.push({
            index: i,
            name,
            enabled: true,
            accessoryType,
        });
    }
    return ordered;
}
/**
 * Unified Device Accessory (Default & Recommended):
 * Exposes the entire Panamax unit as a single HomeKit accessory with 8 outlet services (1..8) and/or a Master Switch.
 */
class PanamaxDeviceAccessory {
    platform;
    accessory;
    client;
    deviceConfig;
    outletServices = new Map();
    masterService;
    constructor(platform, accessory, client, deviceConfig) {
        this.platform = platform;
        this.accessory = accessory;
        this.client = client;
        this.deviceConfig = deviceConfig;
        const deviceIdentifier = deviceConfig.id || deviceConfig.name;
        // 1. Configure AccessoryInformation
        const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation);
        infoService
            .setCharacteristic(this.platform.Characteristic.Name, deviceConfig.name)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panamax')
            .setCharacteristic(this.platform.Characteristic.Model, client.status.model || 'M4320-PRO')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `PANAMAX-${deviceIdentifier}`);
        // Update dynamic model/firmware if reported by the device
        this.client.on('info', (status) => {
            if (status.model) {
                infoService.updateCharacteristic(this.platform.Characteristic.Model, status.model);
            }
            if (status.firmware) {
                infoService.updateCharacteristic(this.platform.Characteristic.FirmwareRevision, status.firmware);
            }
        });
        const controlMode = resolveOutletControlMode(this.deviceConfig);
        const exposeOutlets = controlMode === 'outletsAndMaster' || controlMode === 'outletsOnly';
        const exposeMaster = controlMode === 'outletsAndMaster' || controlMode === 'masterOnly';
        // 2. Setup or remove Outlets 1..8 in numeric order (Outlet 1 first, Outlet 8 last)
        if (exposeOutlets) {
            this.setupOutlets();
        }
        else {
            this.removeAllOutletServices();
        }
        // 3. Setup or remove Master Switch (All Outlets)
        if (exposeMaster) {
            this.setupMasterSwitch();
        }
        else {
            this.removeServiceIfPresent(this.platform.Service.Switch, 'master');
            this.masterService = undefined;
        }
        // 4. Optional Reboot Buttons (Momentary Switches)
        if (this.deviceConfig.enableRebootButtons) {
            this.setupRebootButtons();
        }
        else {
            this.removeServiceIfPresent(this.platform.Service.Switch, 'reboot-1');
            this.removeServiceIfPresent(this.platform.Service.Switch, 'reboot-2');
        }
        // 5. Listen for live state changes from the Panamax TCP client
        this.client.on('outletChange', (index, state) => {
            const service = this.outletServices.get(index);
            if (service) {
                service.updateCharacteristic(this.platform.Characteristic.On, state);
                if (service.testCharacteristic(this.platform.Characteristic.OutletInUse)) {
                    service.updateCharacteristic(this.platform.Characteristic.OutletInUse, state);
                }
            }
            if (this.masterService) {
                this.masterService.updateCharacteristic(this.platform.Characteristic.On, this.isAnyOutletOn());
            }
        });
    }
    setServiceName(service, name) {
        service.displayName = name;
        service.setCharacteristic(this.platform.Characteristic.Name, name);
        // Do NOT set ServiceLabelIndex on outlets; ServiceLabelIndex causes Apple Home
        // to override custom names with generic "Outlet 1".."Outlet 8" labels.
        if (service.testCharacteristic(this.platform.Characteristic.ServiceLabelIndex)) {
            const labelChar = service.getCharacteristic(this.platform.Characteristic.ServiceLabelIndex);
            service.removeCharacteristic(labelChar);
        }
        if (!service.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
            service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
        }
        service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
        service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onGet(() => name);
    }
    setupOutlets() {
        const orderedOutlets = resolveOrderedOutlets(this.deviceConfig);
        for (const outletConfig of orderedOutlets) {
            const i = outletConfig.index;
            const outletDisplayName = outletConfig.name?.trim() || `Outlet ${i}`;
            // Include the configured name in the subtype so that renaming an outlet in Homebridge
            // assigns a fresh HAP instance ID (iid) and forces Apple HomeKit to adopt the new name.
            const subtype = `outlet-${i}-${outletDisplayName}`;
            const isOutletType = (outletConfig.accessoryType || 'Outlet') === 'Outlet';
            const TargetService = isOutletType ? this.platform.Service.Outlet : this.platform.Service.Switch;
            // Remove any existing service for this outlet index whose subtype or service type doesn't match
            const existingForIndex = this.accessory.services.filter((s) => s.subtype === `outlet-${i}` || (s.subtype?.startsWith(`outlet-${i}-`) ?? false));
            for (const oldService of existingForIndex) {
                if (oldService.subtype !== subtype || oldService.UUID !== TargetService.UUID) {
                    this.accessory.removeService(oldService);
                }
            }
            let service = this.accessory.getServiceById(TargetService, subtype);
            if (!service) {
                service = this.accessory.addService(TargetService, outletDisplayName, subtype);
            }
            this.setServiceName(service, outletDisplayName);
            // Configure characteristics
            service.getCharacteristic(this.platform.Characteristic.On)
                .onSet((value) => this.setOutletState(i, value))
                .onGet(() => !!this.client.status.outlets[i]);
            if (isOutletType) {
                service.getCharacteristic(this.platform.Characteristic.OutletInUse)
                    .onGet(() => !!this.client.status.outlets[i]);
            }
            this.outletServices.set(i, service);
        }
    }
    removeAllOutletServices() {
        const toRemove = this.accessory.services.filter((s) => s.subtype !== undefined && /^outlet-[1-8](-|$)/.test(s.subtype));
        for (const service of toRemove) {
            this.accessory.removeService(service);
        }
        this.outletServices.clear();
    }
    setupMasterSwitch() {
        const subtype = 'master';
        const name = `${this.deviceConfig.name} All Outlets`;
        let service = this.accessory.getServiceById(this.platform.Service.Switch, subtype);
        if (!service) {
            service = this.accessory.addService(this.platform.Service.Switch, name, subtype);
        }
        this.setServiceName(service, name);
        service.getCharacteristic(this.platform.Characteristic.On)
            .onSet(async (value) => {
            const on = value;
            try {
                if (on) {
                    await this.client.setAllOn();
                }
                else {
                    await this.client.setAllOff();
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.platform.log.error(`[${this.deviceConfig.name}] Failed to toggle All Outlets: ${message}`);
                throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
            }
        })
            .onGet(() => this.isAnyOutletOn());
        this.masterService = service;
    }
    setupRebootButtons() {
        for (const rebootId of [1, 2]) {
            const subtype = `reboot-${rebootId}`;
            const name = `${this.deviceConfig.name} Reboot ${rebootId}`;
            let service = this.accessory.getServiceById(this.platform.Service.Switch, subtype);
            if (!service) {
                service = this.accessory.addService(this.platform.Service.Switch, name, subtype);
            }
            this.setServiceName(service, name);
            service.getCharacteristic(this.platform.Characteristic.On)
                .onSet(async (value) => {
                if (value) {
                    try {
                        if (rebootId === 1) {
                            await this.client.triggerReboot1();
                        }
                        else {
                            await this.client.triggerReboot2();
                        }
                    }
                    catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        this.platform.log.error(`[${this.deviceConfig.name}] Failed to trigger Reboot ${rebootId}: ${message}`);
                        throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
                    }
                    finally {
                        // Momentary reset back to OFF after 1 second
                        setTimeout(() => {
                            service?.updateCharacteristic(this.platform.Characteristic.On, false);
                        }, 1000);
                    }
                }
            })
                .onGet(() => false);
        }
    }
    isAnyOutletOn() {
        for (let i = 1; i <= 8; i++) {
            if (this.client.status.outlets[i]) {
                return true;
            }
        }
        return false;
    }
    async setOutletState(outletIndex, targetState) {
        try {
            await this.client.setOutlet(outletIndex, targetState);
            const service = this.outletServices.get(outletIndex);
            if (service && service.testCharacteristic(this.platform.Characteristic.OutletInUse)) {
                service.updateCharacteristic(this.platform.Characteristic.OutletInUse, targetState);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.platform.log.error(`[${this.deviceConfig.name}] Failed to switch outlet ${outletIndex}: ${message}`);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    removeServiceIfPresent(serviceType, subtype) {
        const existing = this.accessory.getServiceById(serviceType, subtype);
        if (existing) {
            this.accessory.removeService(existing);
        }
    }
}
exports.PanamaxDeviceAccessory = PanamaxDeviceAccessory;
/**
 * Individual Outlet Accessory Mode (Alternative):
 * Used only when accessoryMode is explicitly set to 'individual'.
 */
class PanamaxIndividualOutletAccessory {
    platform;
    accessory;
    client;
    deviceConfig;
    service;
    outletIndex;
    isOutletType;
    constructor(platform, accessory, client, deviceConfig, outletConfig) {
        this.platform = platform;
        this.accessory = accessory;
        this.client = client;
        this.deviceConfig = deviceConfig;
        this.outletIndex = outletConfig.index;
        this.isOutletType = (outletConfig.accessoryType || 'Outlet') === 'Outlet';
        const deviceIdentifier = deviceConfig.id || deviceConfig.name;
        const displayName = `${deviceConfig.name} ${outletConfig.name?.trim() || `Outlet ${this.outletIndex}`}`;
        this.accessory.displayName = displayName;
        this.accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Name, displayName)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panamax')
            .setCharacteristic(this.platform.Characteristic.Model, client.status.model || 'M4320-PRO')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `PANAMAX-${deviceIdentifier}-OUTLET-${this.outletIndex}`);
        const TargetService = this.isOutletType ? this.platform.Service.Outlet : this.platform.Service.Switch;
        const OpposingService = this.isOutletType ? this.platform.Service.Switch : this.platform.Service.Outlet;
        const oldOpposing = this.accessory.getService(OpposingService);
        if (oldOpposing) {
            this.accessory.removeService(oldOpposing);
        }
        this.service = this.accessory.getService(TargetService) || this.accessory.addService(TargetService, displayName);
        this.service.displayName = displayName;
        this.service.setCharacteristic(this.platform.Characteristic.Name, displayName);
        if (!this.service.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
            this.service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
        }
        this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName);
        this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onGet(() => displayName);
        this.service.getCharacteristic(this.platform.Characteristic.On)
            .onSet(this.setOn.bind(this))
            .onGet(this.getOn.bind(this));
        if (this.isOutletType) {
            this.service.getCharacteristic(this.platform.Characteristic.OutletInUse)
                .onGet(this.getOn.bind(this));
        }
        this.client.on('outletChange', (index, state) => {
            if (index === this.outletIndex) {
                this.service.updateCharacteristic(this.platform.Characteristic.On, state);
                if (this.isOutletType) {
                    this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, state);
                }
            }
        });
    }
    async setOn(value) {
        const targetState = value;
        try {
            await this.client.setOutlet(this.outletIndex, targetState);
            if (this.isOutletType) {
                this.service.updateCharacteristic(this.platform.Characteristic.OutletInUse, targetState);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.platform.log.error(`[${this.deviceConfig.name}] Outlet ${this.outletIndex} error: ${message}`);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    async getOn() {
        return !!this.client.status.outlets[this.outletIndex];
    }
}
exports.PanamaxIndividualOutletAccessory = PanamaxIndividualOutletAccessory;
/**
 * Individual Master Switch Accessory:
 * Used when accessoryMode is 'individual' and Master Switch is enabled.
 */
class PanamaxMasterSwitchAccessory {
    platform;
    accessory;
    client;
    deviceConfig;
    service;
    constructor(platform, accessory, client, deviceConfig) {
        this.platform = platform;
        this.accessory = accessory;
        this.client = client;
        this.deviceConfig = deviceConfig;
        const deviceIdentifier = deviceConfig.id || deviceConfig.name;
        const displayName = `${deviceConfig.name} All Outlets`;
        this.accessory.displayName = displayName;
        this.accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Name, displayName)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Panamax')
            .setCharacteristic(this.platform.Characteristic.Model, client.status.model || 'M4320-PRO')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `PANAMAX-${deviceIdentifier}-MASTER`);
        this.service = this.accessory.getService(this.platform.Service.Switch) ||
            this.accessory.addService(this.platform.Service.Switch, displayName);
        this.service.displayName = displayName;
        this.service.setCharacteristic(this.platform.Characteristic.Name, displayName);
        if (!this.service.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
            this.service.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
        }
        this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName);
        this.service.getCharacteristic(this.platform.Characteristic.ConfiguredName)
            .onGet(() => displayName);
        this.service.getCharacteristic(this.platform.Characteristic.On)
            .onSet(async (value) => {
            const on = value;
            try {
                if (on) {
                    await this.client.setAllOn();
                }
                else {
                    await this.client.setAllOff();
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.platform.log.error(`[${this.deviceConfig.name}] Failed to toggle All Outlets: ${message}`);
                throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
            }
        })
            .onGet(() => this.isAnyOutletOn());
        this.client.on('outletChange', () => {
            this.service.updateCharacteristic(this.platform.Characteristic.On, this.isAnyOutletOn());
        });
    }
    isAnyOutletOn() {
        for (let i = 1; i <= 8; i++) {
            if (this.client.status.outlets[i]) {
                return true;
            }
        }
        return false;
    }
}
exports.PanamaxMasterSwitchAccessory = PanamaxMasterSwitchAccessory;
//# sourceMappingURL=platformAccessory.js.map