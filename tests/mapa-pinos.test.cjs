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
assert.match(config, /fill-outline-color', '#e5e8ed'/);
assert.match(config, /base:'#d7e2ed'/);
assert.match(config, /oneway\|one-way\|direction\|arrow/);
assert.match(config, /'line-dasharray', \[1, 0\]/);
assert.doesNotMatch(config, /'line-dasharray', null/);
assert.doesNotMatch(config, /mapa\.addLayer\(\{\s*id, type:'fill', source:base\.source/);

assert.ok(html.includes('js/mapa/config.js?v=20261106-vias-sem-blocos-6'));
assert.ok(html.includes('js/mapa/marcadores.js?v=20261106-circuit-clean-3'));
assert.ok(html.includes('js/mapa/mapa.js?v=20261106-teste22-mapa-pinos-2'));
assert.ok(html.includes('js/navegacao/navegacao.js?v=20261106-teste22-mapa-pinos-2'));

console.log('PASSOU: mapa de ruas, marcadores numerados sem agrupamento e cache atualizado.');

const vm = require('node:vm');
const ambiente = { window: {} };
vm.runInNewContext(config, ambiente, { filename: 'config.js' });
const estilo = ambiente.window.PacoteEMatoMapaConfig;
const layersTeste = [
  { id: 'road_minor_casing', type: 'line', 'source-layer': 'transportation', layout: {}, paint: { 'line-dasharray': [2, 2] } },
  { id: 'road_minor', type: 'line', 'source-layer': 'transportation', layout: {}, paint: { 'line-dasharray': [2, 2] } },
  { id: 'houses', type: 'fill', 'source-layer': 'building', paint: {} },
  { id: 'houses3D', type: 'fill-extrusion', 'source-layer': 'building', layout: {} }
];
let inclusoes = 0;
const mapaTeste = {
  getStyle: () => ({ layers: layersTeste }),
  getLayer: id => layersTeste.find(layer => layer.id === id),
  setPaintProperty(id, prop, value) { if (value == null) throw Error('Valor null não é suportado'); this.getLayer(id).paint[prop] = value; },
  setLayoutProperty(id, prop, value) { this.getLayer(id).layout = this.getLayer(id).layout || {}; this.getLayer(id).layout[prop] = value; },
  addLayer() { inclusoes++; },
  removeLayer() {}
};
estilo.exibirConstrucoes2D(mapaTeste);
estilo.aplicarEstiloMapaClean(mapaTeste);
assert.equal(inclusoes, 0, 'não deve duplicar o desenho das casas');
assert.equal(layersTeste[0].layout.visibility, 'none', 'bordas decorativas tracejadas ficam ocultas');
assert.deepEqual(Array.from(layersTeste[1].paint['line-dasharray']), [1, 0], 'via principal usa traçado sólido válido');
assert.equal(layersTeste[1].paint['line-gap-width'], 0, 'rua não mantém vão decorativo');
assert.equal(layersTeste[2].paint['fill-outline-color'], '#e5e8ed', 'casas com contorno discreto');
assert.equal(layersTeste[3].layout.visibility, 'none', 'mantém construções sem 3D');
console.log('PASSOU: ruas sem quadradinhos e casas sem camadas duplicadas.');
