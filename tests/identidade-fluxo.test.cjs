/* Regressões de interface da versão Teste22. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = nome => fs.readFileSync(path.resolve(__dirname, '..', nome), 'utf8');
const html = ler('index.html');
const roteiro = ler('js/roteirizacao/roteirizacao.js');
const importador = ler('js/importacao/xlsx.js');
const mapa = ler('js/mapa/mapa.js');
const navegacao = ler('js/navegacao/navegacao.js');
const tema = ler('css/pemato-identidade.css');
const manifest = JSON.parse(ler('manifest.json'));

assert.ok(html.includes('css/pemato-identidade.css'));
assert.ok(!html.includes('teste22-mapa-azul.css'));
assert.ok(!html.includes('routeImportMappingModal'));
assert.ok(!roteiro.includes('abrirMapeamentoImportacao'));
assert.ok(roteiro.includes("PacoteEMatoImportacaoXLSX.lerArquivo(file, { inspecao })"));
assert.ok(importador.includes("pacote: ['pacote', 'spx tn'"));
assert.ok(importador.includes("latitude: ['latitude'"));
assert.ok(importador.includes("longitude: ['longitude'"));
assert.ok(tema.includes('--pemato-cobre: #168B61'));
assert.equal(manifest.theme_color, '#168B61');
assert.equal(manifest.background_color, '#F6FAF8');
assert.ok(html.includes('content="#168B61" id="metaThemeColor"'));
assert.ok(html.includes('manifest.json?v=20261108-teste22-verde-2'));
assert.ok(ler('js/app.js').includes("metaColor.setAttribute('content', '#168B61')"));
assert.ok(!html.includes('#a6532c'));

for (const codigo of [mapa, navegacao]) {
  assert.ok(!codigo.includes('clusterRadius:'));
  assert.ok(!codigo.includes('clusterMaxZoom:'));
  assert.ok(codigo.includes('SOURCE_STOPS_SELECTED'));
  assert.ok(!codigo.includes('point_count_abbreviated'));
}
assert.ok(html.includes('Abrir no Waze'));
assert.ok(html.includes('Abrir no Google Maps'));
for (const codigo of [ler('app.js'), ler('js/app.js')]) {
  assert.ok(!/\b(spoke|circuit)\b/i.test(codigo));
}
console.log('PASSOU: identidade, importação direta, pinos individuais e integrações de navegação.');
