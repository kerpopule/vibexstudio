const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * VibeXStudio uses expo-notifications only for on-device completion alerts.
 * The app never requests a device push token or registers a push payload path,
 * so the generated APNs entitlement would overstate the release capability.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults['aps-environment'];
    return modConfig;
  });
};
