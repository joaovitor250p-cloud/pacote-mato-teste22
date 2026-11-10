const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
function extrair(nome) {
  const start = source.indexOf('    function ' + nome + '(');
  assert.ok(start >= 0, nome);
  const end = source.indexOf('\n    }', start) + 6;
  return source.slice(start, end);
}
const contexto = { Set, Error };
vm.createContext(contexto);
vm.runInContext([
  extrair('normalizarCodigoPacoteBr'),
  extrair('extrairCodigosManifestoNotasFragmentadasV109'),
  extrair('extrairCodigosManifestoNotasPrefixo11V110'),
  // Isola a conferência da página do restante do parser de endereços.
  'function extrairAncorasCodigoPdfV73(itens) { return itens.filter(i=>i.codigo).map(i=>({codigos:[i.codigo]})); }',
  extrair('conferirPaginaPdfCompleta')
].join('\n'), contexto);
const v109 = contexto.extrairCodigosManifestoNotasFragmentadasV109;
const v110 = contexto.extrairCodigosManifestoNotasPrefixo11V110;
const conferir = contexto.conferirPaginaPdfCompleta;
assert.equal(v109([{str:'BR26973763',x:450,y:600},{str:'7885K;',x:450,y:590}],600)[0].codigo,'BR269737637885K');
assert.equal(v110([{str:'BR26995226227',x:450,y:600},{str:'88;',x:450,y:590}],600)[0].codigo,'BR2699522622788');
for (let pagina=1;pagina<=6;pagina++) {
  const codigo='BR26973763788'+pagina+'K';
  conferir([{codigo}], [{codigos:[codigo]}], 600, pagina);
}
assert.throws(()=>conferir([{codigo:'BR269737637885K'}],[],600,4),/PAGINA_PDF_INCOMPLETA\|4/);
assert.throws(()=>conferir([{str:'BR26973763',x:450,y:600}],[],600,5),/PAGINA_PDF_INCOMPLETA\|5/);
conferir([],[],600,6);
assert.match(source,/pagina <= pdf.numPages/);
assert.match(source,/conferirPaginaPdfCompleta\(itens, escolhidosPaginaV73, width, pagina\)/);
console.log('PASSOU: códigos Manifesto em duas linhas, conferência até a página 6 e bloqueio de páginas incompletas.');
