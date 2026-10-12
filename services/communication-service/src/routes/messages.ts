import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '../db';
import {
  requireAuth,
  parseJsonBody,
  parseQuery,
  getConversationRow,
  jsonError,
  internalError,
  MessageRow,
} from '../handlers';
import { messagePostSchema } from '../schemas';
import { normalizeAndScan, SafetyVerdict } from '../chat-safety';
import { emitToRecipientIfOnline } from '../realtime';

// ---------------------------------------------------------------------------
// Messages — POST (persist + safety gate + real-time emit) / GET (history)
// ---------------------------------------------------------------------------

function serializeMessage(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    safetyResult: row.safety_result,
    delivered: row.delivered,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// POST /api/messages — body { conversation_id, body }.
// Authorization: ONLY the conversation's buyer or seller (JWT sub) may post.
// Safety (SRS 5.7.2): verdict != SAFE messages are stored with safety_result
// but NEVER emitted to the recipient; the API still answers 200 with a
// warning payload the frontend turns into a toast.
export async function postMessage(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, messagePostSchema);
    if (!parsed.ok) return parsed.response;
    const { conversation_id, body } = parsed.data;

    const conversation = await getConversationRow(conversation_id);
    if (!conversation) {
      return jsonError(404, 'CONVERSATION_NOT_FOUND', 'Conversation does not exist');
    }

    // Participant check — the integration-test-critical authorization.
    if (conversation.buyer_id !== auth.auth.sub && conversation.seller_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'Only the conversation participants can post');
    }

    // Chat Obfuscation Defense (pure function, unit-tested).
    const scan = normalizeAndScan(body);

    const inserted = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, body, safety_result, delivered)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, conversation_id, sender_id, body, safety_result, delivered, created_at`,
      [conversation_id, auth.auth.sub, body, scan.verdict, false],
    );
    const row = inserted.rows[0] as MessageRow;

    if (scan.verdict !== 'SAFE') {
      // Stored, not delivered. 200 + warning (frontend toast per SRS).
      return NextResponse.json(
        {
          message: serializeMessage(row),
          delivered: false,
          warning: {
            code: scan.verdict,
            text:
              scan.verdict === 'CONTACT_INFO'
                ? 'Message blocked: phone numbers are not allowed in chat.'
                : scan.verdict === 'UPI_INFO'
                  ? 'Message blocked: UPI/payment ids are not allowed in chat.'
                  : 'Message blocked: off-platform payment requests are not allowed in chat.',
          },
        },
        { status: 200 },
      );
    }

    // SAFE -> deliver to the recipient over Socket.IO if they are online.
    const recipientId =
      conversation.seller_id === auth.auth.sub ? conversation.buyer_id : conversation.seller_id;
    const payload = { ...serializeMessage(row), conversationId: conversation_id };
    const delivered = emitToRecipientIfOnline(recipientId, 'message:new', payload);

    if (delivered) {
      await pool.query(`UPDATE messages SET delivered = TRUE WHERE id = $1`, [row.id]);
      row.delivered = true;
    }

    return NextResponse.json({ message: payload, delivered }, { status: 201 });
  } catch (err) {
    return internalError('postMessage', err);
  }
}

// Phase 9 (item 3): query params are Zod-parsed before the DB is touched.
const messageListQuerySchema = z.object({
  conversation_id: z.string().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

// GET /api/messages?conversation_id=...&limit=... — history, participants only.
export async function listMessages(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const url = new URL(request.url);
    const parsedQuery = parseQuery(url, messageListQuerySchema);
    if (!parsedQuery.ok) return parsedQuery.response;
    const { conversation_id: conversationId, limit } = parsedQuery.data;

    const conversation = await getConversationRow(conversationId);
    if (!conversation) {
      return jsonError(404, 'CONVERSATION_NOT_FOUND', 'Conversation does not exist');
    }
    if (conversation.buyer_id !== auth.auth.sub && conversation.seller_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'Only the conversation participants can read messages');
    }

    const res = await pool.query(
      `SELECT id, conversation_id, sender_id, body, safety_result, delivered, created_at
       FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [conversationId, limit],
    );
    return NextResponse.json({ messages: (res.rows as MessageRow[]).map(serializeMessage) });
  } catch (err) {
    return internalError('listMessages', err);
  }
}
