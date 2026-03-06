import {
  compareVersions,
  fetchLatestRelease,
  getLatestReleaseDownloadUrl,
  mapLatestRelease,
  useLatestRelease,
} from "../github-releases";
import { useQuery } from "@tanstack/react-query";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

describe("github-releases", () => {
  describe("compareVersions", () => {
    it("compares semantic versions", () => {
      expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
      expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    });

    it("normalizes prefixes and missing patch versions", () => {
      expect(compareVersions("v1.33", "1.32.9")).toBe(1);
      expect(compareVersions("release-2.0", "2.0.0")).toBe(0);
      expect(compareVersions("not-a-version", "0.0.0")).toBe(0);
    });
  });

  describe("getLatestReleaseDownloadUrl", () => {
    it("prefers apk asset when available", () => {
      expect(
        getLatestReleaseDownloadUrl({
          html_url: "https://github.com/example/release",
          assets: [
            {
              name: "iishnitsa.apk",
              browser_download_url: "https://github.com/example/iishnitsa.apk",
            },
          ],
        }),
      ).toBe("https://github.com/example/iishnitsa.apk");
    });

    it("falls back to release page when no apk asset exists", () => {
      expect(
        getLatestReleaseDownloadUrl({
          html_url: "https://github.com/example/release",
          assets: [
            {
              name: "source.zip",
              browser_download_url: "https://github.com/example/source.zip",
            },
          ],
        }),
      ).toBe("https://github.com/example/release");
    });

    it("accepts APK by content type even without apk extension", () => {
      expect(
        getLatestReleaseDownloadUrl({
          html_url: "https://github.com/example/release",
          assets: [
            {
              name: "android-release.bin",
              content_type: "application/vnd.android.package-archive",
              browser_download_url:
                "https://github.com/example/android-release.bin",
            },
          ],
        }),
      ).toBe("https://github.com/example/android-release.bin");
    });

    it("handles assets without a name", () => {
      expect(
        getLatestReleaseDownloadUrl({
          html_url: "https://github.com/example/release",
          assets: [
            {
              content_type: "application/octet-stream",
              browser_download_url: "https://github.com/example/file.bin",
            },
          ],
        }),
      ).toBe("https://github.com/example/release");
    });
  });

  describe("mapLatestRelease", () => {
    it("marks update as available when release version is newer", () => {
      const result = mapLatestRelease(
        {
          tag_name: "v1.33.8",
          name: "v1.33.8",
          html_url:
            "https://github.com/pastukhov/iishnitsa/releases/tag/v1.33.8",
          body: "Bug fixes",
          published_at: "2026-03-07T00:00:00Z",
          assets: [
            {
              name: "iishnitsa.apk",
              browser_download_url:
                "https://github.com/pastukhov/iishnitsa/releases/download/v1.33.8/iishnitsa.apk",
            },
          ],
        },
        "1.32.7",
      );

      expect(result.latestVersion).toBe("1.33.8");
      expect(result.currentVersion).toBe("1.32.7");
      expect(result.isUpdateAvailable).toBe(true);
      expect(result.downloadUrl).toContain(".apk");
    });

    it("falls back to normalized version and empty URLs when fields are missing", () => {
      const result = mapLatestRelease({}, "1.32.7");

      expect(result.latestVersion).toBe("0.0.0");
      expect(result.releaseName).toBe("0.0.0");
      expect(result.releaseUrl).toBe("");
      expect(result.downloadUrl).toBe("");
      expect(result.isUpdateAvailable).toBe(false);
    });
  });

  describe("fetchLatestRelease", () => {
    it("fetches and maps latest release payload", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tag_name: "v1.33.8",
            html_url:
              "https://github.com/pastukhov/iishnitsa/releases/tag/v1.33.8",
            assets: [],
          }),
      });

      const result = await fetchLatestRelease(
        fetchMock as unknown as typeof fetch,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.github.com/repos/pastukhov/iishnitsa/releases/latest",
        {
          headers: {
            Accept: "application/vnd.github+json",
          },
        },
      );
      expect(result.latestVersion).toBe("1.33.8");
    });

    it("throws with response body when github check fails", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("rate limited"),
      });

      await expect(
        fetchLatestRelease(fetchMock as unknown as typeof fetch),
      ).rejects.toThrow("rate limited");
    });

    it("falls back to status message when response body cannot be read", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error("unavailable")),
      });

      await expect(
        fetchLatestRelease(fetchMock as unknown as typeof fetch),
      ).rejects.toThrow("GitHub release check failed: 503");
    });
  });

  describe("useLatestRelease", () => {
    it("configures a cached release query", async () => {
      (useQuery as jest.Mock).mockReturnValue({ data: null });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tag_name: "v1.33.8",
            html_url:
              "https://github.com/pastukhov/iishnitsa/releases/tag/v1.33.8",
            assets: [],
          }),
      });

      useLatestRelease();

      const config = (useQuery as jest.Mock).mock.calls[0][0];
      await config.queryFn();

      expect(useQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ["github-latest-release"],
          staleTime: 1000 * 60 * 60,
          queryFn: expect.any(Function),
        }),
      );
    });
  });
});
