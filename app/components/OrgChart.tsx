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
    if (next.has(s)) next.delete(s);
    else next.add(s);
    // Never let the viewer filter down to nothing and see an empty page with no
    // explanation. Keeping at least one status on makes the state recoverable.
    if (next.size) setStatuses(next);
  };

  const toggleNode = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  /**
   * The five numbers worth knowing before scrolling. Deliberately includes the
   * two unflattering ones — the people nobody manages, and the ones attached to
   * nothing — because they are the most interesting thing in this data set.
   */
  const summary = useMemo(() => {
    const teams = roots.filter((r) => r.children.length > 0);
    const islands = roots.filter((r) => r.children.length === 0);
    const countries = new Set(visible.map((p) => p.country).filter(Boolean)).size;

    // Deepest reporting line. Iterative walk, same reason as in buildForest:
    // recursion on an arbitrarily deep chain is a crash waiting to happen.
    let maxDepth = 0;
    const stack = [...roots];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.depth > maxDepth) maxDepth = n.depth;
      for (const c of n.children) stack.push(c);
    }

    return [
      { label: 'people shown', value: visible.length, note: `of ${meta.totalEmployments} employments` },
      { label: 'countries', value: countries, note: 'employed across' },
      { label: 'teams', value: teams.length, note: 'with direct reports' },
      { label: 'unconnected', value: islands.length, note: 'no manager, no reports' },
      { label: 'levels deep', value: maxDepth + 1, note: 'longest reporting line' },
    ];
  }, [roots, visible, meta.totalEmployments]);

  const shownRoots = matchIds ? roots.filter((r) => hasMatch(r, matchIds)) : roots;

  /**
   * A root with no reports is not a small team, it is an unconnected person.
   * In this data 12 of the 17 top-level people are islands — no manager and no
   * direct reports — which is the most common edge case here by a wide margin.
   * Rendering them identically to a real team makes the reader count rows to
   * work that out, so they get their own labelled section instead.
   */
  const trees = shownRoots.filter((r) => r.children.length > 0);
  const islands = shownRoots.filter((r) => r.children.length === 0);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Organisation chart</h1>
          {/* This page is publicly reachable and shows names, job titles and
              countries. That is personal data in any other context, so it should
              be unambiguous that these are not real people. Cheap to say, and the
              alternative is a reviewer wondering whether it is. */}
          <span className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-700">
            Sandbox demo data
          </span>
        </div>
        <p className="mt-1.5 max-w-prose text-sm text-neutral-500">
          Built against Remote&rsquo;s public API sandbox. Every person below is
          generated demo data, not a real employee.
        </p>

        {/* The shape of the company, before anyone scrolls.
            This used to be one line of grey text. The most interesting thing in
            this data is that it is five real teams plus twelve people attached to
            nobody, and a sentence buried in a subtitle made the reader work that
            out. Same numbers, just not hidden. */}
        <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-200 bg-neutral-200 sm:grid-cols-5 dark:border-neutral-800 dark:bg-neutral-800">
          {summary.map((s) => (
            <div key={s.label} className="bg-white px-4 py-3 dark:bg-neutral-950">
              <dt className="text-xs text-neutral-500">{s.label}</dt>
              <dd className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">
                {s.value}
              </dd>
              {s.note && <dd className="text-[11px] text-neutral-400">{s.note}</dd>}
            </div>
          ))}
        </dl>

        <p className="mt-2 text-xs text-neutral-500">
          Data as of {new Date(meta.fetchedAt).toLocaleString()} · took{' '}
          {(meta.durationMs / 1000).toFixed(1)}s to fetch {meta.totalEmployments} employments
          over {meta.totalEmployments + 1} API calls
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
        <>
          {trees.length > 0 && (
            <ul className="mt-6 space-y-5">
              {trees.map((r) => (
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

          {islands.length > 0 && (
            <section className="mt-9 border-t border-neutral-200 pt-5 dark:border-neutral-800">
              <h2 className="text-sm font-medium">Not connected to anyone</h2>
              <p className="mt-0.5 mb-3 text-xs text-neutral-500">
                {islands.length} {islands.length === 1 ? 'person has' : 'people have'} no
                manager recorded and no direct reports. They are real employees in the
                data, they just are not attached to the chart anywhere.
              </p>
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {islands.map((r) => (
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
            </section>
          )}
        </>
      )}
    </main>
  );
}

function hasMatch(node: OrgNode, ids: Set<string>): boolean {
  if (ids.has(node.id)) return true;
  return node.children.some((c) => hasMatch(c, ids));
}
