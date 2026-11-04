import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, calculateGrantUntil, evaluateAccess, parsePlaySubscription, validGrantDays } from '../access-policy.mjs';

const now = Date.parse('2026-11-04T12:00:00Z');

function play(state = 'SUBSCRIPTION_STATE_ACTIVE', expiryTime = new Date(now + 14 * DAY_MS).toISOString()) {
  return {
    subscriptionState: state,
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    lineItems: [{ productId: 'pacote_emato_premium', expiryTime,
      offerDetails: { basePlanId: 'mensal', offerId: 'teste-gratis-14d' } }],
    externalAccountIdentifiers: { obfuscatedExternalAccountId: 'a'.repeat(64) },
  };
}

test('dias de cortesia: aceita 1..3650 inteiros', () => {
  for (const days of [1, 7, 14, 30, 60, 3650]) assert.equal(validGrantDays(days), true);
  for (const days of [0, -1, 3651, 1.2, '30', null, undefined]) assert.equal(validGrantDays(days), false);
});

test('nova cortesia começa hoje e cortesia ativa acumula dias', () => {
  assert.equal(calculateGrantUntil(0, 30, now), now + 30 * DAY_MS);
  assert.equal(calculateGrantUntil(now + 10 * DAY_MS, 30, now), now + 40 * DAY_MS);
  assert.equal(calculateGrantUntil(now - DAY_MS, 7, now), now + 7 * DAY_MS);
});

test('cortesia expirada mostra assinatura, sem cobrança automática', () => {
  assert.deepEqual(evaluateAccess({ manualUntil: now, now }),
    { active: false, origin: 'expired', until: 0, showSubscriptionScreen: true });
});

test('cortesia vigente libera o aplicativo inteiro', () => {
  const result = evaluateAccess({ manualUntil: now + DAY_MS, now });
  assert.equal(result.active, true);
  assert.equal(result.origin, 'cortesia');
  assert.equal(result.showSubscriptionScreen, false);
});

test('assinatura Google Play ativa libera tudo, mesmo sem cortesia', () => {
  const result = evaluateAccess({ playUntil: now + 30 * DAY_MS, playState: 'SUBSCRIPTION_STATE_ACTIVE', now });
  assert.equal(result.active, true);
  assert.equal(result.origin, 'google_play');
});

test('cancelamento mantém acesso até o vencimento, mas não depois', () => {
  assert.equal(evaluateAccess({ playUntil: now + DAY_MS, playState: 'SUBSCRIPTION_STATE_CANCELED', now }).active, true);
  assert.equal(evaluateAccess({ playUntil: now, playState: 'SUBSCRIPTION_STATE_CANCELED', now }).active, false);
});

test('conta suspensa ou aguardando pagamento não ganha acesso', () => {
  for (const state of ['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_EXPIRED']) {
    assert.equal(evaluateAccess({ playUntil: now + 100 * DAY_MS, playState: state, now }).active, false);
  }
});

test('cortesia válida funciona mesmo com assinatura Play encerrada', () => {
  const result = evaluateAccess({ manualUntil: now + 7 * DAY_MS,
    playUntil: now - DAY_MS, playState: 'SUBSCRIPTION_STATE_EXPIRED', now });
  assert.equal(result.origin, 'cortesia');
  assert.equal(result.active, true);
});

test('compra verifica produto, plano, teste grátis e vencimento', () => {
  const result = parsePlaySubscription(play(), now);
  assert.equal(result.eligible, true);
  assert.equal(result.acknowledged, true);
  assert.equal(result.offer, 'teste-gratis-14d');
  assert.equal(result.until, now + 14 * DAY_MS);
});

test('período acabou ou assinatura cancelada vencida nega acesso', () => {
  assert.equal(parsePlaySubscription(play('SUBSCRIPTION_STATE_CANCELED', new Date(now - 1).toISOString()), now).eligible, false);
  assert.equal(parsePlaySubscription(play('SUBSCRIPTION_STATE_PENDING'), now).eligible, false);
});

test('não aceita compra de outro produto nem outro plano', () => {
  const other = play();
  other.lineItems[0].productId = 'outro_produto';
  assert.throws(() => parsePlaySubscription(other, now), /PLAY_PRODUCT_MISMATCH/);
  other.lineItems[0].productId = 'pacote_emato_premium';
  other.lineItems[0].offerDetails.basePlanId = 'anual';
  assert.throws(() => parsePlaySubscription(other, now), /PLAY_PRODUCT_MISMATCH/);
});
