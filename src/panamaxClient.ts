import { EventEmitter } from 'events';
import * as net from 'net';
import { Logger } from 'homebridge';

export interface PanamaxClientConfig {
  host: string;
  port: number;
  pollInterval?: number; // in seconds
  timeout?: number;      // in seconds
  delay?: number;        // in seconds (hardware switching delay, default 30)
}

export interface PanamaxDeviceStatus {
  outlets: boolean[]; // 1-indexed (outlets[1] .. outlets[8])
  model?: string;
  firmware?: string;
  faults?: Record<string, string>;
}

export class PanamaxClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private isConnected = false;
  private isConnecting = false;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private sendQueue: Promise<void> = Promise.resolve();
  private buffer = '';

  public status: PanamaxDeviceStatus = {
    outlets: new Array(9).fill(false), // 0 unused, 1..8
  };

  private readonly host: string;
  private readonly port: number;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly delayMs: number;
  private readonly inFlightDelayUntil: Map<number, number> = new Map();
  private readonly confirmationTimers: Map<number, NodeJS.Timeout> = new Map();

  constructor(
    config: PanamaxClientConfig,
    private readonly log: Logger,
  ) {
    super();
    this.host = config.host;
    this.port = config.port || 23;
    this.pollIntervalMs = Math.max((config.pollInterval || 10) * 1000, 2000);
    this.timeoutMs = Math.max((config.timeout || 5) * 1000, 1000);
    this.delayMs = Math.max((config.delay !== undefined ? config.delay : 30) * 1000, 0);
  }

  public start(): void {
    this.ensureConnected().catch(() => {/* handled by reconnect loop */});
    this.startPolling();
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const timer of this.confirmationTimers.values()) {
      clearTimeout(timer);
    }
    this.confirmationTimers.clear();
    this.inFlightDelayUntil.clear();
    this.disconnect();
  }

  private ensureConnected(): Promise<void> {
    if (this.isConnected && this.socket && !this.socket.destroyed) {
      return Promise.resolve();
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    this.log.debug(`[${this.host}:${this.port}] Connecting...`);

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;
      let settled = false;

      const connectTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.log.debug(`[${this.host}:${this.port}] Connection attempt timed out.`);
          socket.destroy(new Error(`Connection timeout to ${this.host}:${this.port}`));
          reject(new Error(`Connection timeout to Panamax at ${this.host}:${this.port}`));
        }
      }, this.timeoutMs);

      socket.connect(this.port, this.host, () => {
        clearTimeout(connectTimeout);
        this.isConnected = true;
        this.isConnecting = false;
        this.connectPromise = null;

        // Disable idle socket timeout so the connection stays open between polls,
        // and use TCP keep-alive to detect dead peers.
        socket.setTimeout(0);
        socket.setKeepAlive(true, 15000);

        this.log.info(`[${this.host}:${this.port}] Connected to Panamax device.`);
        this.emit('connected');

        if (!settled) {
          settled = true;
          resolve();
        }

        // Attempt to enable unsolicited feedback on the device
        this.writeDirectly('!SET_FEEDBACK ON\r').catch(() => {
          this.writeDirectly('!FEEDBACK ON\r').catch(() => {/* ignore */});
        });

        // Request initial identification & outlet states
        this.writeDirectly('?ID\r').catch(() => {/* ignore */});
        this.writeDirectly('?OUTLETSTAT\r').catch(() => {/* ignore */});
      });

      socket.on('data', (data: Buffer) => {
        this.handleIncomingData(data);
      });

      socket.on('error', (err: Error) => {
        clearTimeout(connectTimeout);
        this.log.warn(`[${this.host}:${this.port}] Socket error: ${err.message}`);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      socket.on('close', (hadError: boolean) => {
        clearTimeout(connectTimeout);
        this.isConnected = false;
        this.isConnecting = false;
        this.connectPromise = null;
        if (this.socket === socket) {
          this.socket = null;
        }
        this.emit('disconnected');
        if (!settled) {
          settled = true;
          reject(new Error(`Connection closed while connecting to Panamax at ${this.host}:${this.port}`));
        }
        if (hadError) {
          this.log.warn(`[${this.host}:${this.port}] Connection closed with error. Retrying in 5s...`);
        } else {
          this.log.debug(`[${this.host}:${this.port}] Connection closed.`);
        }
        this.scheduleReconnect();
      });
    });

    return this.connectPromise;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isConnecting || this.isConnected) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch(() => {/* handled by close handler */});
    }, 5000);
  }

  private disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.connectPromise = null;
  }

  private startPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this.pollTimer = setInterval(() => {
      if (this.isConnected) {
        this.queryOutletStatus().catch((err: Error) => {
          this.log.debug(`[${this.host}] Poll error: ${err.message}`);
        });
      } else {
        this.ensureConnected().catch(() => {/* ignore */});
      }
    }, this.pollIntervalMs);
  }

  private writeDirectly(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected || this.socket.destroyed) {
        return reject(new Error(`Not connected to Panamax at ${this.host}:${this.port}`));
      }

      this.log.debug(`[${this.host}:${this.port}] TX: ${command.trim()}`);
      this.socket.write(command, 'ascii', (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  /**
   * Send a raw ASCII command string over the socket.
   * Automatically connects if currently disconnected and serializes concurrent writes
   * so simultaneous HomeKit scene commands don't collide.
   */
  public sendRaw(command: string): Promise<void> {
    const task = this.sendQueue.then(async () => {
      await this.ensureConnected();
      try {
        await this.writeDirectly(command);
      } catch {
        // Reconnect once if socket had just closed
        this.disconnect();
        await this.ensureConnected();
        await this.writeDirectly(command);
      }
      // Small delay between back-to-back commands for Panamax Telnet parser stability
      await new Promise((r) => setTimeout(r, 80));
    });

    // Keep queue alive even if an individual command fails
    this.sendQueue = task.catch(() => {/* ignore queue error */});
    return task;
  }

  /**
   * Strips Telnet IAC (0xFF) negotiation bytes so raw ASCII text is parsed cleanly.\n   */
  private stripTelnetIAC(data: Buffer): Buffer {
    const clean: number[] = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === 0xFF) {
        // Telnet IAC command
        const cmd = data[i + 1];
        if (cmd >= 251 && cmd <= 254) {
          // 3-byte command: IAC (DO|DONT|WILL|WONT) <option>
          i += 3;
        } else {
          // 2-byte command
          i += 2;
        }
      } else {
        clean.push(data[i]);
        i++;
      }
    }
    return Buffer.from(clean);
  }

  private handleIncomingData(chunk: Buffer): void {
    const cleaned = this.stripTelnetIAC(chunk);
    this.buffer += cleaned.toString('ascii');

    let delimiterIndex: number;
    while ((delimiterIndex = this.buffer.search(/[\r\n]/)) !== -1) {
      const line = this.buffer.substring(0, delimiterIndex).trim();
      this.buffer = this.buffer.substring(delimiterIndex + 1);

      if (line.length > 0) {
        this.processLine(line);
      }
    }
  }

  private processLine(line: string): void {
    this.log.debug(`[${this.host}:${this.port}] RX: ${line}`);

    // Parse status lines starting with $
    // E.g., "$OUTLET1 = ON", "$OUTLET2 = OFF"
    const outletMatch = line.match(/^\$OUTLET([1-8])\s*=\s*(ON|OFF)/i);
    if (outletMatch) {
      const outletNum = parseInt(outletMatch[1], 10);
      const state = outletMatch[2].toUpperCase() === 'ON';

      // Check if outlet is in an active switching delay window
      const delayExpiry = this.inFlightDelayUntil.get(outletNum);
      if (delayExpiry) {
        if (Date.now() < delayExpiry) {
          if (state !== this.status.outlets[outletNum]) {
            const remainingSec = Math.ceil((delayExpiry - Date.now()) / 1000);
            this.log.debug(
              `[${this.host}] Outlet ${outletNum} is in switching delay (${remainingSec}s remaining). Suppressing reported state ${state ? 'ON' : 'OFF'}.`,
            );
            return;
          } else {
            // Hardware has reached desired target state early
            this.inFlightDelayUntil.delete(outletNum);
          }
        } else {
          this.inFlightDelayUntil.delete(outletNum);
        }
      }

      const changed = this.status.outlets[outletNum] !== state;
      this.status.outlets[outletNum] = state;
      if (changed) {
        this.log.info(`[${this.host}] Outlet ${outletNum} is now ${state ? 'ON' : 'OFF'}`);
        this.emit('outletChange', outletNum, state);
      }
      return;
    }

    // Parse ID responses
    // E.g., "$PANAMAX", "$MAX 4320-PRO", "$M4320-PRO", "$FIRMWARE: 1.0"
    if (line.startsWith('$PANAMAX')) {
      return;
    }
    if (line.match(/^\$(MAX\s*4320|M4320)/i)) {
      this.status.model = line.replace(/^\$/, '').trim();
      this.emit('info', this.status);
      return;
    }
    if (line.match(/^\$FIRMWARE/i)) {
      this.status.firmware = line.replace(/^\$FIRMWARE:\s*/i, '').trim();
      this.emit('info', this.status);
      return;
    }

    // Parse FAULTSTAT
    // E.g., "$PWR = OK", "$BREAKER = OK", "$WIRE FAULT = OK"
    const faultMatch = line.match(/^\$([A-Z\s]+)\s*=\s*(OK|FAULT)/i);
    if (faultMatch) {
      if (!this.status.faults) {
        this.status.faults = {};
      }
      this.status.faults[faultMatch[1].trim()] = faultMatch[2].trim();
      this.emit('fault', this.status.faults);
      return;
    }
  }

  /**
   * Switch a specific outlet (1..8) ON or OFF.
   */
  public async setOutlet(outletNumber: number, on: boolean): Promise<boolean> {
    if (outletNumber < 1 || outletNumber > 8) {
      throw new Error(`Invalid outlet number ${outletNumber}. Must be between 1 and 8.`);
    }

    const stateStr = on ? 'ON' : 'OFF';
    const command = `!SWITCH ${outletNumber} ${stateStr}\r`;
    this.log.info(`[${this.host}] Switching Outlet ${outletNumber} -> ${stateStr} (delay: ${this.delayMs / 1000}s)`);

    // Update optimistic state and mark outlet in delay window
    this.status.outlets[outletNumber] = on;
    if (this.delayMs > 0) {
      this.inFlightDelayUntil.set(outletNumber, Date.now() + this.delayMs);
    }

    // Clear any previous pending confirmation timer for this outlet
    const existingTimer = this.confirmationTimers.get(outletNumber);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    await this.sendRaw(command);

    // Schedule verification query after the delay completes
    const checkDelay = this.delayMs > 0 ? this.delayMs + 500 : 300;
    const timer = setTimeout(() => {
      this.confirmationTimers.delete(outletNumber);
      this.queryOutletStatus().catch(() => {/* ignore */});
    }, checkDelay);
    this.confirmationTimers.set(outletNumber, timer);

    return on;
  }

  /**
   * Turn all outlets ON simultaneously.
   */
  public async setAllOn(): Promise<void> {
    this.log.info(`[${this.host}] Executing ALL_ON (delay: ${this.delayMs / 1000}s)`);
    const now = Date.now();
    for (let i = 1; i <= 8; i++) {
      this.status.outlets[i] = true;
      if (this.delayMs > 0) {
        this.inFlightDelayUntil.set(i, now + this.delayMs);
      }
      this.emit('outletChange', i, true);
    }

    const existingMasterTimer = this.confirmationTimers.get(0);
    if (existingMasterTimer) {
      clearTimeout(existingMasterTimer);
    }

    await this.sendRaw('!ALL_ON\r');
    const checkDelay = this.delayMs > 0 ? this.delayMs + 500 : 500;
    const timer = setTimeout(() => {
      this.confirmationTimers.delete(0);
      this.queryOutletStatus().catch(() => {/* ignore */});
    }, checkDelay);
    this.confirmationTimers.set(0, timer);
  }

  /**
   * Turn all outlets OFF simultaneously.
   */
  public async setAllOff(): Promise<void> {
    this.log.info(`[${this.host}] Executing ALL_OFF (delay: ${this.delayMs / 1000}s)`);
    const now = Date.now();
    for (let i = 1; i <= 8; i++) {
      this.status.outlets[i] = false;
      if (this.delayMs > 0) {
        this.inFlightDelayUntil.set(i, now + this.delayMs);
      }
      this.emit('outletChange', i, false);
    }

    const existingMasterTimer = this.confirmationTimers.get(0);
    if (existingMasterTimer) {
      clearTimeout(existingMasterTimer);
    }

    await this.sendRaw('!ALL_OFF\r');
    const checkDelay = this.delayMs > 0 ? this.delayMs + 500 : 500;
    const timer = setTimeout(() => {
      this.confirmationTimers.delete(0);
      this.queryOutletStatus().catch(() => {/* ignore */});
    }, checkDelay);
    this.confirmationTimers.set(0, timer);
  }

  /**
   * Trigger Reboot 1 sequence.
   */
  public async triggerReboot1(): Promise<void> {
    this.log.info(`[${this.host}] Triggering REBOOT_1`);
    await this.sendRaw('!REBOOT_1\r');
  }

  /**
   * Trigger Reboot 2 sequence.
   */
  public async triggerReboot2(): Promise<void> {
    this.log.info(`[${this.host}] Triggering REBOOT_2`);
    await this.sendRaw('!REBOOT_2\r');
  }

  /**
   * Query outlet status (?OUTLETSTAT).
   */
  public async queryOutletStatus(): Promise<boolean[]> {
    await this.sendRaw('?OUTLETSTAT\r');
    return this.status.outlets.slice(1);
  }

  /**
   * Query device ID (?ID).
   */
  public async queryId(): Promise<void> {
    await this.sendRaw('?ID\r');
  }

  /**
   * Query unit firmware (?FIRMWARE).
   */
  public async queryFirmware(): Promise<void> {
    await this.sendRaw('?FIRMWARE\r');
  }

  /**
   * Query unit fault status (?FAULTSTAT).
   */
  public async queryFaults(): Promise<void> {
    await this.sendRaw('?FAULTSTAT\r');
  }
}
