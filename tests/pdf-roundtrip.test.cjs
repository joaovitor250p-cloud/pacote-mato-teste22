'use strict';
// Execute com PEMATO_JSPDF_PATH e PEMATO_PDFJS_PATH apontando para as mesmas
// bibliotecas jsPDF 2.5.1 e PDF.js 2.16.105 usadas pelo index.html.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {jsPDF}=require(process.env.PEMATO_JSPDF_PATH || 'jspdf');
const pdfjs=require(process.env.PEMATO_PDFJS_PATH || 'pdfjs-dist');
if(process.env.PEMATO_PDFJS_WORKER_PATH)pdfjs.GlobalWorkerOptions.workerSrc=process.env.PEMATO_PDFJS_WORKER_PATH;
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'js/app.js'),'utf8');
const start=source.indexOf('    function normalizarCodigoPacoteBr(');
const end=source.indexOf("    document.getElementById('pdfInput').addEventListener",start);
const parser={console};vm.createContext(parser);vm.runInContext(source.slice(start,end),parser);
let bytes;
const win={jspdf:{jsPDF},Android:{salvarPdfBase64(nome,base64){bytes=Buffer.from(base64,'base64');}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'js/exportacao/pdf-rota.js'),'utf8'),{window:win,console,Date,Map,Uint8Array,btoa:s=>Buffer.from(s,'binary').toString('base64')});
(async()=>{
 const paradas=Array.from({length:150},(_,i)=>({id:String(i+1),enderecoOriginal:(i%5===0?'Avenida Engenheiro Doutor Francisco de Albuquerque e Vasconcelos':'Rua das Acácias')+', '+(100+i)+', São Paulo',pacotes:['BR'+String(2697376300000+i)],observacao:i%7===0?'Entregar pela Rua das Rosas, 999, portão dos fundos':''}));
 for(const paginaContinua of [false,true]){
  await win.PacoteEMatoPDF.exportar({nome:'Teste de leitura',data:'2026-11-10',paradas,ordem:paradas.map(p=>p.id)},{paginaContinua});
  const doc=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
  assert.ok(paginaContinua?doc.numPages===1:doc.numPages>1);
  const registros=[];
  for(let pagina=1;pagina<=doc.numPages;pagina++){
   const page=await doc.getPage(pagina),text=await page.getTextContent();
   const itens=text.items.map(i=>({str:i.str.trim(),x:i.transform[4],y:i.transform[5]})).filter(i=>i.str);
   const width=page.getViewport({scale:1}).width;
   const rows=parser.extrairRegistrosPdfV73PorCodigo(itens,pagina,width);
   parser.conferirPaginaPdfCompleta(itens,rows,width,pagina);
   registros.push(...rows);
  }
  const result=parser.normalizarRegistrosPdfV73(registros);
  assert.equal(result.length,150);
  result.forEach((r,i)=>{
   assert.equal(r.codigos[0],paradas[i].pacotes[0]);
   const esperado=parser.decomporEnderecoFisicoPdfV71(paradas[i].enderecoOriginal);
   const lido=parser.decomporEnderecoFisicoPdfV71(r.endereco);
   assert.equal(lido.chave,esperado.chave,'Endereço da entrega '+(i+1));
  });
  console.log('PASSOU: exportar e reimportar 150 entregas, '+doc.numPages+' página(s), modo '+(paginaContinua?'longo':'A4'));
  await doc.destroy();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
