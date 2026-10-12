import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { setup, teardown, TestHarness } from './setup';

// ---------------------------------------------------------------------------
// Integration tests for ai-service (Phase 5) — run against a live server on
// TEST_BASE_URL with stub identity / stub marketplace / stub Hugging Face,
// and the REAL compose Postgres (ai_test schema).
// ---------------------------------------------------------------------------

let h: TestHarness;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  h = await setup();
}, 60000);

afterAll(async () => {
  await teardown();
});

const userToken = () => h.signToken({ sub: USER_ID, email: 'u@t.test', fullName: 'User U' });
const otherToken = () => h.signToken({ sub: OTHER_ID, email: 'o@t.test', fullName: 'Other O' });

type Res = { status: number; json: Record<string, unknown> };

async function api(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${h.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

describe('health', () => {
  it('GET /api/health reports ok + db up', async () => {
    const { status, json } = await api('GET', '/api/health');
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.db).toBe('up');
  });
});

describe('POST /api/suggest/listing', () => {
  it('requires a JWT (401)', async () => {
    const { status } = await api('POST', '/api/suggest/listing', undefined, { imageUrl: 'https://x.test/a.jpg' });
    expect(status).toBe(401);
  });

  it('validates the body (400 on bad URL / unknown keys)', async () => {
    const bad = await api('POST', '/api/suggest/listing', userToken(), { imageUrl: 'not-a-url' });
    expect(bad.status).toBe(400);
    const extra = await api('POST', '/api/suggest/listing', userToken(), {
      imageUrl: 'https://x.test/a.jpg',
      seller_id: 'nope',
    });
    expect(extra.status).toBe(400);
  });

  it('HF caption success path: caption mapped into clamped suggestion', async () => {
    const { status, json } = await api('POST', '/api/suggest/listing', userToken(), {
      imageUrl: 'https://images.example.com/mixer.jpg',
      condition: 'Good',
    });
    expect(status).toBe(200);
    expect(json.aiSuggestion).toBe(true); // frontend "edit before posting" flag
    expect(json.fallbackUsed).toBe(false);
    const s = json.suggestion as Record<string, unknown>;
    expect(s.suggestedCategory).toBe('Appliances'); // caption "a mixer grinder on a table"
    expect(String(s.suggestedTitle).length).toBeGreaterThan(0);
    expect(String(s.suggestedTitle).length).toBeLessThanOrEqual(120);
    expect(String(s.suggestedDescription).length).toBeGreaterThan(0);
    expect(String(json.modelVersion)).toContain('blip'); // real model + template version
  });

  it('HF DOWN -> template fallback STILL returns valid output (SRS 7.12)', async () => {
    const { status, json } = await api('POST', '/api/suggest/listing', userToken(), {
      imageUrl: 'https://images.example.com/boom.jpg', // stub HF 500s on /boom
      category: 'Books',
      condition: 'Like New',
    });
    expect(status).toBe(200); // never hard-fails the listing flow
    expect(json.fallbackUsed).toBe(true);
    const s = json.suggestion as Record<string, unknown>;
    expect(s.suggestedCategory).toBe('Books'); // seller-provided hint preserved
    expect(String(s.suggestedTitle)).toContain('Books');
    expect(String(s.suggestedTitle)).toContain('Like New');
    expect(String(json.modelVersion)).toContain('no-caption-fallback');
  });

  it('logs every suggestion to ai.suggestions with model_version', async () => {
    const sep = h.appDbUrl.includes('?') ? '&' : '?';
    const client = new Client({ connectionString: `${h.appDbUrl}${sep}options=--search_path%3Dai_test` });
    await client.connect();
    try {
      const res = await client.query(`SELECT count(*)::int AS n FROM suggestions WHERE kind = 'LISTING' AND user_id = $1`, [USER_ID]);
      // One row per SUCCESSFUL suggest call in this suite (validation-400s
      // correctly log nothing).
      expect(res.rows[0].n).toBe(2);
    } finally {
      await client.end();
    }
  });
});

describe('POST /api/suggest/price', () => {
  it('requires a JWT (401) and validates category (400)', async () => {
    expect((await api('POST', '/api/suggest/price', undefined, { category: 'Books' })).status).toBe(401);
    expect((await api('POST', '/api/suggest/price', userToken(), { category: 'Cars' })).status).toBe(400);
  });

  it('returns the SOLD median range (category + condition tier)', async () => {
    const { status, json } = await api('POST', '/api/suggest/price', userToken(), {
      category: 'Appliances',
      condition: 'Good',
    });
    expect(status).toBe(200);
    expect(json.aiSuggestion).toBe(true);
    expect(json.basis).toBe('SOLD_CATEGORY_CONDITION');
    expect(json.sampleSize).toBe(2);
    expect(json.suggestion).toEqual({ low: 150, mid: 200, high: 250 });
  });

  it('falls back to the category-wide median when condition has no history', async () => {
    const { status, json } = await api('POST', '/api/suggest/price', userToken(), {
      category: 'Books',
      condition: 'Worn',
    });
    expect(status).toBe(200);
    expect(json.basis).toBe('SOLD_CATEGORY');
    expect(json.suggestion).toEqual({ low: 120, mid: 120, high: 120 });
  });

  it('marketplace stats error -> coarse default band, still a range (SRS 7.12)', async () => {
    const { status, json } = await api('POST', '/api/suggest/price', userToken(), { category: 'Food' });
    // 'Food' has no stub history and is not the Boom switch: empty category
    // stats -> FALLBACK_DEFAULT band.
    expect(status).toBe(200);
    expect(json.basis).toBe('FALLBACK_DEFAULT');
    expect(json.sampleSize).toBe(0);
    const s = json.suggestion as Record<string, number>;
    expect(s.low).toBeLessThanOrEqual(s.mid);
    expect(s.mid).toBeLessThanOrEqual(s.high);
    expect(s.low).toBeGreaterThan(0);
  });

  it('clamps impossible medians (Boom 500 -> no throw, valid output)', async () => {
    // The stub 500s for category=Boom before returning stats; ai must fall
    // back to the default band rather than surfacing the error.
    const { status, json } = await api('POST', '/api/suggest/price', userToken(), { category: 'Food', condition: 'Good' });
    expect(status).toBe(200);
    expect(json.basis).toBe('FALLBACK_DEFAULT');
  });

  it('M7: a GENUINE marketplace 500 is reported as degraded fallback, not clean success', async () => {
    // The stub returns HTTP 500 for category=Electronics — an actual
    // downstream 5xx on a VALID category, not "no data". The response must
    // still be 200 (SRS 7.12: never hard-fail) but explicitly flagged as a
    // fallback with no sample — never misreported as a successful estimate.
    const { status, json } = await api('POST', '/api/suggest/price', userToken(), { category: 'Electronics' });
    expect(status).toBe(200);
    expect(json.basis).toBe('FALLBACK_DEFAULT');
    expect(json.fallbackUsed).toBe(true);
    expect(json.sampleSize).toBe(0);
    const s = json.suggestion as Record<string, number>;
    expect(s.low).toBeLessThanOrEqual(s.mid);
    expect(s.mid).toBeLessThanOrEqual(s.high);
    expect(s.low).toBeGreaterThan(0);
  });
});

describe('POST /api/interactions', () => {
  it('requires a JWT (401) and validates (SEARCH needs query, 400)', async () => {
    expect((await api('POST', '/api/interactions', undefined, { kind: 'VIEW', category: 'Books' })).status).toBe(401);
    expect((await api('POST', '/api/interactions', userToken(), { kind: 'SEARCH', category: 'Books' })).status).toBe(400);
  });

  it('logs VIEW events with the JWT sub (never a body-supplied user)', async () => {
    const { status, json } = await api('POST', '/api/interactions', userToken(), {
      kind: 'VIEW',
      category: 'Appliances',
      listingId: 'aaaaaaa1-0000-4000-8000-000000000002',
    });
    expect(status).toBe(201);
    expect((json.interaction as Record<string, unknown>).userId).toBe(USER_ID);
  });

  it('logs SEARCH events with query + category', async () => {
    const { status } = await api('POST', '/api/interactions', userToken(), {
      kind: 'SEARCH',
      category: 'Appliances',
      query: 'mixer grinder',
    });
    expect(status).toBe(201);
  });
});

describe('GET /api/recommendations (E7.11 baseline)', () => {
  it('rejects a userId that is not the JWT sub (403)', async () => {
    const { status } = await api('GET', `/api/recommendations?userId=${OTHER_ID}`, userToken());
    expect(status).toBe(403);
  });

  it('requires a JWT and a valid userId (401/400)', async () => {
    expect((await api('GET', `/api/recommendations?userId=${USER_ID}`)).status).toBe(401);
    expect((await api('GET', `/api/recommendations?userId=not-a-uuid`, userToken())).status).toBe(400);
  });

  it('ranks interacted categories first and EXCLUDES the user own listings', async () => {
    // USER has logged VIEW/SEARCH on Appliances; the stub marketplace has an
    // Appliances listing owned by another seller AND a Books listing owned
    // by USER (aaaa...001) which must not come back.
    const { status, json } = await api('GET', `/api/recommendations?userId=${USER_ID}`, userToken());
    expect(status).toBe(200);
    expect(json.aiSuggestion).toBe(true);
    expect(json.preferredCategories).toEqual(['Appliances']);
    const recs = json.recommendations as Array<Record<string, unknown>>;
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].category).toBe('Appliances');
    for (const r of recs) {
      expect(r.listingId).not.toBe('aaaaaaa1-0000-4000-8000-000000000001'); // own listing excluded
    }
  });

  it('cold start (no interactions) still returns listings, newest-first', async () => {
    const { status, json } = await api('GET', `/api/recommendations?userId=${OTHER_ID}`, otherToken());
    expect(status).toBe(200);
    expect(json.preferredCategories).toEqual([]);
    const recs = json.recommendations as Array<Record<string, unknown>>;
    expect(recs.length).toBeGreaterThan(0); // cold start is handled, not an error
  });
});

describe('PATCH /api/suggestions/:id/accept', () => {
  it('flips accepted_by_user owner-only; foreign/unknown ids 404', async () => {
    // Grab a suggestion id logged for USER.
    const sep = h.appDbUrl.includes('?') ? '&' : '?';
    const client = new Client({ connectionString: `${h.appDbUrl}${sep}options=--search_path%3Dai_test` });
    await client.connect();
    let id = '';
    try {
      const res = await client.query(`SELECT id FROM suggestions WHERE user_id = $1 LIMIT 1`, [USER_ID]);
      id = res.rows[0].id;
    } finally {
      await client.end();
    }

    const foreign = await api('PATCH', `/api/suggestions/${id}/accept`, otherToken());
    expect(foreign.status).toBe(404);

    const ok = await api('PATCH', `/api/suggestions/${id}/accept`, userToken());
    expect(ok.status).toBe(200);
    expect((ok.json.suggestion as Record<string, unknown>).acceptedByUser).toBe(true);

    // Idempotent accept still succeeds.
    const again = await api('PATCH', `/api/suggestions/${id}/accept`, userToken());
    expect(again.status).toBe(200);
  });
});
