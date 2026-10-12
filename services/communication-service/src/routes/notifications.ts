import { NextResponse } from 'next/server';
import { pool } from '../db';
import {
  requireAuth,
  requireInternalKey,
  parseJsonBody,
  parseQuery,
  jsonError,
  internalError,
  NotificationRow,
} from '../handlers';
import { notificationCreateSchema, notificationListQuery } from '../schemas';

// ---------------------------------------------------------------------------
// Notifications — POST (internal-only, shared API key) / GET (own) / PATCH read
// ---------------------------------------------------------------------------

function serializeNotification(row: NotificationRow) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    payload: row.payload,
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// POST /api/notifications — INTERNAL ONLY. Protected by the shared
// service-to-service API key header (x-internal-api-key), explicitly NOT a
// user JWT. Other services (transaction/ai) call this to create notifications.
export async function createNotification(request: Request) {
  try {
    const guard = requireInternalKey(request);
    if (guard) return guard;

    const parsed = await parseJsonBody(request, notificationCreateSchema);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const res = await pool.query(
      `INSERT INTO notifications (user_id, type, payload) VALUES ($1, $2, $3::jsonb)
       RETURNING id, user_id, type, payload, read_at, created_at`,
      [b.user_id, b.type, JSON.stringify(b.payload ?? {})],
    );

    const row = res.rows[0] as NotificationRow;
    // Best-effort real-time nudge to an online recipient (via the co-located
    // Socket.IO server). Notification is persisted regardless.
    try {
      const { emitToRecipientIfOnline } = await import('../realtime');
      emitToRecipientIfOnline(row.user_id, 'notification:new', serializeNotification(row));
    } catch {
      // socket server not attached in this process -> ignore
    }

    return NextResponse.json({ notification: serializeNotification(row) }, { status: 201 });
  } catch (err) {
    return internalError('createNotification', err);
  }
}

// GET /api/notifications — the caller's OWN notifications (JWT), newest first,
// with optional unread_only filter and a bounded limit.
export async function listNotifications(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const url = new URL(request.url);
    const q = parseQuery(url, notificationListQuery);
    if (!q.ok) return q.response;
    const { unread_only, limit } = q.data;

    const values: unknown[] = [auth.auth.sub];
    let where = 'user_id = $1';
    if (unread_only === 'true') where += ' AND read_at IS NULL';

    values.push(limit);
    const res = await pool.query(
      `SELECT id, user_id, type, payload, read_at, created_at
       FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $2`,
      values,
    );

    return NextResponse.json({ notifications: (res.rows as NotificationRow[]).map(serializeNotification) });
  } catch (err) {
    return internalError('listNotifications', err);
  }
}

// PATCH /api/notifications/:id/read — owner-only; stamps read_at.
export async function markNotificationRead(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const res = await pool.query(
      `UPDATE notifications SET read_at = now()
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL
       RETURNING id, user_id, type, payload, read_at, created_at`,
      [id, auth.auth.sub],
    );
    if (!res.rows[0]) {
      // Either not mine or already read — do not leak which.
      return jsonError(404, 'NOT_FOUND', 'Unread notification not found for this user');
    }
    return NextResponse.json({ notification: serializeNotification(res.rows[0] as NotificationRow) });
  } catch (err) {
    return internalError('markNotificationRead', err);
  }
}
