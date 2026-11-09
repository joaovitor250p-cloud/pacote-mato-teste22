const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ler = p=>fs.readFileSync(path.resolve(__dirname,'..',p),'utf8');
const codigo = ler('js/partilhas/partilhar-paradas.js');
const html = ler('index.html');
const mapa = ler('js/mapa/mapa.js');
const nav = ler('js/navegacao/navegacao.js');
const regras = ler('docs/partilhas-firestore-regras-snippet.txt');
const capturadas = [];
const antiga = {
 id:'rota-1',nome:'Teste22',status:'ativa',
 paradas:[
  {id:'a',statusEntrega:'pendente',enderecoOriginal:'Rua A',pacotes:['BR1']},
  {id:'b',statusEntrega:'pendente',enderecoOriginal:'Rua B',pacotes:['BR2']},
  {id:'c',statusEntrega:'pendente',enderecoOriginal:'Rua C',pacotes:['BR2']}
 ],ordem:['a','b','c'],paradaSelecionadaId:'a',proximaParadaId:'a'
};
let route=JSON.parse(JSON.stringify(antiga)), activeId='rota-1';
const store={
 obterRota:async()=>JSON.parse(JSON.stringify(route)),
 obterRotaAtiva:async()=>activeId?{id:activeId}:null,
 salvarRota:async r=>{route=JSON.parse(JSON.stringify(r));capturadas.push(route);return route;}
};
const win={
 location:{origin:'https://example.com',pathname:'/pacote-mato-teste22/',search:''},
 PacoteEMatoRotaStore:store,
 crypto:{randomUUID:()=>'uuid-example'},
 localStorage:{getItem:()=>null,setItem(){}}
};
const context={window:win,document:{readyState:'loading',addEventListener(){}},
 URL,URLSearchParams,console,setTimeout,Date,Map,Set};
vm.runInNewContext(codigo,context,{filename:'partilhar-paradas.js'});
const api=win.PacoteEMatoPartilha;
assert.ok(api);
const id='A'.repeat(20);
assert.equal(api._teste.extrairId('https://example.com/pacote-mato-teste22/?partilha='+id),id);
assert.equal(api._teste.extrairId('texto invalido'),'');
const paradas=[
 {id:'1',enderecoOriginal:'Rua Frei Durao, 603',pacotes:['BR123456789BR'],observacao:'Portaria'},
 {id:'2',enderecoOriginal:'Rua Frei Durao, 603',pacotes:['BR123456789BR'],observacao:'Campainha'}
];
const importadas=api._teste.registrosDaRecepcao(paradas,id);
assert.equal(importadas.length,2);
assert.notEqual(importadas[0].id,importadas[1].id);
assert.equal(importadas[0].pacotes[0],importadas[1].pacotes[0]);
assert.equal(importadas[1].observacao,'Campainha');
assert.equal(importadas[1].partilhaId,id);
assert.equal(importadas[1].statusEntrega,'pendente');
assert.match(codigo,/status:'pendente'/);
assert.match(codigo,/modoRemocao:remocao\?'retirar':'manter'/);
assert.match(codigo,/new global.QRCode\(/);
assert.match(codigo,/a.download='Pacote É Mato - QR Partilha '/);
assert.match(codigo,/navigator\.share\(/);
assert.match(codigo,/navigator\.clipboard\.writeText\(/);
assert.match(codigo,/Html5Qrcode\(/);
assert.match(codigo,/runTransaction\(/);
assert.match(codigo,/status:'recebida',recebedorUid:auth\(\)\.uid/);
assert.match(codigo,/exigirPersistenciaLocal:true/);
assert.match(codigo,/if\(encontradas.some\(concluida\)\)/);
assert.match(regras,/allow list: if false/);
assert.match(regras,/allow get: if request.auth != null/);
assert.match(regras,/request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly/);
assert.ok(html.includes('Partilhar paradas'));
assert.ok(html.includes('Receber paradas'));
assert.ok(html.includes('js/partilhas/partilhar-paradas.js'));
assert.ok(html.includes('css/partilhar-paradas.css'));
assert.match(mapa,/mapa\.on\('dblclick', layerId, aoDuplo\)/);
assert.match(mapa,/selecionar\(id\)/);
assert.match(nav,/mapa\.on\('dblclick',layerId,duplo\)/);
(async()=>{
 const n=await api._teste.retirarRecebidasDoRemetente({id:'share-1',rotaId:'rota-1',ids:['b']});
 assert.equal(n,1);
 assert.equal(route.paradas.length,2);
 assert.deepEqual(route.ordem,['a','c']);
 assert.equal(route.paradas[1].pacotes[0],'BR2');
 assert.equal(route.precisaRecalculo,true);
 // Se a rota foi trocada, nenhuma parada pode ser apagada.
 activeId='outra-rota';
 await assert.rejects(api._teste.retirarRecebidasDoRemetente({id:'share-2',rotaId:'rota-1',ids:['c']}));
 assert.equal(route.paradas.length,2);
 // Proíbe retirar entrega que se tornou concluída após a partilha.
 activeId='rota-1';route.paradas[1].statusEntrega='entregue';
 await assert.rejects(api._teste.retirarRecebidasDoRemetente({id:'share-3',rotaId:'rota-1',ids:['c']}));
 assert.equal(route.paradas.length,2);
 console.log('PASSOU: QR, links, BR repetido, selecao por toque e retirada somente apos recibo.');
})().catch(e=>{console.error(e);process.exitCode=1;});
