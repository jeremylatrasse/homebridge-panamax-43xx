//
//  main.swift
//  homebridge-panamax-43xx
//
//  A macOS Swift utility to test and communicate with Panamax M4315-PRO
//  and M4320-PRO power conditioners over raw TCP / Telnet (port 23).
//

import Foundation
import Network
import os

/// Actor responsible for TCP communication with a Panamax M4315-PRO / M4320-PRO unit.
actor PanamaxSwiftClient {
    private let host: String
    private let port: UInt16
    private var connection: NWConnection?
    private var isConnected = false

    init(host: String, port: UInt16 = 23) {
        self.host = host
        self.port = port
    }

    /// Connects to the device using Apple Network framework.
    func connect() async throws {
        let endpoint = NWEndpoint.Host(host)
        let nwPort = NWEndpoint.Port(rawValue: port) ?? .init(integerLiteral: 23)
        let parameters = NWParameters.tcp

        let conn = NWConnection(host: endpoint, port: nwPort, using: parameters)
        self.connection = conn

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let isResumed = OSAllocatedUnfairLock(initialState: false)

            conn.stateUpdateHandler = { state in
                let shouldResume = {
                    isResumed.withLock { resumed in
                        guard !resumed else { return false }
                        resumed = true
                        return true
                    }
                }

                switch state {
                case .ready:
                    if shouldResume() {
                        continuation.resume()
                    }
                case .failed(let error):
                    if shouldResume() {
                        continuation.resume(throwing: error)
                    }
                case .cancelled:
                    if shouldResume() {
                        continuation.resume(throwing: POSIXError(.ECANCELED))
                    }
                default:
                    break
                }
            }

            conn.start(queue: .global())
        }

        self.isConnected = true
    }

    /// Disconnects the socket.
    func disconnect() {
        connection?.cancel()
        connection = nil
        isConnected = false
    }

    /// Sends a raw command line and awaits the response chunk.
    func sendCommand(_ command: String) async throws -> String {
        guard let connection = self.connection, isConnected else {
            throw POSIXError(.ENOTCONN)
        }

        let formattedCommand = command.hasSuffix("\r") ? command : "\(command)\r"
        guard let data = formattedCommand.data(using: .ascii) else {
            throw POSIXError(.EINVAL)
        }

        // Send
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: data, completion: .contentProcessed { error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            })
        }

        // Read response
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { content, _, _, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }

                guard let content = content, !content.isEmpty else {
                    continuation.resume(returning: "")
                    return
                }

                // Strip Telnet IAC (0xFF)
                var cleanBytes = [UInt8]()
                var i = 0
                let bytes = [UInt8](content)
                while i < bytes.count {
                    if bytes[i] == 0xFF {
                        let cmd = (i + 1 < bytes.count) ? bytes[i + 1] : 0
                        if cmd >= 251 && cmd <= 254 {
                            i += 3
                        } else {
                            i += 2
                        }
                    } else {
                        cleanBytes.append(bytes[i])
                        i += 1
                    }
                }

                let response = String(bytes: cleanBytes, encoding: .ascii) ?? ""
                continuation.resume(returning: response)
            }
        }
    }
}

/// Command line CLI runner
struct PanamaxCLI {
    static func run() async {
        let args = CommandLine.arguments

        if args.contains("--help") || args.count < 2 {
            printUsage()
            return
        }

        var host: String?
        var port: UInt16 = 23
        var command = "?OUTLETSTAT\r"

        var i = 1
        while i < args.count {
            let arg = args[i]
            switch arg {
            case "--host", "-h":
                if i + 1 < args.count {
                    host = args[i + 1]
                    i += 1
                } else {
                    printUsage()
                    return
                }
            case "--port", "-p":
                if i + 1 < args.count, let p = UInt16(args[i + 1]) {
                    port = p
                    i += 1
                }
            case "--status":
                command = "?OUTLETSTAT\r"
            case "--id":
                command = "?ID\r"
            case "--faults":
                command = "?FAULTSTAT\r"
            case "--switch":
                if i + 2 < args.count {
                    let outlet = args[i + 1]
                    let state = args[i + 2].uppercased()
                    command = "!SWITCH \(outlet) \(state)\r"
                    i += 2
                }
            case "--raw":
                if i + 1 < args.count {
                    command = args[i + 1]
                    i += 1
                }
            default:
                break
            }
            i += 1
        }

        guard let targetHost = host else {
            print("Error: --host <IP or hostname> is required.\n")
            printUsage()
            return
        }

        print("Connecting to \(targetHost):\(port)...")
        let client = PanamaxSwiftClient(host: targetHost, port: port)

        do {
            try await client.connect()
            print("Connected! Sending command: \(command.trimmingCharacters(in: .whitespacesAndNewlines))")
            let response = try await client.sendCommand(command)
            print("--- Response ---")
            print(response.trimmingCharacters(in: .whitespacesAndNewlines))
            print("----------------")
            await client.disconnect()
        } catch {
            print("Communication error: \(error.localizedDescription)")
        }
    }

    static func printUsage() {
        print("""
        Usage:
          homebridge-panamax-43xx --host <ip> [options]

        Supported Models:
          Panamax M4315-PRO, Panamax M4320-PRO

        Options:
          --host, -h <ip>         Device IP address (e.g. 192.168.1.50)
          --port, -p <port>       Port (default: 23)
          --status                Query outlet states (?OUTLETSTAT)
          --id                    Query device model & firmware (?ID)
          --faults                Query fault conditions (?FAULTSTAT)
          --switch <1-8> <ON|OFF> Switch an outlet ON or OFF
          --raw "<command>"       Send arbitrary raw command (e.g. '!ALL_ON')
          --help                  Show this usage message

        Homebridge Plugin Note:
          The Homebridge plugin source is located in the root repository.
          See README.md for installation into your Homebridge instance.
        """)
    }
}

// Top-level entrypoint in main.swift
await PanamaxCLI.run()
