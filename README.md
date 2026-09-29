# Org chart — Remote API challenge

An organisational chart built on Remote's public API. Live data, 201 employments
from the sandbox company, rendered as an interactive tree with the data-quality
problems shown rather than hidden.

**Live:** https://remote-org-chart-six.vercel.app
**Code:** https://github.com/shahin-hu/remote-org-chart

> The sandbox API token expires 14 days after it was issued. If the live page
> shows an error instead of the chart, that is why — tell me and I will issue a
> fresh one.

---

## Run it

```bash
npm install
echo 'REMOTE_API_TOKEN=ra_test_your_token_here' > .env.local
npm run dev            # http://localhost:3000
```

Get a token from the sandbox: **Integrations → API**. Sandbox tokens start with
`ra_test_` and are revoked after 14 days.

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run build && npm start` | production build, the same one that deploys |
| `npm test` | 22 unit tests, no network needed (see Testing below) |
| `npm run typecheck` | TypeScript, including the route types Next generates |
| `npm run lint` | ESLint |
| `node --env-file=.env.local scripts/probe.mjs` | measure the API: size, timing at three concurrency levels, data quality |
| `node --env-file=.env.local scripts/snapshot.mjs` | cache a full fetch to `.cache/` so development does not hammer the sandbox |

Optional environment variables:

| Variable | Default | |
|---|---|---|
| `REMOTE_API_BASE` | `https://gateway.remote-sandbox.com` | swap to `https://gateway.remote.com` for production |
| `REMOTE_CONCURRENCY` | `8` | parallel detail requests |
| `ORG_CACHE_TTL_MS` | `300000` | server-side snapshot lifetime |

---

## Approach and architecture

### The problem, and why the architecture looks like this

**Remote's API does not return an org chart. It returns the edges, one node at a
time.**

- `GET /v1/employments` — paginated list. Name, job title, department, status.
  **No manager field.**
- `GET /v1/employments/{id}` — the full record, and the only place
  `manager_employment_id` lives. No `direct_reports` anywhere.

So building the chart means one list call plus **one detail call per person**. An
N+1, forced by the API rather than chosen.

### What I measured before deciding anything

Against the sandbox company, 201 employments. **Measured twice, three days apart:**

| Requests at once | 24 Sep | 27 Sep | Errors |
|---|---|---|---|
| 4 | 15.6 s | 26.4 s | 0 |
| 8 | 8.0 s | 14.5 s | 0 |
| 16 | 5.4 s | 8.2 s | 0 |

Plus ~1.4 s for the paginated list. **Full refresh: roughly 10 s on a good day,
20 s on a slow one**, at the default concurrency of 8.

The sandbox got about 70% slower between those two runs, with no change on my
side. I am quoting both numbers rather than the flattering one, because a single
measurement written down as a fact is how you end up with a README that lies.

Either way the conclusion holds, and the slower figure makes it stronger: this
cannot run inside a page request. Vercel's function limit is 10 s on the free
tier, so even the good day would be marginal. The page is **statically rendered
and revalidated every five minutes** — the fetch happens in the background and
nobody waits for it.

I stopped at concurrency 16. Zero errors there on both runs means I never found
the ceiling, but this is a shared sandbox and I did not want to probe its limits.
The default is 8, one step back from the fastest setting I verified.

**Confirmed in production.** The deployed build took 16.9 s to fetch everything,
and the live page serves in about 180 ms from cache:

```
x-nextjs-prerender: 1        the page is prebuilt
x-vercel-cache: HIT          served from cache
x-nextjs-stale-time: 300     revalidates every 5 minutes
```

A 17-second fetch behind a 180 ms page load. That is the decision working.

### Layout

```
lib/types.ts       our domain shape, deliberately not the API's 50-field payload
lib/tree.ts        buildForest() — flat list of edges → forest + diagnostics
lib/tree.test.ts   10 tests, fixtures only, no network
lib/remote-api.ts  pagination, bounded concurrency, retry with jitter
lib/org.ts         the cached snapshot, single entry point
app/page.tsx       server component, revalidate = 300
app/components/    the interactive chart
app/api/org        the same snapshot as JSON, for inspection
scripts/           probe and snapshot tools
```

`buildForest` is pure and runs in both places: on the server for the JSON route,
in the browser when you change the status filter. Filtering changes who exists,
which changes who is a root, so the tree genuinely has to be rebuilt. One
implementation means the two views can never disagree.

---

## Deploying

Built and deployed on Vercel. One environment variable is required.

```bash
npm i -g vercel
vercel link
vercel env add REMOTE_API_TOKEN production   # paste the ra_test_ token
vercel --prod
```

Or through the dashboard: import the repo, add `REMOTE_API_TOKEN` under
**Settings → Environment Variables**, deploy.

**What happens at deploy time.** The page is statically generated during the
build, so the fetch (10-20 s, see the measurements above) runs once in CI
rather than on a visitor's request.
After that it revalidates every five minutes in the background. The first
visitor after a deploy sees a page that is already built.

**If the token is missing or expired**, the build still succeeds and the page
renders an error explaining what to check, rather than failing the deploy. Sandbox
tokens are revoked after 14 days, so a live demo has a shelf life.

| Variable | Required | |
|---|---|---|
| `REMOTE_API_TOKEN` | yes | sandbox token, starts with `ra_test_` |
| `REMOTE_API_BASE` | no | defaults to the sandbox gateway |
| `REMOTE_CONCURRENCY` | no | defaults to 8 |
| `ORG_CACHE_TTL_MS` | no | defaults to 5 minutes |

---

## Testing

**22 tests, no network required.** `fetch` is stubbed, so the cases that matter
are reproducible on demand rather than dependent on what the sandbox happens to
be doing.

| File | Covers |
|---|---|
| `lib/tree.test.ts` (11) | Multiple roots, orphans, cycles, self-reference, a cycle with a tail, external managers, empty input, a 20,000-deep chain, both sort rules, and the invariant that nobody is ever dropped |
| `lib/remote-api.test.ts` (11) | Which HTTP failures retry and which do not, pagination across pages, the N+1 degrading rather than blanking when one call fails, detail-over-list field precedence, that concurrency is actually bounded, and failing before any request when there is no token |

### The tests were checked by breaking the code on purpose

A test that never fails is decoration. So I mutated the source nine times and
confirmed each change was caught:

| Change made to the source | Caught |
|---|---|
| Drop orphans instead of surfacing them | yes |
| Remove cycle detection entirely | yes, 3 tests |
| Sort roots alphabetically instead of by team size | **no — see below** |
| Off-by-one in subtree size | yes, 2 tests |
| Stop retrying 403 | yes |
| Make 401 retryable | yes, 2 tests |
| Stop after the first page of results | yes |
| Remove the concurrency limit | yes |
| Throw on a failed detail call instead of degrading | yes |

**The third one is the interesting result.** Changing the root sort from "largest
team first" to "alphabetical" broke nothing, because the fixture used `ceo` and
`solo`, where both rules give the same answer. The test could not tell the rule it
was checking from a different rule, which means it was not testing the sort at
all.

Fixed by choosing names where the two orders disagree, and added a second test for
child ordering, which had the same blind spot. Both now fail when the sort is
changed.

---

## What the data actually looks like

| Scenario | People | Top level | Orphans | Max depth |
|---|---|---|---|---|
| Everyone | 201 | **45** | 0 | 4 |
| Active only *(default)* | 171 | **17** | 0 | 4 |
| Excluding archived | 176 | 22 | 0 | 4 |

**Fifteen countries across 201 people.** That is why the chart shows a country on
every person, and why it is one of the five numbers in the header. The brief asks
for "key details **like** name, title, department, reporting line" — "like" means
examples, not a closed list. For most companies country would be a minor field.
For Remote, whose product is employing people in other countries without a local
entity, a 201-person company spread across 15 is the whole point. It was already
in the list response and unused.

*(The header shows 14 rather than 15 because it counts only the employees
currently displayed. Switch the `archived` filter on and it becomes 15.)*

**It is a forest, not a tree.** Even among active employees, 17 people have no
manager. Any chart that assumes a single person at the top is wrong about this
data, so the UI lists every top-level person and labels *why* each one is there.

I did not add a synthetic "Acme Sandbox Corp" node above them. It would make the
first screenshot tidier and it would invent a reporting relationship that does not
exist.

---

## Edge cases

The brief asks for missing data and employees with no manager to be handled
gracefully. `buildForest` holds one invariant: **`placed === total`. Nobody
disappears.** Anyone who cannot be placed under a manager surfaces at the top with
a stated reason, because a chart that silently drops people is the failure nobody
reports.

| Case | Handling | In the sandbox |
|---|---|---|
| No manager recorded | Top level, labelled "no manager recorded" | **45** (17 active) |
| Manager id not in the data set | Top level, labelled, id kept for debugging | 0 |
| Reporting loop (A→B→A) | Loop detected, one link cut, both people still shown | 0 |
| Self-reference | Treated as a one-node loop | 0 |
| Manager named but not on Remote | Name shown, no node invented | 0 |
| Detail call fails | Person still rendered from list data, counted as a failure | 0 |
| Filtering hides a manager | Tree rebuilt, the report becomes a root | — |

**Being straight about this:** the sandbox has none of the orphans, loops or
external managers. Those paths are covered by unit tests against fixtures, not by
live data. What the data *does* contain is multiple roots, and that is real.

---

## Assumptions and limitations

- **Active employees by default.** 30 of the 201 are archived, invited, initiated
  or created. They are one click away rather than hidden, because quietly dropping
  30 people is exactly the behaviour this chart is meant to make visible.
- **Snapshot is up to five minutes old.** Shown in the header. `/api/org?force=1`
  bypasses the cache.
- **Cache is per server instance.** Fine at this size. At ten times the data this
  wants a scheduled job writing a shared snapshot instead.
- **No auth on the app itself.** It is a demo against a sandbox. Production would
  need the reader's own credentials rather than a shared token.
- **Departments are strings, not entities.** The API returns a department name on
  the employment. Grouping by department would be a separate call.
- **Not used: Remote's MCP.** Their docs say it is "not an API you call yourself" —
  OAuth-with-PKCE for conversational clients, with REST recommended for
  server-to-server. A deployed function has no browser to sign in with. I used it
  to explore, and REST to build. See `DECISIONS.md`.

## With more time

1. Virtualise the tree. Fine at 201, not at 20,000.
2. Deep-link to a person, so a reporting line can be shared.
3. Render the second hierarchy — `/company-structure-nodes` exposes cost centres
   with parents, a different tree over the same people.
4. Move the snapshot to a scheduled job so the first request after a deploy never
   pays for the fetch.

## How this was built

With Claude, as the brief encourages. `DECISIONS.md` is the decision log kept
while building: what was chosen, what was rejected, what it cost, and the places I
changed my mind or was wrong.
