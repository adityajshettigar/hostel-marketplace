import { describe, it, expect, beforeAll } from 'vitest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { setup, TestHarness, STUB_SELLER_ID } from './setup';

// ---------------------------------------------------------------------------
// M3 (audit Step 3a): the co-located Socket.IO server must handle a SECOND
// concurrent connection for the SAME user (two browser tabs) without dropping
// the first socket and without duplicate room registration (a leaked double
// join would deliver every message twice per tab).
// ---------------------------------------------------------------------------

let h: TestHarness;

const BUYER_ID = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  h = await setup();
}, 60000);

function connect(token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = io(h.baseUrl, { path: '/socket.io', auth: { token }, reconnection: false, timeout: 5000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err: Error) => reject(err));
  });
}

function collect(s: ClientSocket, event: string, ms: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const seen: unknown[] = [];
    const handler = (p: unknown) => seen.push(p);
    s.on(event, handler);
    setTimeout(() => {
      s.off(event, handler);
      resolve(seen);
    }, ms);
  });
}

describe('M3: two concurrent tabs for the same user', () => {
  it('delivers exactly one copy per socket (no drop, no duplicate join)', async () => {
    const buyer = h.signToken({ sub: BUYER_ID, email: 'b@t.test', fullName: 'Buyer' });
    const seller = h.signToken({ sub: STUB_SELLER_ID, email: 's@t.test', fullName: 'Seller' });

    // Two "tabs" online at the same time for the same user_id.
    const [tab1, tab2] = await Promise.all([connect(buyer), connect(buyer)]);
    expect(tab1.id).not.toBe(tab2.id); // genuinely two connections

    // Create a conversation (buyer side) so the seller can post into it.
    const convRes = await fetch(`${h.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${buyer}`, 'content-type': 'application/json', 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', },
      body: JSON.stringify({ listing_id: '00000000-0000-4000-8000-000000000000' }),
    });
    expect(convRes.status).toBe(201);
    const conversationId = ((await convRes.json()) as { conversation: { id: string } }).conversation.id;

    // Both tabs listen BEFORE the emit.
    const onTab1 = collect(tab1, 'message:new', 900);
    const onTab2 = collect(tab2, 'message:new', 900);

    const post = await fetch(`${h.baseUrl}/api/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${seller}`, 'content-type': 'application/json', 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', },
      body: JSON.stringify({ conversation_id: conversationId, body: 'hello from the seller' }),
    });
    expect(post.status).toBe(201);

    const got1 = await onTab1;
    const got2 = await onTab2;

    // No drop: both tabs got the message. No duplicate-room leak: exactly ONE
    // copy each (a double join would make this 2).
    expect(got1.length).toBe(1);
    expect(got2.length).toBe(1);
    expect((got1[0] as { body: string }).body).toBe('hello from the seller');
    expect((got2[0] as { body: string }).body).toBe('hello from the seller');

    tab1.disconnect();
    tab2.disconnect();
  });
});
