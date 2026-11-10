const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname,'../js/exportacao/pdf-rota.js'),'utf8');
const chamadas = [], arquivos = [], documentos = [];
class PdfTeste {
  constructor(opts) { this.opts=opts; this.textos=[]; this.paginas=1; this.altura=297; this.internal={pageSize:{setHeight: h=>{this.altura=h;}}}; documentos.push(this); }
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
  for (const total of [22, 101, 150, 300, 600]) {
    const paradas = Array.from({length:total}, (_,i)=>({id:String(i+1),
      enderecoOriginal:'Rua Teste, '+(100+i),pacotes:['BR'+String(2697376300000+i)]}));
    const salvo = await window.PacoteEMatoPDF.exportar({nome:'Rota de teste',data:'2026-11-10',paradas,ordem:paradas.map(p=>p.id)});
    assert.equal(salvo.metodo,'download');
    const pdf=documentos.at(-1);
    assert.equal(pdf.opts.format,'a4');
    assert.equal(pdf.altura,297);
    if(total>22)assert.ok(pdf.paginas>1);
    assert.ok(pdf.textos.includes(String(total)), 'Última entrega preservada');
    const texto=pdf.textos.join('');
    paradas.forEach(p=>assert.ok(texto.includes(p.pacotes[0]+';'), 'Código completo preservado em Notes'));
    for(const titulo of ['#','Address','Estimated','Arrival Time','Notes'])assert.ok(pdf.textos.includes(titulo));
    assert.equal(pdf.meta.author,'Pacote É Mato');
  }
  const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
  assert.ok(!html.includes('routingExportPdfLongBtn'));
  assert.ok(!html.includes('navActionExportPdfLong'));
  assert.ok(!code.includes('paginaContinua'));
  assert.doesNotMatch(code,/navigator\.share\s*\(/);
  console.log('PASSOU: uma exportação A4, tabela de referência e todas as entregas até 600 linhas.');
})().catch(erro => { console.error(erro); process.exitCode=1; });
