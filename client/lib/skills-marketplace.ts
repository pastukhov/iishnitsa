/**
 * Client for the skills.sh marketplace, accessed through our own Vercel proxy
 * (server/skills-proxy) since skills.sh's API requires a Vercel OIDC token
 * that only a Vercel-hosted project can obtain.
 */

// Replace with the URL of your deployed server/skills-proxy Vercel project.
export const SKILLS_MARKETPLACE_PROXY_URL =
  "https://YOUR-SKILLS-PROXY.vercel.app";

export interface MarketplaceSkill {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  sourceType: "github" | "well-known";
  installUrl: string | null;
  url: string;
  isDuplicate?: boolean;
}

export interface MarketplaceSkillFile {
  path: string;
  contents: string;
}

export interface MarketplaceSkillDetail {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash: string | null;
  files: MarketplaceSkillFile[] | null;
}

export interface MarketplaceSkillAudit {
  provider: string;
  slug: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  auditedAt: string;
  riskLevel?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  categories?: string[];
}

export interface MarketplaceSkillAuditResult {
  id: string;
  source: string;
  slug: string;
  audits: MarketplaceSkillAudit[];
}

export class SkillsMarketplaceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SkillsMarketplaceError";
    this.status = status;
    this.code = code;
  }
}

async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${SKILLS_MARKETPLACE_PROXY_URL}${path}`);
  const json = await response.json();

  if (!response.ok) {
    throw new SkillsMarketplaceError(
      response.status,
      json?.error || "unknown_error",
      json?.message || `Request failed with status ${response.status}`,
    );
  }

  return json as T;
}

export async function getCuratedSkills(): Promise<{
  data: { owner: string; totalInstalls: number; skills: MarketplaceSkill[] }[];
  totalOwners: number;
  totalSkills: number;
}> {
  return fetchJSON("/api/v1/skills/curated");
}

export async function searchMarketplaceSkills(
  query: string,
  options?: { limit?: number; owner?: string },
): Promise<{ data: MarketplaceSkill[]; searchType: "fuzzy" | "semantic" }> {
  const params = new URLSearchParams({ q: query });
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.owner) params.set("owner", options.owner);
  return fetchJSON(`/api/v1/skills/search?${params.toString()}`);
}

export async function getMarketplaceSkillDetail(
  id: string,
): Promise<MarketplaceSkillDetail> {
  return fetchJSON(`/api/v1/skills/${id}`);
}

export async function getMarketplaceSkillAudit(
  id: string,
): Promise<MarketplaceSkillAuditResult | null> {
  try {
    return await fetchJSON(`/api/v1/skills/audit/${id}`);
  } catch (error) {
    if (error instanceof SkillsMarketplaceError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/** Extracts the SKILL.md contents from a detail response's file list. */
export function extractSkillMdContent(
  files: MarketplaceSkillFile[] | null,
): string | null {
  const skillFile = (files || []).find(
    (f) => f.path.toLowerCase() === "skill.md",
  );
  return skillFile?.contents ?? null;
}

/** Best-effort extraction of the `description:` field from SKILL.md frontmatter. */
export function extractSkillDescription(skillMdContent: string): string {
  const match = skillMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return "";
  const descriptionMatch = match[1].match(/^description:\s*(.+)$/m);
  if (!descriptionMatch) return "";
  return descriptionMatch[1].trim().replace(/^["']|["']$/g, "");
}
