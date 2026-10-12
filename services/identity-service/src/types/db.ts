// Shared types for identity-service.
//
// The DB bootstrap already created the identity schema and a least-privilege
// identity_app role owned by it, so this module talks ONLY to the identity
// schema. Future phases add their own tables there (users, sessions, clients).

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export type VerificationStatus = 'PENDING' | 'VERIFIED';

// Authorization role (admin-side: flipped from the admin console userbase page).
export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  passwordHash: string; // argon2, persisted only in this table
  fullName: string;
  hostelBlock: string;
  hostelGroup: 'MH' | 'LH';
  roomNumber: string;
  upiVpa: string | null; // optional at registration, filled later
  role: UserRole;
  verificationStatus: VerificationStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Row shape returned by the DB (column names -> TS).
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  hostel_block: string;
  hostel_group: 'MH' | 'LH';
  room_number: string;
  upi_vpa: string | null;
  role: UserRole;
  verification_status: string;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export type SessionStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'REFRESHED';

export interface Session {
  id: string; // UUID, primary key
  userId: string;
  deviceFingerprint: string; // client-supplied fingerprint hash
  ipAddress: string | null; // client IP recorded at login
  accessToken: string; // short-lived JWT (15 min), stored for revocation checks
  accessTokenExpiresAt: Date;
  refreshTokenHash: string; // hash of the rotating refresh token (cookie)
  refreshTokenExpiresAt: Date;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  device_fingerprint: string;
  ip_address: string | null;
  access_token: string;
  access_token_expires_at: Date;
  refresh_token_hash: string;
  refresh_token_expires_at: Date;
  status: string;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// clients (device fingerprint -> fingerprint hash binding)
// ---------------------------------------------------------------------------

export interface Client {
  id: string; // UUID, owned by the service
  fingerprintHash: string; // sha256 of the client-supplied fingerprint header
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientRow {
  id: string;
  fingerprint_hash: string;
  created_at: Date;
  updated_at: Date;
}
