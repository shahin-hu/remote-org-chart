import { test, expect, vi, afterEach } from 'vitest';

/**
 * Tests for the network layer.
 *
 * No network is used. `fetch` is replaced with a stub, which is the only way to
 * test the cases that matter here: what happens on a 429, what happens when one
 * call out of two hundred fails, and whether the concurrency limit is actually a
 * limit. None of those are reproducible against a live API on demand.
 *
 * The module reads its token and base URL at import time, so each test sets the
 * environment and then imports fresh. `vi.resetModules()` is what makes that work.
 */

const BASE = 'https://api.test';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

/** A fetch stub that replays a queued list of responses and records the calls. */
function stubFetch(responses: Array<Response | (() => Response)>) {
  const calls: string[] = [];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const next = responses[Math.min(i++, responses.length - 1)];
    return typeof next === 'function' ? next() : next.clone();
  }));
  return calls;
}

async function loadModule() {
  vi.resetModules();
  process.env.REMOTE_API_TOKEN = 'ra_test_stub';
  process.env.REMOTE_API_BASE = BASE;
  return import('./remote-api');
}

afterEach(() => { vi.unstubAllGlobals(); });

/**
 * Route responses by URL. Clearer than replaying a queue, and it does not depend
 * on the order the pool happens to issue requests in.
 */
function routeFetch(route: (url: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    return route(String(url));
  }));
  return calls;
}

// ── which failures are retried, and which are not ────────────────────────────

test('a 401 fails immediately and is not retried', async () => {
  const calls = stubFetch([jsonResponse({}, 401)]);
  const { listEmployments } = await loadModule();
  await expect(listEmployments()).rejects.toThrow(/401/);
  expect(calls, 'a bad token is an answer, not a hiccup').toHaveLength(1);
});

test('a 404 fails immediately and is not retried', async () => {
  const calls = stubFetch([jsonResponse({}, 404)]);
  const { listEmployments } = await loadModule();
  await expect(listEmployments()).rejects.toThrow(/404/);
  expect(calls).toHaveLength(1);
});

test('a 429 is retried, then succeeds', async () => {
  let n = 0;
  const calls = stubFetch([() => {
    n++;
    return n === 1
      ? jsonResponse({}, 429)
      : jsonResponse({ data: { employments: [], total_pages: 1, current_page: 1, total_count: 0 } });
  }]);
  const { listEmployments } = await loadModule();
  await expect(listEmployments()).resolves.toEqual([]);
  expect(calls, 'slowed down and tried again').toHaveLength(2);
});

test('a 403 is retried — this sandbox load-sheds with 403 where most APIs send 429', async () => {
  let n = 0;
  const calls = stubFetch([() => {
    n++;
    return n === 1
      ? jsonResponse({}, 403)
      : jsonResponse({ data: { employments: [], total_pages: 1, current_page: 1, total_count: 0 } });
  }]);
  const { listEmployments } = await loadModule();
  await expect(listEmployments()).resolves.toEqual([]);
  expect(calls).toHaveLength(2);
});

test('a 500 is retried and eventually gives up rather than looping forever', async () => {
  const calls = stubFetch([jsonResponse({}, 500)]);
  const { listEmployments } = await loadModule();
  await expect(listEmployments()).rejects.toThrow(/500/);
  expect(calls.length, 'one attempt plus a bounded number of retries').toBeGreaterThan(1);
  expect(calls.length).toBeLessThanOrEqual(5);
}, 20_000); // real backoff between retries, so this one needs longer than the default

// ── pagination ───────────────────────────────────────────────────────────────

test('every page is fetched, not just the first', async () => {
  const page = (n: number, total: number) => jsonResponse({
    data: {
      employments: [{ id: `p${n}`, full_name: `Person ${n}` }],
      current_page: n, total_pages: total, total_count: total,
    },
  });
  const calls = stubFetch([page(1, 3), page(2, 3), page(3, 3)]);
  const { listEmployments } = await loadModule();
  const all = await listEmployments();
  expect(all, 'stopping at page 1 would silently return a third of the company').toHaveLength(3);
  expect(calls.filter((c) => c.includes('page=')).length).toBe(3);
});

test('a single page does not trigger a second request', async () => {
  const calls = stubFetch([jsonResponse({
    data: { employments: [{ id: 'a' }], current_page: 1, total_pages: 1, total_count: 1 },
  })]);
  const { listEmployments } = await loadModule();
  await listEmployments();
  expect(calls).toHaveLength(1);
});

// ── the N+1, and what happens when part of it fails ──────────────────────────

test('one failed detail call degrades that person, it does not blank the chart', async () => {
  const list = {
    data: {
      employments: [
        { id: 'a', full_name: 'Ada', job_title: 'Engineer', department: 'Eng', status: 'active' },
        { id: 'b', full_name: 'Bob', job_title: 'Designer', department: 'Design', status: 'active' },
      ],
      current_page: 1, total_pages: 1, total_count: 2,
    },
  };
  // 404 rather than 500 on purpose: it is not retryable, so the test does not
  // sit through four rounds of backoff to prove a point about degradation.
  routeFetch((url) => {
    if (url.includes('page=')) return jsonResponse(list);
    if (url.endsWith('/v1/employments/b')) return jsonResponse({}, 404);
    return jsonResponse({ data: { employment: { full_name: 'Ada', manager_employment_id: null } } });
  });
  const { fetchPeople } = await loadModule();
  const { people, failures } = await fetchPeople();

  expect(people, 'both people are still returned').toHaveLength(2);
  expect(failures, 'the failure is reported, not swallowed').toHaveLength(1);
  expect(failures[0].id).toBe('b');
  const bob = people.find((p) => p.id === 'b')!;
  expect(bob.name, 'name still comes from the list call').toBe('Bob');
  expect(bob.managerId, 'but the manager is unknown').toBeNull();
});

test('detail values win over list values, and the list is the fallback', async () => {
  routeFetch((url) => {
    if (url.includes('page=')) {
      return jsonResponse({ data: {
        employments: [{ id: 'a', full_name: 'Stale Name', job_title: 'Old Title', department: 'Old Dept' }],
        current_page: 1, total_pages: 1, total_count: 1,
      } });
    }
    return jsonResponse({ data: { employment: {
      full_name: 'Fresh Name', job_title: 'New Title',
      country: { name: 'Portugal' }, manager: 'The Boss', manager_employment_id: 'mgr-1',
    } } });
  });
  const { fetchPeople } = await loadModule();
  const { people } = await fetchPeople();
  expect(people[0].name).toBe('Fresh Name');
  expect(people[0].jobTitle).toBe('New Title');
  expect(people[0].country).toBe('Portugal');
  expect(people[0].managerId).toBe('mgr-1');
  expect(people[0].managerName).toBe('The Boss');
  expect(people[0].department, 'falls back to the list when detail omits it').toBe('Old Dept');
});

test('concurrency is actually bounded, not just configured', async () => {
  process.env.REMOTE_CONCURRENCY = '3';
  const N = 20;
  let inFlight = 0, peak = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('page=')) {
      return jsonResponse({ data: {
        employments: Array.from({ length: N }, (_, i) => ({ id: `p${i}`, full_name: `P${i}` })),
        current_page: 1, total_pages: 1, total_count: N,
      } });
    }
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return jsonResponse({ data: { employment: { manager_employment_id: null } } });
  }));
  const { fetchPeople } = await loadModule();
  const { people } = await fetchPeople();
  expect(people).toHaveLength(N);
  expect(peak, `never more than 3 detail calls at once, saw ${peak}`).toBeLessThanOrEqual(3);
  delete process.env.REMOTE_CONCURRENCY;
});

test('a missing token fails before any request is made', async () => {
  vi.resetModules();
  delete process.env.REMOTE_API_TOKEN;
  process.env.REMOTE_API_BASE = BASE;
  const calls = stubFetch([jsonResponse({})]);
  const { listEmployments } = await import('./remote-api');
  await expect(listEmployments()).rejects.toThrow(/REMOTE_API_TOKEN/);
  expect(calls, 'no point calling an API with no credentials').toHaveLength(0);
});
