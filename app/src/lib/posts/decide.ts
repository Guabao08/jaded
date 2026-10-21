/**
 * Decides whether a push is worth posting about. Deterministic rules (no AI),
 * so the decision is explainable and free; the user can override it.
 */

export interface DecisionInput {
  pusherLogin: string | null;
  commits: Array<{ title: string; message: string }>;
}

export interface Decision {
  decision: "POST" | "SKIP";
  reason: string;
}

const MAINTENANCE = /^(chore|ci|build|test|tests|docs|style|refactor|deps|revert)(\([^)]*\))?!?:/i;
const USER_FACING = /^(feat|feature|fix|perf|ux|ui)(\([^)]*\))?!?:/i;
const DEPENDENCY = /\b(bump|upgrade|update)s?\b.*\b(deps?|dependenc(y|ies)|packages?|version|from v?\d|to v?\d)/i;
const MERGE = /^merge (branch|pull request|remote-tracking branch)\b/i;
const TINY = /^(wip|typo|fix typo|typos|lint|format(ting)?|cleanup|clean up|minor|tweak|small fix(es)?|oops|\.)$/i;

export function decideUpdate(input: DecisionInput): Decision {
  if (input.pusherLogin && /\[bot\]$/i.test(input.pusherLogin)) {
    return { decision: "SKIP", reason: "Pushed by a bot (usually an automated dependency update)." };
  }
  const titles = input.commits.map((c) => c.title.trim()).filter((t) => t && !MERGE.test(t));
  if (titles.length === 0) return { decision: "SKIP", reason: "Only merge commits, no new changes described." };

  const userFacing = titles.find((t) => USER_FACING.test(t));
  if (userFacing) return { decision: "POST", reason: `Includes a user-facing change: "${userFacing.slice(0, 80)}".` };

  if (titles.every((t) => MAINTENANCE.test(t))) {
    return { decision: "SKIP", reason: "Only maintenance commits (chores, CI, docs, tests or refactoring)." };
  }
  if (titles.every((t) => DEPENDENCY.test(t) || MAINTENANCE.test(t))) {
    return { decision: "SKIP", reason: "Only dependency or version bumps." };
  }
  if (titles.every((t) => TINY.test(t) || t.length < 8)) {
    return { decision: "SKIP", reason: "Only tiny fixes (typos, formatting, WIP)." };
  }
  const first = titles.find((t) => !MAINTENANCE.test(t) && !DEPENDENCY.test(t) && !TINY.test(t)) ?? titles[0];
  return { decision: "POST", reason: `Looks like a real change: "${first.slice(0, 80)}".` };
}
