"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLUGIN_VERSION = exports.PANAMAX_DEFAULT_DELAY = exports.PANAMAX_DEFAULT_POLL_INTERVAL = exports.PANAMAX_DEFAULT_PORT = exports.PLUGIN_NAME = exports.PLATFORM_NAME = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
/**
 * Name of the platform registered in Homebridge.
 * This matches the platform name used in config.json and config.schema.json.
 */
exports.PLATFORM_NAME = 'Panamax43xx';
/**
 * Name of the npm package.
 * This matches the name in package.json.
 */
exports.PLUGIN_NAME = 'homebridge-panamax-43xx';
/**
 * Default Panamax BlueBOLT TCP / Telnet port.
 */
exports.PANAMAX_DEFAULT_PORT = 23;
/**
 * Default status polling interval in seconds.
 */
exports.PANAMAX_DEFAULT_POLL_INTERVAL = 10;
/**
 * Default hardware switching delay window in seconds.
 */
exports.PANAMAX_DEFAULT_DELAY = 30;
function readPluginVersion() {
    try {
        const pkgPath = path.resolve(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (typeof pkg.version === 'string' && pkg.version.trim()) {
            return pkg.version.trim();
        }
    }
    catch {
        // Ignore read errors and fall back to default version string
    }
    return '0.0.0';
}
/**
 * Current plugin version read from package.json.
 */
exports.PLUGIN_VERSION = readPluginVersion();
//# sourceMappingURL=settings.js.map