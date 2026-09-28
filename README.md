# Org chart — Remote API challenge

An organisational chart built on Remote's public API. Live data, 201 employments
from the sandbox company, rendered as an interactive tree with the data-quality
problems shown rather than hidden.

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
| `npm test` | unit tests for the tree builder (10 tests, no network needed) |
| `node --env-file=.env.local scripts/probe.mjs` | measure the API: size, timing at three concurrency levels, data quality |
| `node --env-file=.env.local scripts/snapshot.mjs` | cache a full fetch to `.cache/` so development does not hammer the sandbox |

Optional environment variables:

| Variable | Default | |
|---|---|---|
| `REMOTE_API_BASE` | `https://gateway.remote-sandbox.com` | swap to `https://gateway.remote.com` for production |
| `REMOTE_CONCURRENCY` | `8` | parallel detail requests |
| `ORG_CACHE_TTL_MS` | `300000` | server-side snapshot lifetime |

---

## The problem, and why the architecture looks like this

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

## What the data actually looks like

| Scenario | People | Top level | Orphans | Max depth |
|---|---|---|---|---|
| Everyone | 201 | **45** | 0 | 4 |
| Active only *(default)* | 171 | **17** | 0 | 4 |
| Excluding archived | 176 | 22 | 0 | 4 |

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
