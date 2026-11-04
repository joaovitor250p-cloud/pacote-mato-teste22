import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const webRoot = existsSync(new URL('../../web/index.html', import.meta.url))
  ? new URL('../../web/', import.meta.url)
  : new URL('../../../', import.meta.url);
const read = path => readFileSync(new URL(path, webRoot), 'utf8');
const html = read('index.html');
const app = read('js/app.js');
const map = read('js/mapa/config.js');
const google = read('js/google-vinculo-v81.js');
const staging = read('js/ambiente-teste.js');

function runConfig(source) {
  const context = {
    window: {}, URL,
    document: { readyState: 'loading', addEventListener() {} }
  };
  runInNewContext(source, context);
  return context.window.PEMATO_TEST_ENV;
}

function prepare(source, worker) {
  return source
    .replace("apiKey: ''", "apiKey: 'firebase-web-key-de-testes'")
    .replace("authDomain: ''", "authDomain: 'pacote-e-mato-staging.firebaseapp.com'")
    .replace("projectId: ''", "projectId: 'pacote-e-mato-staging'")
    .replace("appId: ''", "appId: '1:123:web:test'")
    .replace("const workerBaseUrl = '';", `const workerBaseUrl = '${worker}';`);
}

test('branch de testes bloqueia acesso enquanto Firebase e Worker de testes não estiverem definidos', () => {
  assert.equal(runConfig(staging).ready, false);
  assert.match(html, /js\/ambiente-teste\.js/);
  assert.ok(html.indexOf('js/ambiente-teste.js') < html.indexOf('js/app.js'));
  assert.match(app, /AMBIENTE_TESTE_NAO_CONFIGURADO/);
  assert.doesNotMatch(app, /pacote-e-mato\.firebaseapp\.com/);
  assert.doesNotMatch(app, /holy-frog-272c\.joaovitor250p\.workers\.dev/);
});

test('configuração de staging só habilita com Firebase diferente e Worker HTTPS diferente', () => {
  const valido = runConfig(prepare(staging, 'https://worker-de-testes.workers.dev'));
  assert.equal(valido.ready, true);
  assert.equal(valido.firebaseConfig.projectId, 'pacote-e-mato-staging');
  const principal = runConfig(prepare(staging, 'https://holy-frog-272c.joaovitor250p.workers.dev'));
  assert.equal(principal.ready, false);
});

test('mapas e login Google no teste não apontam mais para o Worker principal', () => {
  assert.doesNotMatch(map, /holy-frog-272c\.joaovitor250p\.workers\.dev/);
  assert.doesNotMatch(google, /holy-frog-272c\.joaovitor250p\.workers\.dev/);
  assert.match(map, /PEMATO_TEST_ENV/);
  assert.match(google, /PEMATO_TEST_ENV/);
});
