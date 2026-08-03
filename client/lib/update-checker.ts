import AsyncStorage from "@react-native-async-storage/async-storage";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import { Platform } from "react-native";

import { appInfo } from "@/lib/app-info";
import { compareVersions, fetchLatestRelease } from "@/lib/github-releases";
import {
  apkFileExists,
  deleteApkFile,
  downloadApk,
  getUpdateApkPath,
  installApk,
} from "@/lib/apk-installer";

export const UPDATE_CHECK_TASK_NAME = "background-update-check";

const PENDING_UPDATE_STORAGE_KEY = "@ai_agent_pending_update";

// Every ~6 hours; the OS treats this as a minimum, not an exact schedule.
const CHECK_INTERVAL_MINUTES = 6 * 60;

export interface PendingUpdate {
  version: string;
  releaseName: string;
  releaseUrl: string;
  localUri: string;
  downloadedAt: string;
}

async function readPendingUpdate(): Promise<PendingUpdate | null> {
  const raw = await AsyncStorage.getItem(PENDING_UPDATE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingUpdate;
  } catch {
    return null;
  }
}

export async function checkForUpdateAndDownload(): Promise<void> {
  const release = await fetchLatestRelease();
  if (!release.isUpdateAvailable) return;

  // getLatestReleaseDownloadUrl() falls back to the release page URL when no
  // .apk asset exists; only attempt a background download for a real asset.
  if (!release.downloadUrl.toLowerCase().endsWith(".apk")) return;

  const existing = await readPendingUpdate();
  if (existing && existing.version === release.latestVersion) {
    if (await apkFileExists(existing.localUri)) return; // already downloaded
  }

  const localUri = await downloadApk(release.downloadUrl, getUpdateApkPath());

  const pending: PendingUpdate = {
    version: release.latestVersion,
    releaseName: release.releaseName,
    releaseUrl: release.releaseUrl,
    localUri,
    downloadedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(
    PENDING_UPDATE_STORAGE_KEY,
    JSON.stringify(pending),
  );
}

// Must run unconditionally at module scope: when the OS wakes the app in the
// background to run the task, only the JS module graph is evaluated, no
// component ever mounts, so this can't live inside a hook or effect.
if (
  Platform.OS === "android" &&
  !TaskManager.isTaskDefined(UPDATE_CHECK_TASK_NAME)
) {
  TaskManager.defineTask(UPDATE_CHECK_TASK_NAME, async () => {
    try {
      await checkForUpdateAndDownload();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      console.error("Background update check failed:", error);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerBackgroundUpdateCheck(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await BackgroundTask.registerTaskAsync(UPDATE_CHECK_TASK_NAME, {
      minimumInterval: CHECK_INTERVAL_MINUTES,
    });
  } catch (error) {
    console.error("Failed to register background update check:", error);
  }
}

/** Returns the pending update if one is downloaded and still valid, clearing stale records. */
export async function getPendingUpdate(): Promise<PendingUpdate | null> {
  const pending = await readPendingUpdate();
  if (!pending) return null;

  // Already running this version or newer (e.g. installed another way).
  if (compareVersions(appInfo.version, pending.version) >= 0) {
    await clearPendingUpdate(pending);
    return null;
  }

  if (!(await apkFileExists(pending.localUri))) {
    await AsyncStorage.removeItem(PENDING_UPDATE_STORAGE_KEY);
    return null;
  }

  return pending;
}

export async function clearPendingUpdate(
  pending: PendingUpdate,
): Promise<void> {
  await AsyncStorage.removeItem(PENDING_UPDATE_STORAGE_KEY);
  await deleteApkFile(pending.localUri);
}

export async function installPendingUpdate(
  pending: PendingUpdate,
): Promise<void> {
  await installApk(pending.localUri);
}
