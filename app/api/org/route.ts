import { NextResponse } from 'next/server';
import { getOrg } from '@/lib/org';

/**
 * JSON view of the same snapshot the page renders.
 *
 * Exists so the data layer can be inspected without the UI, and so a reviewer can
 * read the diagnostics directly. `?force=1` bypasses the cache.
 */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('force') === '1';
  try {
    const snap = await getOrg(force);
    return NextResponse.json({
      meta: snap.meta,
      diagnostics: snap.forest.diagnostics,
      people: snap.people,
      error: snap.error ?? null,
    });
  } catch (err) {
    // Only reachable on a cold cache plus a failed fetch.
    return NextResponse.json(
      { error: (err as Error).message, hint: 'Is REMOTE_API_TOKEN set and valid?' },
      { status: 502 },
    );
  }
}
