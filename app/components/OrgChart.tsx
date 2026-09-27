'use client';

import { useMemo, useState } from 'react';
import { buildForest } from '@/lib/tree';
import type { Person, OrgNode } from '@/lib/types';
import NodeRow from './NodeRow';
import Diagnostics from './Diagnostics';

/**
 * The chart, and the controls over it.
 *
 * WHY THE TREE IS REBUILT IN THE BROWSER. The same `buildForest` runs on the
 * server for the JSON route and here for the interactive view. Filtering by status
 * changes which people exist, which changes who is a root — so the tree genuinely
 * has to be rebuilt, not just hidden with CSS. Reusing one implementation means
 * the two views can never disagree about who reports to whom.
 */

type Props = {
  people: Person[];
  meta: { fetchedAt: string; totalEmployments: number; durationMs: number;
    failures: { id: string; reason: string }[] };
  refreshError: string | null;
};

const ALL_STATUSES = ['active', 'archived', 'invited', 'initiated', 'created'];

export default function OrgChart({ people, meta, refreshError }: Props) {
  const [statuses, setStatuses] = useState<Set<string>>(new Set(['active']));
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () => people.filter((p) => statuses.has(p.status ?? 'unknown')),
    [people, statuses],
  );

  const { roots, diagnostics } = useMemo(() => buildForest(visible), [visible]);

  /**
   * Search keeps the path, not just the match. Showing "Abigail Baker" with no
   * ancestors answers the wrong question: an org chart is about position, so a
   * result is only useful with its reporting line above it.
   */
  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set<string>();
    const byId = new Map(visible.map((p) => [p.id, p]));
    for (const p of visible) {
      const hay = `${p.name} ${p.jobTitle ?? ''} ${p.department ?? ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
      let cur: Person | undefined = p;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.id)) {
        guard.add(cur.id);
        hit.add(cur.id);
        cur = cur.managerId ? byId.get(cur.managerId) : undefined;
      }
    }
    return hit;
  }, [query, visible]);

  const toggleStatus = (s: string) => {
    const next = new Set(statuses);
    next.has(s) ? next.delete(s) : next.add(s);
    // Never let the viewer filter down to nothing and see an empty page with no
    // explanation. Keeping at least one status on makes the state recoverable.
    if (next.size) setStatuses(next);
  };

  const toggleNode = (id: string) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsed(next);
  };

  const shownRoots = matchIds ? roots.filter((r) => hasMatch(r, matchIds)) : roots;

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Organisation chart</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {visible.length} of {meta.totalEmployments} employments ·{' '}
          {diagnostics.roots.length} at the top ·{' '}
          data as of {new Date(meta.fetchedAt).toLocaleString()} ({(meta.durationMs / 1000).toFixed(1)}s to fetch)
        </p>
        {refreshError && (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Showing the last good snapshot. {refreshError}
          </p>
        )}
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, title or department"
          className="min-w-64 flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="flex flex-wrap gap-1.5">
          {ALL_STATUSES.map((s) => {
            const on = statuses.has(s);
            const n = people.filter((p) => p.status === s).length;
            if (!n) return null;
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  on
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                    : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'
                }`}
              >
                {s} {n}
              </button>
            );
          })}
        </div>
      </div>

      <Diagnostics diagnostics={diagnostics} failures={meta.failures} />

      {shownRoots.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">
          Nothing matches “{query}” in the selected statuses.
        </p>
      ) : (
        <ul className="mt-6 space-y-5">
          {shownRoots.map((r) => (
            <li key={r.id}>
              <NodeRow
                node={r}
                reason={diagnostics.roots.find((x) => x.id === r.id)?.reason}
                matchIds={matchIds}
                query={query}
                collapsed={collapsed}
                onToggle={toggleNode}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function hasMatch(node: OrgNode, ids: Set<string>): boolean {
  if (ids.has(node.id)) return true;
  return node.children.some((c) => hasMatch(c, ids));
}
