const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

/** User-configured Media Lab and local model hosts may use HTTP on a LAN or
 * Tailscale network. Android otherwise blocks these in release builds.
 * This permits HTTP app-wide; it does not bypass HTTPS certificate checks.
 */
module.exports = function withSelfHostedNetwork(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });
};
