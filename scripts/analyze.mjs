/**
 * Offline analysis of the snapshot. No network.
 *
 * The question this answers: which employees belong on the chart? Status
 * filtering is the biggest product decision in this exercise, and filtering can
 * CREATE orphans — if an active employee's manager is archived and we filter the
 * manager out, the employee loses their parent.
 */
import { readFileSync } from 'node:fs';
const { people } = JSON.parse(readFileSync('.cache/people.json', 'utf8'));

const statusCounts = {};
for (const p of people) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
console.log('statuses:', statusCounts);
console.log('types   :', [...new Set(people.map((p) => p.type))].join(', '));
console.log();

const scenarios = {
  'everyone (201)':            () => true,
  'active only':               (p) => p.status === 'active',
  'exclude archived':          (p) => p.status !== 'archived',
  'active + invited + created':(p) => ['active', 'invited', 'created'].includes(p.status),
};

for (const [label, keep] of Object.entries(scenarios)) {
  const set = people.filter(keep);
  const ids = new Set(set.map((p) => p.id));
  const roots = set.filter((p) => !p.managerId);
  const orphans = set.filter((p) => p.managerId && !ids.has(p.managerId));
  const maxDepth = (() => {
    const byId = new Map(set.map((p) => [p.id, p]));
    let best = 0;
    for (const p of set) {
      let d = 0, cur = p, seen = new Set();
      while (cur?.managerId && byId.has(cur.managerId) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.managerId); d++; }
      best = Math.max(best, d);
    }
    return best;
  })();
  console.log(`${label.padEnd(28)} n=${String(set.length).padStart(3)}  roots=${String(roots.length).padStart(3)}  orphans=${String(orphans.length).padStart(3)}  maxDepth=${maxDepth}`);
}

console.log('\nroots in the full set, by status:');
const rootsByStatus = {};
for (const p of people.filter((x) => !x.managerId)) rootsByStatus[p.status] = (rootsByStatus[p.status] ?? 0) + 1;
console.log(rootsByStatus);
