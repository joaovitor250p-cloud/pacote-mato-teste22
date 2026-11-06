const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const config = read('js/mapa/config.js');
const planejamento = read('js/mapa/mapa.js');
const navegacao = read('js/navegacao/navegacao.js');
const marcadores = read('js/mapa/marcadores.js');
const html = read('index.html');

// Distanciar o mapa não deve substituir os números das paradas por bolhas de total.
for (const codigo of [planejamento, navegacao]) {
  assert.doesNotMatch(codigo, /cluster\s*:\s*true/);
  assert.doesNotMatch(codigo, /point_count_abbreviated|\['has',\s*'point_count'\]/);
  assert.match(codigo, /'icon-allow-overlap'\s*:\s*true/);
  assert.match(codigo, /'icon-ignore-placement'\s*:\s*true/);
  assert.match(codigo, /#2876e6/);
}

assert.match(planejamento, /numbered:\s*1/);
assert.match(planejamento, /order:\s*ordem\(p\)/);
assert.match(config, /mapStyleUrl:\s*'https:\/\/tiles\.openfreemap\.org\/styles\/bright'/);
assert.match(marcadores, /const larguraCss = 40, alturaCss = 42/);
assert.match(config, /fill-color', '#f0f2f1'/);
assert.match(config, /fill-outline-color', '#c5cbd5'/);
assert.match(config, /base:'#d7e2ed'/);
assert.match(config, /oneway\|one-way\|direction\|arrow/);

assert.ok(html.includes('js/mapa/config.js?v=20261106-ruas-urbanas-4'));
assert.ok(html.includes('js/mapa/marcadores.js?v=20261106-circuit-clean-3'));
assert.ok(html.includes('js/mapa/mapa.js?v=20261106-teste22-mapa-pinos-2'));
assert.ok(html.includes('js/navegacao/navegacao.js?v=20261106-teste22-mapa-pinos-2'));

console.log('PASSOU: mapa de ruas, marcadores numerados sem agrupamento e cache atualizado.');
