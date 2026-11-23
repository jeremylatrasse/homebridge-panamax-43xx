import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { PanamaxDeviceConfig } from './platformAccessory';
export interface NormalizedPlatformConfig {
    name: string;
    platform: string;
    devices: PanamaxDeviceConfig[];
}
/**
 * Safely normalizes raw Homebridge PlatformConfig into strongly typed Panamax settings
 * without throwing on malformed or partial entries.
 */
export declare function normalizePlatformConfig(config: PlatformConfig | undefined): NormalizedPlatformConfig;
export declare class Panamax43xxPlatform implements DynamicPlatformPlugin {
    readonly log: Logger;
    readonly config: PlatformConfig;
    readonly api: API;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly accessories: PlatformAccessory[];
    readonly registeredPlatformName: string;
    private readonly clients;
    private readonly normalizedConfig;
    constructor(log: Logger, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    discoverDevices(): void;
}
