'use client';

import { useState } from 'react';
import type { Diagnostics as D } from '@/lib/types';

/**
 * What the data could not tell us, shown rather than swallowed.
 *
 * An org chart that silently drops the people it cannot place is worse than one
 * that shows them and says why: missing people do not get reported, because there
 * is nothing on screen to report. Everything here is a count of something real.
 */
export default function Diagnostics({
  diagnostics, failures,
}: { diagnostics: D; failures: { id: string; reason: string }[] }) {
  const [open, setOpen] = useState(false);

  const byReason = {
    no_manager: diagnostics.roots.filter((r) => r.reason === 'no_manager').length,
    orphaned: diagnostics.roots.filter((r) => r.reason === 'orphaned').length,
    cycle_broken: diagnostics.roots.filter((r) => r.reason === 'cycle_broken').length,
  };

  const items = [
    { label: 'people placed', value: `${diagnostics.placed}/${diagnostics.total}`, warn: diagnostics.placed !== diagnostics.total },
    { label: 'no manager recorded', value: byReason.no_manager, warn: false },
    { label: 'manager not in data', value: byReason.orphaned, warn: byReason.orphaned > 0 },
    { label: 'reporting loops', value: diagnostics.cycles.length, warn: diagnostics.cycles.length > 0 },
    { label: 'manager not on Remote', value: diagnostics.managersNotInRemote.length, warn: false },
    { label: 'failed detail calls', value: failures.length, warn: failures.length > 0 },
  ];

  return (
    <section className="rounded border border-neutral-200 dark:border-neutral-800">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm"
      >
        <span className="font-medium">Data quality</span>
        <span className="text-xs text-neutral-500">{open ? 'hide' : 'show'}</span>
      </button>
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        {items.map((i) => (
          <div key={i.label} className="text-xs">
            <span className={`font-mono text-base ${i.warn ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {i.value}
            </span>{' '}
            <span className="text-neutral-500">{i.label}</span>
          </div>
        ))}
      </div>

      {open && (
        <div className="space-y-3 border-t border-neutral-200 px-4 py-3 text-xs dark:border-neutral-800">
          <Detail title="Top-level people" rows={diagnostics.roots.map((r) => `${r.name} — ${r.reason.replace('_', ' ')}`)} />
          {diagnostics.orphans.length > 0 && (
            <Detail title="Manager id not found in this data set" rows={diagnostics.orphans.map((o) => `${o.name} → ${o.missingManagerId}`)} />
          )}
          {diagnostics.cycles.length > 0 && (
            <Detail title="Reporting loops (link cut so the chart can render)" rows={diagnostics.cycles.map((c) => c.join(' → '))} />
          )}
          {failures.length > 0 && (
            <Detail title="Detail calls that failed (person shown without a manager)" rows={failures.map((f) => `${f.id}: ${f.reason}`)} />
          )}
        </div>
      )}
    </section>
  );
}

function Detail({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div>
      <p className="mb-1 font-medium">{title}</p>
      <ul className="space-y-0.5 text-neutral-600 dark:text-neutral-400">
        {rows.slice(0, 50).map((r, i) => <li key={i} className="font-mono">{r}</li>)}
        {rows.length > 50 && <li className="italic">…and {rows.length - 50} more</li>}
      </ul>
    </div>
  );
}
