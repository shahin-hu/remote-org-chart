import { getOrg, type OrgSnapshot } from '@/lib/org';
import OrgChart from './components/OrgChart';

/**
 * Revalidate on a timer rather than fetching per request.
 *
 * The full fetch takes tens of seconds against the sandbox (201 employments, one
 * list call plus 201 detail calls). That does not fit inside a page request, so
 * Next renders this page ahead of time and refreshes it in the background.
 * Nobody waits for the N+1.
 */
export const revalidate = 300;

export default async function Page() {
  // Deliberately NOT wrapping the JSX in the try block. React renders components
  // lazily, so an error thrown during render would escape a try/catch here and
  // the catch would give a false sense of safety. Fetch inside the try, decide
  // what to render outside it.
  let snap: OrgSnapshot | null = null;
  let loadError: string | null = null;

  try {
    snap = await getOrg();
  } catch (err) {
    loadError = (err as Error).message;
  }

  if (!snap) {
    // Cold cache and the API is unreachable. Say what is wrong and what to check,
    // rather than showing an empty chart that looks like a company with no staff.
    return (
      <main className="mx-auto max-w-2xl p-10">
        <h1 className="text-xl font-semibold">Could not load the org chart</h1>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{loadError}</p>
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          Check that <code className="font-mono">REMOTE_API_TOKEN</code> is set and
          still valid. Sandbox tokens expire after 14 days.
        </p>
      </main>
    );
  }

  return (
    <OrgChart people={snap.people} meta={snap.meta} refreshError={snap.error ?? null} />
  );
}
