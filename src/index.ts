import { API } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Panamax43xxPlatform } from './platform';

/**
 * Entry point for Homebridge to load the plugin.
 */
export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, Panamax43xxPlatform);
  // Also register legacy alias to ensure seamless compatibility with existing configurations
  api.registerPlatform('homebridge-panamax-4320-pro', 'Panamax4320', Panamax43xxPlatform);
};
