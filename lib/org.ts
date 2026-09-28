import { fetchPeople } from './remote-api';
import { buildForest } from './tree';
import type { Person, OrgForest } from './types';

/**
 * The application's single entry point for org data.
 *
 * WHY THERE IS A CACHE HERE AT ALL. Measured against the sandbox: 201 employments,
 * one list call plus 201 detail calls, ~7 seconds end to end at concurrency 16.
 * That does not fit inside a page request — Vercel's function limit is 10s on the
 * free tier and a cold start eats into it. So the fetch happens on a timer and the
 * page is served from what was already built. See DECISIONS.md D8.
 *
 * WHY IT RETURNS AN ERROR INSTEAD OF THROWING. If the API is down, an org chart
 * that says "showing data from 14:02, could not refresh" is more useful than a
 * stack trace. Stale and honest beats empty.
 */

export type OrgSnapshot = {
  people: Person[];
  forest: OrgForest;
  meta: {
    fetchedAt: string;
    /** Employments the list returned, before any filtering. */
    totalEmployments: number;
    /** Detail calls that failed; these people appear with no manager. */
    failures: { id: string; reason: string }[];
    durationMs: number;
  };
  /** Set when this snapshot is stale because a refresh failed. */
  error?: string;
};

const TTL_MS = Number(process.env.ORG_CACHE_TTL_MS ?? 5 * 60_000);

let cached: OrgSnapshot | null = null;
let cachedAt = 0;
let inFlight: Promise<OrgSnapshot> | null = null;

async function load(): Promise<OrgSnapshot> {
  const started = Date.now();
  const { people, failures } = await fetchPeople();
  return {
    people,
    forest: buildForest(people),
    meta: {
      fetchedAt: new Date().toISOString(),
      totalEmployments: people.length,
      failures,
      durationMs: Date.now() - started,
    },
  };
}

/**
 * Returns a snapshot, fetching only when the cache has expired.
 *
 * `inFlight` de-duplicates concurrent callers. Without it, two requests arriving
 * together on a cold cache would each start their own 201-call fetch — the
 * stampede that turns a slow page into an outage.
 */
export async function getOrg(force = false): Promise<OrgSnapshot> {
  const fresh = cached && Date.now() - cachedAt < TTL_MS;
  if (fresh && !force) return cached!;
  if (inFlight) return inFlight;

  inFlight = load()
    .then((snap) => {
      cached = snap;
      cachedAt = Date.now();
      return snap;
    })
    .catch((err: Error) => {
      // Loud on purpose. A build that cannot reach the API still succeeds and
      // ships an error page, which is the right behaviour for a deploy but a
      // terrible thing to discover silently. This line puts it in the CI log.
      console.error(`[org] load failed: ${err.message}`);
      // Serve what we have rather than nothing. An org chart from five minutes
      // ago still answers "who does Abigail report to".
      if (cached) return { ...cached, error: `refresh failed: ${err.message}` };
      throw err;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

/** Statuses considered "on the chart" unless the viewer asks for more. */
export const DEFAULT_STATUSES = ['active'] as const;
