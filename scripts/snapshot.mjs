/**
 * Fetch every employment once and save it to .cache/people.json.
 *
 *   node --env-file=.env.local scripts/snapshot.mjs
 *
 * Why: during development I do not want to re-run 201 detail calls every time I
 * change a line. One snapshot, then work offline against it. Also means the
 * sandbox is not being hammered while I iterate.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.REMOTE_API_BASE ?? 'https://gateway.remote-sandbox.com';
const TOKEN = process.env.REMOTE_API_TOKEN;
const CONCURRENCY = Number(process.env.REMOTE_CONCURRENCY ?? 16);
if (!TOKEN) { console.error('REMOTE_API_TOKEN not set'); process.exit(2); }

const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`);
  return r.json();
};

const t0 = Date.now();
let page = 1, list = [];
for (;;) {
  const b = await get(`/v1/employments?page=${page}&page_size=100`);
  list.push(...b.data.employments);
  if (page >= b.data.total_pages) break;
  page++;
}

let i = 0; const out = new Array(list.length);
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) { const k = i++; if (k >= list.length) return;
    const e = list[k];
    try {
      const emp = (await get(`/v1/employments/${e.id}`)).data.employment;
      out[k] = { id: e.id, name: emp.full_name ?? e.full_name, jobTitle: emp.job_title ?? e.job_title ?? null,
        department: emp.department?.name ?? emp.department ?? e.department ?? null,
        status: emp.status ?? e.status ?? null, type: emp.type ?? e.type ?? null,
        country: e.country?.name ?? null,
        managerId: emp.manager_employment_id ?? null, managerName: emp.manager ?? null };
    } catch (err) { out[k] = { id: e.id, name: e.full_name, __error: String(err.message) }; }
  }
}));

mkdirSync('.cache', { recursive: true });
writeFileSync('.cache/people.json', JSON.stringify({ fetchedAt: new Date().toISOString(), people: out }, null, 2));
console.log(`saved ${out.length} people to .cache/people.json in ${Date.now() - t0}ms`);
