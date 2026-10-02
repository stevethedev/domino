import type { GraphNode } from "./types";

/**
 * The signed-in user's issues that a refresh unblocked: blocked on the previous load of the same
 * scope, and now open with no open blocker. Ghosts never count (their blockers aren't loaded).
 */
export function newlyUnblocked(
  previouslyBlocked: ReadonlySet<string>,
  nowBlocked: ReadonlySet<string>,
  nodes: readonly GraphNode[],
  mine: ReadonlySet<string>,
): GraphNode[] {
  return nodes.filter(
    (n) => !n.ghost && mine.has(n.uid) && previouslyBlocked.has(n.uid) && !nowBlocked.has(n.uid) && n.statusCategory !== "done",
  );
}

/** One notification for however many issues were unblocked. */
export function unblockedMessage(issues: readonly GraphNode[]): { title: string; body: string } {
  if (issues.length === 1) {
    const [n] = issues;
    return { title: `Unblocked: ${n.key}`, body: `${n.summary}\nNothing is blocking it any more; you can start it.` };
  }
  const keys = issues.map((n) => n.key);
  const listed = keys.length > 4 ? `${keys.slice(0, 4).join(", ")} and ${keys.length - 4} more` : keys.join(", ");
  return { title: `${issues.length} of your issues are unblocked`, body: listed };
}
