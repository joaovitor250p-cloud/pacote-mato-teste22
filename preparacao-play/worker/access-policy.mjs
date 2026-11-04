// Política compartilhada pelo backend. Não confiar em status calculado no app.
export const DAY_MS = 24 * 60 * 60 * 1000;
export const PRODUCT_ID = 'pacote_emato_premium';
export const BASE_PLAN_ID = 'mensal';
export const TRIAL_OFFER_ID = 'teste-gratis-14d';

const PLAY_STATES_WITH_ENTITLEMENT = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED', // Até o vencimento informado pela Play.
]);

export function validGrantDays(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 3650;
}

export function calculateGrantUntil(previousUntil, days, now = Date.now()) {
  if (!validGrantDays(days) || !Number.isSafeInteger(now) || now <= 0) {
    throw new TypeError('GRANT_INVALID');
  }
  const base = Math.max(now, Number(previousUntil) || 0);
  const until = base + days * DAY_MS;
  if (!Number.isSafeInteger(until)) throw new RangeError('GRANT_OVERFLOW');
  return until;
}

export function parsePlaySubscription(subscription, now = Date.now()) {
  if (!subscription || typeof subscription !== 'object') {
    throw new TypeError('PLAY_INVALID_RESPONSE');
  }
  const state = String(subscription.subscriptionState || '');
  const items = Array.isArray(subscription.lineItems) ? subscription.lineItems : [];
  const matching = items.filter(item => item && item.productId === PRODUCT_ID &&
    item.offerDetails?.basePlanId === BASE_PLAN_ID);
  if (matching.length === 0) throw new TypeError('PLAY_PRODUCT_MISMATCH');
  const endMs = Math.max(0, ...matching.map(item => {
    const time = Date.parse(item.expiryTime || '');
    return Number.isFinite(time) ? time : 0;
  }));
  if (!endMs) throw new TypeError('PLAY_EXPIRY_INVALID');
  const eligible = PLAY_STATES_WITH_ENTITLEMENT.has(state) && endMs > now;
  return {
    state,
    until: endMs,
    eligible,
    acknowledged: subscription.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    offer: matching.some(item => item.offerDetails?.offerId === TRIAL_OFFER_ID) ? TRIAL_OFFER_ID : null,
    isTest: Boolean(subscription.testPurchase),
    // Se houver um ID ofuscado enviado pelo app, o backend confere a conta.
    externalAccountId: subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
  };
}

export function evaluateAccess({ manualUntil = 0, playUntil = 0, playState = '', now = Date.now() }) {
  const manual = Number(manualUntil) > now;
  const play = PLAY_STATES_WITH_ENTITLEMENT.has(playState) && Number(playUntil) > now;
  const active = manual || play;
  return {
    active,
    origin: play ? 'google_play' : manual ? 'cortesia' : 'expired',
    until: active ? Math.max(manual ? Number(manualUntil) : 0, play ? Number(playUntil) : 0) : 0,
    showSubscriptionScreen: !active,
  };
}
