<p align="center">
  <img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

# Homebridge Panamax 43xx Plugin (`homebridge-panamax-43xx`)

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

A dynamic platform plugin for [Homebridge](https://homebridge.io) to control **Panamax M4315-PRO** and **Panamax M4320-PRO** power conditioners over local TCP / Telnet (port 23).

---

## Supported Hardware

This plugin is specifically built and tested for both models in the Panamax 43xx series equipped with a BlueBOLT network management card (**BlueBOLT-CV1** or **BlueBOLT-CV2**):

* **Panamax M4315-PRO**: 15 Amp power conditioner with 8 individually controllable AC outlets across isolated banks.
* **Panamax M4320-PRO**: 20 Amp power conditioner with 8 individually controllable AC outlets across isolated banks.

Both models share the exact same TCP/IP communication protocol, command set, feedback broadcasting, and reboot sequencing.

---

## Features

- **Compatibility with M4315-PRO & M4320-PRO:** Full out-of-the-box support for both 15A and 20A models.
- **Single Child Bridge for All Units:** Publishes all your configured Panamax units together on **one child bridge** rather than cluttering your setup with separate bridges per device.
- **Clean Unified Device Layout:** By default, each Panamax unit is published as **one unified accessory** containing all 8 outlets in numeric order (`Outlet 1` through `Outlet 8`) with distinct HomeKit `ConfiguredName` labels.
- **Flexible Outlet & Master Switch Modes:** Choose between **Individual Outlets (1–8) + Master Switch**, **Individual Outlets (1–8) Only**, or **Master Switch Only**.
- **Pre-Populated Numeric Outlet Fields:** Outlets 1 through 8 are pre-populated in order (`Outlet 1` first, `Outlet 8` last) in Homebridge Config UI X—no sliders required.
- **Direct Local Network Control:** Fast, reliable communication via raw TCP/Telnet (`Port 23`) directly to the Panamax BlueBOLT card. No cloud connection or external services required.
- **Smart Hardware Switching Delay:** Includes a configurable 30-second outlet switching delay window. When toggling outlets in Apple Home, HomeKit acknowledges the press immediately so buttons never time out, while background polls prevent premature hardware state readings from snapping buttons back before power sequencing completes.
- **Real-Time Feedback & State Sync:** Listens for unsolicited feedback broadcasts from the Panamax and polls periodically to keep Apple Home in sync when outlets are toggled physically.
- **Optional Reboot Switches:** Exposes Reboot 1 and Reboot 2 as momentary buttons in HomeKit to trigger power-cycling sequences.
- **Built-in Swift Diagnostic Tool:** Includes a native macOS CLI tool in the repository for direct troubleshooting and testing from terminal or Xcode.

---

## Installation

### Homebridge Config UI X (Recommended)
1. Open the **Homebridge Config UI X** web interface.
2. Go to the **Plugins** tab and search for `homebridge-panamax-43xx`.
3. Click **Install** and configure your Panamax unit(s) in the plugin settings.

### Command Line (npm)
```bash
npm install -g homebridge-panamax-43xx
```

### Direct Zero-Compile GitHub Install
Pre-compiled `dist/` artifacts are tracked in git so Homebridge hosts do not need `typescript` installed:
```bash
npm install -g git+https://github.com/jeremylatrasse/homebridge-panamax-43xx.git
```

---

## Running as a Single Child Bridge

Homebridge child bridges run plugins in an isolated process with their own HomeKit pairing code. Because this plugin is a **Dynamic Platform**, **all Panamax devices configured under this platform are published together on 1 single child bridge**:

1. In the **Homebridge Config UI X** dashboard, go to the **Plugins** tab.
2. Find the **Panamax 43xx** plugin card.
3. Click the **Wrench icon** (Settings) -> **Bridge Settings**.
4. Toggle **Run as Child Bridge** and click **Save**.
5. Restart Homebridge.
6. Scan the single QR code shown on the dashboard to pair all your Panamax devices into Apple Home at once!

---

## Configuration

### Example `config.json` with Multiple Units

```json
{
  "platforms": [
    {
      "platform": "Panamax43xx",
      "name": "Panamax 43xx",
      "_bridge": {
        "username": "0E:43:20:AA:BB:CC",
        "port": 51820
      },
      "devices": [
        {
          "name": "AV Rack 4320",
          "id": "rack-panamax-01",
          "host": "192.168.1.50",
          "port": 23,
          "pollInterval": 10,
          "delay": 30,
          "accessoryMode": "device",
          "outletControlMode": "outletsAndMaster",
          "enableRebootButtons": false,
          "outlet1": { "name": "AV Receiver", "accessoryType": "Outlet" },
          "outlet2": { "name": "Apple TV", "accessoryType": "Outlet" },
          "outlet3": { "name": "Subwoofer", "accessoryType": "Switch" },
          "outlet4": { "name": "Turntable", "accessoryType": "Switch" },
          "outlet5": { "name": "Game Console", "accessoryType": "Outlet" },
          "outlet6": { "name": "Network Switch", "accessoryType": "Outlet" },
          "outlet7": { "name": "Modem", "accessoryType": "Outlet" },
          "outlet8": { "name": "Access Point", "accessoryType": "Outlet" }
        },
        {
          "name": "Living Room 4315",
          "id": "living-room-panamax-02",
          "host": "192.168.1.51",
          "port": 23,
          "pollInterval": 10,
          "delay": 30,
          "accessoryMode": "device",
          "outletControlMode": "masterOnly",
          "enableRebootButtons": false
        }
      ]
    }
  ]
}
```

### Configuration Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `platform` | `string` | **Yes** | `"Panamax43xx"` | Platform identifier (also accepts `"Panamax4320"`) |
| `name` | `string` | **Yes** | `"Panamax 43xx"` | Platform instance name in Homebridge |
| `devices` | `array` | **Yes** | `[]` | List of Panamax hardware units to manage |
| `devices[].name` | `string` | **Yes** | — | Unique, identifiable name for the unit (e.g. *"AV Rack 4320"*, *"Living Room 4315"*) |
| `devices[].id` | `string` | No | — | Optional unique ID to keep persistent HomeKit pairing if IP changes |
| `devices[].host` | `string` | **Yes** | — | 4-octet IPv4 address or RFC 1123 hostname of the Panamax unit |
| `devices[].port` | `integer` | No | `23` | TCP port (`1`–`65535`, default is `23`) |
| `devices[].pollInterval` | `integer` | No | `10` | Status polling interval in seconds (`2`–`3600`, default is `10`) |
| `devices[].delay` | `integer` | No | `30` | Delay in seconds per outlet (`0`–`300`) for hardware power sequencing and relay switching before verifying status |
| `devices[].accessoryMode` | `string` | No | `"device"` | `"device"` (1 unified accessory per unit) or `"individual"` (separate accessory per outlet) |
| `devices[].outletControlMode` | `string` | No | `"outletsAndMaster"` | `"outletsAndMaster"` (Outlets 1–8 + Master Switch), `"outletsOnly"` (Outlets 1–8 Only), or `"masterOnly"` (Master Switch Only) |
| `devices[].enableRebootButtons` | `boolean` | No | `false` | Expose Reboot 1 / Reboot 2 buttons |
| `devices[].outlet1` … `outlet8` | `object` | No | `{"name": "Outlet N", "accessoryType": "Outlet"}` | Pre-ordered settings (`name` and `accessoryType`) for Outlet 1 through Outlet 8 |

---

## macOS Swift Diagnostic Tool

The repository includes a native Swift CLI executable in the Xcode project (`homebridge-panamax-43xx.xcodeproj`).

You can run it from Xcode or terminal to test communication with any Panamax M4315-PRO or M4320-PRO device:
```bash
# Query all outlet states
./Products/homebridge-panamax-43xx --host 192.168.1.50 --status

# Query device identity and firmware
./Products/homebridge-panamax-43xx --host 192.168.1.50 --id

# Switch Outlet 1 ON or OFF
./Products/homebridge-panamax-43xx --host 192.168.1.50 --switch 1 ON
./Products/homebridge-panamax-43xx --host 192.168.1.50 --switch 1 OFF
```

---

## License

This project is licensed under the Apache 2.0 License.
