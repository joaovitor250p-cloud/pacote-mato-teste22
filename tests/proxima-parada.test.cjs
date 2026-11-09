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

// A ordem de entrega avança para frente, mesmo com a 4 ainda pendente.
const inicio = nav.indexOf('  function paradaFinalizada(');
const fim = nav.indexOf('\n  function animarCardParada(',inicio);
const blocoStatus = nav.slice(inicio,fim);
const proximaInicio = nav.indexOf('  function proximaFixaAposTratar(');
const proximaFim = nav.indexOf('\n  function destinoFinalDaRota()',proximaInicio);
assert.ok(inicio>=0 && proximaInicio>=0 && proximaFim>proximaInicio);
const ambienteSequencia={resultado:null};
vm.runInNewContext(blocoStatus+'\n'+nav.slice(proximaInicio,proximaFim)+'\nresultado = proximaFixaAposTratar;',ambienteSequencia,
  {filename:'sequencia-proxima.js'});
const escolherProxima = ambienteSequencia.resultado;
const criar = (id, finalizada=false) => ({
  id:String(id),statusEntrega:finalizada?'entregue':'pendente'
});
// 4 ficou sem entrega, 5 entregue -> cursor vai para 6, não volta para 4.
const depoisDa5=[criar(4),criar(5,true),criar(6),criar(7),criar(8)];
assert.equal(escolherProxima(depoisDa5,'5','5').id,'6');
 // Mesmo que o cursor ainda esteja na 4, concluir a 5 adianta para a 6.
assert.equal(escolherProxima(depoisDa5,'4','5').id,'6');
// Abrir ou concluir a 8 fora de ordem não rouba o destaque permanente da 6.
const depoisDa8=[criar(4),criar(5,true),criar(6),criar(7),criar(8,true)];
assert.equal(escolherProxima(depoisDa8,'6','8').id,'6');
// Quando a própria próxima (6) é entregue, avança para a 7.
const depoisDa6=[criar(4),criar(5,true),criar(6,true),criar(7),criar(8,true)];
assert.equal(escolherProxima(depoisDa6,'6','6').id,'7');
// Pula a 7 caso também já esteja concluída e avança adiante.
const pulandoConcluidas=[criar(4),criar(5,true),criar(6,true),criar(7,true),criar(8)];
assert.equal(escolherProxima(pulandoConcluidas,'6','6').id,'8');
// Ao terminar o trecho sequencial, preserva a pendência antiga para revisita.
const apenasAntiga=[criar(4),criar(5,true),criar(6,true),criar(7,true)];
assert.equal(escolherProxima(apenasAntiga,'6','6').id,'4');
assert.match(nav,/const idAtivoAntes = proxima\(\)\?\.id \|\| null/);
assert.match(nav,/const proximaDepois=proximaFixaAposTratar\(paradasPorOrdem\(\), idAtivoAntes, idTratado\)/);
assert.match(nav,/proximaParadaId:rota\.proximaParadaId/);

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
assert.ok(html.includes('js/navegacao/navegacao.js?v=20261109-sequencia-18'));
console.log('PASSOU: proxima entrega sempre destacada, consulta independente e avancos de status.');
