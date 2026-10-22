import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(
    resolve(__dirname, "../../../.github/workflows/auto-pr.yml"),
    "utf8",
  ),
);

function shouldOpenPr(actor: string, ref: string, triggeringActor = actor) {
  const condition = workflow.jobs["open-pr"].if;
  // GitHub runs jobs without an explicit condition by default.
  if (condition === undefined) return true;
  return runInNewContext(condition.replace(/^\$\{\{\s*|\s*\}\}$/g, ""), {
    github: { actor, ref, triggering_actor: triggeringActor },
    startsWith: (value: string, prefix: string) => value.startsWith(prefix),
  });
}

describe("Auto PR workflow", () => {
  test.each([
    ["dependabot[bot]", "refs/heads/dependabot/npm_and_yarn/update", false],
    ["dependabot[bot]", "refs/heads/dependency-update", false],
    ["pastukhov", "refs/heads/dependabot/npm_and_yarn/update", false],
    ["pastukhov", "refs/heads/fix-streaming", true],
    ["pastukhov", "refs/heads/dependabot-tools", true],
  ])("actor %s on %s runs: %s", (actor, ref, expected) => {
    expect(shouldOpenPr(actor, ref)).toBe(expected);
  });

  test("a human rerun does not enable the Dependabot job", () => {
    expect(
      shouldOpenPr(
        "dependabot[bot]",
        "refs/heads/dependency-update",
        "pastukhov",
      ),
    ).toBe(false);
  });

  test("keeps ordinary branch pushes and their existing credential permissions", () => {
    expect(workflow.on.push).toEqual({ "branches-ignore": ["main"] });
    expect(workflow.permissions).toEqual({
      contents: "read",
      "pull-requests": "write",
    });
    expect(workflow.jobs["open-pr"].steps[0].with["github-token"]).toBe(
      "${{ secrets.GH_TOKEN }}",
    );
  });
});
