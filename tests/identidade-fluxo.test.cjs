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
assert.ok(tema.includes('--pemato-cobre: #a6532c'));
assert.equal(manifest.theme_color, '#a6532c');
assert.equal(manifest.background_color, '#f6f5f2');

for (const codigo of [mapa, navegacao]) {
  assert.ok(codigo.includes('clusterRadius:'));
  assert.ok(codigo.includes('clusterMaxZoom:'));
  assert.ok(codigo.includes('SOURCE_STOPS_SELECTED'));
  assert.ok(codigo.includes('point_count_abbreviated'));
}
assert.ok(html.includes('Abrir no Waze'));
assert.ok(html.includes('Abrir no Google Maps'));
for (const codigo of [ler('app.js'), ler('js/app.js')]) {
  assert.ok(!/\b(spoke|circuit)\b/i.test(codigo));
}
console.log('PASSOU: identidade, importação direta, agrupamentos e integrações de navegação.');
