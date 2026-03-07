import {
  cacheDirectory,
  createDownloadResumable,
  getContentUriAsync,
} from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

export type DownloadProgress = {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
};

export async function downloadAndInstallApk(
  downloadUrl: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("APK installation is only supported on Android");
  }

  const localUri = `${cacheDirectory}update.apk`;

  const downloadResumable = createDownloadResumable(
    downloadUrl,
    localUri,
    {},
    onProgress,
  );

  const result = await downloadResumable.downloadAsync();

  if (!result?.uri) {
    throw new Error("Download failed");
  }

  const contentUri = await getContentUriAsync(result.uri);

  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
  });
}
