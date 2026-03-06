import {
  compareVersions,
  fetchLatestRelease,
  getLatestReleaseDownloadUrl,
  mapLatestRelease,
} from "../github-releases";

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
  });
});
