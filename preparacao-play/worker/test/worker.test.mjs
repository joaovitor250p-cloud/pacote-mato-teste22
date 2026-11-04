import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import worker from '../index.mjs';

globalThis.crypto ||= webcrypto;
const encoder = new TextEncoder();
const encode = data => Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)).toString('base64url');
let keys, jwk, googleKeys, googleJwk, purchase;
let now;

const grants = new Map();
const subscriptions = new Map();
const audit = [];
const processedEvents = new Set();
const fakeD1 = {
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  prepare(sql) {
    const stmt = { params: [], bind(...args) { this.params = args; return this; },
      async first() {
        if (sql.includes('FROM rtdn_events')) return processedEvents.has(this.params[0]) ? { message_id: this.params[0] } : null;
        if (sql.includes('FROM manual_grants')) {
          const row = grants.get(this.params[0]); return row ? { expires_at: row.expires_at } : null;
        }
        if (sql.includes('FROM subscription_entitlements WHERE token_hash')) {
          const row = subscriptions.get(this.params[0]); return row ? { uid: row.uid } : null;
        }
        throw new Error('Unknown SELECT first: ' + sql);
      },
      async all() {
        if (sql.includes('FROM manual_grants')) {
          return { results: [...grants.entries()].map(([uid, row]) => ({ uid, expires_at: row.expires_at, updated_at: row.updated_at })) };
        }
        if (sql.includes('FROM subscription_entitlements WHERE uid')) {
          return { results: [...subscriptions.values()].filter(row => row.uid === this.params[0] && row.acknowledged === 1) };
        }
        throw new Error('Unknown SELECT all: ' + sql);
      },
      async run() {
        if (sql.startsWith('INSERT INTO manual_grants')) {
          const [uid, expires_at, granted_by, updated_at, now, extra] = this.params;
          const previous = grants.get(uid);
          grants.set(uid, { expires_at: previous ? Math.max(previous.expires_at, now) + extra : expires_at,
            granted_by, updated_at });
        } else if (sql.startsWith('INSERT INTO admin_audit')) {
          audit.push(this.params);
        } else if (sql.startsWith('DELETE FROM manual_grants')) {
          grants.delete(this.params[0]);
        } else if (sql.startsWith('INSERT OR IGNORE INTO rtdn_events')) {
          processedEvents.add(this.params[0]);
        } else if (sql.startsWith('INSERT OR IGNORE INTO subscription_entitlements')) {
          const [hash, uid, state, expires_at, acknowledged, updated_at] = this.params;
          if (!subscriptions.has(hash)) subscriptions.set(hash, { uid, play_state: state, expires_at, acknowledged, updated_at });
        } else if (sql.startsWith('UPDATE subscription_entitlements')) {
          const [play_state, expires_at, acknowledged, updated_at, hash, uid] = this.params;
          if (subscriptions.get(hash)?.uid === uid) subscriptions.set(hash, { uid, play_state, expires_at, acknowledged, updated_at });
        } else throw new Error('Unknown UPDATE: ' + sql);
        return { success: true };
      } };
    return stmt;
  },
};

const env = {
  FIREBASE_PROJECT_ID: 'pacote-e-mato',
  ANDROID_PACKAGE: 'com.pacoteemato.app',
  BILLING_DB: fakeD1,
  ADMIN_FIREBASE_UIDS: 'uid-admin',
  ALLOWED_ORIGINS: 'https://pacoteemato.github.io',
  PUBSUB_AUDIENCE: 'https://billing.example/api/play/rtdn',
  PUBSUB_PUSH_SA_EMAIL: 'pubsub@example.com',
};

async function signedJwt(claims, pair = keys, kid = 'key1') {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid });
  const payload = encode(claims);
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(data));
  return `${data}.${Buffer.from(sig).toString('base64url')}`;
}

async function firebaseJwt(uid) {
  const epoch = Math.floor(Date.now() / 1000);
  return signedJwt({ aud: 'pacote-e-mato', iss: 'https://securetoken.google.com/pacote-e-mato',
    sub: uid, iat: epoch, exp: epoch + 3600 });
}

async function request(path, { method = 'GET', token = '', body, origin = 'https://pacoteemato.github.io' } = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`https://billing.example${path}`, { method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env);
}

before(async () => {
  now = Date.now();
  keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'key1' };
  googleKeys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  googleJwk = { ...(await crypto.subtle.exportKey('jwk', googleKeys.publicKey)), kid: 'pubsub-key' };
  const privateDer = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
  env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'play@example.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${privateDer}\n-----END PRIVATE KEY-----` });
  const accountId = Buffer.from(await crypto.subtle.digest('SHA-256', encoder.encode('pacote-emato:v1:uid-driver'))).toString('hex');
  purchase = {
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_NOT_ACKNOWLEDGED',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: accountId },
    lineItems: [{ productId: 'pacote_emato_premium', expiryTime: new Date(now + 14 * 86400000).toISOString(),
      offerDetails: { basePlanId: 'mensal', offerId: 'teste-gratis-14d' } }],
  };
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('service_accounts/v1/jwk/')) return Response.json({ keys: [jwk] });
    if (url.includes('/oauth2/v3/certs')) return Response.json({ keys: [googleJwk] });
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    if (url.includes('subscriptionsv2/tokens/')) return Response.json(purchase);
    if (url.includes(':acknowledge')) {
      purchase.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected network request: ' + url);
  };
});

test('sem JWT, backend nega consultar acesso', async () => {
  const response = await request('/api/access/status');
  assert.equal(response.status, 403);
});

test('usuário sem cortesia e sem assinatura recebe tela de assinatura', async () => {
  const response = await request('/api/access/status', { token: await firebaseJwt('uid-new') });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).access.showSubscriptionScreen, true);
});

test('usuário comum não concede dias a si mesmo', async () => {
  const response = await request('/api/admin/grant-days', { method: 'POST', token: await firebaseJwt('uid-driver'),
    body: { uid: 'uid-driver', days: 30 } });
  assert.equal(response.status, 403);
  assert.equal(grants.size, 0);
});

test('administrador pode conceder 30 dias de acesso completo', async () => {
  const response = await request('/api/admin/grant-days', { method: 'POST', token: await firebaseJwt('uid-admin'),
    body: { uid: 'uid-driver', days: 30 } });
  assert.equal(response.status, 200);
  assert.equal(grants.size, 1);
  assert.equal(audit.length, 1);
  const status = await request('/api/access/status', { token: await firebaseJwt('uid-driver') });
  const result = (await status.json()).access;
  assert.equal(result.active, true);
  assert.equal(result.origin, 'cortesia');
});

test('somente administrador pode listar cortesias', async () => {
  const bad = await request('/api/admin/grants', { token: await firebaseJwt('uid-driver') });
  assert.equal(bad.status, 403);
  const okay = await request('/api/admin/grants', { token: await firebaseJwt('uid-admin') });
  assert.equal(okay.status, 200);
  const data = await okay.json();
  assert.equal(data.grants.length, 1);
  assert.equal(data.grants[0].uid, 'uid-driver');
});

test('administrador continua podendo abrir o app sem cobrança', async () => {
  const response = await request('/api/access/status', { token: await firebaseJwt('uid-admin') });
  const data = await response.json();
  assert.equal(data.access.origin, 'admin');
  assert.equal(data.access.active, true);
});

test('revogar cortesia não cancela uma assinatura do Google Play', async () => {
  const bad = await request('/api/admin/revoke-grant', { method: 'POST', token: await firebaseJwt('uid-driver'),
    body: { uid: 'uid-driver' } });
  assert.equal(bad.status, 403);
  const good = await request('/api/admin/revoke-grant', { method: 'POST', token: await firebaseJwt('uid-admin'),
    body: { uid: 'uid-driver' } });
  assert.equal(good.status, 200);
  assert.equal(grants.size, 0);
  assert.equal(subscriptions.size, 0);
  const status = await request('/api/access/status', { token: await firebaseJwt('uid-driver') });
  assert.equal((await status.json()).access.active, false);
});

test('compra autenticada é confirmada pela Play e vinculada ao mesmo UID', async () => {
  const response = await request('/api/play/verify', { method: 'POST', token: await firebaseJwt('uid-driver'),
    body: { purchaseToken: 'token-test-valid-123' } });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).access.origin, 'google_play');
  assert.equal(subscriptions.size, 1);
  assert.equal(purchase.acknowledgementState, 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED');
});

test('token comprado por outro UID não pode ser reivindicado', async () => {
  const response = await request('/api/play/verify', { method: 'POST', token: await firebaseJwt('uid-other'),
    body: { purchaseToken: 'token-test-valid-123' } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'PLAY_ACCOUNT_MISMATCH');
});

test('notificação RTDN requer autenticação de conta PubSub', async () => {
  const notification = { message: { messageId: 'pubsub-test-123', data: Buffer.from(JSON.stringify({ packageName: 'com.pacoteemato.app',
    subscriptionNotification: { purchaseToken: 'token-test-valid-123' } })).toString('base64') } };
  const unsigned = await request('/api/play/rtdn', { method: 'POST', body: notification });
  assert.equal(unsigned.status, 403);
  const epoch = Math.floor(Date.now() / 1000);
  const token = await signedJwt({ aud: env.PUBSUB_AUDIENCE, iss: 'https://accounts.google.com',
    email: env.PUBSUB_PUSH_SA_EMAIL, email_verified: true, iat: epoch, exp: epoch + 3600 }, googleKeys, 'pubsub-key');
  const signed = await request('/api/play/rtdn', { method: 'POST', token, body: notification });
  assert.equal(signed.status, 200);
  const repeated = await request('/api/play/rtdn', { method: 'POST', token, body: notification });
  assert.equal((await repeated.json()).duplicate, true);
});
