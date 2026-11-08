/* Teste dos balões sem serviços externos: node tests/marcadores.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { devicePixelRatio: 2 };
sandbox.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = { width: 0, height: 0, fills: [], texts: [] };
    const ctx = {
      scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      quadraticCurveTo() {}, closePath() {}, arc() {}, save() {}, restore() {},
      stroke() {}, fillText(text) { canvas.texts.push(String(text)); },
      fill() { canvas.fills.push(this.fillStyle); },
      measureText(text) { return { width: String(text).length * 8 }; },
      getImageData() { return { width: canvas.width, height: canvas.height, fills: canvas.fills.slice(), texts: canvas.texts.slice() }; }
    };
    canvas.getContext = () => ctx;
    return canvas;
  }
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../js/mapa/marcadores.js'), 'utf8'), sandbox);

const images = new Map();
const mapa = {
  hasImage: name => images.has(name),
  addImage: (name, data, options) => images.set(name, { data, options })
};
const criar = options => {
  const name = sandbox.PacoteEMatoMarcadores.criarIcone(mapa, { prefixo: 'teste22', ...options });
  assert.ok(images.has(name));
  return images.get(name);
};

const pendente = criar({ ordem: 17, quantidade: 1, status: 'pendente' });
const selecionada = criar({ ordem: 18, quantidade: 2, status: 'pendente', selecionado: true });
const parcial = criar({ ordem: 19, quantidade: 3, status: 'parcial' });
const concluida = criar({ ordem: 20, quantidade: 1, status: 'concluida' });
const falhou = criar({ ordem: 21, quantidade: 1, status: 'nao_entregue' });
const rascunho = criar({ quantidade: 1, status: 'pendente', mostrarNumero: false });

for (const entry of [pendente, selecionada, parcial, concluida, falhou]) {
  assert.equal(entry.options.pixelRatio, 2);
  assert.equal(entry.data.height / entry.options.pixelRatio, 34);
  assert.equal(entry.data.width / entry.options.pixelRatio, [selecionada, parcial].includes(entry) ? 49 : 34);
}
assert.equal(rascunho.data.height / rascunho.options.pixelRatio, 24);
assert.equal(selecionada.data.width / selecionada.options.pixelRatio, 49);
assert.deepEqual(selecionada.data.texts, ['18', '×2'], 'o selo ×2 nao substitui o numero principal');
assert.deepEqual(parcial.data.texts, ['19', '×3']);
assert.ok(pendente.data.fills.includes('#018D3E'));
assert.ok(selecionada.data.fills.includes('#006D32'));
assert.ok(parcial.data.fills.includes('#e59b24'));
assert.ok(concluida.data.fills.includes('#16a34a'));
assert.ok(falhou.data.fills.includes('#E71506'));

const longa = criar({ ordem: 1234, quantidade: 1, status: 'pendente' });
assert.equal(longa.data.width / longa.options.pixelRatio, 34);

// Registra o mesmo ícone apenas uma vez no atlas MapLibre.
const total = images.size;
criar({ ordem: 17, quantidade: 1, status: 'pendente' });
assert.equal(images.size, total);

console.log('PASSOU: dimensões, estado, cores e cache dos marcadores.');

// Bandeira com tecido ondulado, haste central e base oval.
assert.match(fs.readFileSync(path.resolve(__dirname, '../js/mapa/marcadores.js'), 'utf8'), /desenharBandeirola/);
assert.ok([...images.keys()].every(name => name.includes('bandeirola-premium-v3-multi')));

assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../js/mapa/marcadores.js'), 'utf8'), /function desenharBaseBandeira/);


// Popup responsivo: 12 paradas compartilham o ponto sem esmagar os botoes.
const elementos = [];
sandbox.document = {
  createElement(tag) {
    const el = {
      tag, type: '', className: '', textContent: '', hidden: false,
      children: [], eventos: {}, atributos: {}, scrollTop: 0,
      append(...filhos) { this.children.push(...filhos); },
      addEventListener(tipo, fn) { this.eventos[tipo] = fn; },
      setAttribute(nome, valor) { this.atributos[nome] = valor; }
    };
    elementos.push(el);
    return el;
  }
};
let popupTeste = null;
sandbox.maplibregl = {
  Popup: class {
    constructor(options) { this.options = options; popupTeste = this; }
    setLngLat(coordenadas) { this.coordenadas = coordenadas; return this; }
    setDOMContent(conteudo) { this.conteudo = conteudo; return this; }
    addTo() { return this; }
    remove() { this.removido = true; }
  }
};
const paradasDoze = Array.from({length: 12}, (_, i) => ({
  id: String(i + 1),
  ordemOriginal: i + 1,
  enderecoOriginal: 'Rua teste, ' + (100 + i),
  pacotes: ['PAC-' + (100 + i)]
}));
let paradaSelecionada = null;
const abriuDoze = sandbox.PacoteEMatoMarcadores.abrirDetalhesPacotes(
  mapa,
  { properties: { id: '1', ids: paradasDoze.map(p => p.id).join(',') },
    geometry: { coordinates: [-46.6, -23.5] } },
  paradasDoze,
  id => { paradaSelecionada = id; }
);
assert.equal(abriuDoze, true);
const raizPopup = popupTeste.conteudo;
const listaPopup = raizPopup.children.find(e => e.className === 'pemato-multi-popup-lista');
const botaoMais = raizPopup.children.find(e => e.className === 'pemato-multi-popup-mais');
assert.equal(listaPopup.children.length, 12);
assert.equal(listaPopup.children.filter(e => !e.hidden).length, 4, 'apenas quatro paradas inicialmente visiveis');
assert.equal(botaoMais.textContent, 'Ver todas as 12 paradas');
assert.match(raizPopup.children[0].textContent, /12 pacotes neste ponto/);
botaoMais.eventos.click();
assert.equal(listaPopup.children.filter(e => !e.hidden).length, 12, 'ao expandir todas ficam acessiveis');
assert.equal(botaoMais.atributos['aria-expanded'], 'true');
listaPopup.children[11].eventos.click();
assert.equal(paradaSelecionada, '12', 'a ultima das doze paradas pode ser escolhida');
assert.equal(popupTeste.removido, true);
console.log('PASSOU: popup compacto com 12 paradas, expansao e selecao da ultima.');
