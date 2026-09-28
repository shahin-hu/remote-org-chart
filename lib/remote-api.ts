import type { Person } from './types';

/**
 * Client for the Remote API.
 *
 * THE SHAPE OF THE PROBLEM. `GET /v1/employments` returns a paginated list with
 * no manager field. The parent pointer (`manager_employment_id`) only exists on
 * `GET /v1/employments/{id}`. So building an org chart means one list call plus
 * one detail call per person. An N+1, forced by the API, not chosen by us.
 *
 * Everything below exists to make that N+1 survivable: bounded concurrency so we
 * do not open 500 sockets, backoff so a 429 does not become a failed page, and a
 * hard per-request timeout so one slow call cannot hold the whole render.
 */

const BASE = process.env.REMOTE_API_BASE ?? 'https://gateway.remote-sandbox.com';
const TOKEN = process.env.REMOTE_API_TOKEN ?? '';

/** How many detail calls run at once. Tuned after measuring; see decisions.md #7. */
const CONCURRENCY = Number(process.env.REMOTE_CONCURRENCY ?? 8);
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 4;

export class RemoteApiError extends Error {
  constructor(message: string, readonly status?: number, readonly path?: string) {
    super(message);
    this.name = 'RemoteApiError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One HTTP GET with retries.
 *
 * WHICH FAILURES ARE WORTH RETRYING. 429 and 5xx, obviously. A 404 is an answer,
 * not a hiccup, and retrying it turns a fast failure into a slow one.
 *
 * 403 IS THE INTERESTING ONE. Conventionally it means "you are not allowed" and
 * should never be retried. But this sandbox returned 403 during a build that ran
 * immediately after ~1,000 calls in a few minutes, while the same token returned
 * 200 on a single call moments before and moments after. So on this API a 403
 * appears to be how load-shedding shows up, where most APIs would send 429.
 *
 * I cannot prove that — I did not want to hammer a shared sandbox to reproduce
 * it. So 403 is retried with backoff, which is safe either way: a genuine
 * permission error still fails, just four attempts later instead of one.
 *
 * 401 stays fail-fast, because that is the unambiguous "bad token" signal and it
 * is the one worth surfacing immediately.
 *
 * Honours `Retry-After` when sent, otherwise exponential backoff with jitter so
 * parallel workers do not all wake together and repeat the burst that caused it.
 */
async function get<T>(path: string): Promise<T> {
  if (!TOKEN) throw new RemoteApiError('REMOTE_API_TOKEN is not set', undefined, path);

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status === 403 || res.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) {
        throw new RemoteApiError(`HTTP ${res.status} on ${path}`, res.status, path);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 400 + Math.random() * 300;
      await sleep(wait);
    } catch (err) {
      // A timeout or a socket error is worth one more try; a RemoteApiError is not.
      if (err instanceof RemoteApiError) throw err;
      lastError = err;
      if (attempt === MAX_RETRIES) break;
      await sleep(2 ** attempt * 400 + Math.random() * 300);
    }
  }
  throw new RemoteApiError(
    `network failure on ${path}: ${(lastError as Error)?.message ?? 'unknown'}`, undefined, path,
  );
}

/** Run tasks with at most `limit` in flight. Keeps memory and sockets bounded. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

type MinimalEmployment = { id: string; full_name?: string; job_title?: string | null;
  department?: string | null; status?: string | null; type?: string | null;
  country?: { name?: string | null } | null };

/**
 * Only the fields an org chart needs. Their full employment record has ~50 more
 * covering banking, contracts and onboarding; typing those would be noise, and
 * typing this as `any` would lose the checks on the six that matter.
 */
type EmploymentDetail = {
  full_name?: string | null;
  job_title?: string | null;
  department?: string | { name?: string | null } | null;
  status?: string | null;
  country?: { name?: string | null } | null;
  manager?: string | null;
  manager_employment_id?: string | null;
};

/** Walk every page of the employments list. */
export async function listEmployments(): Promise<MinimalEmployment[]> {
  const all: MinimalEmployment[] = [];
  let page = 1;
  for (;;) {
    const body = await get<{ data: { employments: MinimalEmployment[];
      current_page: number; total_pages: number; total_count: number } }>(
      `/v1/employments?page=${page}&page_size=100`,
    );
    const d = body.data;
    all.push(...(d.employments ?? []));
    if (!d.total_pages || page >= d.total_pages) return all;
    page++;
  }
}

/**
 * Fetch every employment's detail and flatten to our Person shape.
 *
 * `failures` is returned rather than thrown. One employee's detail call failing
 * should degrade the chart, not blank it: we would rather render 199 of 200
 * people and say so than show an error page.
 */
export async function fetchPeople(): Promise<{ people: Person[]; failures: { id: string; reason: string }[] }> {
  const list = await listEmployments();
  const failures: { id: string; reason: string }[] = [];

  const results = await pooled(list, CONCURRENCY, async (e) => {
    try {
      const body = await get<{ data: { employment: EmploymentDetail } }>(`/v1/employments/${e.id}`);
      const emp: EmploymentDetail = body.data.employment ?? {};
      return {
        id: e.id,
        name: emp.full_name ?? e.full_name ?? '(unnamed)',
        jobTitle: emp.job_title ?? e.job_title ?? null,
        department: (typeof emp.department === 'object' ? emp.department?.name : emp.department) ?? e.department ?? null,
        status: emp.status ?? e.status ?? null,
        country: emp.country?.name ?? e.country?.name ?? null,
        managerId: emp.manager_employment_id ?? null,
        managerName: emp.manager ?? null,
      } satisfies Person;
    } catch (err) {
      failures.push({ id: e.id, reason: (err as Error).message });
      // Keep the person. We know their name from the list call even when the
      // detail call failed; dropping them would make the chart quietly wrong.
      return {
        id: e.id, name: e.full_name ?? '(unnamed)', jobTitle: e.job_title ?? null,
        department: e.department ?? null, status: e.status ?? null,
        country: e.country?.name ?? null,
        managerId: null, managerName: null,
      } satisfies Person;
    }
  });

  return { people: results, failures };
}
