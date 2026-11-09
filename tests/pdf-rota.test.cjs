const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname,'../js/exportacao/pdf-rota.js'),'utf8');
const chamadas = [], arquivos = [], documentos = [];
class PdfTeste {
  constructor(opts) { this.opts=opts; this.textos=[]; this.paginas=1; documentos.push(this); }
  setProperties(meta) { this.meta=meta; }
  setFillColor() {}
  rect() {}
  setTextColor() {}
  setFont() {}
  setFontSize() {}
  setDrawColor() {}
  setLineWidth() {}
  line() {}
  addPage() { this.paginas++; }
  text(valor) { this.textos.push(...(Array.isArray(valor) ? valor : [valor]).map(String)); }
  splitTextToSize(valor) { return String(valor).split('\n'); }
  output(tipo) { chamadas.push('output:'+tipo); return { tipo }; }
}
const documento = {
  body: { appendChild(elemento) { arquivos.push(elemento); } },
  createElement(tipo) {
    assert.equal(tipo,'a');
    return { style:{}, click(){ chamadas.push('click'); }, remove(){ chamadas.push('remove'); } };
  }
};
const navegador = { share(){ throw Error('Compartilhamento nao permitido!'); } };
const url = { createObjectURL(){return 'blob:pdf-teste'},revokeObjectURL(){} };
const window = { jspdf:{jsPDF:PdfTeste},Android:null };
vm.runInNewContext(code,{window,document:documento,navigator:navegador,URL:url,
  setTimeout(){},console,Date,Map,Uint8Array,btoa(){}},{filename:'pdf-rota.js'});

(async () => {
  const rota = {
    nome:'Rota Manhã', data:'2026-11-09', duracaoTotalSegundos:4800,
    distanciaTotalMetros:24800, ordem:['1','2','3'],
    paradas:[
      {id:'1',enderecoOriginal:'Rua Frei Durao, 603',latitude:-23.5,longitude:-46.6,pacotes:['BR111111111BR']},
      {id:'2',enderecoOriginal:'Rua Frei Durao, 603',latitude:-23.5,longitude:-46.6,pacotes:['BR111111111BR']},
      {id:'3',enderecoOriginal:'Rua Bento Vieira, 101',latitude:-23.6,longitude:-46.7,pacotes:['BR222222222BR','BR333333333BR']}
    ]
  };
  const salvo = await window.PacoteEMatoPDF.exportar(rota);
  assert.equal(salvo.metodo,'download');
  assert.equal(arquivos.length,1);
  assert.match(arquivos[0].download,/^Pacote É Mato - /);
  assert.match(arquivos[0].download,/\.pdf$/);
  assert.ok(chamadas.includes('click'));
  assert.equal(documentos[0].meta.author,'Pacote É Mato');
  assert.equal(documentos[0].textos.filter(t=>t==='BR111111111BR').length,2,'BRs repetidos permanecem na tabela');
  assert.ok(['1','2','3','4'].every(n=>documentos[0].textos.includes(n)));
  assert.ok(documentos[0].textos.includes('ENDEREÇO'));
  assert.ok(documentos[0].textos.includes('CHEGADA'));
  assert.ok(documentos[0].textos.includes('BR / OBSERVAÇÕES'));
  assert.ok(documentos[0].textos.includes('Gerado pelo Pacote É Mato'));
  assert.doesNotMatch(code,/navigator\.share\s*\(/);
  console.log('PASSOU: PDF tabular por pacote, marca no nome e download direto.');
})().catch(erro => { console.error(erro); process.exitCode=1; });
