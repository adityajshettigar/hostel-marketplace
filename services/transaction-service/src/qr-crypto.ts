import crypto from 'node:crypto';
import argon2 from 'argon2';
import { env } from './env';

// ---------------------------------------------------------------------------
// PIN + QR cryptography.
//
// PIN: crypto.randomInt(1000, 10000) → 4-digit, stored ONLY as an argon2 hash.
// Plaintext exists exactly once (the webhook response field `pin`) and is
// never logged, never stored, never returned again.
//
// QR: AES-256-GCM over {transactionId, expiresAt}; key = base64 32-byte
// QR_ENCRYPTION_KEY. Auth tag is appended to the ciphertext (GCM).
// ---------------------------------------------------------------------------

const QR_TTL_MS = 48 * 60 * 60 * 1000; // handover window = release window

// Returns ONLY the hash — caller stores it; plaintext `pin` goes to the
// buyer-facing webhook response exactly once.
export async function generatePin(): Promise<{ pin: string; pinHash: string }> {
  const pin = String(crypto.randomInt(1000, 10000)); // 4 digits, never '00xx'
  const pinHash = await argon2.hash(pin, { type: argon2.argon2id });
  return { pin, pinHash };
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  try {
    return await argon2.verify(pinHash, pin);
  } catch {
    return false;
  }
}

function qrKey(): Buffer {
  const raw = env.QR_ENCRYPTION_KEY;
  if (!raw) throw new Error('QR_ENCRYPTION_KEY is not set');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('QR_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)');
  }
  return buf;
}

export function encryptQrPayload(txnId: string, expiresAt: Date): { ciphertext: string; nonce: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', qrKey(), iv);
  const plaintext = Buffer.concat([
    Buffer.from(JSON.stringify({ transactionId: txnId, expiresAt: expiresAt.toISOString() }), 'utf8'),
  ]);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: iv.toString('base64'),
  };
}

export type QrPayload = { transactionId: string; expiresAt: string };

export function decryptQrPayload(ciphertextB64: string, nonceB64: string): QrPayload | null {
  try {
    const data = Buffer.from(ciphertextB64, 'base64');
    if (data.length < 17) return null; // 16-byte tag minimum + payload
    const enc = data.subarray(0, data.length - 16);
    const tag = data.subarray(data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', qrKey(), Buffer.from(nonceB64, 'base64'));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain) as QrPayload;
    if (typeof parsed.transactionId !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    return parsed;
  } catch {
    return null; // tampered / wrong key / malformed → never throws to caller
  }
}

export function qrIsValidForTransaction(payload: QrPayload, txnId: string): boolean {
  if (payload.transactionId !== txnId) return false;
  const exp = new Date(payload.expiresAt);
  return !Number.isNaN(exp.getTime()) && exp.getTime() > Date.now();
}

export function newQrExpiry(): Date {
  return new Date(Date.now() + QR_TTL_MS);
}

// ---------------------------------------------------------------------------
// H1 closeout — PIN at-rest encryption.
//
// The buyer must be able to retrieve their PIN on demand (the plaintext
// previously existed ONLY in the Razorpay webhook response, which goes to
// Razorpay's servers, never to the buyer). The PIN is therefore stored
// AES-256-GCM-encrypted alongside its argon2 hash; the hash remains the
// verification authority, the ciphertext is only ever decrypted by the
// buyer-only handover-credential route while handover is pending.
// Same 32-byte base64 key as the QR payload (QR_ENCRYPTION_KEY).
// ---------------------------------------------------------------------------

export function encryptSecret(plaintext: string): { ciphertext: string; nonce: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', qrKey(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: iv.toString('base64'),
  };
}

export function decryptSecret(ciphertextB64: string, nonceB64: string): string | null {
  try {
    const data = Buffer.from(ciphertextB64, 'base64');
    if (data.length < 17) return null; // 16-byte tag minimum + payload
    const enc = data.subarray(0, data.length - 16);
    const tag = data.subarray(data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', qrKey(), Buffer.from(nonceB64, 'base64'));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    if (plain.length === 0) return null;
    return plain;
  } catch {
    return null; // tampered / wrong key / malformed → never throws to caller
  }
}
