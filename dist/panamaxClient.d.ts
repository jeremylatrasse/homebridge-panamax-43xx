import { EventEmitter } from 'events';
import { Logger } from 'homebridge';
export interface PanamaxClientConfig {
    host: string;
    port: number;
    pollInterval?: number;
    timeout?: number;
    delay?: number;
}
export interface PanamaxDeviceStatus {
    outlets: boolean[];
    model?: string;
    firmware?: string;
    faults?: Record<string, string>;
}
export declare class PanamaxClient extends EventEmitter {
    private readonly log;
    private socket;
    private isConnected;
    private isConnecting;
    private connectPromise;
    private reconnectTimer;
    private pollTimer;
    private sendQueue;
    private buffer;
    status: PanamaxDeviceStatus;
    private readonly host;
    private readonly port;
    private readonly pollIntervalMs;
    private readonly timeoutMs;
    private readonly delayMs;
    private readonly inFlightDelayUntil;
    private readonly confirmationTimers;
    constructor(config: PanamaxClientConfig, log: Logger);
    start(): void;
    stop(): void;
    private ensureConnected;
    private scheduleReconnect;
    private disconnect;
    private startPolling;
    private writeDirectly;
    /**
     * Send a raw ASCII command string over the socket.
     * Automatically connects if currently disconnected and serializes concurrent writes
     * so simultaneous HomeKit scene commands don't collide.
     */
    sendRaw(command: string): Promise<void>;
    /**
     * Strips Telnet IAC (0xFF) negotiation bytes so raw ASCII text is parsed cleanly.\n   */
    private stripTelnetIAC;
    private handleIncomingData;
    private processLine;
    /**
     * Switch a specific outlet (1..8) ON or OFF.
     */
    setOutlet(outletNumber: number, on: boolean): Promise<boolean>;
    /**
     * Turn all outlets ON simultaneously.
     */
    setAllOn(): Promise<void>;
    /**
     * Turn all outlets OFF simultaneously.
     */
    setAllOff(): Promise<void>;
    /**
     * Trigger Reboot 1 sequence.
     */
    triggerReboot1(): Promise<void>;
    /**
     * Trigger Reboot 2 sequence.
     */
    triggerReboot2(): Promise<void>;
    /**
     * Query outlet status (?OUTLETSTAT).
     */
    queryOutletStatus(): Promise<boolean[]>;
    /**
     * Query device ID (?ID).
     */
    queryId(): Promise<void>;
    /**
     * Query unit firmware (?FIRMWARE).
     */
    queryFirmware(): Promise<void>;
    /**
     * Query unit fault status (?FAULTSTAT).
     */
    queryFaults(): Promise<void>;
}
