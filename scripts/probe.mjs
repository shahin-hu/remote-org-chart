/**
 * Measure the sandbox before committing to an architecture.
 *
 *   node --env-file=.env.local scripts/probe.mjs
 *
 * Answers: does the token work, how many people are there, how long does the
 * full N+1 actually take, and how messy is the manager data.
 */
const BASE = process.env.REMOTE_API_BASE ?? 'https://gateway.remote-sandbox.com';
const TOKEN = process.env.REMOTE_API_TOKEN;
if (!TOKEN) { console.error('REMOTE_API_TOKEN not set. Put it in .env.local'); process.exit(2); }

const get = async (path) => {
  const r = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path} — ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

console.log(`probing ${BASE}\n`);

// 1. does the token work at all
const me = await get('/v1/identity/current');
console.log('1. identity ok:', JSON.stringify(me).slice(0, 300), '\n');

// 2. how many people, how many pages
let page = 1, list = [];
const tList = Date.now();
for (;;) {
  const b = await get(`/v1/employments?page=${page}&page_size=100`);

  list.push(...(b.data.employments ?? []));
  if (!b.data.total_pages || page >= b.data.total_pages) break;
  page++;
}
console.log(`2. list: ${list.length} employments over ${page} page(s) in ${Date.now() - tList}ms`);
console.log('   sample row:', JSON.stringify(list[0], null, 2).slice(0, 600), '\n');

// 3. the N+1, timed, at a few concurrency levels
for (const limit of [4, 8, 16]) {
  const t = Date.now();
  let i = 0; const details = new Array(list.length);
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    for (;;) { const k = i++; if (k >= list.length) return;
      try { details[k] = (await get(`/v1/employments/${list[k].id}`)).data.employment; }
      catch (e) { details[k] = { __error: e.message }; } }
  }));
  const ms = Date.now() - t;
  const errs = details.filter((d) => d?.__error).length;
  console.log(`3. concurrency ${String(limit).padStart(2)}: ${ms}ms for ${list.length} detail calls, ${errs} error(s)`);
  if (limit === 16) globalThis.__details = details;
}

// 4. how messy is the manager data
const d = globalThis.__details.filter((x) => x && !x.__error);
const ids = new Set(d.map((x) => x.id));
const noMgr = d.filter((x) => !x.manager_employment_id);
const dangling = d.filter((x) => x.manager_employment_id && !ids.has(x.manager_employment_id));
const nameNoId = d.filter((x) => x.manager && !x.manager_employment_id);
console.log(`\n4. manager data quality over ${d.length} records`);
console.log(`   no manager_employment_id : ${noMgr.length}  (these become roots)`);
console.log(`   dangling manager id      : ${dangling.length}  (orphans)`);
console.log(`   manager name, no id      : ${nameNoId.length}  (manager not on Remote)`);
console.log(`   departments              : ${new Set(d.map((x) => x.department?.name ?? x.department).filter(Boolean)).size}`);
console.log(`   statuses                 : ${JSON.stringify([...new Set(d.map((x) => x.status))])}`);
