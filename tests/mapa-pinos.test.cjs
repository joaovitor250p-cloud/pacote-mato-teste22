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
assert.match(marcadores, /const larguraCss = mostrarNumero \? \(multiplo \? 49 : 34\) : 26/);
assert.match(config, /fill-color', '#f0f2f1'/);
assert.match(config, /fill-outline-color', '#cdd5de'/);
assert.match(config, /base:'#d7e2ed'/);
assert.match(config, /oneway\|one-way\|direction\|arrow/);
assert.match(config, /'line-dasharray', \[1, 0\]/);
assert.doesNotMatch(config, /'line-dasharray', null/);
assert.doesNotMatch(config, /mapa\.addLayer\(\{\s*id, type:'fill', source:base\.source/);

assert.ok(html.includes('js/mapa/config.js?v=20261108-sem-tracejados-3'));
assert.match(config, /const camadaPedestre/);
assert.match(config, /garantirRuasAzuisUniformes\(mapa, navegacaoAtiva\)/);
assert.match(config, /'pemato-streets-solid'/);
assert.ok(html.includes('js/mapa/marcadores.js?v=20261108-pinos-fixos-15'));
assert.ok(html.includes('js/mapa/mapa.js?v=20261108-pinos-fixos-15'));
assert.ok(html.includes('js/navegacao/navegacao.js?v=20261108-pinos-fixos-15'));
assert.doesNotMatch(planejamento + navegacao, /#a6532c|rgba\(166,83,44/i, 'marcador da posição usa o verde da marca');

assert.match(planejamento, /abrirDetalhesPacotes/);
assert.match(navegacao, /abrirDetalhesPacotes/);
assert.match(planejamento, /const totalPacotes = global\.PacoteEMatoMarcadores\?\.quantidadePacotesRegistradosDoGrupo/);
assert.match(navegacao, /const multi = global\.PacoteEMatoMarcadores\?\.quantidadePacotesRegistradosDoGrupo/);
assert.match(marcadores, /'×' \+ quantidade/);
assert.match(marcadores, /function abrirDetalhesPacotes\(/);
assert.match(marcadores, /function pacotesRegistradosDoGrupo\(/);
assert.match(marcadores, /rotulo\.textContent = item\.codigo/);
assert.ok(html.includes('css/pemato-identidade.css?v=20261108-limpeza-13'));
assert.ok(html.includes('js/roteirizacao/roteirizacao.js?v=20261108-previsao-13'));
const roteiro = read('js/roteirizacao/roteirizacao.js');
assert.match(roteiro, /function quantidadePacotesVisiveisNoEndereco/);
assert.match(roteiro, /quantidadePacotesRegistradosDoGrupo/);
assert.match(roteiro, /Previsão de término:/, 'horario mostra o nome correto');
assert.doesNotMatch(roteiro, /`Término: /);

assert.ok(html.includes('id="routingSummaryPackages"'), 'resumo tem total de pacotes');
assert.ok(html.includes('id="routingSummaryStops"'), 'resumo tem total de paradas');
assert.match(roteiro, /routingSummaryPackages/);
assert.match(roteiro, /routingSummaryStops/);
assert.match(marcadores, /pemato-packages-top-panel/);
assert.match(marcadores, /getContainer\?\.\(\)/);



console.log('PASSOU: mapa de ruas, numeracao com selo separado e detalhes das entregas no mesmo endereco.');

const vm = require('node:vm');
const ambiente = { window: {} };
vm.runInNewContext(config, ambiente, { filename: 'config.js' });
const estilo = ambiente.window.PacoteEMatoMapaConfig;
const layersTeste = [
  { id: 'road_minor_casing', type: 'line', 'source-layer': 'transportation', layout: {}, paint: { 'line-dasharray': [2, 2] } },
  { id: 'road_minor', type: 'line', 'source-layer': 'transportation', layout: {}, paint: { 'line-dasharray': [2, 2] } },
  { id: 'footway_path', type: 'line', 'source-layer': 'transportation', layout: {}, paint: { 'line-color': '#a98760', 'line-dasharray': [1, 2] } },
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
assert.equal(layersTeste[1].paint['line-color'], '#d7e2ed', 'ruas não viram trilhas apagadas');
assert.equal(layersTeste[1].paint['line-gap-width'], 0, 'rua não mantém vão decorativo');
assert.equal(layersTeste[2].layout.visibility, 'none', 'passagens tracejadas internas ficam ocultas');
assert.equal(layersTeste[3].paint['fill-outline-color'], '#cdd5de', 'contornos das casas com melhor legibilidade');
assert.equal(layersTeste[4].layout.visibility, 'none', 'mantém construções sem 3D');
console.log('PASSOU: ruas sem quadradinhos e casas sem camadas duplicadas.');


// Teste das ruas em todo o mapa com uma fonte vetorial do estilo base.
const viasReais = [
  { id: 'minor_roads', type: 'line', source: 'vector', 'source-layer': 'transportation', paint: { 'line-color': '#ffffff' }, layout: {} },
  { id: 'oneway_arrows', type: 'symbol', source: 'vector', 'source-layer': 'transportation_name', layout: {}, paint: {} },
  { id: 'direction_marker', type: 'symbol', source: 'vector', 'source-layer': 'poi', layout: {}, paint: {} },
  { id: 'street_names', type: 'symbol', source: 'vector', 'source-layer': 'transportation_name', layout: {}, paint: {} }
];
let camadaCriada = 0;
const mapaRuas = {
  getStyle() { return { layers: viasReais }; },
  getLayer(id) { return viasReais.find(x => x.id === id); },
  getSource(id) { return id === 'vector' ? {} : undefined; },
  addLayer(layer, before) {
    camadaCriada++;
    const index = viasReais.findIndex(x => x.id === before);
    viasReais.splice(index < 0 ? viasReais.length : index, 0, layer);
  },
  setLayoutProperty(id, prop, value) {
    const l = this.getLayer(id);
    l.layout = l.layout || {};
    l.layout[prop] = value;
  },
  setPaintProperty(id, prop, value) {
    const l = this.getLayer(id);
    l.paint = l.paint || {};
    l.paint[prop] = value;
  }
};
estilo.aplicarEstiloMapaClean(mapaRuas);
assert.equal(camadaCriada, 2, 'cria um contorno e um preenchimento continuo para todas as ruas');
const ruasAzuis = mapaRuas.getLayer('pemato-streets-solid');
assert.equal(ruasAzuis.source, 'vector', 'usa a propria base vetorial do mapa');
assert.equal(ruasAzuis['source-layer'], 'transportation');
assert.ok(ruasAzuis.filter[2].includes('minor'), 'inclui ruas locais');
assert.ok(ruasAzuis.filter[2].includes('service'), 'inclui vias de acesso');
assert.equal(ruasAzuis.paint['line-color'], '#d2dfed');
assert.equal(mapaRuas.getLayer('oneway_arrows').layout.visibility, 'visible', 'setas de mão única retornaram às ruas');
assert.equal(mapaRuas.getLayer('oneway_arrows').layout['symbol-placement'], 'line', 'setas seguem as ruas');
assert.equal(mapaRuas.getLayer('oneway_arrows').layout['symbol-spacing'], 420, 'setas têm espaçamento maior');
assert.equal(mapaRuas.getLayer('oneway_arrows').paint['icon-opacity'], 0.66, 'setas discretas mas visíveis');
assert.equal(mapaRuas.getLayer('direction_marker').layout.visibility, 'none', 'setas genéricas fora das ruas ocultas');
assert.equal(mapaRuas.getLayer('street_names').layout.visibility, 'visible', 'nomes das ruas permanecem');
estilo.aplicarEstiloNavegacaoAtiva(mapaRuas);
assert.equal(camadaCriada, 2, 'trocar de modo nao duplica ruas');
console.log('PASSOU: ruas preservadas e somente setas de sentido da via visiveis.');

// Cobertura de setas de mão única não pode depender da capital paulista.
// A seta própria acompanha o tile vetorial e exige o atributo oneway válido.
assert.match(config, /const CAMADA_SETAS_BRASIL = 'pemato-oneway-brasil'/);
assert.match(config, /function garantirSetasRuasBrasil\(mapa\)/);
assert.match(config, /\['get', 'oneway'\]/);
assert.match(config, /\['1', 'yes', 'true', '-1'\]/);
assert.match(config, /garantirSetasRuasBrasil\(mapa\)/);
assert.ok(html.includes('css/pemato-identidade.css?v=20261108-limpeza-13'));
assert.ok(!html.includes('id="pematoTest22Version"'), 'nao mostra numero de versao ao entregador');
assert.ok(!html.includes('Teste22 · visual 8 · pacotes 8'));
assert.ok(html.includes('js/mapa/config.js?v=20261108-sem-tracejados-3'));
console.log('PASSOU: estilo premium e setas vetoriais sem limite por estado.');

assert.ok(!html.includes('Teste22 · visual 12 · painel 12'));
assert.match(marcadores, /function quantidadePacotesRegistradosDoGrupo\(/);
console.log('PASSOU: nova contagem de codigos distintos em ambas as telas.');

 
// Regressão: é proibido afastar os pinos das coordenadas reais.
const ambienteMarcadores = {window:{}};
vm.runInNewContext(marcadores, ambienteMarcadores, {filename:'marcadores.js'});
const mapaPinos = ambienteMarcadores.window.PacoteEMatoMarcadores;
assert.equal(typeof mapaPinos.organizarPinosVisiveis, 'undefined',
  'distribuicao artificial dos pinos removida');
assert.doesNotMatch(planejamento, /organizarPinosVisiveis|mapa\.on\('moveend', \(\) => \{ if \(pronto\) renderizarMarcadores/,
  'planejamento nao redistribui marcadores ao mover mapa');
assert.doesNotMatch(navegacao, /organizarPinosVisiveis/,
  'navegacao nao redistribui marcadores ao mover mapa');
assert.match(planejamento, /stackIndex, markerOffset: \[0,0\]/,
  'planejamento ancora o pino na coordenada original');
assert.match(navegacao, /stackIndex,markerOffset:\[0,0\]/,
  'navegacao ancora o pino na coordenada original');
assert.ok(html.includes('js/mapa/marcadores.js?v=20261108-pinos-fixos-15'));
assert.ok(html.includes('js/mapa/mapa.js?v=20261108-pinos-fixos-15'));
assert.ok(html.includes('js/navegacao/navegacao.js?v=20261108-pinos-fixos-15'));
assert.ok(html.includes('js/exportacao/pdf-rota.js?v=20261109-download-circuit-14'));
assert.ok(html.includes('Baixar PDF da rota'));
console.log('PASSOU: pinos ancorados nos enderecos e PDF preservado.');
