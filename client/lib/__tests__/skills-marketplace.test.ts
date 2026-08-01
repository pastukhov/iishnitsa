import {
  parseSkillReference,
  findSkillFiles,
  fetchRawFile,
  extractSkillDescription,
  hashContent,
  GitHubSkillError,
} from "../skills-marketplace";

describe("skills-marketplace", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  const mockResponse = (status: number, body: unknown, isJson = true) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (isJson ? JSON.stringify(body) : (body as string)),
  });

  describe("parseSkillReference", () => {
    it("parses a skills.sh URL with a slug", () => {
      expect(
        parseSkillReference("https://skills.sh/vercel-labs/skills/find-skills"),
      ).toEqual({ owner: "vercel-labs", repo: "skills", slug: "find-skills" });
    });

    it("parses a skills.sh URL without a slug", () => {
      expect(
        parseSkillReference("https://skills.sh/mintlify.com/mintlify"),
      ).toEqual({ owner: "mintlify.com", repo: "mintlify", slug: undefined });
    });

    it("parses a plain GitHub repo URL", () => {
      expect(
        parseSkillReference("https://github.com/vercel-labs/skills"),
      ).toEqual({ owner: "vercel-labs", repo: "skills" });
    });

    it("parses a GitHub tree URL, using the last path segment as slug", () => {
      expect(
        parseSkillReference(
          "https://github.com/vercel-labs/skills/tree/main/find-skills",
        ),
      ).toEqual({ owner: "vercel-labs", repo: "skills", slug: "find-skills" });
    });

    it("parses a bare owner/repo string", () => {
      expect(parseSkillReference("expo/skills")).toEqual({
        owner: "expo",
        repo: "skills",
        slug: undefined,
      });
    });

    it("parses a bare owner/repo/slug string", () => {
      expect(parseSkillReference("expo/skills/react-native")).toEqual({
        owner: "expo",
        repo: "skills",
        slug: "react-native",
      });
    });

    it("returns null for unrecognized input", () => {
      expect(parseSkillReference("not a reference")).toBeNull();
      expect(parseSkillReference("")).toBeNull();
    });
  });

  describe("findSkillFiles", () => {
    it("matches a skill at the repo root by slug", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, {
          tree: [
            { path: "find-skills/SKILL.md", type: "blob" },
            { path: "other-skill/SKILL.md", type: "blob" },
          ],
        }),
      );

      const matches = await findSkillFiles(
        "vercel-labs",
        "skills",
        "find-skills",
      );
      expect(matches).toEqual([
        { path: "find-skills/SKILL.md", name: "find-skills" },
      ]);
    });

    it("matches a nested skill path", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, {
          tree: [{ path: "packages/find-skills/SKILL.md", type: "blob" }],
        }),
      );

      const matches = await findSkillFiles(
        "vercel-labs",
        "skills",
        "find-skills",
      );
      expect(matches).toEqual([
        { path: "packages/find-skills/SKILL.md", name: "find-skills" },
      ]);
    });

    it("matches a root-level SKILL.md when the repo name equals the slug", () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, { tree: [{ path: "SKILL.md", type: "blob" }] }),
      );

      return expect(
        findSkillFiles("mintlify.com", "mintlify", "mintlify"),
      ).resolves.toEqual([{ path: "SKILL.md", name: "mintlify" }]);
    });

    it("returns all skill files when no slug is given", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, {
          tree: [
            { path: "a/SKILL.md", type: "blob" },
            { path: "b/SKILL.md", type: "blob" },
            { path: "b/examples/file.ts", type: "blob" },
          ],
        }),
      );

      const matches = await findSkillFiles("owner", "repo");
      expect(matches).toEqual([
        { path: "a/SKILL.md", name: "a" },
        { path: "b/SKILL.md", name: "b" },
      ]);
    });

    it("falls back to all skill files when the slug doesn't match any", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, { tree: [{ path: "a/SKILL.md", type: "blob" }] }),
      );

      const matches = await findSkillFiles("owner", "repo", "missing");
      expect(matches).toEqual([{ path: "a/SKILL.md", name: "a" }]);
    });

    it("throws repo_not_found on 404", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(404, {}));

      await expect(findSkillFiles("owner", "missing-repo")).rejects.toThrow(
        GitHubSkillError,
      );
      await expect(
        findSkillFiles("owner", "missing-repo"),
      ).rejects.toMatchObject({ code: "repo_not_found" });
    });

    it("throws rate_limited on 403", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(403, {}));

      await expect(findSkillFiles("owner", "repo")).rejects.toMatchObject({
        code: "rate_limited",
      });
    });
  });

  describe("fetchRawFile", () => {
    it("returns the file's text content", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(200, "# Hello", false),
      );

      const content = await fetchRawFile("owner", "repo", "a/SKILL.md");
      expect(content).toBe("# Hello");
      expect(global.fetch).toHaveBeenCalledWith(
        "https://raw.githubusercontent.com/owner/repo/HEAD/a/SKILL.md",
      );
    });

    it("throws file_not_found on 404", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        mockResponse(404, "", false),
      );

      await expect(
        fetchRawFile("owner", "repo", "missing/SKILL.md"),
      ).rejects.toMatchObject({ code: "file_not_found" });
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

  describe("hashContent", () => {
    it("is deterministic", () => {
      expect(hashContent("hello world")).toBe(hashContent("hello world"));
    });

    it("differs for different content", () => {
      expect(hashContent("hello")).not.toBe(hashContent("world"));
    });
  });
});
