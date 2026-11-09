const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nav = fs.readFileSync(path.resolve(__dirname,'../js/navegacao/navegacao.js'),'utf8');
const html = fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const first = nav.indexOf('  function destaquesNoMapa(');
const last = nav.indexOf('\n  function atualizarFontesPontos()',first);
assert.ok(first !== -1 && last > first,'helper de duas marcacoes presente');
const helper = nav.slice(first,last)+'\nresult = destaquesNoMapa;';
const context = { result:null };
vm.runInNewContext(helper,context,{filename:'destaquesNoMapa.js'});
const calcular = context.result;

// Primeira parada ativa permanece marcada ao consultar outra.
let atual = calcular(['1'],'1','3');
let consultada = calcular(['3'],'1','3');
assert.equal(atual.current,true);
assert.equal(atual.highlighted,true);
assert.equal(atual.selected,false);
assert.equal(consultada.current,false);
assert.equal(consultada.selected,true);
assert.equal(consultada.highlighted,true);

// A próxima entrega muda quando a anterior foi concluída.
const antiga = calcular(['1'],'2','5');
const proxima = calcular(['2'],'2','5');
const outra = calcular(['5'],'2','5');
assert.equal(antiga.current,false);
assert.equal(proxima.current,true);
assert.equal(proxima.highlighted,true);
assert.equal(outra.selected,true);
assert.equal(outra.highlighted,true);

// Mesma coordenada compartilhada: ativa e consultada convivem no grupo.
const grupo = calcular(['2','5'],'2','5');
assert.equal(grupo.current,true);
assert.equal(grupo.selected,true);
assert.equal(grupo.highlighted,true);

assert.match(nav,/const LAYER_NEXT_HALO = 'pemato-nav-next-stop-halo'/);
assert.match(nav,/source:SOURCE_STOPS_SELECTED,\s*filter:\['==',\['get','current'\],true\]/);
assert.match(nav,/const LAYER_NEXT_LABEL = 'pemato-nav-next-stop-label'/);
assert.match(nav,/'text-field':'PRÓXIMA'/);
assert.match(nav,/'symbol-sort-key':\['case',\['==',\['get','current'\],true\],1000000/);
assert.match(nav,/const idAtivo = String\(p\?\.id \|\| rota\?\.proximaParadaId \|\| ''\)/);
assert.match(nav,/const idConsultado = String\(cartaoSelecionadoId/);
assert.match(nav,/const \{current,selected,highlighted\} = destaquesNoMapa/);
assert.match(nav,/cartaoSelecionadoId=proximaDepois\?\.id \|\| idTratado/);
assert.match(nav,/rota\.proximaParadaId=proximaDepois\?\.id\|\|null/);
assert.doesNotMatch(nav,/organizarPinosVisiveis/,'nao pode redistribuir pinos');
assert.ok(html.includes('js/navegacao/navegacao.js?v=20261109-proxima-16'));
console.log('PASSOU: proxima entrega sempre destacada, consulta independente e avancos de status.');
