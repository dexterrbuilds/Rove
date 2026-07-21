import {NextResponse} from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  try {
    // One monitor can call this frontend route to exercise the Next.js service,
    // the Express API, and a read-only Supabase query in a single request.
    const response = await fetch(`${apiUrl}/health?deep=1`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    const api = await response.json();
    return NextResponse.json(
      {ok: response.ok, service: 'rove-web', api},
      {status: response.ok ? 200 : 503, headers: {'Cache-Control': 'no-store'}},
    );
  } catch {
    return NextResponse.json(
      {ok: false, service: 'rove-web', api: 'unreachable'},
      {status: 503, headers: {'Cache-Control': 'no-store'}},
    );
  }
}
