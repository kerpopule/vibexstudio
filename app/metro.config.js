// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// FlowDeck's UI-automation sessions write screenshots into .flowdeck/ inside
// the project — without this, every capture triggers a Fast Refresh.
config.resolver.blockList = [/\.flowdeck\/.*/];
config.watcher = {
  ...config.watcher,
  additionalExts: [],
  ignored: [/\.flowdeck\/.*/],
};

module.exports = config;
