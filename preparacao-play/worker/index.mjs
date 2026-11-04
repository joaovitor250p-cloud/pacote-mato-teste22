/**
 * Pacote É Mato — backend de assinaturas, versão de preparação.
 * Dependências: Cloudflare Worker + D1 + Google Play Developer API.
 * NÃO publicar antes de configurar a conta de serviço, D1, RTDN e testes na Play.
 */
import {
  DAY_MS, PRODUCT_ID, evaluateAccess,
  parsePlaySubscription, validGrantDays,
} from './access-policy.mjs';

const utf8 = new TextEncoder();
const MAX_BODY_BYTES = 8192;
const PROJECT_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const PUBSUB_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const PLAY_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
let cachedAccessToken = null;
const jwksCache = new Map();

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

function decodeBase64Url(input) {
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) throw new Error('JWT_INVALID');
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

function encodeBase64Url(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeJsonSegment(value) {
  const bytes = decodeBase64Url(value);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function sha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value)));
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
}

async function fetchJwks(url) {
  const existing = jwksCache.get(url);
  if (existing && existing.until > Date.now()) return existing.keys;
  const response = await fetch(url);
  if (!response.ok) throw new Error('KEYS_UNAVAILABLE');
  const data = await response.json();
  if (!Array.isArray(data.keys) || data.keys.length === 0) throw new Error('KEYS_INVALID');
  jwksCache.set(url, { keys: data.keys, until: Date.now() + 60 * 60 * 1000 });
  return data.keys;
}

async function verifyJwt(token, { jwksUrl, audience, issuer, email }) {
  if (typeof token !== 'string' || token.length < 100 || token.length > 8192) throw new Error('AUTH_INVALID');
  const pieces = token.split('.');
  if (pieces.length !== 3) throw new Error('AUTH_INVALID');
  const header = decodeJsonSegment(pieces[0]);
  const claims = decodeJsonSegment(pieces[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('AUTH_INVALID');
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== audience || !issuer.includes(claims.iss) ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
      (email && (claims.email !== email || claims.email_verified !== true))) {
    throw new Error('AUTH_INVALID');
  }
  const key = (await fetchJwks(jwksUrl)).find(jwk => jwk.kid === header.kid);
  if (!key) throw new Error('AUTH_INVALID');
  const imported = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, decodeBase64Url(pieces[2]),
    utf8.encode(`${pieces[0]}.${pieces[1]}`));
  if (!ok) throw new Error('AUTH_INVALID');
  return claims;
}

async function firebaseUser(request, env) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('SERVER_NOT_CONFIGURED');
  const bearer = request.headers.get('Authorization') || '';
  const token = /^Bearer (\S+)$/i.exec(bearer)?.[1] || '';
  const project = env.FIREBASE_PROJECT_ID;
  const claims = await verifyJwt(token, {
    jwksUrl: PROJECT_JWKS,
    audience: project,
    issuer: [`https://securetoken.google.com/${project}`],
  });
  if (typeof claims.sub !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(claims.sub)) {
    throw new Error('AUTH_INVALID');
  }
  return { uid: claims.sub, email: claims.email || '' };
}

async function pubsubUser(request, env) {
  if (!env.PUBSUB_AUDIENCE || !env.PUBSUB_PUSH_SA_EMAIL) throw new Error('SERVER_NOT_CONFIGURED');
  const token = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') || '')?.[1] || '';
  await verifyJwt(token, {
    jwksUrl: PUBSUB_JWKS,
    audience: env.PUBSUB_AUDIENCE,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    email: env.PUBSUB_PUSH_SA_EMAIL,
  });
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
  const raw = await request.text();
  if (utf8.encode(raw).length > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
  try { return JSON.parse(raw); } catch { throw new Error('BODY_INVALID'); }
}

function parseAccountService(env) {
  const raw = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('PLAY_CREDENTIAL_MISSING');
  const value = JSON.parse(raw);
  if (!value.client_email || !value.private_key) throw new Error('PLAY_CREDENTIAL_INVALID');
  return value;
}

async function playAccessToken(env) {
  if (cachedAccessToken && cachedAccessToken.expires > Date.now() + 60_000) return cachedAccessToken.token;
  const account = parseAccountService(env);
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(utf8.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = encodeBase64Url(utf8.encode(JSON.stringify({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })));
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(pem), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8.encode(`${header}.${payload}`)));
  const assertion = `${header}.${payload}.${encodeBase64Url(signature)}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('PLAY_AUTH_UNAVAILABLE');
  const body = await response.json();
  if (!body.access_token) throw new Error('PLAY_AUTH_UNAVAILABLE');
  cachedAccessToken = { token: body.access_token, expires: Date.now() + Math.max(60, body.expires_in || 3600) * 1000 };
  return cachedAccessToken.token;
}

async function playSubscription(env, purchaseToken) {
  const token = await playAccessToken(env);
  const response = await fetch(`${PLAY_BASE}/${encodeURIComponent(env.ANDROID_PACKAGE)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404 || response.status === 410) throw new Error('PLAY_PURCHASE_NOT_FOUND');
  if (!response.ok) throw new Error('PLAY_VERIFY_UNAVAILABLE');
  return response.json();
}

async function acknowledgePurchase(env, purchaseToken) {
  const token = await playAccessToken(env);
  const response = await fetch(`${PLAY_BASE}/${encodeURIComponent(env.ANDROID_PACKAGE)}/purchases/subscriptions/${PRODUCT_ID}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error('PLAY_ACK_UNAVAILABLE');
}

async function accountStatus(db, uid, now = Date.now()) {
  const manual = await db.prepare('SELECT expires_at FROM manual_grants WHERE uid = ?').bind(uid).first();
  // Jamais liberar assinatura não reconhecida (ACK) pela Google Play.
  const plays = await db.prepare('SELECT play_state, expires_at FROM subscription_entitlements WHERE uid = ? AND acknowledged = 1 ORDER BY expires_at DESC LIMIT 20').bind(uid).all();
  const results = (plays.results || []).map(row => evaluateAccess({
    manualUntil: manual?.expires_at || 0, playUntil: row.expires_at, playState: row.play_state, now,
  }));
  if (results.length === 0) return evaluateAccess({ manualUntil: manual?.expires_at || 0, now });
  return results.reduce((best, current) => current.until > best.until ? current : best, results[0]);
}

async function savePlayEntitlement(db, uid, purchaseToken, verified) {
  const tokenHash = await sha256(purchaseToken);
  await db.prepare(`INSERT OR IGNORE INTO subscription_entitlements
    (token_hash, uid, play_state, expires_at, acknowledged, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(tokenHash, uid, verified.state, verified.until, verified.acknowledged ? 1 : 0, Date.now()).run();
  const row = await db.prepare('SELECT uid FROM subscription_entitlements WHERE token_hash = ?').bind(tokenHash).first();
  if (!row || row.uid !== uid) throw new Error('TOKEN_ALREADY_LINKED');
  await db.prepare(`UPDATE subscription_entitlements SET play_state = ?, expires_at = ?,
    acknowledged = ?, updated_at = ? WHERE token_hash = ? AND uid = ?`)
    .bind(verified.state, verified.until, verified.acknowledged ? 1 : 0, Date.now(), tokenHash, uid).run();
  return tokenHash;
}

async function handleVerify(request, env) {
  const user = await firebaseUser(request, env);
  const data = await readBody(request);
  const purchaseToken = data?.purchaseToken;
  if (typeof purchaseToken !== 'string' || purchaseToken.length < 8 || purchaseToken.length > 4096 || /\s/.test(purchaseToken)) {
    throw new Error('PLAY_TOKEN_INVALID');
  }
  const sub = await playSubscription(env, purchaseToken);
  const verified = parsePlaySubscription(sub);
  // Obrigatório: a compra deve ter sido iniciada pelo UID autenticado neste app.
  const expectedAccountId = await sha256(`pacote-emato:v1:${user.uid}`);
  if (verified.externalAccountId !== expectedAccountId) throw new Error('PLAY_ACCOUNT_MISMATCH');
  if (!verified.eligible) throw new Error('PLAY_SUBSCRIPTION_INACTIVE');
  // Reserva o token antes do ACK; um token de outra conta nunca pode ser reutilizado.
  await savePlayEntitlement(env.BILLING_DB, user.uid, purchaseToken, verified);
  if (!verified.acknowledged) {
    await acknowledgePurchase(env, purchaseToken);
    const checked = parsePlaySubscription(await playSubscription(env, purchaseToken));
    if (!checked.acknowledged) throw new Error('PLAY_ACK_UNCONFIRMED');
    await savePlayEntitlement(env.BILLING_DB, user.uid, purchaseToken, checked);
  }
  return { success: true, access: await accountStatus(env.BILLING_DB, user.uid) };
}

async function handleGrant(request, env) {
  const admin = await firebaseUser(request, env);
  const admins = (env.ADMIN_FIREBASE_UIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!admins.includes(admin.uid)) throw new Error('ADMIN_FORBIDDEN');
  const body = await readBody(request);
  const uid = body?.uid;
  const days = body?.days;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(uid) || !validGrantDays(days)) {
    throw new Error('GRANT_INVALID');
  }
  const now = Date.now();
  // UPSERT atômico: duas liberações simultâneas não se sobrescrevem.
  // batch() executa atualização e auditoria na mesma transação do D1.
  await env.BILLING_DB.batch([
    env.BILLING_DB.prepare(`INSERT INTO manual_grants (uid, expires_at, granted_by, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET
      expires_at = MAX(manual_grants.expires_at, ?) + ?,
      granted_by = excluded.granted_by, updated_at = excluded.updated_at`)
      .bind(uid, now + days * DAY_MS, admin.uid, now, now, days * DAY_MS),
    env.BILLING_DB.prepare('INSERT INTO admin_audit (admin_uid, target_uid, action, days, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(admin.uid, uid, 'grant_days', days, now),
  ]);
  const current = await env.BILLING_DB.prepare('SELECT expires_at FROM manual_grants WHERE uid = ?').bind(uid).first();
  return { success: true, uid, manualUntil: current.expires_at };
}

async function requireAdminUser(request, env) {
  const admin = await firebaseUser(request, env);
  const admins = (env.ADMIN_FIREBASE_UIDS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!admins.includes(admin.uid)) throw new Error('ADMIN_FORBIDDEN');
  return admin;
}

async function handleGrantList(request, env) {
  await requireAdminUser(request, env);
  const rows = await env.BILLING_DB.prepare('SELECT uid, expires_at, updated_at FROM manual_grants ORDER BY updated_at DESC LIMIT 200').all();
  return { success: true, grants: (rows.results || []).map(row => ({
    uid: row.uid, until: row.expires_at, updatedAt: row.updated_at,
  })) };
}

async function handleGrantRevoke(request, env) {
  const admin = await requireAdminUser(request, env);
  const data = await readBody(request);
  const uid = data?.uid;
  if (typeof uid !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) throw new Error('GRANT_INVALID');
  const now = Date.now();
  await env.BILLING_DB.batch([
    env.BILLING_DB.prepare('DELETE FROM manual_grants WHERE uid = ?').bind(uid),
    env.BILLING_DB.prepare('INSERT INTO admin_audit (admin_uid, target_uid, action, days, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(admin.uid, uid, 'revoke_grant', 0, now),
  ]);
  return { success: true, uid };
}

async function handleRtdn(request, env) {
  await pubsubUser(request, env);
  const body = await readBody(request);
  const message = body?.message;
  if (!message?.data || typeof message.data !== 'string') throw new Error('RTDN_INVALID');
  const messageId = message.messageId || message.message_id;
  if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 200) throw new Error('RTDN_INVALID');
  const previous = await env.BILLING_DB.prepare('SELECT message_id FROM rtdn_events WHERE message_id = ?').bind(messageId).first();
  if (previous) return { success: true, duplicate: true };
  let notification;
  try { notification = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(message.data), ch => ch.charCodeAt(0)))); }
  catch { throw new Error('RTDN_INVALID'); }
  if (notification.packageName !== env.ANDROID_PACKAGE) throw new Error('RTDN_PACKAGE_MISMATCH');
  const purchaseToken = notification.subscriptionNotification?.purchaseToken;
  if (!purchaseToken) return { success: true, ignored: true };
  const hash = await sha256(purchaseToken);
  const row = await env.BILLING_DB.prepare('SELECT uid FROM subscription_entitlements WHERE token_hash = ?').bind(hash).first();
  // Uma notificação de compra anterior à primeira abertura do app não revela o UID.
  if (!row) return { success: true, pendingAppVerification: true };
  const sub = await playSubscription(env, purchaseToken);
  const parsed = parsePlaySubscription(sub);
  const expected = await sha256(`pacote-emato:v1:${row.uid}`);
  if (parsed.externalAccountId !== expected) throw new Error('RTDN_ACCOUNT_MISMATCH');
  await savePlayEntitlement(env.BILLING_DB, row.uid, purchaseToken, parsed);
  await env.BILLING_DB.prepare('INSERT OR IGNORE INTO rtdn_events (message_id, processed_at) VALUES (?, ?)')
    .bind(messageId, Date.now()).run();
  return { success: true };
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!origin || !headers['Access-Control-Allow-Origin']) return json({ code: 'ORIGIN_FORBIDDEN' }, 403, headers);
      return new Response(null, { status: 204, headers });
    }
    if (!env.BILLING_DB || !env.ANDROID_PACKAGE || env.ANDROID_PACKAGE !== 'com.pacoteemato.app') {
      return json({ code: 'SERVER_NOT_CONFIGURED' }, 503, headers);
    }
    try {
      if (path === '/api/access/status' && request.method === 'GET') {
        const user = await firebaseUser(request, env);
        const admins = (env.ADMIN_FIREBASE_UIDS || '').split(',').map(x => x.trim()).filter(Boolean);
        if (admins.includes(user.uid)) {
          return json({ success: true, access: { active: true, origin: 'admin',
            until: Number.MAX_SAFE_INTEGER, showSubscriptionScreen: false } }, 200, headers);
        }
        return json({ success: true, access: await accountStatus(env.BILLING_DB, user.uid) }, 200, headers);
      }
      if (path === '/api/play/verify' && request.method === 'POST') {
        return json(await handleVerify(request, env), 200, headers);
      }
      if (path === '/api/admin/grant-days' && request.method === 'POST') {
        return json(await handleGrant(request, env), 200, headers);
      }
      if (path === '/api/admin/grants' && request.method === 'GET') {
        return json(await handleGrantList(request, env), 200, headers);
      }
      if (path === '/api/admin/revoke-grant' && request.method === 'POST') {
        return json(await handleGrantRevoke(request, env), 200, headers);
      }
      if (path === '/api/play/rtdn' && request.method === 'POST') {
        return json(await handleRtdn(request, env), 200, headers);
      }
      return json({ code: 'NOT_FOUND' }, 404, headers);
    } catch (err) {
      const code = err?.message || 'SERVER_ERROR';
      const badRequest = /INVALID|MISMATCH|INACTIVE|BODY_TOO_LARGE/.test(code);
      const forbidden = /AUTH_INVALID|FORBIDDEN|TOKEN_ALREADY_LINKED/.test(code);
      // Nunca devolver mensagens cruas do Google Play, credenciais ou token de compra.
      const safe = /^[A-Z_]+$/.test(code) ? code : 'SERVER_ERROR';
      return json({ success: false, code: safe }, forbidden ? 403 : badRequest ? 400 : 503, headers);
    }
  },
};
