import {
  getCuratedSkills,
  searchMarketplaceSkills,
  getMarketplaceSkillDetail,
  getMarketplaceSkillAudit,
  extractSkillMdContent,
  extractSkillDescription,
  SkillsMarketplaceError,
  SKILLS_MARKETPLACE_PROXY_URL,
} from "../skills-marketplace";

describe("skills-marketplace", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  const mockResponse = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  describe("getCuratedSkills", () => {
    it("fetches the curated endpoint", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, {
          data: [{ owner: "vercel-labs", totalInstalls: 1, skills: [] }],
          totalOwners: 1,
          totalSkills: 1,
        }),
      );

      const result = await getCuratedSkills();

      expect(global.fetch).toHaveBeenCalledWith(
        `${SKILLS_MARKETPLACE_PROXY_URL}/api/v1/skills/curated`,
      );
      expect(result.totalOwners).toBe(1);
    });
  });

  describe("searchMarketplaceSkills", () => {
    it("builds query params for search", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, { data: [], searchType: "semantic" }),
      );

      await searchMarketplaceSkills("react native", {
        limit: 5,
        owner: "expo",
      });

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(calledUrl).toContain("/api/v1/skills/search?");
      expect(calledUrl).toContain("q=react+native");
      expect(calledUrl).toContain("limit=5");
      expect(calledUrl).toContain("owner=expo");
    });
  });

  describe("getMarketplaceSkillDetail", () => {
    it("fetches a skill's detail by id", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, {
          id: "vercel-labs/skills/find-skills",
          source: "vercel-labs/skills",
          slug: "find-skills",
          installs: 1,
          hash: "abc",
          files: [{ path: "SKILL.md", contents: "---\nname: X\n---\nBody" }],
        }),
      );

      const detail = await getMarketplaceSkillDetail(
        "vercel-labs/skills/find-skills",
      );

      expect(global.fetch).toHaveBeenCalledWith(
        `${SKILLS_MARKETPLACE_PROXY_URL}/api/v1/skills/vercel-labs/skills/find-skills`,
      );
      expect(detail.hash).toBe("abc");
    });

    it("throws a SkillsMarketplaceError on non-2xx responses", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(404, { error: "not_found", message: "Skill not found." }),
      );

      await expect(getMarketplaceSkillDetail("missing/skill")).rejects.toThrow(
        SkillsMarketplaceError,
      );
    });
  });

  describe("getMarketplaceSkillAudit", () => {
    it("returns null when no audit exists (404)", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(404, { error: "not_found", message: "No audits yet." }),
      );

      const result = await getMarketplaceSkillAudit("owner/repo/skill");
      expect(result).toBeNull();
    });

    it("returns audit data when available", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, {
          id: "owner/repo/skill",
          source: "owner/repo",
          slug: "skill",
          audits: [
            {
              provider: "Socket",
              slug: "socket",
              status: "pass",
              summary: "No alerts",
              auditedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );

      const result = await getMarketplaceSkillAudit("owner/repo/skill");
      expect(result?.audits).toHaveLength(1);
      expect(result?.audits[0].status).toBe("pass");
    });

    it("rethrows non-404 errors", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(500, { error: "server_error", message: "Boom" }),
      );

      await expect(
        getMarketplaceSkillAudit("owner/repo/skill"),
      ).rejects.toThrow(SkillsMarketplaceError);
    });
  });

  describe("extractSkillMdContent", () => {
    it("finds SKILL.md case-insensitively", () => {
      const content = extractSkillMdContent([
        { path: "examples/a.ts", contents: "code" },
        { path: "SKILL.md", contents: "# Hello" },
      ]);
      expect(content).toBe("# Hello");
    });

    it("returns null when there is no SKILL.md or files is null", () => {
      expect(extractSkillMdContent([{ path: "a.ts", contents: "x" }])).toBe(
        null,
      );
      expect(extractSkillMdContent(null)).toBe(null);
    });
  });

  describe("extractSkillDescription", () => {
    it("extracts description from YAML frontmatter", () => {
      const md = `---\nname: Next.js Development\ndescription: Helps with Next.js apps\n---\n\nBody text`;
      expect(extractSkillDescription(md)).toBe("Helps with Next.js apps");
    });

    it("strips surrounding quotes", () => {
      const md = `---\ndescription: "Quoted description"\n---\nBody`;
      expect(extractSkillDescription(md)).toBe("Quoted description");
    });

    it("returns empty string when there is no frontmatter or description", () => {
      expect(extractSkillDescription("# Just a heading\nBody")).toBe("");
      expect(extractSkillDescription("---\nname: X\n---\nBody")).toBe("");
    });
  });
});
