import {
  cacheDirectory,
  documentDirectory,
  createDownloadResumable,
  getContentUriAsync,
  getInfoAsync,
  deleteAsync,
} from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

export type DownloadProgress = {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
};

const UPDATE_APK_FILENAME = "update.apk";

/** Persistent (survives app restarts, not cleared under storage pressure) path for a background-downloaded update. */
export function getUpdateApkPath(): string {
  return `${documentDirectory}${UPDATE_APK_FILENAME}`;
}

export async function downloadApk(
  downloadUrl: string,
  localUri: string = `${cacheDirectory}${UPDATE_APK_FILENAME}`,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
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

  return result.uri;
}

export async function installApk(localUri: string): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("APK installation is only supported on Android");
  }

  const contentUri = await getContentUriAsync(localUri);

  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
  });
}

export async function downloadAndInstallApk(
  downloadUrl: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("APK installation is only supported on Android");
  }

  const localUri = await downloadApk(downloadUrl, undefined, onProgress);
  await installApk(localUri);
}

export async function apkFileExists(localUri: string): Promise<boolean> {
  const info = await getInfoAsync(localUri);
  return info.exists;
}

export async function deleteApkFile(localUri: string): Promise<void> {
  try {
    await deleteAsync(localUri, { idempotent: true });
  } catch {
    // Best-effort cleanup; a leftover file is harmless.
  }
}
