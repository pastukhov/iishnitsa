/**
 * Installs skills directly from their GitHub source, the same way the
 * `skills` CLI's `npx skills add <installUrl>` does — no skills.sh API call,
 * no backend, no auth. Browsing/searching the catalog itself still happens
 * on skills.sh in the user's browser; this module only resolves a skill
 * reference (a skills.sh or GitHub URL, or an `owner/repo[/slug]` string)
 * down to its `SKILL.md` file and fetches that file's raw content.
 */

export class GitHubSkillError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GitHubSkillError";
    this.status = status;
    this.code = code;
  }
}

export interface SkillReference {
  owner: string;
  repo: string;
  slug?: string;
}

export interface SkillFileMatch {
  /** Path to SKILL.md within the repo. */
  path: string;
  /** Directory name containing SKILL.md, or the repo name if it's at the root. */
  name: string;
}

/** Parses a skills.sh URL, a GitHub URL, or an `owner/repo[/slug]` string. */
export function parseSkillReference(input: string): SkillReference | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  const skillsShMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?skills\.sh\/([^/]+)\/([^/]+)(?:\/([^/?#]+))?/i,
  );
  if (skillsShMatch) {
    return {
      owner: skillsShMatch[1],
      repo: skillsShMatch[2],
      slug: skillsShMatch[3],
    };
  }

  const githubTreeMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/tree\/[^/]+\/(.+)$/i,
  );
  if (githubTreeMatch) {
    const pathParts = githubTreeMatch[3].split("/").filter(Boolean);
    return {
      owner: githubTreeMatch[1],
      repo: githubTreeMatch[2],
      slug: pathParts[pathParts.length - 1],
    };
  }

  const githubRepoMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)/i,
  );
  if (githubRepoMatch) {
    return { owner: githubRepoMatch[1], repo: githubRepoMatch[2] };
  }

  const bareMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)(?:\/([^/\s]+))?$/);
  if (bareMatch) {
    return { owner: bareMatch[1], repo: bareMatch[2], slug: bareMatch[3] };
  }

  return null;
}

interface GitHubTreeEntry {
  path: string;
  type: string;
}

async function fetchRepoTree(
  owner: string,
  repo: string,
): Promise<GitHubTreeEntry[]> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new GitHubSkillError(
        404,
        "repo_not_found",
        `Repository "${owner}/${repo}" was not found.`,
      );
    }
    if (response.status === 403) {
      throw new GitHubSkillError(
        403,
        "rate_limited",
        "GitHub API rate limit reached. Try again later.",
      );
    }
    throw new GitHubSkillError(
      response.status,
      "github_error",
      `GitHub API request failed with status ${response.status}.`,
    );
  }

  const json = await response.json();
  return json.tree || [];
}

/** Finds SKILL.md file(s) in a repo, optionally narrowed to a specific slug. */
export async function findSkillFiles(
  owner: string,
  repo: string,
  slug?: string,
): Promise<SkillFileMatch[]> {
  const tree = await fetchRepoTree(owner, repo);
  const skillFiles = tree.filter(
    (entry) => entry.type === "blob" && /(^|\/)SKILL\.md$/i.test(entry.path),
  );

  const toMatch = (path: string): SkillFileMatch => {
    const segments = path.split("/");
    const name = segments.length > 1 ? segments[segments.length - 2] : repo;
    return { path, name };
  };

  if (!slug) {
    return skillFiles.map((entry) => toMatch(entry.path));
  }

  const lowerSlug = slug.toLowerCase();
  const filtered = skillFiles.filter((entry) => {
    const lowerPath = entry.path.toLowerCase();
    return (
      lowerPath === `${lowerSlug}/skill.md` ||
      lowerPath.endsWith(`/${lowerSlug}/skill.md`) ||
      (lowerPath === "skill.md" && repo.toLowerCase() === lowerSlug)
    );
  });

  return (filtered.length > 0 ? filtered : skillFiles).map((entry) =>
    toMatch(entry.path),
  );
}

/** Fetches the raw contents of a file from a repo's default branch. */
export async function fetchRawFile(
  owner: string,
  repo: string,
  path: string,
): Promise<string> {
  const response = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`,
  );

  if (!response.ok) {
    throw new GitHubSkillError(
      response.status,
      response.status === 404 ? "file_not_found" : "github_error",
      `Failed to fetch ${path} (status ${response.status}).`,
    );
  }

  return response.text();
}

/** Best-effort extraction of the `description:` field from SKILL.md frontmatter. */
export function extractSkillDescription(skillMdContent: string): string {
  const match = skillMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const descriptionMatch = match[1].match(/^description:\s*(.+)$/m);
  if (!descriptionMatch) return "";
  return descriptionMatch[1].trim().replace(/^["']|["']$/g, "");
}

/** A small, non-cryptographic content hash used only to detect upstream changes. */
export function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
