import type { Person, OrgNode, OrgForest, Diagnostics, RootReason } from './types';

/**
 * Build a forest of org nodes from a flat list of people.
 *
 * WHY A FOREST AND NOT A TREE. The API gives every employment an optional
 * `manager_employment_id`. Nothing guarantees exactly one person has none. A real
 * company has contractors, a founder, an unassigned new hire. Returning a single
 * root would mean inventing one.
 *
 * WHY DIAGNOSTICS ARE A RETURN VALUE, NOT A LOG LINE. The interesting part of
 * this data set is where it is broken. An org chart that silently drops the people
 * it could not place is worse than one that shows them and says why, because
 * missing people do not get reported. So every person is placed somewhere, and
 * every reason is named.
 *
 * Complexity: O(n) time and O(n) space. Each node's ancestor walk is memoised, so
 * cycle detection does not degrade to O(n²) on a deep chain.
 */
export function buildForest(people: Person[]): OrgForest {
  const byId = new Map<string, Person>();
  for (const p of people) byId.set(p.id, p);

  const diagnostics: Diagnostics = {
    total: people.length,
    roots: [],
    orphans: [],
    cycles: [],
    managersNotInRemote: [],
    placed: 0,
  };

  // ── 1. resolve each person's effective parent ──────────────────────────────
  // "Effective" because a pointer can be null, dangling, or part of a cycle. All
  // three end up as null here, each for a different and recorded reason.
  const parentOf = new Map<string, string | null>();
  const rootReason = new Map<string, RootReason>();

  for (const p of people) {
    if (p.managerId == null) {
      parentOf.set(p.id, null);
      rootReason.set(p.id, 'no_manager');
      // A named manager with no id is not an error. It means the manager is real
      // but not employed through Remote, so no node exists for them.
      if (p.managerName) {
        diagnostics.managersNotInRemote.push({ id: p.id, name: p.name, managerName: p.managerName });
      }
      continue;
    }
    if (!byId.has(p.managerId)) {
      // Dangling pointer: manager was deleted, is inactive, or sits outside the
      // page of data we fetched. Surface it rather than dropping the person.
      parentOf.set(p.id, null);
      rootReason.set(p.id, 'orphaned');
      diagnostics.orphans.push({ id: p.id, name: p.name, missingManagerId: p.managerId });
      continue;
    }
    if (p.managerId === p.id) {
      // Self-reference is a one-node cycle. Treat it as such.
      parentOf.set(p.id, null);
      rootReason.set(p.id, 'cycle_broken');
      diagnostics.cycles.push([p.id]);
      continue;
    }
    parentOf.set(p.id, p.managerId);
  }

  // ── 2. break cycles ────────────────────────────────────────────────────────
  // A→B→A will hang any recursive renderer. Walk ancestors from each node; if the
  // walk re-enters the current path we have a cycle. Cut exactly one edge — the
  // one that closes the loop — so the people stay visible and the render halts.
  const SAFE = 1, INPATH = 2;
  const state = new Map<string, number>();

  for (const p of people) {
    if (state.get(p.id)) continue;
    const path: string[] = [];
    let cur: string | null = p.id;

    while (cur != null && !state.get(cur)) {
      state.set(cur, INPATH);
      path.push(cur);
      cur = parentOf.get(cur) ?? null;
    }

    if (cur != null && state.get(cur) === INPATH) {
      // Closed a loop. The cycle is the tail of path starting at `cur`.
      const start = path.indexOf(cur);
      const cycle = path.slice(start);
      diagnostics.cycles.push(cycle);
      // Cut the edge from the last member back to `cur`.
      const last = cycle[cycle.length - 1];
      parentOf.set(last, null);
      rootReason.set(last, 'cycle_broken');
    }

    for (const id of path) state.set(id, SAFE);
  }

  // ── 3. assemble ────────────────────────────────────────────────────────────
  const nodes = new Map<string, OrgNode>();
  for (const p of people) nodes.set(p.id, { ...p, children: [], depth: 0, subtreeSize: 1 });

  const roots: OrgNode[] = [];
  for (const p of people) {
    const node = nodes.get(p.id)!;
    const parentId = parentOf.get(p.id) ?? null;
    if (parentId == null) {
      roots.push(node);
      diagnostics.roots.push({ id: p.id, name: p.name, reason: rootReason.get(p.id) ?? 'no_manager' });
    } else {
      nodes.get(parentId)!.children.push(node);
    }
  }

  // ── 4. depth, subtree size, stable ordering ────────────────────────────────
  // Iterative, not recursive: a 10,000-person chain should not blow the stack.
  const sortKids = (n: OrgNode) => n.children.sort((a, b) => a.name.localeCompare(b.name));
  const order: OrgNode[] = [];
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    order.push(n);
    sortKids(n);
    for (const c of n.children) {
      c.depth = n.depth + 1;
      stack.push(c);
    }
  }
  // Walk back up so a parent's size includes every descendant.
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    n.subtreeSize = 1 + n.children.reduce((s, c) => s + c.subtreeSize, 0);
  }

  roots.sort((a, b) => b.subtreeSize - a.subtreeSize || a.name.localeCompare(b.name));
  diagnostics.placed = order.length;

  return { roots, diagnostics };
}
