/* Teste dos balões sem serviços externos: node tests/marcadores.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { devicePixelRatio: 2 };
sandbox.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    const canvas = { width: 0, height: 0, fills: [] };
    const ctx = {
      scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      quadraticCurveTo() {}, closePath() {}, arc() {}, save() {}, restore() {},
      stroke() {}, fillText() {},
      fill() { canvas.fills.push(this.fillStyle); },
      measureText(text) { return { width: String(text).length * 8 }; },
      getImageData() { return { width: canvas.width, height: canvas.height, fills: canvas.fills.slice() }; }
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
  assert.equal(entry.data.width / entry.options.pixelRatio, 40);
}
assert.equal(rascunho.data.height / rascunho.options.pixelRatio, 28);
assert.equal(selecionada.data.width, pendente.data.width);
assert.ok(pendente.data.fills.includes('#168B61'));
assert.ok(selecionada.data.fills.includes('#0F7351'));
assert.ok(parcial.data.fills.includes('#e59b24'));
assert.ok(concluida.data.fills.includes('#16a34a'));
assert.ok(falhou.data.fills.includes('#dc2626'));

const longa = criar({ ordem: 1234, quantidade: 1, status: 'pendente' });
assert.equal(longa.data.width / longa.options.pixelRatio, 40);

// Registra o mesmo ícone apenas uma vez no atlas MapLibre.
const total = images.size;
criar({ ordem: 17, quantidade: 1, status: 'pendente' });
assert.equal(images.size, total);

console.log('PASSOU: dimensões, estado, cores e cache dos marcadores.');

// Bandeira com tecido ondulado, haste central e base oval.
assert.match(fs.readFileSync(path.resolve(__dirname, '../js/mapa/marcadores.js'), 'utf8'), /desenharBandeirola/);
assert.ok([...images.keys()].every(name => name.includes('bandeirola-premium-v1')));

assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../js/mapa/marcadores.js'), 'utf8'), /function desenharBaseBandeira/);
