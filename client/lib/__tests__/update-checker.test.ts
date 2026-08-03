import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundTask from "expo-background-task";

import {
  apkFileExists,
  deleteApkFile,
  downloadApk,
  installApk,
} from "../apk-installer";
import { fetchLatestRelease } from "../github-releases";
import {
  checkForUpdateAndDownload,
  clearPendingUpdate,
  getPendingUpdate,
  installPendingUpdate,
  PendingUpdate,
  registerBackgroundUpdateCheck,
  UPDATE_CHECK_TASK_NAME,
} from "../update-checker";

jest.mock("../github-releases", () => ({
  ...jest.requireActual("../github-releases"),
  fetchLatestRelease: jest.fn(),
}));

jest.mock("../apk-installer", () => ({
  apkFileExists: jest.fn(() => Promise.resolve(true)),
  deleteApkFile: jest.fn(() => Promise.resolve()),
  downloadApk: jest.fn(() =>
    Promise.resolve("file:///mock/documents/update.apk"),
  ),
  getUpdateApkPath: jest.fn(() => "file:///mock/documents/update.apk"),
  installApk: jest.fn(() => Promise.resolve()),
}));

jest.mock("expo-background-task", () => ({
  registerTaskAsync: jest.fn(() => Promise.resolve()),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));

jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
}));

const notUpdateAvailable = {
  currentVersion: "1.0.0-test",
  latestVersion: "1.0.0-test",
  releaseName: "1.0.0-test",
  releaseUrl: "https://example.com/releases/1.0.0-test",
  downloadUrl: "",
  isUpdateAvailable: false,
};

const updateAvailable = {
  currentVersion: "1.0.0-test",
  latestVersion: "2.0.0",
  releaseName: "2.0.0",
  releaseUrl: "https://example.com/releases/2.0.0",
  downloadUrl: "https://example.com/releases/download/app.apk",
  isUpdateAvailable: true,
};

describe("update-checker", () => {
  const storedPending: PendingUpdate = {
    version: "2.0.0",
    releaseName: "2.0.0",
    releaseUrl: "https://example.com/releases/2.0.0",
    localUri: "file:///mock/documents/update.apk",
    downloadedAt: "2026-01-01T00:00:00.000Z",
  };

  describe("checkForUpdateAndDownload", () => {
    it("does nothing when no update is available", async () => {
      (fetchLatestRelease as jest.Mock).mockResolvedValue(notUpdateAvailable);

      await checkForUpdateAndDownload();

      expect(downloadApk).not.toHaveBeenCalled();
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it("does nothing when the release has no apk asset", async () => {
      (fetchLatestRelease as jest.Mock).mockResolvedValue({
        ...updateAvailable,
        downloadUrl: "https://example.com/releases/2.0.0",
      });

      await checkForUpdateAndDownload();

      expect(downloadApk).not.toHaveBeenCalled();
    });

    it("downloads and persists a pending update when none is stored", async () => {
      (fetchLatestRelease as jest.Mock).mockResolvedValue(updateAvailable);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

      await checkForUpdateAndDownload();

      expect(downloadApk).toHaveBeenCalledWith(
        updateAvailable.downloadUrl,
        "file:///mock/documents/update.apk",
      );
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "@ai_agent_pending_update",
        expect.stringContaining('"version":"2.0.0"'),
      );
    });

    it("skips re-downloading when the same version is already downloaded", async () => {
      (fetchLatestRelease as jest.Mock).mockResolvedValue(updateAvailable);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(storedPending),
      );
      (apkFileExists as jest.Mock).mockResolvedValue(true);

      await checkForUpdateAndDownload();

      expect(downloadApk).not.toHaveBeenCalled();
    });

    it("re-downloads when the stored file for the same version is missing", async () => {
      (fetchLatestRelease as jest.Mock).mockResolvedValue(updateAvailable);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(storedPending),
      );
      (apkFileExists as jest.Mock).mockResolvedValue(false);

      await checkForUpdateAndDownload();

      expect(downloadApk).toHaveBeenCalled();
    });

    it("re-downloads when the stored record is for an older version", async () => {
      (fetchLatestRelease as jest.Mock).mockResolvedValue(updateAvailable);
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ ...storedPending, version: "1.5.0" }),
      );

      await checkForUpdateAndDownload();

      expect(downloadApk).toHaveBeenCalled();
    });
  });

  describe("getPendingUpdate", () => {
    it("returns null when nothing is stored", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      expect(await getPendingUpdate()).toBeNull();
    });

    it("clears and returns null when the current app already matches or exceeds the pending version", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify({ ...storedPending, version: "1.0.0-test" }),
      );

      expect(await getPendingUpdate()).toBeNull();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "@ai_agent_pending_update",
      );
      expect(deleteApkFile).toHaveBeenCalledWith(storedPending.localUri);
    });

    it("clears and returns null when the downloaded file no longer exists", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(storedPending),
      );
      (apkFileExists as jest.Mock).mockResolvedValue(false);

      expect(await getPendingUpdate()).toBeNull();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "@ai_agent_pending_update",
      );
    });

    it("returns the pending update when it's valid", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
        JSON.stringify(storedPending),
      );
      (apkFileExists as jest.Mock).mockResolvedValue(true);

      expect(await getPendingUpdate()).toEqual(storedPending);
    });
  });

  describe("clearPendingUpdate", () => {
    it("removes the storage record and deletes the file", async () => {
      await clearPendingUpdate(storedPending);

      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        "@ai_agent_pending_update",
      );
      expect(deleteApkFile).toHaveBeenCalledWith(storedPending.localUri);
    });
  });

  describe("installPendingUpdate", () => {
    it("installs the apk at the pending update's local uri", async () => {
      await installPendingUpdate(storedPending);
      expect(installApk).toHaveBeenCalledWith(storedPending.localUri);
    });
  });

  describe("registerBackgroundUpdateCheck", () => {
    it("registers the task on android", async () => {
      Platform.OS = "android";
      await registerBackgroundUpdateCheck();

      expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(
        UPDATE_CHECK_TASK_NAME,
        { minimumInterval: 6 * 60 },
      );
    });

    it("does nothing on non-android platforms", async () => {
      Platform.OS = "ios";
      await registerBackgroundUpdateCheck();

      expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
    });
  });
});
