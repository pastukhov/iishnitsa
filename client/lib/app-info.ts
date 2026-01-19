import Constants from "expo-constants";

const expoConfig = Constants.expoConfig ?? Constants.manifest;

const appName = expoConfig?.name ?? "Iishnitsa";
const appVersion = expoConfig?.version ?? "0.0.0";
const androidVersionCode =
  typeof expoConfig?.android?.versionCode === "number"
    ? expoConfig.android.versionCode
    : undefined;

export const appInfo = {
  name: appName,
  version: appVersion,
  androidVersionCode,
};
