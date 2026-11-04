import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// Funciona tanto no ZIP de preparação quanto na branch do repositório web.
const webRoot = existsSync(new URL('../../web/index.html', import.meta.url))
  ? new URL('../../web/', import.meta.url)
  : new URL('../../../', import.meta.url);
const html = readFileSync(new URL('index.html', webRoot), 'utf8');
const app = readFileSync(new URL('js/app.js', webRoot), 'utf8');
const play = readFileSync(new URL('js/assinatura-google-play.js', webRoot), 'utf8');

test('a tela de pagamento de acesso agora apresenta apenas Google Play', () => {
  assert.match(html, /R\$ 19,90\/mês/);
  assert.match(html, /14 dias grátis/);
  assert.match(html, /iniciarAssinaturaGooglePlay\(\)/);
  assert.doesNotMatch(html, /Gerar Pagamento Pix/);
  assert.doesNotMatch(html, /TESTE GRÁTIS — 10 DIAS/);
  assert.doesNotMatch(html, /Plano Trimestral \(3 Meses\)/);
});

test('o checkout é desativado por padrão e não envia token Play pelo JavaScript', () => {
  assert.match(html, /enabled: false, apiBase: ''/);
  assert.match(play, /window\.Android\.iniciarAssinaturaGooglePlay\(\)/);
  assert.doesNotMatch(play, /purchaseToken/);
});

test('cortesia é configurada pelo admin, acesso é consultado no servidor', () => {
  assert.match(app, /PEMATO_ASSINATURA_PLAY\.liberarDias/);
  assert.match(app, /PEMATO_ASSINATURA_PLAY\.confirmarAcesso/);
  assert.match(html, /Ver cortesias concedidas/);
});
