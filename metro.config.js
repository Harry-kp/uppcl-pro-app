// `@shared/*` → ./shared (the API client, crypto and insights, vendored from the uppcl-pro web app).
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.extraNodeModules = { "@shared": path.resolve(__dirname, "shared") };

module.exports = config;
