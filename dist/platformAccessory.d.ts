import { PlatformAccessory, CharacteristicValue } from 'homebridge';
import { Panamax43xxPlatform } from './platform';
import { PanamaxClient } from './panamaxClient';
export type OutletControlMode = 'outletsAndMaster' | 'outletsOnly' | 'masterOnly';
export interface FixedOutletConfig {
    name?: string;
    accessoryType?: 'Outlet' | 'Switch';
}
export interface OutletConfig {
    index: number;
    name?: string;
    enabled?: boolean;
    accessoryType?: 'Outlet' | 'Switch';
}
export interface PanamaxDeviceConfig {
    name: string;
    id?: string;
    host: string;
    port?: number;
    pollInterval?: number;
    delay?: number;
    accessoryMode?: 'device' | 'individual';
    outletControlMode?: OutletControlMode;
    enableAllOutletsSwitch?: boolean;
    enableRebootButtons?: boolean;
    outlet1?: FixedOutletConfig;
    outlet2?: FixedOutletConfig;
    outlet3?: FixedOutletConfig;
    outlet4?: FixedOutletConfig;
    outlet5?: FixedOutletConfig;
    outlet6?: FixedOutletConfig;
    outlet7?: FixedOutletConfig;
    outlet8?: FixedOutletConfig;
    outlets?: OutletConfig[];
}
/**
 * Sanitizes a user-supplied name for safe use in HomeKit Name / ConfiguredName
 * characteristics while preserving valid characters and falling back when empty.
 */
export declare function sanitizeHomeKitName(value: string | undefined, fallback: string): string;
export declare function resolveOutletControlMode(deviceConfig: PanamaxDeviceConfig): OutletControlMode;
export declare function resolveOrderedOutlets(deviceConfig: PanamaxDeviceConfig): OutletConfig[];
/**
 * Unified Device Accessory (Default & Recommended):
 * Exposes the entire Panamax unit as a single HomeKit accessory with 8 outlet services (1..8) and/or a Master Switch.
 */
export declare class PanamaxDeviceAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly client;
    private readonly deviceConfig;
    private outletServices;
    private masterService?;
    constructor(platform: Panamax43xxPlatform, accessory: PlatformAccessory, client: PanamaxClient, deviceConfig: PanamaxDeviceConfig);
    private setServiceName;
    private setupOutlets;
    private removeAllOutletServices;
    private setupMasterSwitch;
    private setupRebootButtons;
    private isAnyOutletOn;
    private setOutletState;
    private removeServiceIfPresent;
}
/**
 * Individual Outlet Accessory Mode (Alternative):
 * Used only when accessoryMode is explicitly set to 'individual'.
 */
export declare class PanamaxIndividualOutletAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly client;
    private readonly deviceConfig;
    private service;
    private readonly outletIndex;
    private readonly isOutletType;
    constructor(platform: Panamax43xxPlatform, accessory: PlatformAccessory, client: PanamaxClient, deviceConfig: PanamaxDeviceConfig, outletConfig: OutletConfig);
    setOn(value: CharacteristicValue): Promise<void>;
    getOn(): Promise<CharacteristicValue>;
}
/**
 * Individual Master Switch Accessory:
 * Used when accessoryMode is 'individual' and Master Switch is enabled.
 */
export declare class PanamaxMasterSwitchAccessory {
    private readonly platform;
    private readonly accessory;
    private readonly client;
    private readonly deviceConfig;
    private service;
    constructor(platform: Panamax43xxPlatform, accessory: PlatformAccessory, client: PanamaxClient, deviceConfig: PanamaxDeviceConfig);
    private isAnyOutletOn;
}
