import { useQuery } from "@tanstack/react-query";

import { appInfo } from "@/lib/app-info";

const GITHUB_OWNER = "pastukhov";
const GITHUB_REPO = "iishnitsa";
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const VERSION_PARTS = 3;

export interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  content_type?: string;
}

export interface GitHubLatestReleasePayload {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

export interface AppUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  releaseNotes?: string;
  publishedAt?: string;
  downloadUrl: string;
  isUpdateAvailable: boolean;
}

function normalizeVersion(input?: string): string {
  if (!input) return "0.0.0";

  const match = input.trim().match(/(\d+(?:\.\d+){0,2})/);
  if (!match) return "0.0.0";

  const parts = match[1]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  while (parts.length < VERSION_PARTS) {
    parts.push(0);
  }

  return parts.slice(0, VERSION_PARTS).join(".");
}

export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split(".").map(Number);
  const right = normalizeVersion(b).split(".").map(Number);

  for (let index = 0; index < VERSION_PARTS; index += 1) {
    const leftValue = left[index] || 0;
    const rightValue = right[index] || 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

export function getLatestReleaseDownloadUrl(
  release: GitHubLatestReleasePayload,
): string {
  const apkAsset = release.assets?.find((asset) => {
    const name = asset.name?.toLowerCase() || "";
    const contentType = asset.content_type?.toLowerCase() || "";

    return (
      name.endsWith(".apk") ||
      contentType === "application/vnd.android.package-archive"
    );
  });

  return apkAsset?.browser_download_url || release.html_url || "";
}

export function mapLatestRelease(
  release: GitHubLatestReleasePayload,
  currentVersion: string = appInfo.version,
): AppUpdateInfo {
  const latestVersion = normalizeVersion(release.tag_name || release.name);
  const releaseName =
    release.name?.trim() || release.tag_name?.trim() || latestVersion;
  const releaseUrl = release.html_url || "";
  const downloadUrl = getLatestReleaseDownloadUrl(release);

  return {
    currentVersion: normalizeVersion(currentVersion),
    latestVersion,
    releaseName,
    releaseUrl,
    releaseNotes: release.body,
    publishedAt: release.published_at,
    downloadUrl,
    isUpdateAvailable: compareVersions(latestVersion, currentVersion) > 0,
  };
}

export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<AppUpdateInfo> {
  const response = await fetchImpl(GITHUB_RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      errorText || `GitHub release check failed: ${response.status}`,
    );
  }

  const payload = (await response.json()) as GitHubLatestReleasePayload;
  return mapLatestRelease(payload);
}

export function useLatestRelease() {
  return useQuery({
    queryKey: ["github-latest-release"],
    queryFn: () => fetchLatestRelease(),
    staleTime: 1000 * 60 * 60,
  });
}
