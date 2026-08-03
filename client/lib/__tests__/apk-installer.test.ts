import { Platform } from "react-native";
import {
  createDownloadResumable,
  getContentUriAsync,
  getInfoAsync,
  deleteAsync,
} from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

import {
  apkFileExists,
  deleteApkFile,
  downloadAndInstallApk,
  downloadApk,
  getUpdateApkPath,
  installApk,
} from "../apk-installer";

jest.mock("expo-intent-launcher", () => ({
  startActivityAsync: jest.fn(() => Promise.resolve()),
}));

describe("apk-installer", () => {
  beforeEach(() => {
    Platform.OS = "android";
  });

  describe("getUpdateApkPath", () => {
    it("returns a path in the persistent document directory", () => {
      expect(getUpdateApkPath()).toBe("file:///mock/documents/update.apk");
    });
  });

  describe("downloadApk", () => {
    it("downloads to the given path and returns the resulting uri", async () => {
      const uri = await downloadApk(
        "https://example.com/app.apk",
        "file:///mock/documents/update.apk",
      );
      expect(uri).toBe("file:///mock/documents/update.apk");
      expect(createDownloadResumable).toHaveBeenCalledWith(
        "https://example.com/app.apk",
        "file:///mock/documents/update.apk",
        {},
        undefined,
      );
    });

    it("defaults to the cache directory when no path is given", async () => {
      await downloadApk("https://example.com/app.apk");
      expect(createDownloadResumable).toHaveBeenCalledWith(
        "https://example.com/app.apk",
        "file:///mock/cache/update.apk",
        {},
        undefined,
      );
    });

    it("throws when the download doesn't resolve to a uri", async () => {
      (createDownloadResumable as jest.Mock).mockReturnValueOnce({
        downloadAsync: () => Promise.resolve(undefined),
      });

      await expect(downloadApk("https://example.com/app.apk")).rejects.toThrow(
        "Download failed",
      );
    });
  });

  describe("installApk", () => {
    it("resolves a content uri and launches the install intent", async () => {
      await installApk("file:///mock/documents/update.apk");

      expect(getContentUriAsync).toHaveBeenCalledWith(
        "file:///mock/documents/update.apk",
      );
      expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
        "android.intent.action.VIEW",
        expect.objectContaining({
          type: "application/vnd.android.package-archive",
        }),
      );
    });

    it("throws on non-android platforms", async () => {
      Platform.OS = "ios";
      await expect(
        installApk("file:///mock/documents/update.apk"),
      ).rejects.toThrow("APK installation is only supported on Android");
    });
  });

  describe("downloadAndInstallApk", () => {
    it("downloads then installs on android", async () => {
      await downloadAndInstallApk("https://example.com/app.apk");
      expect(createDownloadResumable).toHaveBeenCalled();
      expect(IntentLauncher.startActivityAsync).toHaveBeenCalled();
    });

    it("throws on non-android platforms without downloading", async () => {
      Platform.OS = "ios";
      await expect(
        downloadAndInstallApk("https://example.com/app.apk"),
      ).rejects.toThrow("APK installation is only supported on Android");
      expect(createDownloadResumable).not.toHaveBeenCalled();
    });
  });

  describe("apkFileExists", () => {
    it("returns the exists flag from file info", async () => {
      (getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false });
      expect(await apkFileExists("file:///mock/documents/update.apk")).toBe(
        false,
      );
    });
  });

  describe("deleteApkFile", () => {
    it("deletes idempotently and swallows errors", async () => {
      await deleteApkFile("file:///mock/documents/update.apk");
      expect(deleteAsync).toHaveBeenCalledWith(
        "file:///mock/documents/update.apk",
        { idempotent: true },
      );

      (deleteAsync as jest.Mock).mockRejectedValueOnce(new Error("boom"));
      await expect(
        deleteApkFile("file:///mock/documents/update.apk"),
      ).resolves.toBeUndefined();
    });
  });
});
