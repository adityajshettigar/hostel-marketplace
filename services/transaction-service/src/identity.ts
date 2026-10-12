import { env } from './env';

// ---------------------------------------------------------------------------
// Identity client — internal SYSTEM-TO-SYSTEM batch profile read.
//
// The transaction role owns only the `transaction` schema (least privilege,
// one schema per service), so buyer/seller display data (name, hostel block,
// room, email) always comes from identity-service over HTTP with the shared
// x-internal-api-key — never a cross-schema SQL join. Fail-closed: any non-200
// or unparseable response returns ok:false so the caller can refuse to render
// a half-truthful timeline.
// ---------------------------------------------------------------------------

export type UserSummary = {
  id: string;
  fullName: string;
  hostelBlock: string | null;
  roomNumber: string | null;
  hostelGroup: string | null;
  email: string | null;
  phone: string | null;
};

export async function fetchUsersByIds(
  ids: string[],
): Promise<{ ok: true; users: UserSummary[] } | { ok: false; status: number; error: string }> {
  const key = env.INTERNAL_SERVICE_API_KEY;
  if (!key) {
    return { ok: false, status: 0, error: 'INTERNAL_SERVICE_API_KEY is not configured' };
  }
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { ok: true, users: [] };

  let res: Response;
  try {
    res = await fetch(
      `${env.IDENTITY_SERVICE_URL}/api/internal/users?ids=${encodeURIComponent(unique.join(','))}`,
      {
        headers: {
          'x-internal-api-key': key,
          authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch (err) {
    return { ok: false, status: 0, error: `identity unreachable: ${String(err).slice(0, 200)}` };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `identity responded HTTP ${res.status}` };
  }
  const body = (await res.json().catch(() => ({}))) as { users?: UserSummary[] };
  if (!Array.isArray(body.users)) {
    return { ok: false, status: res.status, error: 'identity response missing users' };
  }
  return { ok: true, users: body.users };
}
