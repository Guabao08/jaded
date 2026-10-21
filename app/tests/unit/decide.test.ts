import { describe, expect, it } from "vitest";
import { decideUpdate } from "@/lib/posts/decide";

const c = (title: string) => ({ title, message: title });

describe("decideUpdate", () => {
  it.each([
    [["feat: dark mode"], "POST"],
    [["fix(sync): lost edits after reconnecting"], "POST"],
    [["Add widget for the home screen"], "POST"],
    [["chore: bump eslint", "feat: share sheet"], "POST"],
    [["chore: tidy up", "ci: cache npm"], "SKIP"],
    [["docs: readme", "test: more tests", "refactor: split module"], "SKIP"],
    [["Bump react from 19.3.0 to 19.3.1"], "SKIP"],
    [["Update dependencies"], "SKIP"],
    [["typo", "wip"], "SKIP"],
    [["Merge branch 'main' into feature"], "SKIP"],
  ] as const)("%j → %s", (titles, expected) => {
    expect(decideUpdate({ pusherLogin: "alice", commits: titles.map(c) }).decision).toBe(expected);
  });

  it("skips pushes made by bots and explains why", () => {
    const result = decideUpdate({ pusherLogin: "dependabot[bot]", commits: [c("feat: looks real")] });
    expect(result).toEqual({ decision: "SKIP", reason: expect.stringContaining("bot") });
  });

  it("gives a readable reason for posting", () => {
    expect(decideUpdate({ pusherLogin: null, commits: [c("feat: offline mode")] }).reason).toContain("offline mode");
  });
});
