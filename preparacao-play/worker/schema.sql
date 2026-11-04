-- Cloudflare D1 de PRODUÇÃO, separado do D1 de testes.
-- IDs de usuário são UIDs do Firebase Auth, nunca WhatsApp ou e-mail.
CREATE TABLE IF NOT EXISTS subscription_entitlements (
  token_hash TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  play_state TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_subscription_uid ON subscription_entitlements(uid);

CREATE TABLE IF NOT EXISTS manual_grants (
  uid TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_uid TEXT NOT NULL,
  target_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  days INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rtdn_events (
  message_id TEXT PRIMARY KEY NOT NULL,
  processed_at INTEGER NOT NULL
);

