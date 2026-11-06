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
assert.match(marcadores, /const larguraCss = 46, alturaCss = 47/);

for (const arquivo of ['config', 'marcadores', 'mapa']) {
  assert.ok(html.includes(`js/mapa/${arquivo}.js?v=20261106-teste22-mapa-pinos-2`));
}
assert.ok(html.includes('js/navegacao/navegacao.js?v=20261106-teste22-mapa-pinos-2'));

console.log('PASSOU: mapa de ruas, marcadores numerados sem agrupamento e cache atualizado.');
