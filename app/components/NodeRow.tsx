'use client';

import type { OrgNode, RootReason } from '@/lib/types';

/**
 * One person and their reports.
 *
 * Rendered recursively, which is safe only because `buildForest` cuts cycles
 * before this ever sees the data. Without that guarantee a reporting loop would
 * hang the browser.
 */
export default function NodeRow({
  node, reason, matchIds, query, collapsed, onToggle, depth = 0, ancestors = [],
}: {
  node: OrgNode;
  reason?: RootReason;
  matchIds: Set<string> | null;
  query: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
  /** Names from the root down to this node's manager. Drives the reporting line. */
  ancestors?: string[];
}) {
  // When searching, prune branches with no match anywhere beneath them.
  const children = matchIds
    ? node.children.filter((c) => subtreeMatches(c, matchIds))
    : node.children;

  const isCollapsed = collapsed.has(node.id);
  const hasChildren = children.length > 0;
  const isHit = matchIds?.has(node.id) && matchesSelf(node, query);

  return (
    <div className={depth > 0 ? 'border-l border-neutral-200 pl-4 dark:border-neutral-800' : ''}>
      <div
        className={`flex items-start gap-2 rounded px-2 py-1.5 ${
          isHit ? 'bg-yellow-100 dark:bg-yellow-900/30' : ''
        }`}
      >
        <button
          onClick={() => onToggle(node.id)}
          disabled={!hasChildren}
          aria-label={hasChildren ? (isCollapsed ? 'Expand' : 'Collapse') : undefined}
          className={`mt-0.5 w-4 shrink-0 text-xs ${
            hasChildren ? 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white' : 'text-transparent'
          }`}
        >
          {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
        </button>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{node.name}</span>
            {node.jobTitle && (
              <span className="text-sm text-neutral-600 dark:text-neutral-400">{node.jobTitle}</span>
            )}
            {node.department && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {node.department}
              </span>
            )}
            {node.country && (
              <span className="text-xs text-neutral-500">{node.country}</span>
            )}
            {node.status && node.status !== 'active' && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {node.status}
              </span>
            )}
          </div>

          <div className="mt-0.5 text-xs text-neutral-500">
            {/* The reporting line. For a root, say WHY it is a root rather than
                leaving a blank where a manager should be. */}
            {reason ? rootLabel(reason, node) : `Reports to ${node.managerName ?? '—'}`}
            {hasChildren && <> · {node.children.length} direct, {node.subtreeSize - 1} total</>}
          </div>

          {/* Full reporting line. Only from depth 2 down: at depth 1 the chain is
              just the manager we already named above, so printing it twice is
              noise. This is what makes a search result readable when you land in
              the middle of a subtree with no visible context. */}
          {ancestors.length > 1 && (
            <div className="mt-0.5 truncate text-[11px] text-neutral-400 dark:text-neutral-600">
              {ancestors.join(' › ')} › <span className="text-neutral-500 dark:text-neutral-500">{node.name}</span>
            </div>
          )}
        </div>
      </div>

      {hasChildren && !isCollapsed && (
        <div className="ml-4">
          {children.map((c) => (
            <NodeRow
              key={c.id}
              node={c}
              matchIds={matchIds}
              query={query}
              collapsed={collapsed}
              onToggle={onToggle}
              depth={depth + 1}
              ancestors={[...ancestors, node.name]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function rootLabel(reason: RootReason, node: OrgNode) {
  if (reason === 'no_manager') {
    return node.managerName
      ? `Top level · manager "${node.managerName}" is not employed through Remote`
      : 'Top level · no manager recorded';
  }
  if (reason === 'orphaned') return 'Top level · manager not found in this data set';
  return 'Top level · reporting loop detected, link cut here';
}

function matchesSelf(node: OrgNode, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return `${node.name} ${node.jobTitle ?? ''} ${node.department ?? ''}`.toLowerCase().includes(q);
}

function subtreeMatches(node: OrgNode, ids: Set<string>): boolean {
  return ids.has(node.id) || node.children.some((c) => subtreeMatches(c, ids));
}
