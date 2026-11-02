"use strict";
const settings_1 = require("./settings");
const platform_1 = require("./platform");
module.exports = (api) => {
    api.registerPlatform(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, platform_1.Panamax43xxPlatform);
    // Also register legacy alias to ensure seamless compatibility with existing configurations
    api.registerPlatform('homebridge-panamax-4320-pro', 'Panamax4320', platform_1.Panamax43xxPlatform);
};
//# sourceMappingURL=index.js.map