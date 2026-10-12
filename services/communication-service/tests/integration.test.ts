import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { Client } from 'pg';
import { setup, teardown, TestHarness, STUB_SELLER_ID, LISTING_404, LISTING_500 } from './setup';

// ---------------------------------------------------------------------------
// Integration tests for communication-service (Phase 4).
// Run by scripts/test-integration.sh, which starts the dev server on
// TEST_BASE_URL plus stub identity + stub marketplace, against the REAL
// compose Postgres (communication_test schema).
// ---------------------------------------------------------------------------

let h: TestHarness;

const BUYER_ID = '11111111-1111-4111-8111-111111111111';
const SELLER_ID = STUB_SELLER_ID; // seller the stub marketplace returns
const OUTSIDER_ID = '22222222-2222-4222-8222-222222222222';

let conversationId = '';

beforeAll(async () => {
  h = await setup();
}, 60000);

afterAll(async () => {
  await teardown();
});

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function api(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const res = await fetch(`${h.baseUrl}${path}`, {
    method,
    headers: {
      'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key',
      ...(token ? auth(token) : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

// Open a socket as a user and wait for connection (handshake-authenticated).
function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = io(h.baseUrl, { path: '/socket.io', auth: { token }, reconnection: false, timeout: 5000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err: Error) => reject(err));
  });
}

function waitFor(s: ClientSocket, event: string, ms = 4000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (payload: Record<string, unknown>) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

describe('health', () => {
  it('GET /api/health reports ok + db up', async () => {
    const { status, json } = await api('GET', '/api/health', null);
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.db).toBe('up');
  });
});

describe('POST /api/conversations', () => {
  it('requires a JWT', async () => {
    const { status } = await api('POST', '/api/conversations', null, { listing_id: '00000000-0000-4000-8000-000000000000' });
    expect(status).toBe(401);
  });

  it('rejects a client-supplied seller_id (strict body: unknown key)', async () => {
    const token = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const { status, json } = await api('POST', '/api/conversations', token, {
      listing_id: '00000000-0000-4000-8000-000000000000',
      seller_id: OUTSIDER_ID,
    });
    expect(status).toBe(400);
    expect(JSON.stringify(json)).toContain('seller_id');
  });

  it('404 for a listing that does not exist (via marketplace stub)', async () => {
    const token = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const { status } = await api('POST', '/api/conversations', token, { listing_id: LISTING_404 });
    expect(status).toBe(404);
  });

  it('502 fail-closed when marketplace errors', async () => {
    const token = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const { status } = await api('POST', '/api/conversations', token, { listing_id: LISTING_500 });
    expect(status).toBe(502);
  });

  it('creates a conversation with seller_id fetched FROM MARKETPLACE, idempotent on retry', async () => {
    const token = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const listingId = '00000000-0000-4000-8000-000000000000';

    const first = await api('POST', '/api/conversations', token, { listing_id: listingId });
    expect(first.status).toBe(201);
    expect(first.json.existing).toBe(false);
    const conv = first.json.conversation as Record<string, unknown>;
    // The critical assertion: seller came from marketplace-service, NOT client.
    expect(conv.sellerId).toBe(SELLER_ID);
    expect(conv.buyerId).toBe(BUYER_ID);
    conversationId = conv.id as string;

    const again = await api('POST', '/api/conversations', token, { listing_id: listingId });
    expect(again.status).toBe(200);
    expect(again.json.existing).toBe(true);
  });
});

describe('POST /api/messages — participant authorization', () => {
  it('forbids a non-participant from posting (only buyer/seller allowed)', async () => {
    const outsider = h.signToken({ sub: OUTSIDER_ID, email: 'o@t.test', fullName: 'Outsider' });
    const { status, json } = await api('POST', '/api/messages', outsider, {
      conversation_id: conversationId,
      body: 'i should not be here',
    });
    expect(status).toBe(403);
    expect(json.error).toBe('FORBIDDEN');
  });

  it('forbids a non-participant from reading history', async () => {
    const outsider = h.signToken({ sub: OUTSIDER_ID, email: 'o@t.test', fullName: 'Outsider' });
    const { status } = await api('GET', `/api/messages?conversation_id=${conversationId}`, outsider);
    expect(status).toBe(403);
  });

  it('404 for unknown conversation', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const { status } = await api('POST', '/api/messages', buyer, {
      conversation_id: '00000000-0000-4000-8000-00000000aaaa',
      body: 'hello?',
    });
    expect(status).toBe(404);
  });

  it('400 for invalid body (validation)', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const { status } = await api('POST', '/api/messages', buyer, {
      conversation_id: conversationId,
      body: '',
    });
    expect(status).toBe(400);
  });
});

describe('chat safety gate (SRS 5.7.2) over HTTP', () => {
  it('delivers a SAFE message and marks it delivered', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const { status, json } = await api('POST', '/api/messages', buyer, {
      conversation_id: conversationId,
      body: 'is the book still available?',
    });
    expect(status).toBe(201);
    expect(json.delivered).toBe(false); // seller socket not connected yet
    expect((json.message as Record<string, unknown>).safetyResult).toBe('SAFE');
  });

  it('stores CONTACT_INFO/UPI_INFO messages but NEVER delivers them (200 + warning)', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const cases = [
      { body: 'call me at 9876543210', code: 'CONTACT_INFO' },
      { body: 'send it to adisharma@ybl', code: 'UPI_INFO' },
      { body: 'lets finish this over paytm', code: 'OFF_PLATFORM_REQUEST' },
    ];
    for (const c of cases) {
      const { status, json } = await api('POST', '/api/messages', buyer, {
        conversation_id: conversationId,
        body: c.body,
      });
      expect(status).toBe(200);
      expect(json.delivered).toBe(false);
      const warning = json.warning as Record<string, unknown>;
      expect(warning.code).toBe(c.code);
      const msg = json.message as Record<string, unknown>;
      expect(msg.safetyResult).toBe(c.code);
    }
  });
});

describe('Socket.IO real-time delivery', () => {
  it('emits message:new to the ONLINE recipient only', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const seller = h.signToken({ sub: SELLER_ID, email: 's@t.test', fullName: 'Seller' });

    const sellerSock = await connect(seller);
    try {
      const incoming = waitFor(sellerSock, 'message:new');

      const { status, json } = await api('POST', '/api/messages', buyer, {
        conversation_id: conversationId,
        body: 'great, see you at the gate at 5pm',
      });
      expect(status).toBe(201);
      expect(json.delivered).toBe(true);

      const payload = await incoming;
      expect(payload.body).toBe('great, see you at the gate at 5pm');
      expect(payload.conversationId).toBe(conversationId);

      // A blocked message must NOT arrive while the seller is online.
      const before = Date.now();
      await api('POST', '/api/messages', buyer, {
        conversation_id: conversationId,
        body: 'whatsapp me instead',
      });
      await new Promise((r) => setTimeout(r, 700));
      expect(Date.now() - before).toBeGreaterThanOrEqual(650); // no emit happened
    } finally {
      sellerSock.disconnect();
    }
  });

  it('rejects unauthenticated socket handshakes', async () => {
    await expect(connect('garbage-token')).rejects.toThrow(/UNAUTHORIZED|invalid/i);
  });
});

describe('notifications', () => {
  it('rejects POST without the internal API key (no JWT route)', async () => {
    const { status } = await api('POST', '/api/notifications', null, {
      user_id: BUYER_ID,
      type: 'OFFER_ACCEPTED',
      payload: { offerId: 'x' },
    });
    expect(status).toBe(401);
  });

  it('rejects POST with a WRONG internal key', async () => {
    const { status } = await api('POST', '/api/notifications', null, {
      user_id: BUYER_ID,
      type: 'OFFER_ACCEPTED',
    }, { 'x-internal-api-key': 'nope' });
    expect(status).toBe(401);
  });

  it('accepts POST with the shared internal key and creates the notification', async () => {
    const { status, json } = await api('POST', '/api/notifications', null, {
      user_id: BUYER_ID,
      type: 'OFFER_ACCEPTED',
      payload: { offerId: 'offer-1', amount: 250 },
    }, { 'x-internal-api-key': h.internalKey });
    expect(status).toBe(201);
    const n = json.notification as Record<string, unknown>;
    expect(n.type).toBe('OFFER_ACCEPTED');
    expect(n.readAt).toBeNull();
  });

  it('GET returns only MY notifications and PATCH read marks them read (owner-only)', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const outsider = h.signToken({ sub: OUTSIDER_ID, email: 'o@t.test', fullName: 'Outsider' });

    const list = await api('GET', '/api/notifications', buyer);
    expect(list.status).toBe(200);
    const notifications = list.json.notifications as Record<string, unknown>[];
    expect(notifications.length).toBeGreaterThan(0);
    for (const n of notifications) expect(n.userId).toBe(BUYER_ID);

    const target = notifications[0];
    const { status } = await api('PATCH', `/api/notifications/${target.id}/read`, buyer);
    expect(status).toBe(200);

    // Another user cannot mark someone else's notification read.
    const { status: s2 } = await api('PATCH', `/api/notifications/${target.id}/read`, outsider);
    expect(s2).toBe(404);

    // Marking again -> already read -> 404 (no state leak).
    const { status: s3 } = await api('PATCH', `/api/notifications/${target.id}/read`, buyer);
    expect(s3).toBe(404);
  });

  it('filtered list: unread_only=true excludes read notifications', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const list = await api('GET', '/api/notifications?unread_only=true', buyer);
    expect(list.status).toBe(200);
    const notifications = list.json.notifications as Record<string, unknown>[];
    for (const n of notifications) expect(n.readAt).toBeNull();
  });
});

// Direct DB probe (communication_app) verifying the safety_result column
// persisted blocked messages with delivered=FALSE.
describe('persistence guarantees', () => {
  it('blocked messages are stored with safety_result and delivered=false', async () => {
    const client = new Client({ connectionString: h.appDbUrl });
    await client.connect();
    try {
      await client.query(`SET search_path = ${'communication_test'}`);
      const res = await client.query(
        `SELECT safety_result, delivered FROM messages WHERE conversation_id = $1`,
        [conversationId],
      );
      const blocked = res.rows.filter((r) => r.safety_result !== 'SAFE');
      expect(blocked.length).toBeGreaterThanOrEqual(3);
      for (const r of blocked) expect(r.delivered).toBe(false);
    } finally {
      await client.end();
    }
  });
});
