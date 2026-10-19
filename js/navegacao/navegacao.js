(function iniciarNavegacao(global) {
  'use strict';

  let rota = null;
  let mapa = null;
  let mapReady = false;
  let contextoPerdido = false;
  let watchId = null;
  let ordemPendente = [];
  let ultimaPosicao = null;
  let posicaoAnterior = null;
  let seguirPosicao = true;
  let vozAtiva = true;
  let processandoStatus = false;
  let ultimoIdNota = '';
  let ultimoRecalculo = 0;
  let eventosForaRota = 0;
  let ultimaCentralizacao = 0;
  let ultimoRetomar = 0;
  let backgroundEm = 0;
  let reconstruindoMapa = false;
  let estadoPainelNav = 'collapsed';
  let instructionSpeechState = {instructionId:'',falouLonge:false,falouPerto:false,falouAgora:false};
  let mapLoadTimer = null;
  let fallbackBaseAtivo = false;
  let assinaturaParadasV11 = '';
  let persistenciaCartaoTimer = null;
  let ultimaPosicaoBruta = null;
  let posicaoVisual = null;
  let alvoVisual = null;
  let headingVisual = null;
  let ultimoTimestampGps = 0;
  let ultimoFrameVisual = 0;
  let rafVisual = null;
  let ultimaAtualizacaoCameraFrame = 0;
  let velocidadeVisualMs = 0;
  let modoMapaNavegacao = 'overview';
  let ultimaAssinaturaGeometriaDiagnostico = '';
  let distanciaProximaManobra = Infinity;
  let ultimoIndiceVisualRota = null;
  let ultimoProgressoVisual = null;

  const SOURCE_ROUTE = 'pemato-nav-route';
  const SOURCE_ROUTE_STATUS = 'pemato-nav-route-status';
  const SOURCE_PROGRESS = 'pemato-nav-progress';
  const SOURCE_DRIVER = 'pemato-nav-driver';
  const SOURCE_MANEUVER = 'pemato-nav-maneuver-overlay';
  const SOURCE_STOPS = 'pemato-nav-all-stops';
  const LAYER_STOPS = 'pemato-nav-stops-simple';
  const LAYER_STOPS_MULTI = 'pemato-nav-stops-multi';
  const LAYER_STOPS_ACTIVE = 'pemato-nav-stops-active';
  const LAYER_STOPS_MULTI_ACTIVE = 'pemato-nav-stops-multi-active';
  let cartaoSelecionadoId = null;
  const LAYER_ROUTE_CASE = 'pemato-nav-route-case';
  const LAYER_ROUTE = 'pemato-nav-route-layer';
  const LAYER_ROUTE_STATUS_CASE = 'pemato-nav-route-status-case';
  const LAYER_ROUTE_STATUS = 'pemato-nav-route-status-layer';
  const LAYER_PROGRESS = 'pemato-nav-progress-layer';
  const LAYER_MANEUVER_ARROW = 'pemato-nav-maneuver-arrow';
  const LAYER_MANEUVER_LABEL = 'pemato-nav-maneuver-label';
  const LAYER_DRIVER_RING = 'pemato-nav-driver-ring';
  const LAYER_DRIVER = 'pemato-nav-driver';
  const LAYER_DRIVER_DOT = 'pemato-nav-driver-dot';

  function $(id) { return document.getElementById(id); }
  function cfg() { return global.PEMATO_MAP_CONFIG || {}; }

  function registrarRetornoInterno(tag) {
    global.PacoteEMatoAppShell?.registrarRetornoInterno?.(tag || 'navegacao');
  }

  async function mostrarTutorialPacotesSeNecessario() {
    try { if (localStorage.getItem('pemato_tutorial_pacotes_qr_v58') === '1') return false; } catch (_) {}
    await global.PacoteEMatoDialog?.avisar?.({
      titulo: 'Como usar Pacotes da rota',
      mensagem: 'Escolha Adicionar pacotes ou Remover pacotes, importe a planilha dessa operação e depois bipe o QR code do pacote ou digite o código manualmente. Cada leitura marca somente os pacotes desejados para entrar ou sair da rota.',
      confirmar: 'Entendi'
    });
    try { localStorage.setItem('pemato_tutorial_pacotes_qr_v58', '1'); } catch (_) {}
    return true;
  }
  function fc(features) { return { type: 'FeatureCollection', features: features || [] }; }

  function providerAtual() { return String(global.PacoteEMatoConfiguracoes?.obter?.().navegacao || global.appState?.navegacao?.provider || 'pacote_emato'); }
  function navegacaoInternaAtiva() { return providerAtual() === 'pacote_emato' && modoMapaNavegacao === 'navigation-active'; }
  function modoOverview() { return modoMapaNavegacao === 'overview'; }

  function coordenadaValida(lat, lon) {
    if (lat === null || lat === undefined || lon === null || lon === undefined || String(lat).trim() === '' || String(lon).trim() === '') return false;
    const a = Number(lat), o = Number(lon);
    return Number.isFinite(a) && a >= -90 && a <= 90 && Number.isFinite(o) && o >= -180 && o <= 180;
  }

  function geometriaValida(g) { return global.PacoteEMatoServicoRota?.geometriaValida?.(g) === true; }
  function geometriaPontos(g) { return !geometriaValida(g) ? [] : (g.type === 'LineString' ? g.coordinates : g.coordinates.flat()); }

  function formatarDistancia(m) {
    const n = Number(m);
    if (!Number.isFinite(n)) return '—';
    if (n < 1000) return `${Math.max(0, Math.round(n))} m`;
    return `${(n / 1000).toFixed(1).replace('.', ',')} km`;
  }
  function formatarTempo(s) {
    const n = Number(s);
    if (!Number.isFinite(n)) return '—';
    const min = Math.max(0, Math.round(n / 60));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  }

  function quantidadePacotesDaParada(p) {
    return global.PacoteEMatoMarcadores?.quantidadePacotesDaParada?.(p) || 1;
  }
  function chaveFisicaMarcador(p) {
    return global.PacoteEMatoMarcadores?.chaveFisicaMarcador?.(p) || `id:${String(p?.id || '')}`;
  }

  function deslocamentoMarcador(indice) {
    if (!indice) return [0,0];
    const anel = Math.ceil(indice / 8), angulo = ((indice - 1) % 8) * Math.PI / 4;
    return [Math.round(Math.cos(angulo)*44*anel), Math.round(Math.sin(angulo)*44*anel)];
  }

  function haversine(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371000, rad = Math.PI / 180;
    const lat1 = Number(a[1]) * rad, lat2 = Number(b[1]) * rad;
    const dLat = (Number(b[1]) - Number(a[1])) * rad, dLon = (Number(b[0]) - Number(a[0])) * rad;
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function paradasPorOrdem() {
    if (!rota) return [];
    const byId = new Map((rota.paradas || []).map(p => [String(p.id), p]));
    const ids = Array.isArray(rota.ordem) && rota.ordem.length ? rota.ordem : (rota.paradas || []).map(p => p.id);
    return ids.map(id => byId.get(String(id))).filter(Boolean);
  }

  function paradaFinalizada(p) {
    return ['entregue', 'concluida', 'nao_entregue'].includes(String(p?.statusEntrega || ''));
  }

  function animarCardParada(direcao) {
    const card = $('navStopCard');
    if (!card || typeof card.animate !== 'function') return;
    try { card.getAnimations?.().forEach(a => a.cancel()); } catch (_) {}
    const x = direcao === 'left' ? 12 : direcao === 'right' ? -12 : 0;
    const frames = x
      ? [{ transform:`translate3d(${x}px,0,0)`, opacity:.90 }, { transform:'translate3d(0,0,0)', opacity:1 }]
      : [{ transform:'scale(.994)', opacity:.94 }, { transform:'scale(1)', opacity:1 }];
    card.animate(frames,{duration:180,easing:'cubic-bezier(.2,.75,.25,1)',fill:'none'});
  }

  function persistirCartaoComAtraso(){
    clearTimeout(persistenciaCartaoTimer);
    persistenciaCartaoTimer = global.setTimeout(() => {
      persistirSelecao({motivo:'troca_cartao'});
    }, 180);
  }


  // V39: a parada verde é o ponto de continuidade da corrida, não necessariamente
  // a primeira pendente da lista. Se o motorista estiver na 2, abrir a 4 e concluir
  // a 4, a 2 continua pendente/branca e a 5 passa a ser a parada ativa/verde.
  function atualizarPendentes() {
    const ordenadas = paradasPorOrdem();
    ordemPendente = ordenadas.filter(p => !paradaFinalizada(p));

    let ativa = ordenadas.find(p => String(p.id) === String(rota?.proximaParadaId || '') && !paradaFinalizada(p));
    if (!ativa) ativa = ordemPendente[0] || null;
    if (rota) rota.proximaParadaId = ativa?.id || null;

    if (global.appState?.navegacao) {
      global.appState.navegacao.paradaAtualId = ativa?.id || null;
      global.appState.navegacao.proximaParadaId = ativa?.id || null;
    }
  }
  function proxima() {
    if (!rota) return ordemPendente[0] || null;
    const ativa = paradasPorOrdem().find(p => String(p.id) === String(rota.proximaParadaId || '') && !paradaFinalizada(p));
    return ativa || ordemPendente[0] || null;
  }
  function proximaPendenteDepois(idAtual) {
    const ordenadas = paradasPorOrdem();
    const indice = ordenadas.findIndex(p => String(p.id) === String(idAtual || ''));
    if (indice >= 0) {
      for (let i = indice + 1; i < ordenadas.length; i++) {
        if (!['entregue','concluida','nao_entregue'].includes(String(ordenadas[i].statusEntrega || ''))) return ordenadas[i];
      }
    }
    return ordemPendente[0] || null;
  }

  function destinoFinalDaRota() {
    if (!rota || rota.pontoFinalConcluidoEm) return null;
    if (rota.retornarAoInicio === true && rota.pontoInicial && coordenadaValida(rota.pontoInicial.lat, rota.pontoInicial.lon)) {
      return { tipo:'retorno', descricao: rota.pontoInicial.descricao || 'Ponto de partida', lat:Number(rota.pontoInicial.lat), lon:Number(rota.pontoInicial.lon) };
    }
    if (rota.pontoFinal && coordenadaValida(rota.pontoFinal.lat, rota.pontoFinal.lon)) {
      return { tipo:'final', descricao: rota.pontoFinal.descricao || 'Ponto final', lat:Number(rota.pontoFinal.lat), lon:Number(rota.pontoFinal.lon) };
    }
    return null;
  }

  function emDestinoFinal() {
    return ordemPendente.length === 0 && !!destinoFinalDaRota();
  }

  function adicionarSource(id, data) {
    if (mapa.getSource(id)) return;
    const opcoes = { type:'geojson', data };
    if (id === SOURCE_ROUTE || id === SOURCE_ROUTE_STATUS || id === SOURCE_PROGRESS) {
      // V81 FINAL: preserve a geometria viária integral também no render do MapLibre.
      // Não simplifica curvas/rotatórias perceptíveis da resposta do provedor.
      opcoes.tolerance = 0;
      opcoes.buffer = 128;
      opcoes.maxzoom = 20;
    }
    mapa.addSource(id, opcoes);
  }
  function antesRotulos() { return (mapa.getStyle()?.layers || []).find(l => l.type === 'symbol')?.id; }

  function removerCamadas3D() {
    if (!mapa || !mapReady) return;
    try {
      global.PacoteEMatoMapaConfig?.exibirConstrucoes2D?.(mapa); global.PacoteEMatoMapaConfig?.limparPontosInteresse?.(mapa);
      (mapa.getStyle()?.layers || []).forEach(layer => {
        if (layer?.type === 'fill-extrusion' && mapa.getLayer(layer.id)) mapa.removeLayer(layer.id);
      });
      if (!navegacaoInternaAtiva()) mapa.setPitch?.(0);
    } catch (_) {}
  }

  function garantirImagemBalao() {
    if (!mapa) return;
    try {
      if (!mapa.hasImage?.('pemato-driver-arrow')) {
        const a = document.createElement('canvas'); a.width = 72; a.height = 72;
        const c = a.getContext('2d');
        if (c) {
          // HOTFIX FINAL 7: ponteiro próprio de navegação premium. Não é gota,
          // triângulo puro nem asset de terceiros. A frente do ícone é o topo.
          const corpo = new Path2D('M36 7 C40 7 44 10 46 15 L58 43 C61 51 54 59 46 56 L36 51 L26 56 C18 59 11 51 14 43 L26 15 C28 10 32 7 36 7 Z');
          const interno = new Path2D('M36 15 C39 15 41 17 42 20 L49 39 C50 43 47 47 43 45 L36 42 L29 45 C25 47 22 43 23 39 L30 20 C31 17 33 15 36 15 Z');
          c.clearRect(0,0,72,72);
          c.save();
          c.shadowColor='rgba(15,23,42,.28)'; c.shadowBlur=9; c.shadowOffsetY=3;
          c.fillStyle='#047857'; c.fill(corpo);
          c.restore();
          c.lineJoin='round'; c.lineCap='round';
          c.strokeStyle='#ffffff'; c.lineWidth=3.5; c.stroke(corpo);
          c.fillStyle='rgba(255,255,255,.16)'; c.fill(interno);
          c.beginPath(); c.arc(36,35,4.4,0,Math.PI*2); c.fillStyle='#ecfdf5'; c.fill();
          c.beginPath(); c.arc(36,35,2.1,0,Math.PI*2); c.fillStyle='#047857'; c.fill();
          mapa.addImage('pemato-driver-arrow', c.getImageData(0,0,72,72));
        }
      }
    } catch(_){ }
  }

  function desenharIconeManobraMapa(tipo) {
    const size=96, canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size;
    const c=canvas.getContext('2d'); if(!c) return null;
    const paths={
      esquerda:'M66 75 V55 C66 40 56 31 41 31 H22 M35 18 L22 31 L35 44',
      direita:'M30 75 V55 C30 40 40 31 55 31 H74 M61 18 L74 31 L61 44',
      leve_esquerda:'M65 76 V61 C65 49 59 40 49 32 L27 15 M29 36 L27 15 L48 18',
      leve_direita:'M31 76 V61 C31 49 37 40 47 32 L69 15 M67 36 L69 15 L48 18',
      acentuada_esquerda:'M68 77 V53 C68 36 57 25 40 25 H20 M34 12 L20 25 L34 38',
      acentuada_direita:'M28 77 V53 C28 36 39 25 56 25 H76 M62 12 L76 25 L62 38',
      retorno_esquerda:'M64 78 V47 C64 29 54 18 39 18 C24 18 14 28 14 43 V55 M28 42 L14 56 L6 42',
      retorno_direita:'M32 78 V47 C32 29 42 18 57 18 C72 18 82 28 82 43 V55 M68 42 L82 56 L90 42',
      saida_esquerda:'M63 78 V54 C63 39 54 31 41 31 H22 M35 18 L22 31 L35 44 M63 54 V20',
      saida_direita:'M33 78 V54 C33 39 42 31 55 31 H74 M61 18 L74 31 L61 44 M33 54 V20',
      rotatoria:'M31 29 C40 17 59 16 70 27 C82 39 81 57 68 68 C56 78 38 76 29 64 M20 36 L31 29 L34 42',
      rotatoria_saida:'M29 31 C39 17 59 17 70 28 C82 40 80 58 67 68 C58 75 45 76 36 70 M20 38 L29 31 L33 44 M61 49 L78 32 M65 31 H79 V45',
      chegada:'M31 79 V18 M34 20 H72 L62 35 L72 50 H34 M45 26 V44 M36 35 H54'
    };
    const pathText=paths[tipo]; if(!pathText) return null;
    const path=new Path2D(pathText);
    c.clearRect(0,0,size,size);
    c.save(); c.shadowColor='rgba(15,23,42,.38)'; c.shadowBlur=10; c.shadowOffsetY=2;
    c.lineCap='round'; c.lineJoin='round'; c.strokeStyle='rgba(15,23,42,.72)'; c.lineWidth=14; c.stroke(path); c.restore();
    c.lineCap='round'; c.lineJoin='round'; c.strokeStyle='#ffffff'; c.lineWidth=8; c.stroke(path);
    return c.getImageData(0,0,size,size);
  }

  function garantirImagensManobraMapa() {
    if(!mapa) return;
    const tipos=['esquerda','direita','leve_esquerda','leve_direita','acentuada_esquerda','acentuada_direita','retorno_esquerda','retorno_direita','saida_esquerda','saida_direita','rotatoria','rotatoria_saida','chegada'];
    tipos.forEach(tipo=>{
      const id=`pemato-map-maneuver-${tipo}`;
      try {
        if(mapa.hasImage?.(id)) return;
        const image=desenharIconeManobraMapa(tipo);
        if(image) mapa.addImage(id,image);
      } catch(_) {}
    });
  }

  function prepararIconesParadasV12(features) {
    return global.PacoteEMatoMarcadores?.prepararFeatures?.(mapa, features, {
      prefixo: 'pemato-nav-v12',
      propriedadeSelecao: 'highlighted',
      propriedadeIcone: 'iconV12'
    }) || features;
  }

  function adicionarSourceParadas() {
    if (!mapa || mapa.getSource(SOURCE_STOPS)) return;
    mapa.addSource(SOURCE_STOPS, {
      type:'geojson',
      data:fc([])
    });
  }

  function selecionarMarcadorNav(event) {
    const props=event?.features?.[0]?.properties||{};
    const ids=String(props.ids||props.id||'').split(',').map(v=>v.trim()).filter(Boolean);
    const id=ids[0];
    if(!id)return;
    cartaoSelecionadoId=id;
    definirAcompanhamento(false);
    animarCardParada('pulse');
    atualizarPainel();
    atualizarFontesPontos();
    persistirSelecao({motivo:'selecionar_marcador_mapa'});
  }

  function bindEventosMarcadoresNav() {
    if(!mapa||mapa.__pematoNavMarkersBound)return;
    mapa.__pematoNavMarkersBound=true;
    [LAYER_STOPS,LAYER_STOPS_MULTI,LAYER_STOPS_ACTIVE,LAYER_STOPS_MULTI_ACTIVE].forEach(layerId=>{
      mapa.on('click',layerId,selecionarMarcadorNav);
      mapa.on('mouseenter',layerId,()=>{try{mapa.getCanvas().style.cursor='pointer';}catch(_){}});
      mapa.on('mouseleave',layerId,()=>{try{mapa.getCanvas().style.cursor='';}catch(_){}});
    });
  }

  function garantirCamadas() {
    if (!mapa || !mapReady) return;
    adicionarSource(SOURCE_ROUTE, fc([])); adicionarSource(SOURCE_ROUTE_STATUS, fc([])); adicionarSource(SOURCE_PROGRESS, fc([])); adicionarSource(SOURCE_DRIVER, fc([])); adicionarSource(SOURCE_MANEUVER, fc([])); adicionarSourceParadas();
    garantirImagemBalao();
    garantirImagensManobraMapa();
    const before = antesRotulos();
    if (!mapa.getLayer(LAYER_ROUTE_CASE)) mapa.addLayer({ id:LAYER_ROUTE_CASE,type:'line',source:SOURCE_ROUTE,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':['interpolate',['linear'],['zoom'],10,3.8,13,5.2,16,7.6,18,8.6],'line-opacity':.72,'line-blur':0}}, before);
    if (!mapa.getLayer(LAYER_ROUTE)) mapa.addLayer({ id:LAYER_ROUTE,type:'line',source:SOURCE_ROUTE,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#047857','line-width':['interpolate',['linear'],['zoom'],10,2.2,13,3.4,16,5.3,18,6.2],'line-opacity':.92,'line-blur':0}}, before);
    if (!mapa.getLayer(LAYER_ROUTE_STATUS_CASE)) mapa.addLayer({ id:LAYER_ROUTE_STATUS_CASE,type:'line',source:SOURCE_ROUTE_STATUS,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':['interpolate',['linear'],['zoom'],10,4.4,13,5.9,16,8.5,18,9.5],'line-opacity':['match',['get','status'],'passado',0.06,'proxima',0.72,0.56]}}, before);
    if (!mapa.getLayer(LAYER_ROUTE_STATUS)) mapa.addLayer({ id:LAYER_ROUTE_STATUS,type:'line',source:SOURCE_ROUTE_STATUS,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['match',['get','status'],'passado','#96a69f','proxima','#047857','#047857'],'line-width':['interpolate',['linear'],['zoom'],10,2.4,13,3.7,16,5.8,18,6.6],'line-opacity':['match',['get','status'],'passado',0.07,'proxima',0.92,0.82]}}, before);
    // HOTFIX FINAL 7: a rota atrás vira histórico visual apagado. O source é
    // o mesmo snapping da geometria real; nenhuma coordenada operacional muda.
    if (!mapa.getLayer(LAYER_PROGRESS)) mapa.addLayer({ id:LAYER_PROGRESS,type:'line',source:SOURCE_PROGRESS,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#96a69f','line-width':['interpolate',['linear'],['zoom'],10,2.2,13,3.4,16,5.2,18,5.9],'line-opacity':.20,'line-blur':0}}, before);
    if (!mapa.getLayer(LAYER_MANEUVER_ARROW)) mapa.addLayer({id:LAYER_MANEUVER_ARROW,type:'symbol',source:SOURCE_MANEUVER,layout:{'icon-image':['get','icon'],'icon-size':['interpolate',['linear'],['zoom'],14,.58,16,.70,18,.82,20,.90],'icon-anchor':'center','icon-allow-overlap':true,'icon-ignore-placement':true,'icon-rotation-alignment':'map','icon-rotate':['coalesce',['get','bearing'],0],'symbol-sort-key':9998}});
    if (!mapa.getLayer(LAYER_MANEUVER_LABEL)) mapa.addLayer({id:LAYER_MANEUVER_LABEL,type:'symbol',source:SOURCE_MANEUVER,filter:['has','street'],layout:{'text-field':['get','street'],'text-size':['interpolate',['linear'],['zoom'],15,10.5,18,12.5,20,13.5],'text-offset':[0,3.15],'text-anchor':'top','text-allow-overlap':false,'text-optional':true,'symbol-sort-key':9997},paint:{'text-color':'#1f2937','text-halo-color':'rgba(255,255,255,.96)','text-halo-width':2.2,'text-halo-blur':.3}});
    if (!mapa.getLayer(LAYER_DRIVER_RING)) mapa.addLayer({ id:LAYER_DRIVER_RING,type:'circle',source:SOURCE_DRIVER,paint:{'circle-radius':['case',['==',['get','mode'],'internal'],14,11],'circle-color':['case',['==',['get','mode'],'internal'],'rgba(4,120,87,.10)','rgba(5,150,105,.16)'],'circle-stroke-color':['case',['==',['get','mode'],'internal'],'rgba(255,255,255,.95)','rgba(5,150,105,.35)'],'circle-stroke-width':['case',['==',['get','mode'],'internal'],1.4,1]} });
    if (!mapa.getLayer(LAYER_DRIVER_DOT)) mapa.addLayer({ id:LAYER_DRIVER_DOT,type:'circle',source:SOURCE_DRIVER,filter:['==',['get','mode'],'external'],paint:{'circle-radius':7,'circle-color':'#059669','circle-stroke-color':'#ffffff','circle-stroke-width':3} });
    if (!mapa.getLayer(LAYER_DRIVER)) mapa.addLayer({ id:LAYER_DRIVER,type:'symbol',source:SOURCE_DRIVER,filter:['==',['get','mode'],'internal'],layout:{'icon-image':'pemato-driver-arrow','icon-size':['interpolate',['linear'],['zoom'],12,0.52,15,0.58,18,0.64,20,0.68],'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-anchor':'center','icon-rotation-alignment':'map','icon-rotate':['coalesce',['get','heading'],0]} });
    const layoutMarcadorV12 = {
      'icon-image':['get','iconV12'],
      'icon-anchor':'center',
      'icon-size':['interpolate',['linear'],['zoom'],9,.62,12,.72,14,.86,16,1,18,1.04],
      'icon-offset': ['get','markerOffset'],
      'icon-allow-overlap':true,
      'icon-ignore-placement':true,
      'icon-padding':1,
      'symbol-sort-key':['get','order']
    };
    if(!mapa.getLayer(LAYER_STOPS)) mapa.addLayer({id:LAYER_STOPS,type:'symbol',source:SOURCE_STOPS,
      filter:['all',['<=',['get','multi'],1],['!=',['get','highlighted'],true]],
      layout:{...layoutMarcadorV12}});
    if(!mapa.getLayer(LAYER_STOPS_MULTI)) mapa.addLayer({id:LAYER_STOPS_MULTI,type:'symbol',source:SOURCE_STOPS,
      filter:['all',['>',['get','multi'],1],['!=',['get','highlighted'],true]],
      layout:{...layoutMarcadorV12}});
    if(!mapa.getLayer(LAYER_STOPS_ACTIVE)) mapa.addLayer({id:LAYER_STOPS_ACTIVE,type:'symbol',source:SOURCE_STOPS,
      filter:['all',['<=',['get','multi'],1],['==',['get','highlighted'],true]],
      layout:{...layoutMarcadorV12,'icon-allow-overlap':true,'icon-ignore-placement':true}});
    if(!mapa.getLayer(LAYER_STOPS_MULTI_ACTIVE)) mapa.addLayer({id:LAYER_STOPS_MULTI_ACTIVE,type:'symbol',source:SOURCE_STOPS,
      filter:['all',['>',['get','multi'],1],['==',['get','highlighted'],true]],
      layout:{...layoutMarcadorV12,'icon-allow-overlap':true,'icon-ignore-placement':true}});

  }

  function ocultarFallbackMapa() {
    const el = $('navMapFallback');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }

  function mostrarFallbackMapa(texto) {
    const el = $('navMapFallback');
    if (!el) return;
    el.textContent = texto || 'Mapa indisponível. Verifique sua conexão.';
    el.style.display = 'flex';
  }

  function ativarMapaBaseFallback() {
    if (!mapa || fallbackBaseAtivo || !cfg().fallbackMapStyle) return false;
    fallbackBaseAtivo = true;
    mapReady = false;
    try {
      mapa.setStyle(cfg().fallbackMapStyle);
      ocultarFallbackMapa();
      clearTimeout(mapLoadTimer);
      mapLoadTimer = setTimeout(() => {
        if (!mapReady) mostrarFallbackMapa('O mapa base não respondeu. Verifique sua conexão.');
      }, 9000);
      return true;
    } catch (erro) {
      console.warn('Pacote É Mato: falha ao ativar mapa de contingência na navegação.', erro);
      return false;
    }
  }

  // O primeiro quadro já mostra a rota, mesmo sem GPS ou rede disponíveis.
  function centroDaRota() {
    const p = ordemPendente.find(p => coordenadaValida(p.latitude, p.longitude)) || paradasPorOrdem().find(p => coordenadaValida(p.latitude, p.longitude));
    if (p && coordenadaValida(p.latitude, p.longitude)) return [Number(p.longitude), Number(p.latitude)];
    const g = normalizarGeometriaVisual(rota?.geometria);
    const c = g?.type === 'MultiLineString' ? g.coordinates?.[0]?.[0] : g?.coordinates?.[0];
    return c && coordenadaValida(c[1], c[0]) ? c : (cfg().initialCenter || [-46.6333,-23.5505]);
  }

  function enquadrarOverview(duracao = 0) {
    if (!mapa || !mapReady || navegacaoInternaAtiva()) return;
    const coords = geometriaPontos(rota?.geometria).filter(c => Array.isArray(c) && coordenadaValida(c[1], c[0]));
    if (!coords.length) {
      try { mapa.jumpTo({center:centroDaRota(),zoom:15,pitch:0,bearing:0,offset:[0,0]}); } catch (_) {}
      return;
    }
    let minLon=Infinity,minLat=Infinity,maxLon=-Infinity,maxLat=-Infinity;
    coords.forEach(c => { minLon=Math.min(minLon,Number(c[0])); maxLon=Math.max(maxLon,Number(c[0])); minLat=Math.min(minLat,Number(c[1])); maxLat=Math.max(maxLat,Number(c[1])); });
    const mobile = global.matchMedia?.('(max-width: 820px)')?.matches;
    const padding = mobile ? {top:96,right:28,bottom:245,left:28} : {top:96,right:42,bottom:42,left:42};
    try {
      mapa.stop?.();
      mapa.fitBounds([[minLon,minLat],[maxLon,maxLat]], {padding,maxZoom:16.3,pitch:0,bearing:0,duration:Math.max(0,Number(duracao)||0)});
    } catch (_) {}
  }

  function aplicarModoVisualMapa() {
    if (!mapa || !mapReady) return;
    if (navegacaoInternaAtiva()) global.PacoteEMatoMapaConfig?.aplicarEstiloNavegacaoAtiva?.(mapa);
    else global.PacoteEMatoMapaConfig?.aplicarEstiloMapaClean?.(mapa, { navegacaoAtiva:false });
  }

  function definirModoMapa(modo, opcoes = {}) {
    const modoAnterior = modoMapaNavegacao;
    modoMapaNavegacao = modo === 'navigation-active' ? 'navigation-active' : 'overview';
    assinaturaParadasV11 = '';
    document.body.dataset.pematoNavMode = modoMapaNavegacao;
    if (global.appState?.navegacao) global.appState.navegacao.modo = modoMapaNavegacao;
    aplicarModoVisualMapa();
    if (modoMapaNavegacao === 'navigation-active') {
      definirPainelNav('collapsed');
      if (opcoes.acompanhar !== false) definirAcompanhamento(true);
      const nearestInicial=nearestOnRoute(ultimaPosicao,{visual:true});
      atualizarInstrucao(nearestInicial);
      if(nearestInicial) atualizarProgressoVisual(nearestInicial);
      acompanharCamera(Number(opcoes.duracao || 0));
    } else {
      definirAcompanhamento(false);
      definirPainelNav('expanded');
      ultimoProgressoVisual = null;
      setSource(SOURCE_PROGRESS, fc([]));
      setSource(SOURCE_MANEUVER, fc([]));
      if (modoAnterior === 'navigation-active') moduloVozNavegacao()?.limparEstado?.({cancelar:true});
      desenharRota(); // restaura a geometria completa no overview
      enquadrarOverview(Number(opcoes.duracao || 0));
    }
    atualizarBotaoVoz();
    atualizarBotaoFollow();
    atualizarFontesPontos();
  }

  function atualizarTermino() {
    const el = $('navRouteEtaTime');
    const fim = Number(rota?.horarioTerminoEstimado);
    if (el) el.textContent = fim > 0 && Number.isFinite(fim)
      ? new Date(fim).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '—';
    posicionarSobreposicoes();
  }

  function posicionarSobreposicoes() {
    const wrap = $('mapaNavegacao')?.parentElement;
    const card = wrap?.querySelector('.nav-maneuver-card');
    if (!wrap || !card) return;
    const topo = Math.max(100, card.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top + 14);
    wrap.style.setProperty('--nav-overlay-top', `${topo}px`);
  }

  function garantirMapa() {
    const container = $('mapaNavegacao');
    if (!container || mapa || !global.maplibregl) return mapa;
    try {
      ocultarFallbackMapa();
      fallbackBaseAtivo = false;
      mapReady = false;
      clearTimeout(mapLoadTimer);
      mapa = new global.maplibregl.Map({
        container,
        // V18: volta para a mesma base vetorial que funcionava na V14.
        style: cfg().mapStyleUrl,
        center: centroDaRota(),
        zoom: 15,
        pitch: 0,
        bearing: 0,
        maxPitch: 60,
        dragRotate: true,
        touchPitch: true,
        attributionControl: true,
        fadeDuration: 120
      });
      contextoPerdido = false;
      mapa.on('webglcontextlost', () => { contextoPerdido = true; });
      mapa.on('webglcontextrestored', () => { contextoPerdido = false; });
      mapa.touchZoomRotate?.enableRotation?.();
      ['dragstart','zoomstart','rotatestart','pitchstart'].forEach(nome => mapa.on(nome, explorarMapa));
      mapa.on('zoomend', () => { atualizarProgressoVisual(nearestOnRoute(ultimaPosicao,{visual:true})); });

      const ready = () => {
        mapReady = true;
        clearTimeout(mapLoadTimer);
        ocultarFallbackMapa();
        assinaturaParadasV11 = '';
        removerCamadas3D();
        garantirCamadas();
        bindEventosMarcadoresNav();
        aplicarModoVisualMapa();
        try { mapa.resize(); mapa.triggerRepaint?.(); } catch (_) {}
        desenharRota();
        atualizarFontesPontos();
        if (navegacaoInternaAtiva()) acompanharCamera(0);
        else enquadrarOverview(0);
      };

      mapa.on('load', ready);
      mapa.on('style.load', ready);

      // Se o estilo principal realmente não montar, só então cai para OSM.
      // Não trocamos de mapa por erros isolados de fonte/glyph/tile.
      mapLoadTimer = setTimeout(() => {
        if (mapReady) return;
        if (!ativarMapaBaseFallback()) mostrarFallbackMapa('O mapa base não respondeu. Verifique sua conexão.');
      }, 9000);

      mapa.on('error', ev => {
        const mensagem = ev?.error?.message || String(ev?.error || '');
        console.warn('Pacote É Mato: falha no mapa de navegação.', mensagem);
        if (!mapReady) {
          // Dá tempo para o estilo principal terminar antes de acionar contingência.
          setTimeout(() => {
            if (!mapReady && !fallbackBaseAtivo) ativarMapaBaseFallback();
          }, 1800);
        }
      });
    } catch (erro) {
      console.error('Pacote É Mato: erro ao iniciar mapa de navegação.', erro);
      mostrarFallbackMapa(erro?.message || 'Não foi possível abrir o mapa.');
    }
    return mapa;
  }

  function setSource(id, data) { if (!mapa || !mapReady) return; garantirCamadas(); mapa.getSource(id)?.setData?.(data); }

  function limparLinhaRota(linha) {
    const limpa = [];
    (linha || []).forEach(coord => {
      if (!Array.isArray(coord) || coord.length < 2) return;
      const lon = Number(coord[0]), lat = Number(coord[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return;
      const atual = [lon, lat];
      const anterior = limpa[limpa.length - 1];
      if (!anterior || haversine(anterior, atual) > 0.35) limpa.push(atual);
    });
    return limpa;
  }

  function normalizarGeometriaVisual(g) {
    if (!geometriaValida(g)) return null;
    const orig = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    const partes = orig.map(limparLinhaRota).filter(linha => linha.length >= 2);
    if (!partes.length) return null;

    const distanciaCoord = (a, b) => haversine(a, b);
    const unidas = [];
    let atual = partes[0].slice();
    const LIMITE_JUNCAO_M = 8;
    for (let i = 1; i < partes.length; i++) {
      let proxima = partes[i].slice();
      const fim = atual[atual.length - 1];
      const dInicio = distanciaCoord(fim, proxima[0]);
      const dFim = distanciaCoord(fim, proxima[proxima.length - 1]);
      if (Math.min(dInicio, dFim) <= LIMITE_JUNCAO_M) {
        if (dFim < dInicio) proxima.reverse();
        const d = distanciaCoord(atual[atual.length - 1], proxima[0]);
        atual.push(...(d <= 0.35 ? proxima.slice(1) : proxima));
      } else {
        unidas.push(atual);
        atual = proxima;
      }
    }
    unidas.push(atual);
    return unidas.length === 1 ? { type:'LineString', coordinates:unidas[0] } : { type:'MultiLineString', coordinates:unidas };
  }

  function divisaoVisualDaRota(nearest) {
    const coords = geometriaPontos(rota?.geometria);
    if (!coords.length || !nearest?.point) return null;
    const indice = Math.max(0, Math.min(coords.length - 2, Number(nearest.index) || 0));
    const snapped = [Number(nearest.point[0]), Number(nearest.point[1])];
    if (!Number.isFinite(snapped[0]) || !Number.isFinite(snapped[1])) return null;

    const dedupe = lista => {
      const saida = [];
      (lista || []).forEach(coord => {
        if (!Array.isArray(coord) || coord.length < 2) return;
        const atual = [Number(coord[0]), Number(coord[1])];
        if (!Number.isFinite(atual[0]) || !Number.isFinite(atual[1])) return;
        const anterior = saida[saida.length - 1];
        if (!anterior || haversine(anterior, atual) > 0.05) saida.push(atual);
      });
      return saida;
    };

    const passados = dedupe([...coords.slice(0, indice + 1), snapped]);
    const futuros = dedupe([snapped, ...coords.slice(indice + 1)]);
    const t = Math.max(0, Math.min(1, Number(nearest.t) || 0));
    const progressIndex = indice + t;
    const progressFraction = coords.length > 1 ? Math.max(0, Math.min(1, progressIndex / (coords.length - 1))) : 0;
    return { coords, indice, t, snapped, passados, futuros, progressIndex, progressFraction };
  }

  function aplicarDivisaoVisualRota(nearest) {
    if (!navegacaoInternaAtiva()) return false;
    const divisao = divisaoVisualDaRota(nearest);
    if (!divisao) return false;
    ultimoProgressoVisual = { index:divisao.indice, t:divisao.t, point:divisao.snapped.slice() };

    const passadoFeature = divisao.passados.length >= 2
      ? {type:'Feature',properties:{status:'passado',origem:'progress-split-v81'},geometry:{type:'LineString',coordinates:divisao.passados}}
      : null;
    const futuroFeature = divisao.futuros.length >= 2
      ? {type:'Feature',properties:{status:'proxima',origem:'progress-split-v81'},geometry:{type:'LineString',coordinates:divisao.futuros}}
      : null;

    // SOURCE_ROUTE_STATUS conserva o significado de "próxima leg", mas a parte
    // anterior ao motorista é recortada pelo MESMO snapped point da rota principal.
    const segmentosOriginais = global.PacoteEMatoMarcadores?.segmentosStatusDaRota?.(rota) || [];
    const segmentoProxima = segmentosOriginais.find(feature => String(feature?.properties?.status || '') === 'proxima');
    let statusFuturoCoords = [];
    if (segmentoProxima?.geometry) {
      const linhas = segmentoProxima.geometry.type === 'LineString'
        ? [segmentoProxima.geometry.coordinates]
        : (segmentoProxima.geometry.type === 'MultiLineString' ? segmentoProxima.geometry.coordinates : []);
      const statusCoords = linhas.flat().filter(c=>Array.isArray(c)&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1]))).map(c=>[Number(c[0]),Number(c[1])]);
      if (statusCoords.length >= 2) {
        const nearestStatus = nearestNoIntervalo(statusCoords,{lon:divisao.snapped[0],lat:divisao.snapped[1]},0,statusCoords.length-2);
        if (nearestStatus && Number(nearestStatus.distance) <= 120) statusFuturoCoords = [nearestStatus.point,...statusCoords.slice(nearestStatus.index+1)];
        else statusFuturoCoords = []; // segurança: nunca redesenhar uma leg verde inteira atrás do motorista.
      }
    }
    const statusFuturoFeature = statusFuturoCoords.length >= 2
      ? {type:'Feature',properties:{status:'proxima',origem:'status-proxima-recortado-v81'},geometry:{type:'LineString',coordinates:statusFuturoCoords}}
      : null;

    // FINAL 8: uma única divisão visual controla TODAS as layers de rota.
    // Assim SOURCE_ROUTE_STATUS não consegue recolocar verde forte atrás do veículo.
    setSource(SOURCE_PROGRESS, fc(passadoFeature ? [passadoFeature] : []));
    setSource(SOURCE_ROUTE, fc(futuroFeature ? [{...futuroFeature,properties:{origem:'rota-futura-v81'}}] : []));
    setSource(SOURCE_ROUTE_STATUS, fc([passadoFeature, statusFuturoFeature].filter(Boolean)));

    global.diagnosticoRotaVisualV81 = {
      progressIndex: divisao.progressIndex,
      progressFraction: divisao.progressFraction,
      routeFutureCoordinates: divisao.futuros.map(c=>c.slice()),
      routePastCoordinates: divisao.passados.map(c=>c.slice()),
      routeStatusFutureCoordinates: statusFuturoCoords.map(c=>c.slice()),
      routeStatusPastCoordinates: divisao.passados.map(c=>c.slice()),
      driverSnappedCoordinate: divisao.snapped.slice()
    };
    return true;
  }

  function desenharRota() {
    if (!mapa || !mapReady) return;
    const g = normalizarGeometriaVisual(rota?.geometria);
    const segmentosStatus = global.PacoteEMatoMarcadores?.segmentosStatusDaRota?.(rota) || [];
    const progress = navegacaoInternaAtiva() ? ultimoProgressoVisual : null;
    if (!(progress && aplicarDivisaoVisualRota(progress))) {
      const routeData = fc(g ? [{type:'Feature',properties:{},geometry:g}] : []);
      setSource(SOURCE_ROUTE, routeData);
      setSource(SOURCE_ROUTE_STATUS, fc(segmentosStatus));
      if (!navegacaoInternaAtiva()) setSource(SOURCE_PROGRESS, fc([]));
    }

    try {
      const pontos = g?.type === 'LineString' ? g.coordinates.length : (g?.coordinates || []).reduce((n,l)=>n+(l?.length||0),0);
      const assinatura = `${g?.type||'none'}:${pontos}:${segmentosStatus.length}:${navegacaoInternaAtiva()?'active':'overview'}`;
      if (assinatura !== ultimaAssinaturaGeometriaDiagnostico) {
        ultimaAssinaturaGeometriaDiagnostico = assinatura;
        global.diagnosticoNavegacaoV81 = Object.assign(global.diagnosticoNavegacaoV81 || {}, {
          SOURCE_ROUTE:{type:g?.type||null,pontos,origem:'rota.geometria'},
          SOURCE_ROUTE_STATUS:{type:'FeatureCollection',features:segmentosStatus.length,origem:navegacaoInternaAtiva()?'progress-split-v81':'segmentosStatusDaRota'},
          SOURCE_PROGRESS:global.diagnosticoNavegacaoV81?.SOURCE_PROGRESS || {type:'FeatureCollection',pontos:0},
          modo:modoMapaNavegacao
        });
        console.info('[PACOTE É MATO][NAVEGAÇÃO][GEOMETRIA]', global.diagnosticoNavegacaoV81);
      }
    } catch (_) {}
  }

  function atualizarFonteMotoristaVisual() {
    if (!mapa || !mapReady) return;
    const pos = posicaoVisual || ultimaPosicao;
    const valido = pos && coordenadaValida(pos.lat, pos.lon);
    setSource(SOURCE_DRIVER, fc(valido ? [{
      type:'Feature',
      properties:{heading:Number.isFinite(Number(headingVisual)) ? Number(headingVisual) : direcaoCamera(),mode:navegacaoInternaAtiva()?'internal':'external'},
      geometry:{type:'Point',coordinates:[Number(pos.lon),Number(pos.lat)]}
    }] : []));
  }

  function atualizarFontesPontos() {
    if (!mapa || !mapReady) return;
    const p = proxima();
    atualizarFonteMotoristaVisual();
    const ordenadas = paradasPorOrdem();
    const grupos = new Map();
    ordenadas.forEach((stop, i) => {
      if (!coordenadaValida(stop.latitude, stop.longitude)) return;
      const key = chaveFisicaMarcador(stop);
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push({ stop, order: i + 1 });
    });
    const ocupacaoVisual = new Map();
    const features = [];
    grupos.forEach(grupo => {
      grupo.sort((a,b) => a.order - b.order);
      const ativos = grupo.filter(item => !['entregue','concluida','nao_entregue'].includes(String(item.stop?.statusEntrega || '')));
      const grupoVisual = ativos.length ? ativos : grupo;
      // V41: o verde pertence à continuidade da corrida, não ao card aberto.
      // Ex.: se a 28 foi concluída, a 29 continua verde mesmo quando o motorista
      // desliza e consulta a parada 5. Se ele concluir a 4 fora de ordem, a 2
      // continua pendente/branca e a 5 passa a ser a continuação verde.
      const idAtivo = String(p?.id || rota?.proximaParadaId || '');
      const idConsultado = String(cartaoSelecionadoId || global.appState?.navegacao?.paradaExibidaId || '');
      const consultada = grupo.find(item => String(item.stop?.id) === idConsultado);
      const ativa = grupo.find(item => String(item.stop?.id) === idAtivo);
      const principal = consultada || ativa || grupoVisual[0];
      const stop = principal.stop;
      const multi = grupoVisual.reduce((total,item) => total + quantidadePacotesDaParada(item.stop), 0);
      const lat = Number(stop.latitude), lon = Number(stop.longitude);
      // V40: sem deslocamento dinâmico. O balão fica ancorado na coordenada
      // real da parada e não muda de posição ao selecionar, entregar ou recalcular.
      const stackIndex = 0;
      const ids = grupo.map(item => String(item.stop.id));
      const current = ids.includes(idAtivo);
      const selected = ids.includes(idConsultado) && idConsultado !== '';
      // V47: dois verdes independentes. A parada ativa da corrida permanece verde
      // e a parada consultada pelo motorista também fica verde sem substituir a ativa.
      features.push({type:'Feature',properties:{id:String(stop.id),ids:ids.join(','),order:principal.order,multi,stackIndex,markerOffset:[0,0],status:stop.statusEntrega||'pendente',current,selected,highlighted:(current||selected)},geometry:{type:'Point',coordinates:[lon,lat]}});
    });
    let featuresVisiveis = features;
    if (navegacaoInternaAtiva()) {
      const ordenadasPendentes = paradasPorOrdem().filter(stop => !paradaFinalizada(stop));
      const indiceAtivo = ordenadasPendentes.findIndex(stop => String(stop.id) === String(p?.id || ''));
      const proximaDepois = indiceAtivo >= 0 ? ordenadasPendentes[indiceAtivo + 1] : ordenadasPendentes[1];
      const permitidos = new Set([p?.id, proximaDepois?.id, cartaoSelecionadoId].filter(Boolean).map(String));
      featuresVisiveis = features.filter(feature => String(feature?.properties?.ids || feature?.properties?.id || '').split(',').some(id => permitidos.has(String(id))));
    }
    prepararIconesParadasV12(featuresVisiveis);
    const assinatura = `${modoMapaNavegacao}|` + featuresVisiveis.map(f => {
      const p = f.properties || {};
      const c = f.geometry?.coordinates || [];
      return `${p.id}:${p.order}:${p.multi}:${p.status||''}:${p.current?1:0}:${p.selected?1:0}:${p.highlighted?1:0}:${p.iconV12||''}:${c[0]}:${c[1]}`;
    }).join('|');
    if (assinatura !== assinaturaParadasV11) {
      assinaturaParadasV11 = assinatura;
      setSource(SOURCE_STOPS, fc(featuresVisiveis));
    }
  }

  function nearestNoIntervalo(coords, pos, inicio, fim) {
    if (!coords.length || !pos) return null;
    const lon0 = Number(pos.lon), lat0 = Number(pos.lat), rad = Math.PI/180;
    const cos = Math.cos(lat0*rad), kx=111320*cos, ky=110540;
    let best={distance:Infinity,index:Math.max(0,inicio||0),t:0,point:coords[Math.max(0,inicio||0)]};
    const de=Math.max(0,Math.min(coords.length-2,Number(inicio||0)));
    const ate=Math.max(de,Math.min(coords.length-2,Number(fim ?? coords.length-2)));
    for(let i=de;i<=ate;i++){
      const a=coords[i], b=coords[i+1];
      const ax=(a[0]-lon0)*kx, ay=(a[1]-lat0)*ky, bx=(b[0]-lon0)*kx, by=(b[1]-lat0)*ky;
      const dx=bx-ax, dy=by-ay, den=dx*dx+dy*dy;
      const t=den?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/den)):0;
      const px=ax+t*dx, py=ay+t*dy, d=Math.hypot(px,py);
      if(d<best.distance) best={distance:d,index:i,t,point:[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]};
    }
    return best;
  }

  function nearestOnRoute(pos, opcoes = {}) {
    const coords = geometriaPontos(rota?.geometria);
    if (!coords.length || !pos) return null;
    const globalBest = () => nearestNoIntervalo(coords, pos, 0, coords.length - 2);
    if (opcoes.visual !== true || !navegacaoInternaAtiva() || !Number.isFinite(Number(ultimoIndiceVisualRota))) return globalBest();

    // Map matching SOMENTE visual: procura primeiro perto do progresso anterior para
    // não saltar para outro trecho quando a rota cruza a si mesma.
    const anterior = Number(ultimoIndiceVisualRota);
    const local = nearestNoIntervalo(coords, pos, anterior - 35, anterior + 220);
    const limiteLocal = Math.max(45, Math.min(110, Number(pos?.accuracy || 0) * 2.5 + 25));
    let escolhido = local;
    if (!local || Number(local.distance) > limiteLocal) escolhido = globalBest();
    if (escolhido) {
      if (escolhido.index < anterior - 30 && local && Number(local.distance) <= limiteLocal * 1.35) escolhido = local;
      ultimoIndiceVisualRota = Number(escolhido.index);
    }
    return escolhido;
  }


  function distanciaAoLongo(coords, fromIndex, toIndex, firstPoint) {
    if (!coords.length) return Infinity;
    let i=Math.max(0,Math.min(coords.length-1,Number(fromIndex||0))), fim=Math.max(i,Math.min(coords.length-1,Number(toIndex||i)));
    let total=0, atual=firstPoint || coords[i];
    for(let j=i+1;j<=fim;j++){ total+=haversine(atual,coords[j]); atual=coords[j]; }
    return total;
  }

  function instrucaoAtual(nearest) {
    const lista=Array.isArray(rota?.instrucoes)?rota.instrucoes:[];
    if(!lista.length) return null;
    if(!nearest) return lista[0];
    return lista.find(inst => Number.isFinite(Number(inst.toIndex)) && Number(inst.toIndex)>=nearest.index) || lista[lista.length-1];
  }

  function atualizarProgressoVisual(nearest) {
    const coords=geometriaPontos(rota?.geometria);
    if(!mapa||!mapReady||!coords.length||!nearest){
      ultimoProgressoVisual=null;
      setSource(SOURCE_PROGRESS,fc([]));
      return;
    }
    if(navegacaoInternaAtiva()) aplicarDivisaoVisualRota(nearest);
    else {
      ultimoProgressoVisual=null;
      setSource(SOURCE_PROGRESS,fc([]));
    }
    try {
      const diag=global.diagnosticoRotaVisualV81||{};
      global.diagnosticoNavegacaoV81 = Object.assign(global.diagnosticoNavegacaoV81 || {}, {
        SOURCE_PROGRESS:{type:'LineString',pontos:Array.isArray(diag.routePastCoordinates)?diag.routePastCoordinates.length:0,origem:'projeção visual única sobre rota.geometria'},
        modo:modoMapaNavegacao
      });
    } catch (_) {}
  }

  function moduloVozNavegacao() { return global.PacoteEMatoVozNavegacao || null; }
  function vozDisponivel() { return moduloVozNavegacao()?.disponivel?.() === true; }
  function contextoVozNavegacao() {
    return {
      navigationMode: modoMapaNavegacao,
      navegacaoInternaAtiva: navegacaoInternaAtiva(),
      vozNavegacaoAtiva: vozAtiva === true,
      temInstrucaoValida: Array.isArray(rota?.instrucoes) && rota.instrucoes.length > 0,
      modulo: String(document.body.dataset.pematoModule || ''),
      provider: providerAtual()
    };
  }
  moduloVozNavegacao()?.configurarContexto?.(contextoVozNavegacao);
  function falar(texto, chave, opcoes = {}) {
    if (!navegacaoInternaAtiva() || !vozAtiva || !texto) return false;
    const modulo = moduloVozNavegacao();
    if (!modulo) return false;
    const key = String(chave || 'navegacao');
    const corte = key.lastIndexOf(':');
    const especial = /^(?:route|stop):/.test(key);
    const instructionId = String(opcoes.instructionId || (especial ? key : (corte > 0 ? key.slice(0, corte) : key)));
    const fase = String(opcoes.fase || (corte > 0 ? key.slice(corte + 1) : 'agora'));
    return modulo.falarInstrucaoNavegacao({instructionId,fase,texto,urgente:opcoes.urgente===true,minIntervaloMs:opcoes.minIntervaloMs||1800});
  }

  function tipoGeoapifyNormalizado(inst) {
    return String(inst?.tipo || inst?.type || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^a-z0-9]+/gi,' ')
      .trim()
      .toLowerCase();
  }

  function tipoGeoapifyCompacto(inst) {
    return tipoGeoapifyNormalizado(inst).replace(/\s+/g,'');
  }

  function valorSaidaRotatoria(inst) {
    const bruto = inst?.roundabout_exit ?? inst?.exitNumber ?? inst?.exit_number;
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    const n = Number(String(valor ?? '').match(/\d+/)?.[0]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function nomeRuaInstrucao(inst, {fallbackTexto=false}={}) {
    const streets = Array.isArray(inst?.streets) ? inst.streets : (inst?.streets ? [inst.streets] : []);
    const exitRoadName = Array.isArray(inst?.exitRoadName) ? inst.exitRoadName : (inst?.exitRoadName ? [inst.exitRoadName] : []);
    const candidatos=[streets[0],inst?.street_name,inst?.rua,inst?.name,exitRoadName[0]];
    const achada=candidatos.map(v=>String(v||'').trim()).find(Boolean);
    if (achada) return achada;
    if (!fallbackTexto) return '';
    return String(inst?.transition_instruction || inst?.pre_transition_instruction || inst?.texto || '').trim();
  }

  function tipoVisualManobra(inst) {
    const tipo = tipoGeoapifyCompacto(inst);
    const mapaTipos = {
      none:'reta', startat:'reta', straight:'reta', merge:'reta', ferryenter:'reta', ferryexit:'reta',
      startatright:'direita', startatleft:'esquerda',
      slightright:'leve_direita', stayright:'leve_direita', mergeright:'leve_direita',
      slightleft:'leve_esquerda', stayleft:'leve_esquerda', mergeleft:'leve_esquerda',
      right:'direita', exitright:'saida_direita', left:'esquerda', exitleft:'saida_esquerda',
      sharpright:'acentuada_direita', sharpleft:'acentuada_esquerda',
      turnaroundright:'retorno_direita', turnaroundleft:'retorno_esquerda',
      destinationreached:'chegada', destinationreachedright:'chegada', destinationreachedleft:'chegada'
    };
    if (tipo === 'roundabout') return valorSaidaRotatoria(inst) ? 'rotatoria_saida' : 'rotatoria';
    if (mapaTipos[tipo]) return mapaTipos[tipo];

    // Fallback textual somente quando o tipo real não existe. Nunca inventa uma direção.
    const mod = String(inst?.modificador || inst?.modifier || inst?.direcao || '').toLowerCase();
    const texto = String(inst?.texto || inst?.transition_instruction || '').toLocaleLowerCase('pt-BR');
    const tudo = `${tipo} ${mod} ${texto}`;
    if (/(arrive|arrival|destination|chegada|chegue|destino)/.test(tudo)) return 'chegada';
    if (/u[- ]?turn|retorno|retorne|meia volta/.test(tudo)) return /left|esquer/.test(tudo)?'retorno_esquerda':'retorno_direita';
    if (/roundabout|rotary|rotat[oó]ria|rotatoria/.test(tudo)) return valorSaidaRotatoria(inst) ? 'rotatoria_saida' : 'rotatoria';
    if (/sharp\s*left|acentuad.+esquer/.test(tudo)) return 'acentuada_esquerda';
    if (/sharp\s*right|acentuad.+direit/.test(tudo)) return 'acentuada_direita';
    if (/slight\s*left|stay\s*left|merge\s*left|leve.+esquer/.test(tudo)) return 'leve_esquerda';
    if (/slight\s*right|stay\s*right|merge\s*right|leve.+direit/.test(tudo)) return 'leve_direita';
    if (/exit\s*left|sa[ií]da.+esquer/.test(tudo)) return 'saida_esquerda';
    if (/exit\s*right|sa[ií]da.+direit/.test(tudo)) return 'saida_direita';
    if (/\bleft\b|esquerda/.test(tudo)) return 'esquerda';
    if (/\bright\b|direita/.test(tudo)) return 'direita';
    return 'reta';
  }

  function svgManobra(tipo) {
    const base='viewBox="0 0 64 64" focusable="false" aria-hidden="true" role="img"';
    const comum='fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';
    const paths={
      reta:'<path d="M32 55V10M20 22l12-12 12 12"/>',
      esquerda:'<path d="M46 54V38c0-10-7-17-17-17H13M24 10L13 21l11 11"/>',
      direita:'<path d="M18 54V38c0-10 7-17 17-17h16M40 10l11 11-11 11"/>',
      leve_esquerda:'<path d="M43 54V42c0-9-4-15-11-21L16 9M18 25L16 9l16 2"/>',
      leve_direita:'<path d="M21 54V42c0-9 4-15 11-21L48 9M46 25l2-16-16 2"/>',
      acentuada_esquerda:'<path d="M48 54V35c0-11-7-18-18-18H12M24 6L12 17l12 12"/>',
      acentuada_direita:'<path d="M16 54V35c0-11 7-18 18-18h18M40 6l12 11-12 12"/>',
      retorno_direita:'<path d="M20 55V30c0-12 7-19 18-19s18 7 18 18v7M45 25l11 11 8-11"/>',
      retorno_esquerda:'<path d="M44 55V30c0-12-7-19-18-19S8 18 8 29v7M19 25L8 36 0 25"/>',
      saida_direita:'<path d="M22 55V35c0-10 6-16 16-16h12M40 9l10 10-10 10"/><path d="M22 35V14"/>',
      saida_esquerda:'<path d="M42 55V35c0-10-6-16-16-16H14M24 9L14 19l10 10"/><path d="M42 35V14"/>',
      rotatoria_entrada:'<path d="M32 58V47"/><path d="M19 20a18 18 0 1 1-2 23M10 22l9-2 2 9"/>',
      rotatoria:'<path d="M19 20a18 18 0 1 1-2 23M10 22l9-2 2 9"/><path d="M32 10V4"/>',
      rotatoria_saida:'<path d="M19 20a18 18 0 1 1 10 29M10 22l9-2 2 9"/><path d="M40 36l16-16M44 18h12v12"/>',
      chegada:'<path d="M16 56V9M19 11h31l-7 11 7 11H19"/><path d="M27 17h8M35 17v8M27 25h8"/>'
    };
    return `<svg ${base} ${comum}>${paths[tipo] || paths.reta}</svg>`;
  }

  function fraseBaseManobra(inst) {
    const tipo=tipoGeoapifyCompacto(inst);
    const saida=valorSaidaRotatoria(inst);
    if(tipo==='roundabout') return saida?`Na rotatória, pegue a ${saida}ª saída`:'Entre na rotatória';
    const frases={
      startat:'Siga em frente',startatright:'Siga à direita',startatleft:'Siga à esquerda',straight:'Continue em frente',
      slightright:'Mantenha-se à direita',right:'Vire à direita',sharpright:'Faça uma curva acentuada à direita',
      turnaroundright:'Faça o retorno',turnaroundleft:'Faça o retorno',
      sharpleft:'Faça uma curva acentuada à esquerda',left:'Vire à esquerda',slightleft:'Mantenha-se à esquerda',
      exitright:'Pegue a saída à direita',exitleft:'Pegue a saída à esquerda',
      stayright:'Mantenha-se à direita',stayleft:'Mantenha-se à esquerda',
      merge:'Entre na via',mergeright:'Entre à direita',mergeleft:'Entre à esquerda',
      destinationreached:'Você chegou ao destino',destinationreachedright:'Você chegou ao destino',destinationreachedleft:'Você chegou ao destino'
    };
    return frases[tipo] || 'Siga a rota destacada';
  }

  function fraseManobra(inst, {comRua=true,pontuar=false}={}) {
    const base=fraseBaseManobra(inst);
    const rua=nomeRuaInstrucao(inst);
    const tipo=tipoGeoapifyCompacto(inst);
    let frase=base;
    if(comRua && rua && !/^destinationreached/.test(tipo)) {
      if(tipo==='roundabout' && valorSaidaRotatoria(inst)) frase += ` para ${rua}`;
      else if(/^(straight|startat)$/.test(tipo)) frase += ` pela ${rua}`;
      else if(/^(slightright|slightleft|stayright|stayleft|mergeright|mergeleft|merge)$/.test(tipo)) frase += ` para ${rua}`;
      else if(!/^turnaround/.test(tipo)) frase += ` na ${rua}`;
    }
    return pontuar && !/[.!?]$/.test(frase) ? `${frase}.` : frase;
  }

  function idInstrucaoVoz(inst) {
    return [inst?.legIndex ?? 'x',inst?.stepIndex ?? 'x',inst?.globalFromIndex ?? inst?.fromIndex ?? 'x',tipoGeoapifyCompacto(inst)||'none'].join(':');
  }

  function distanciaNaturalFala(metros) {
    const d=Math.max(0,Number(metros)||0);
    if(d<80) return Math.max(20,Math.round(d/10)*10);
    if(d<180) return Math.round(d/20)*20;
    return Math.round(d/50)*50;
  }

  function limitesFalaPorVelocidade() {
    const kmh=Math.max(0,Number(velocidadeVisualMs||0)*3.6);
    if(kmh>=70) return {longe:430,perto:170,agora:65};
    if(kmh>=45) return {longe:360,perto:140,agora:50};
    if(kmh>=20) return {longe:310,perto:115,agora:40};
    return {longe:260,perto:90,agora:30};
  }

  function retaRelevante(lista, indice) {
    const inst=lista[indice];
    if(tipoGeoapifyCompacto(inst)!=='straight') return true;
    const rua=nomeRuaInstrucao(inst).toLocaleLowerCase('pt-BR');
    const anterior=nomeRuaInstrucao(lista[indice-1]).toLocaleLowerCase('pt-BR');
    return !!rua && rua!==anterior;
  }

  function atualizarDiagnosticoManobra(inst, tipoVisual, fraseVisual, fraseTTS, distancia, fase) {
    global.diagnosticoNavegacaoVozV81 = Object.assign(global.diagnosticoNavegacaoVozV81 || {}, {
      instructionId:idInstrucaoVoz(inst),legIndex:inst?.legIndex??null,stepIndex:inst?.stepIndex??null,
      typeBruto:inst?.type||inst?.tipo||'',modifierBruto:inst?.modifier||inst?.modificador||'',tipoVisual,fraseVisual,fraseTTS,
      rua:nomeRuaInstrucao(inst),distancia:Number.isFinite(Number(distancia))?Number(distancia):null,faseFalando:fase||'idle',
      falouLonge:instructionSpeechState.falouLonge,falouPerto:instructionSpeechState.falouPerto,falouAgora:instructionSpeechState.falouAgora,
      speechSynthesisDisponivel:vozDisponivel()
    });
  }

  function atualizarDiagnosticoManobrasReal() {
    try {
      const lista=Array.isArray(rota?.instrucoes)?rota.instrucoes:[];
      global.diagnosticoManobrasReal=lista.map(inst=>({
        legIndex:inst?.legIndex??null,
        stepIndex:inst?.stepIndex??null,
        typeBruto:inst?.type||inst?.tipo||'',
        modifierBruto:inst?.modifier||inst?.modificador||'',
        texto:inst?.texto||'',
        rua:nomeRuaInstrucao(inst),
        fromIndexLeg:inst?.fromIndexLeg??inst?.from_index??null,
        toIndexLeg:inst?.toIndexLeg??inst?.to_index??null,
        globalFromIndex:inst?.globalFromIndex??null,
        globalToIndex:inst?.globalToIndex??null,
        tipoVisual:tipoVisualManobra(inst),
        svgEscolhido:svgManobra(tipoVisualManobra(inst))
      }));
    } catch (_) {}
  }

  function indiceGlobalInstrucao(inst, campo) {
    const globalCampo = campo === 'from' ? inst?.globalFromIndex : inst?.globalToIndex;
    const legado = campo === 'from' ? (inst?.fromIndex ?? inst?.from_index) : (inst?.toIndex ?? inst?.to_index);
    return Number.isFinite(Number(globalCampo)) ? Number(globalCampo) : (Number.isFinite(Number(legado)) ? Number(legado) : null);
  }

  function indiceInstrucaoAtual(nearest) {
    const lista=Array.isArray(rota?.instrucoes)?rota.instrucoes:[];
    if(!lista.length) return -1;
    if(!nearest) return 0;
    const idx=lista.findIndex(inst => {
      const to = indiceGlobalInstrucao(inst, 'to');
      return to != null && to >= nearest.index;
    });
    return idx >= 0 ? idx : lista.length - 1;
  }

  function manobraImportanteNoMapa(tipo) {
    return ['esquerda','direita','leve_esquerda','leve_direita','acentuada_esquerda','acentuada_direita','retorno_esquerda','retorno_direita','saida_esquerda','saida_direita','rotatoria','rotatoria_saida'].includes(String(tipo||''));
  }

  function pontoAntesDaManobra(coords, indiceDestino, metrosAntes=18) {
    if(!Array.isArray(coords)||!coords.length) return null;
    const fim=Math.max(0,Math.min(coords.length-1,Number(indiceDestino)||0));
    let restante=Math.max(0,Number(metrosAntes)||0);
    let atual=coords[fim];
    for(let i=fim-1;i>=0;i--){
      const anterior=coords[i];
      const trecho=haversine({lon:anterior[0],lat:anterior[1]},{lon:atual[0],lat:atual[1]});
      if(Number.isFinite(trecho)&&trecho>0){
        if(trecho>=restante){
          const t=restante/trecho;
          const ponto=[atual[0]+(anterior[0]-atual[0])*t,atual[1]+(anterior[1]-atual[1])*t];
          const bearing=bearingEntre({lon:anterior[0],lat:anterior[1]},{lon:atual[0],lat:atual[1]}) ?? 0;
          return {point:ponto,bearing,index:i};
        }
        restante-=trecho;
      }
      atual=anterior;
    }
    const a=coords[Math.max(0,fim-1)]||coords[fim], b=coords[fim];
    return {point:coords[0],bearing:bearingEntre({lon:a[0],lat:a[1]},{lon:b[0],lat:b[1]})??0,index:0};
  }

  function atualizarOverlayManobraMapa(inst, nearest) {
    if(!mapa||!mapReady||!navegacaoInternaAtiva()||!inst){setSource(SOURCE_MANEUVER,fc([]));return;}
    const tipo=tipoVisualManobra(inst);
    if(!manobraImportanteNoMapa(tipo)){setSource(SOURCE_MANEUVER,fc([]));return;}
    const coords=geometriaPontos(rota?.geometria);
    const toIndex=indiceGlobalInstrucao(inst,'to');
    if(toIndex==null||!coords[toIndex]){setSource(SOURCE_MANEUVER,fc([]));return;}
    const distanciaAtual=nearest?distanciaAoLongo(coords,nearest.index,toIndex,nearest.point):Number(inst?.distance??inst?.distancia??Infinity);
    // Só mostra a seta quando ela é útil ao motorista, evitando vários overlays.
    if(Number.isFinite(distanciaAtual)&&distanciaAtual>520){setSource(SOURCE_MANEUVER,fc([]));return;}
    const alvo=pontoAntesDaManobra(coords,toIndex,tipo.startsWith('rotatoria')?12:18);
    if(!alvo?.point){setSource(SOURCE_MANEUVER,fc([]));return;}
    const rua=nomeRuaInstrucao(inst);
    const feature={type:'Feature',properties:{icon:`pemato-map-maneuver-${tipo}`,bearing:Number(alvo.bearing)||0,street:rua||'',tipo,distancia:Number.isFinite(distanciaAtual)?Math.max(0,distanciaAtual):null},geometry:{type:'Point',coordinates:alvo.point}};
    setSource(SOURCE_MANEUVER,fc([feature]));
    global.diagnosticoOverlayManobraV81={tipo,rua,distancia:feature.properties.distancia,bearing:feature.properties.bearing,coordinates:alvo.point,toIndex,nearestIndex:nearest?.index??null};
  }

  function atualizarInstrucao(nearest) {
    const lista=Array.isArray(rota?.instrucoes)?rota.instrucoes:[];
    atualizarDiagnosticoManobrasReal();
    const indice=indiceInstrucaoAtual(nearest);
    const inst=indice>=0?lista[indice]:null;
    const proximaInst=indice>=0?lista[indice+1]:null;
    const coords=geometriaPontos(rota?.geometria);
    const toIndex=inst ? indiceGlobalInstrucao(inst, 'to') : null;
    const dist=inst&&nearest&&toIndex!=null?distanciaAoLongo(coords,nearest.index,toIndex,nearest.point):Number(inst?.distancia ?? inst?.distance ?? NaN);
    distanciaProximaManobra = Number.isFinite(dist) ? Math.max(0, dist) : Infinity;

    const tipoVisual=tipoVisualManobra(inst);
    const ruaAtual=nomeRuaInstrucao(inst,{fallbackTexto:true});
    const fraseVisual=fraseManobra(inst,{comRua:true,pontuar:false});
    const fraseTTS=fraseManobra(inst,{comRua:true,pontuar:true});

    if($('navManeuverText')) $('navManeuverText').textContent=ruaAtual||'Próxima manobra';
    if($('navManeuverStreet')) $('navManeuverStreet').textContent=fraseVisual;
    if($('navManeuverDistance')) $('navManeuverDistance').textContent=Number.isFinite(dist)?formatarDistancia(dist):'—';
    if($('navManeuverIcon')) $('navManeuverIcon').innerHTML=svgManobra(tipoVisual);
    atualizarOverlayManobraMapa(inst, nearest);

    const after=$('navManeuverAfter');
    if(after){
      const atualTo=inst?indiceGlobalInstrucao(inst,'to'):null;
      const proxTo=proximaInst?indiceGlobalInstrucao(proximaInst,'to'):null;
      const gap=atualTo!=null&&proxTo!=null&&coords[atualTo]?distanciaAoLongo(coords,atualTo,proxTo,coords[atualTo]):Number(proximaInst?.distancia??proximaInst?.distance??Infinity);
      const mostrarSegunda=!!proximaInst && (!Number.isFinite(gap) || gap<=700);
      if(mostrarSegunda){
        after.hidden=false;
        if($('navManeuverNextIcon')) $('navManeuverNextIcon').innerHTML=svgManobra(tipoVisualManobra(proximaInst));
        if($('navManeuverNextStreet')) $('navManeuverNextStreet').textContent=fraseManobra(proximaInst,{comRua:true,pontuar:false});
      } else after.hidden=true;
    }

    if(inst&&Number.isFinite(dist)&&navegacaoInternaAtiva()){
      const instructionId=idInstrucaoVoz(inst);
      const modulo=moduloVozNavegacao();
      modulo?.definirInstrucaoAtual?.(instructionId);
      if(instructionSpeechState.instructionId!==instructionId) instructionSpeechState={instructionId,falouLonge:false,falouPerto:false,falouAgora:false};
      const limites=limitesFalaPorVelocidade();
      const podeFalar=retaRelevante(lista,indice);
      let fase='idle', textoFalado='';
      const atualTo=indiceGlobalInstrucao(inst,'to');
      const proxTo=proximaInst?indiceGlobalInstrucao(proximaInst,'to'):null;
      const gapSegunda=atualTo!=null&&proxTo!=null&&coords[atualTo]?distanciaAoLongo(coords,atualTo,proxTo,coords[atualTo]):Infinity;
      const segundaUtil=proximaInst&&Number.isFinite(gapSegunda)&&gapSegunda<=Math.max(100,Math.min(180,limites.perto+35));
      const depois=segundaUtil?` Depois, ${fraseManobra(proximaInst,{comRua:true,pontuar:true}).replace(/^./,c=>c.toLocaleLowerCase('pt-BR'))}`:'';

      const confirmarFaseFalou = faseConfirmada => {
        if (instructionSpeechState.instructionId !== instructionId) return;
        if (faseConfirmada === 'agora') instructionSpeechState.falouAgora = true;
        if (faseConfirmada === 'perto') instructionSpeechState.falouPerto = true;
        if (faseConfirmada === 'longe') instructionSpeechState.falouLonge = true;
      };
      if(podeFalar && dist<=limites.agora && !instructionSpeechState.falouAgora){
        fase='agora'; textoFalado=`${fraseTTS}${depois}`;
        modulo?.falarInstrucaoNavegacao?.({instructionId,fase,texto:textoFalado,urgente:true,minIntervaloMs:1200,onStarted:()=>confirmarFaseFalou('agora')});
      } else if(podeFalar && dist<=limites.perto && !instructionSpeechState.falouPerto){
        fase='perto'; textoFalado=`Em ${distanciaNaturalFala(dist)} metros, ${fraseTTS.charAt(0).toLocaleLowerCase('pt-BR')+fraseTTS.slice(1)}${depois}`;
        modulo?.falarInstrucaoNavegacao?.({instructionId,fase,texto:textoFalado,minIntervaloMs:2500,onStarted:()=>confirmarFaseFalou('perto')});
      } else if(podeFalar && dist<=limites.longe && dist>limites.perto+35 && !instructionSpeechState.falouLonge){
        fase='longe'; textoFalado=`Em ${distanciaNaturalFala(dist)} metros, ${fraseTTS.charAt(0).toLocaleLowerCase('pt-BR')+fraseTTS.slice(1)}`;
        modulo?.falarInstrucaoNavegacao?.({instructionId,fase,texto:textoFalado,minIntervaloMs:3000,onStarted:()=>confirmarFaseFalou('longe')});
      }
      atualizarDiagnosticoManobra(inst,tipoVisual,fraseVisual,textoFalado||fraseTTS,dist,fase);
    } else if(inst) atualizarDiagnosticoManobra(inst,tipoVisual,fraseVisual,fraseTTS,dist,'idle');
  }


  function definirAcompanhamento(ativo) {
    seguirPosicao = ativo;
    if(global.appState?.navegacao) global.appState.navegacao.seguirPosicao = ativo;
    atualizarBotaoFollow();
  }
  function atualizarBotaoFollow() {
    const b=$('navFollowBtn');
    if(b){ b.hidden=seguirPosicao; b.title='Recentralizar e acompanhar'; b.setAttribute('aria-label','Recentralizar e acompanhar'); }
  }
  function explorarMapa(event) {
    if(event?.originalEvent) definirAcompanhamento(false);
  }
  function normalizarAngulo(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? ((n % 360) + 360) % 360 : null;
  }

  function interpolarAnguloCircular(atual, alvo, alpha) {
    const a = normalizarAngulo(atual), b = normalizarAngulo(alvo);
    if (b == null) return a ?? 0;
    if (a == null) return b;
    const delta = ((b - a + 540) % 360) - 180;
    return normalizarAngulo(a + delta * Math.max(0, Math.min(1, alpha)));
  }

  function direcaoCamera() {
    if (Number.isFinite(Number(headingVisual))) return Number(headingVisual);
    const h = ultimaPosicao?.heading;
    if(h != null && Number.isFinite(Number(h))) return Number(h);
    const pos = ultimaPosicao || {lon:centroDaRota()[0],lat:centroDaRota()[1]};
    const perto=nearestOnRoute(pos,{visual:true}), pontos=geometriaPontos(rota?.geometria);
    if(perto && perto.distance < 100 && pontos[perto.index+1]) {
      const a=pontos[perto.index], b=pontos[perto.index+1];
      return bearingEntre({lon:a[0],lat:a[1]},{lon:b[0],lat:b[1]}) ?? mapa?.getBearing?.() ?? 0;
    }
    return mapa?.getBearing?.() || 0;
  }

  function zoomNavegacaoInterna() {
    const kmh = Math.max(0, Number(velocidadeVisualMs || 0) * 3.6);
    let zoom = 18.35;
    if (kmh < 12) zoom = 18.65;
    else if (kmh < 28) zoom = 18.55;
    else if (kmh < 50) zoom = 18.42;
    else if (kmh < 75) zoom = 18.30;
    else zoom = 18.20;
    // Próximo à manobra abre só o necessário para manter veículo + cruzamento.
    if (distanciaProximaManobra < 120) zoom = Math.min(zoom, 18.32);
    if (distanciaProximaManobra < 55) zoom = Math.min(zoom, 18.22);
    return zoom;
  }

  function offsetCameraInterna() {
    const container=$('mapaNavegacao');
    const area=container?.getBoundingClientRect();
    if(!area?.height) return [0,0];
    const painel=$('navigationPanel')?.getBoundingClientRect();
    const manobra=container.parentElement?.querySelector('.nav-maneuver-card')?.getBoundingClientRect();
    const topo=Math.max(0,(manobra?.bottom || area.top)-area.top)+18;
    const sobrepoe=painel && painel.left<area.right && painel.right>area.left && painel.top<area.bottom;
    const fundo=sobrepoe ? Math.max(topo+120, painel.top-area.top-18) : area.height-18;
    const yDesejado=topo+(fundo-topo)*0.70;
    return [0,yDesejado-area.height/2];
  }

  function deslocarPontoVisual(pos, bearing, metros) {
    if(!pos || !Number.isFinite(Number(bearing)) || !(metros > 0)) return [Number(pos?.lon),Number(pos?.lat)];
    const R=6378137, br=Number(bearing)*Math.PI/180, lat1=Number(pos.lat)*Math.PI/180, lon1=Number(pos.lon)*Math.PI/180, d=metros/R;
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
    const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
    return [lon2*180/Math.PI,lat2*180/Math.PI];
  }

  function acompanharCamera(duracao=0) {
    if(!seguirPosicao || !mapa || !mapReady) return;
    const interna=navegacaoInternaAtiva();
    const visual=posicaoVisual || ultimaPosicao;
    const recente=visual && Date.now()-Number(visual.at || ultimaPosicao?.at || 0)<30000;
    const bearing=interna?direcaoCamera():0;
    const kmh=Math.max(0,Number(velocidadeVisualMs||0)*3.6);
    const frente=kmh<15?42:kmh<45?58:kmh<75?72:88;
    const center=recente?(interna?deslocarPontoVisual(visual,bearing,frente):[Number(visual.lon),Number(visual.lat)]):centroDaRota();
    const opcoes={
      center,
      zoom:interna?zoomNavegacaoInterna():16,
      pitch:interna?56:0,
      bearing,
      offset:interna?offsetCameraInterna():[0,0]
    };
    try {
      if (duracao > 0) {
        mapa.stop?.();
        mapa.easeTo({...opcoes,duration:duracao,easing:t=>1-Math.pow(1-t,3)});
      } else {
        mapa.jumpTo(opcoes);
      }
    } catch (_) {}
  }

  function atualizarBotaoVoz(){
    const b=$('navVoiceBtn'); if(!b)return;
    const interna=navegacaoInternaAtiva();
    const modulo=moduloVozNavegacao();
    const diag=modulo?.diagnostico?.()||{};
    b.style.display=interna?'':'none';
    b.classList.toggle('active',vozAtiva&&interna);
    if(!modulo?.disponivel?.()) b.textContent='Voz indisponível';
    else if(vozAtiva&&['initializing','retrying'].includes(String(diag.ttsState||''))) b.textContent='Inicializando voz...';
    else b.textContent=vozAtiva?'Voz ativa':'Voz muda';
    b.setAttribute('aria-pressed',vozAtiva?'true':'false');
  }

  function detalhesDaParada(p) {
    if (!p) return '';
    const itens = [];
    const add = valor => {
      const texto = String(valor || '').trim();
      if (!texto) return;
      if (!itens.some(item => item.toLocaleLowerCase('pt-BR') === texto.toLocaleLowerCase('pt-BR'))) itens.push(texto);
    };
    add(p.complemento);
    if (p.bloco) add(`Bloco ${p.bloco}`);
    if (p.apartamento) add(`Apartamento ${p.apartamento}`);
    if (p.sala) add(`Sala ${p.sala}`);
    if (p.loja) add(`Loja ${p.loja}`);
    const vis = new Set(Array.isArray(rota?.camposVisiveisParada) ? rota.camposVisiveisParada : ['pacote','endereco','bairro','cidade']);
    if (vis.has('atId') && p.atId) add(`AT ID: ${p.atId}`);
    if (vis.has('sequenceOrigem') && p.sequenceOrigem && p.sequenceOrigem !== '-') add(`Sequence: ${p.sequenceOrigem}`);
    if (vis.has('stopOrigem') && p.stopOrigem && p.stopOrigem !== '-') add(`Stop: ${p.stopOrigem}`);
    if (vis.has('pacote') && (p.pacotes || []).length) add(`SPX TN: ${(p.pacotes || []).join(', ')}`);
    const localParts=[]; if(vis.has('bairro')&&p.bairro)localParts.push(p.bairro); if(vis.has('cidade')&&p.cidade)localParts.push(p.cidade); if(vis.has('cep')&&p.cep)localParts.push(p.cep);
    const local = localParts.map(v => String(v || '').trim()).filter(Boolean).join(' · ');
    if (local) add(local);
    if (vis.has('latitude') && vis.has('longitude') && coordenadaValida(p.latitude,p.longitude)) add(`GPS: ${Number(p.latitude).toFixed(6)}, ${Number(p.longitude).toFixed(6)}`);
    return itens.join('\n');
  }

  function observacaoClienteDaParada(p) {
    if (!p) return '';
    const itens = [];
    const add = valor => {
      const texto = String(valor || '').trim();
      if (!texto) return;
      const norm = texto.toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
      // Evita repetir um pedaço de uma observação maior. Ex.: se já temos
      // "T3 ROMA APTO 402", não adiciona novamente apenas "APTO 402".
      if (itens.some(v => {
        const atual = String(v || '').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
        return atual === norm || atual.includes(norm) || norm.includes(atual);
      })) return;
      itens.push(texto);
    };

    // Campo de observação da planilha é sempre prioritário.
    add(p.observacao);

    // Complementos operacionais também são instruções úteis para o entregador.
    if (p.apartamento) add(/^ap(?:to|artamento)?\b/i.test(String(p.apartamento)) ? p.apartamento : `Ap ${p.apartamento}`);
    if (p.bloco) add(/^bloco\b/i.test(String(p.bloco)) ? p.bloco : `Bloco ${p.bloco}`);
    if (p.sala) add(/^sala\b/i.test(String(p.sala)) ? p.sala : `Sala ${p.sala}`);
    if (p.loja) add(/^loja\b/i.test(String(p.loja)) ? p.loja : `Loja ${p.loja}`);
    add(p.complemento);

    // Algumas planilhas trazem o apartamento/instrução dentro do endereço.
    // Captura somente trechos claramente operacionais, sem copiar o endereço inteiro.
    const endereco = String(p.enderecoOriginal || '');
    const padroes = [
      /\b(?:ap|apt|apto|apartamento)\.?\s*[-º°#:]?\s*[a-z0-9-]+/ig,
      /\bbloco\s*[-º°#:]?\s*[a-z0-9-]+/ig,
      /\b(?:casa|sala|loja)\s*[-º°#:]?\s*[a-z0-9-]+/ig,
      /\b(?:tocar|toque)\s+(?:a\s+)?campainha\b[^,;|]*/ig,
      /\b(?:ligar|chamar|interfone|portaria)\b[^,;|]*/ig
    ];
    padroes.forEach(re => (endereco.match(re) || []).forEach(add));
    return itens.join(' · ');
  }

  function atualizarPainel() {
    atualizarTermino();
    atualizarPendentes();
    const destinoFinal = destinoFinalDaRota();
    if (!ordemPendente.length && destinoFinal) {
      if ($('navStopNumber')) $('navStopNumber').textContent = destinoFinal.tipo === 'retorno' ? 'RETORNO À BASE' : 'DESTINO FINAL';
      if ($('navNextAddress')) $('navNextAddress').textContent = destinoFinal.descricao;
      if ($('navNextComplement')) $('navNextComplement').textContent = 'Depois da última entrega · não faz parte da bipagem';
      if ($('navCustomerObservationText')) $('navCustomerObservationText').textContent = 'Ponto final da rota. Toque em Cheguei quando encerrar o deslocamento.';
      if ($('navCustomerObservation')) $('navCustomerObservation').classList.remove('is-empty');
      if ($('navNextPackages')) $('navNextPackages').textContent = '0 pacotes';
      if ($('navStopCard')) $('navStopCard').dataset.status = 'ponto_final';
      const badge = $('navStopStatusBadge');
      if (badge) { badge.className='nav-stop-status-badge is-pending'; badge.textContent='Destino final'; }
      const entregar = $('navDeliveredBtn'); if (entregar) { entregar.style.display=''; entregar.textContent='Cheguei'; }
      const falha = $('navNotDeliveredBtn'); if (falha) falha.style.display='none';
      const desfazer = $('navUndoStatusBtn'); if (desfazer) desfazer.style.display='none';
      const nota = $('navDeliveryNote'); if (nota) nota.value='';
      if ($('navExtrasPanel')) $('navExtrasPanel').style.display='none';
      if (global.appState?.navegacao) { global.appState.navegacao.paradaExibidaId=null; global.appState.navegacao.proximaParadaId=null; }
      atualizarFontesPontos();
      return;
    }
    const p=paradasPorOrdem().find(s=>String(s.id)===String(cartaoSelecionadoId)) || proxima();
    const pos=paradasPorOrdem().findIndex(s=>String(s.id)===String(p?.id));
    if($('navStopNumber')) $('navStopNumber').textContent=pos>=0?`PARADA ${String(pos+1).padStart(2,'0')}`:'SEM PARADA';
    if($('navNextAddress')) $('navNextAddress').textContent=p?.enderecoOriginal||'Nenhuma parada pendente';
    if($('navNextComplement')) $('navNextComplement').textContent=detalhesDaParada(p);
    const obsCliente = observacaoClienteDaParada(p);
    if($('navCustomerObservationText')) $('navCustomerObservationText').textContent = obsCliente || 'Sem observações do cliente.';
    if($('navCustomerObservation')) $('navCustomerObservation').classList.toggle('is-empty', !obsCliente);
    if($('navNextPackages')) {
      const quantidadeFisica = p ? (global.PacoteEMatoOperacoesPacotes?.quantidadePacotesFisicos?.(rota, p) ?? (p?.pacotes?.length || 0)) : 0;
      $('navNextPackages').textContent = `${quantidadeFisica} ${quantidadeFisica === 1 ? 'pacote' : 'pacotes'}`;
    }
    if($('navStopCard')) $('navStopCard').dataset.status = String(p?.statusEntrega || 'pendente');
    atualizarStatusCard(p);
    if(global.appState?.navegacao){global.appState.navegacao.paradaExibidaId=p?.id||null;global.appState.navegacao.proximaParadaId=proxima()?.id||null;}
    const idNota=String(p?.id||'');
    if(idNota!==ultimoIdNota){ultimoIdNota=idNota;if($('navDeliveryNote'))$('navDeliveryNote').value=String(p?.observacaoEntrega||'');}
    const list=$('navInstructions'); if(list){list.replaceChildren();(Array.isArray(rota?.instrucoes)?rota.instrucoes.slice(0,5):[]).forEach((inst,i)=>{const item=document.createElement('div');item.className='nav-instruction';const n=document.createElement('span');n.textContent=String(i+1);const t=document.createElement('div'),strong=document.createElement('strong'),meta=document.createElement('small');strong.textContent=inst.texto||'Continue';meta.textContent=`${formatarDistancia(inst.distancia)} · ${formatarTempo(inst.tempo)}`;t.append(strong,meta);item.append(n,t);list.append(item);});}
    atualizarFontesPontos();
  }

  function mostrarConclusao() {
    if(!rota) return;
    const entregues=(rota.paradas||[]).filter(p=>['entregue','concluida'].includes(p.statusEntrega)).length;
    const falhas=(rota.paradas||[]).filter(p=>p.statusEntrega==='nao_entregue').length;
    if($('navCompletionDelivered')) $('navCompletionDelivered').textContent=String(entregues);
    if($('navCompletionFailed')) $('navCompletionFailed').textContent=String(falhas);
    if($('navCompletionTotal')) $('navCompletionTotal').textContent=String(rota.paradas?.length||0);
    const percorrida = Number(rota.distanciaPercorridaMetros || 0);
    const inicio = Number(global.appState?.navegacao?.iniciadaEm || rota.iniciadoEm || 0);
    const execucao = inicio ? Math.max(0, Math.round((Date.now() - inicio) / 1000)) : null;
    if($('navCompletionDistance')) $('navCompletionDistance').textContent=formatarDistancia(percorrida > 0 ? percorrida : rota.distanciaTotalMetros);
    if($('navCompletionTime')) $('navCompletionTime').textContent=formatarTempo(execucao ?? rota.duracaoTotalSegundos);
    const modal=$('navCompletionBackdrop'); if(modal) modal.style.display='flex';
    if(global.appState?.navegacao) global.appState.navegacao.conclusaoPendente=true;
    falar('Todas as paradas foram tratadas. Revise os resultados antes de finalizar a rota.','route:complete');
  }

  async function recalcular(motivo) {
    if(!rota||!ultimaPosicao||!global.PacoteEMatoServicoRota) return false;
    atualizarPendentes();
    const destinoFinal = destinoFinalDaRota();
    if(!ordemPendente.length && !destinoFinal) return false;
    const points=[{lat:ultimaPosicao.lat,lon:ultimaPosicao.lon}];
    ordemPendente.forEach(p=>{if(coordenadaValida(p.latitude,p.longitude))points.push({lat:Number(p.latitude),lon:Number(p.longitude)});});
    if(destinoFinal) points.push({lat:Number(destinoFinal.lat),lon:Number(destinoFinal.lon)});
    if(points.length<2) return false;
    const btn=$('navRecalculateBtn');
    const textoBtn=btn?.textContent||'Recalcular rota';
    if(btn){btn.disabled=true;btn.textContent='Recalculando...';}
    if($('navGpsStatus')) $('navGpsStatus').textContent='Recalculando trajeto pelas ruas...';
    try{
      moduloVozNavegacao()?.limparEstado?.({cancelar:true});
      instructionSpeechState={instructionId:'',falouLonge:false,falouPerto:false,falouAgora:false};
      const response=await global.PacoteEMatoServicoRota.calcularRotaPelasRuas(rota,points), feature=response.feature;
      rota.geometria=feature.geometry; rota.distanciaTotalMetros=Number(feature.properties?.distance||0); rota.duracaoDirecaoSegundos=Number(feature.properties?.time||0);
      rota.pernas=Array.isArray(feature.properties?.legs)?feature.properties.legs:[]; rota.instrucoes=global.PacoteEMatoServicoRota.extrairInstrucoes(feature); ultimoIndiceVisualRota=null; ultimoProgressoVisual=null; rota.recalculadoEm=Date.now();
      const pendentesAgora=ordemPendente.length; rota.duracaoParadasSegundos=pendentesAgora*Number(rota.tempoParadaSegundos||0);
      rota.duracaoTotalSegundos=Number(rota.duracaoDirecaoSegundos||0)+Number(rota.duracaoParadasSegundos||0);
      rota.horarioTerminoEstimado=Date.now()+rota.duracaoTotalSegundos*1000;
      await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});
      desenharRota();
      if(navegacaoInternaAtiva()){
        const nearestNovo=nearestOnRoute(ultimaPosicao,{visual:true});
        if(nearestNovo){atualizarProgressoVisual(nearestNovo);atualizarInstrucao(nearestNovo);}
      }
      atualizarPainel(); ultimoRecalculo=Date.now(); eventosForaRota=0;
      if($('navGpsStatus')) $('navGpsStatus').textContent=motivo==='desvio'?'Rota recalculada após desvio':'Rota atualizada';
      return true;
    }catch(erro){global.notificar?.(erro?.message||'Não foi possível recalcular a rota.'); if($('navGpsStatus')) $('navGpsStatus').textContent='Não foi possível recalcular'; return false;}
    finally{if(btn){btn.disabled=false;btn.textContent=textoBtn;}}
  }

  function bearingEntre(a,b){
    if(!a||!b) return null;
    const rad=Math.PI/180; const lat1=Number(a.lat)*rad,lat2=Number(b.lat)*rad;
    const dLon=(Number(b.lon)-Number(a.lon))*rad;
    const y=Math.sin(dLon)*Math.cos(lat2);
    const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
    const deg=(Math.atan2(y,x)/rad+360)%360;
    return Number.isFinite(deg)?deg:null;
  }

  function alvoVisualDaPosicao(raw, nearest) {
    if (!raw) return null;
    const accuracy = Math.max(0, Number(raw.accuracy || 0));
    const limiteMatch = Math.max(16, Math.min(45, accuracy * 1.35 + 6));
    let lon = Number(raw.lon), lat = Number(raw.lat), matched = false;
    if (navegacaoInternaAtiva() && nearest?.point && Number(nearest.distance) <= limiteMatch) {
      lon = Number(nearest.point[0]);
      lat = Number(nearest.point[1]);
      matched = true;
    }
    let heading = normalizarAngulo(raw.heading);
    if (matched && (heading == null || Number(velocidadeVisualMs || 0) < 4)) {
      const pontos=geometriaPontos(rota?.geometria);
      const a=pontos[nearest.index], b=pontos[nearest.index+1];
      if(a&&b) heading=bearingEntre({lon:a[0],lat:a[1]},{lon:b[0],lat:b[1]}) ?? heading;
    }
    return {lat,lon,heading,at:raw.at,matched};
  }

  function iniciarInterpolacaoVisual() {
    if (rafVisual != null) return;
    ultimoFrameVisual = 0;
    const frame = (agoraFrame) => {
      rafVisual = null;
      if (!alvoVisual) return;
      if (!ultimoFrameVisual) ultimoFrameVisual = agoraFrame;
      const dt=Math.max(8,Math.min(120,agoraFrame-ultimoFrameVisual));
      ultimoFrameVisual=agoraFrame;
      if(!posicaoVisual) posicaoVisual={...alvoVisual};
      const alphaPos=1-Math.exp(-dt/170);
      posicaoVisual.lat += (Number(alvoVisual.lat)-Number(posicaoVisual.lat))*alphaPos;
      posicaoVisual.lon += (Number(alvoVisual.lon)-Number(posicaoVisual.lon))*alphaPos;
      posicaoVisual.at=alvoVisual.at;
      headingVisual=interpolarAnguloCircular(headingVisual, alvoVisual.heading, 1-Math.exp(-dt/230));
      atualizarFonteMotoristaVisual();
      if(seguirPosicao&&navegacaoInternaAtiva()&&mapa&&mapReady&&agoraFrame-ultimaAtualizacaoCameraFrame>=70){
        ultimaAtualizacaoCameraFrame=agoraFrame;
        acompanharCamera(0);
      }
      const falta=Math.hypot(Number(alvoVisual.lat)-Number(posicaoVisual.lat),Number(alvoVisual.lon)-Number(posicaoVisual.lon));
      const headingFalta=alvoVisual.heading==null?0:Math.abs((((Number(alvoVisual.heading)-Number(headingVisual||0))+540)%360)-180);
      if(falta>0.0000012 || headingFalta>0.8) rafVisual=requestAnimationFrame(frame);
    };
    rafVisual=requestAnimationFrame(frame);
  }

  function processarPosicao(pos) {
    const timestamp = Number(pos?.timestamp || Date.now());
    if (timestamp <= ultimoTimestampGps) return;
    const nova={lat:Number(pos.coords.latitude),lon:Number(pos.coords.longitude),accuracy:Number(pos.coords.accuracy||0),heading:pos.coords.heading!=null&&Number.isFinite(Number(pos.coords.heading))&&Number(pos.coords.heading)>=0?Number(pos.coords.heading):null,at:timestamp};
    if(!coordenadaValida(nova.lat,nova.lon)) return;

    const dtSeg = ultimaPosicaoBruta ? Math.max(.001,(nova.at-ultimaPosicaoBruta.at)/1000) : 0;
    const mov = ultimaPosicaoBruta ? haversine([ultimaPosicaoBruta.lon,ultimaPosicaoBruta.lat],[nova.lon,nova.lat]) : 0;
    if(nova.heading==null && ultimaPosicaoBruta && Number.isFinite(mov)&&mov>=Math.max(5, Math.min(15,nova.accuracy||0))) nova.heading=bearingEntre(ultimaPosicaoBruta,nova);
    const velocidadeGps=Number(pos.coords.speed);
    velocidadeVisualMs=Number.isFinite(velocidadeGps)&&velocidadeGps>=0?velocidadeGps:(dtSeg>0&&Number.isFinite(mov)?Math.min(60,mov/dtSeg):velocidadeVisualMs);

    ultimoTimestampGps=timestamp;
    ultimaPosicaoBruta={...nova};
    ultimaPosicao=nova; // posição bruta: decisões operacionais, desvio e recálculo.
    if(global.appState?.navegacao){global.appState.navegacao.ultimaPosicao=ultimaPosicao;global.appState.navegacao.ultimaAtualizacaoEm=timestamp;}

    if (posicaoAnterior && coordenadaValida(posicaoAnterior.lat,posicaoAnterior.lon)) {
      const trecho = haversine([posicaoAnterior.lon,posicaoAnterior.lat],[ultimaPosicao.lon,ultimaPosicao.lat]);
      if (Number.isFinite(trecho) && trecho >= 1 && trecho < 1000) rota.distanciaPercorridaMetros = Number(rota.distanciaPercorridaMetros || 0) + trecho;
    }
    posicaoAnterior = { ...ultimaPosicao };

    const nearestOperacional=nearestOnRoute(ultimaPosicao,{visual:false});
    const nearestVisual=nearestOnRoute(ultimaPosicao,{visual:true}) || nearestOperacional;
    alvoVisual=alvoVisualDaPosicao(ultimaPosicao,nearestVisual);
    if(!posicaoVisual&&alvoVisual){posicaoVisual={...alvoVisual};headingVisual=normalizarAngulo(alvoVisual.heading) ?? direcaoCamera();}
    iniciarInterpolacaoVisual();
    if (navegacaoInternaAtiva()) {
      atualizarProgressoVisual(nearestVisual);
      atualizarInstrucao(nearestVisual);
      const p=proxima(); if(p&&coordenadaValida(p.latitude,p.longitude)){
        const d=haversine([ultimaPosicao.lon,ultimaPosicao.lat],[Number(p.longitude),Number(p.latitude)]);
        if(d<=120) falar('Seu destino está próximo.',`stop:${p.id}:near`,{instructionId:`stop:${p.id}`,fase:'near'});
        if(d<=30) falar('Você chegou ao destino.',`stop:${p.id}:arrived`,{instructionId:`stop:${p.id}`,fase:'arrived',urgente:true});
      }
      // Desvio/recálculo usam EXCLUSIVAMENTE a posição GPS bruta.
      const limite=Math.max(80,(ultimaPosicao.accuracy||0)*2.2);
      if(nearestOperacional&&nearestOperacional.distance>limite) eventosForaRota++; else eventosForaRota=0;
      if(global.appState?.navegacao) global.appState.navegacao.foraDaRota=eventosForaRota>=3;
      if($('navGpsStatus')) $('navGpsStatus').textContent=eventosForaRota>=3?'Fora da rota planejada':`GPS ativo${ultimaPosicao.accuracy?` · precisão ${Math.round(ultimaPosicao.accuracy)} m`:''}`;
      if(eventosForaRota>=3&&Date.now()-ultimoRecalculo>60000&&global.PacoteEMatoServicoRota?.endpoint?.('route')) recalcular('desvio');
    } else {
      eventosForaRota=0;
      if(global.appState?.navegacao) global.appState.navegacao.foraDaRota=false;
      setSource(SOURCE_PROGRESS,fc([]));
      if($('navGpsStatus')) $('navGpsStatus').textContent=`Visualização da rota${ultimaPosicao.accuracy?` · GPS ${Math.round(ultimaPosicao.accuracy)} m`:''}`;
    }
  }

  function iniciarGPS() {
    if(!navigator.geolocation||watchId!=null){if(!navigator.geolocation&&$('navGpsStatus'))$('navGpsStatus').textContent='GPS indisponível neste navegador';return;}
    watchId=navigator.geolocation.watchPosition(processarPosicao,erro=>{if($('navGpsStatus'))$('navGpsStatus').textContent=erro?.code===1?'Permissão de localização negada':'Sinal de GPS indisponível';},{enableHighAccuracy:true,maximumAge:0,timeout:12000});
  }
  function pararGPS(){
    if(watchId!=null){try{navigator.geolocation.clearWatch(watchId);}catch(_){}watchId=null;}
    if(rafVisual!=null){try{cancelAnimationFrame(rafVisual);}catch(_){}rafVisual=null;}
  }

  async function persistirSelecao(extra){
    if(!rota)return;
    const alvo=cartaoSelecionadoId||proxima()?.id||null;
    const exibida=paradasPorOrdem().find(p=>String(p.id)===String(alvo||''));
    // O motorista pode digitar uma nota e tocar em Navegar sem tirar o foco do campo.
    // Copiamos o valor antes de abrir outro aplicativo para não perder esse texto.
    if(exibida&&$('navDeliveryNote')) exibida.observacaoEntrega=String($('navDeliveryNote').value||'').trim();
    rota.navegacaoSeguirPosicao=seguirPosicao;
    rota.paradaSelecionadaId=alvo;
    rota.proximaParadaId=proxima()?.id||null;
    if(global.appState?.navegacao){global.appState.navegacao.paradaExibidaId=alvo;global.appState.navegacao.proximaParadaId=rota.proximaParadaId;}
    try{await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});}catch(e){console.warn('Não foi possível persistir a parada selecionada',e);}
    try{await global.PacoteEMatoSessao?.persistirAgora?.(Object.assign({motivo:'navegacao',paradaSelecionadaId:alvo,proximaParadaId:rota.proximaParadaId,navegacaoAtiva:true},extra||{}));}catch(_){}
  }
  function selecionarCartao(delta){
    const lista=paradasPorOrdem(); if(!lista.length)return;
    const id=cartaoSelecionadoId||proxima()?.id;
    const indice=Math.max(0,lista.findIndex(s=>String(s.id)===String(id)));
    const anterior=lista[indice];
    if(anterior && $('navDeliveryNote')) anterior.observacaoEntrega=String($('navDeliveryNote').value||'').trim();
    const alvo=lista[Math.max(0,Math.min(lista.length-1,indice+delta))];
    if(!alvo || String(alvo.id)===String(id))return;
    definirAcompanhamento(false);
    cartaoSelecionadoId=alvo.id;
    // V43: o marcador verde pertence à continuidade da corrida, então navegar
    // pelos cards não precisa reconstruir a source de marcadores. Evita duas
    // repinturas pesadas e deixa o gesto muito mais fluido em celulares.
    global.requestAnimationFrame(() => {
      atualizarPainel();
      animarCardParada(delta>0?'left':'right');
      // V47: atualiza o destaque da parada consultada sem alterar a parada ativa.
      // Os ícones são cacheados, então esta atualização é bem mais leve que reconstruir o mapa.
      atualizarFontesPontos();
    });
    persistirCartaoComAtraso();
    if(mapa&&mapReady&&coordenadaValida(alvo.latitude,alvo.longitude)){
      const interna=navegacaoInternaAtiva();
      try { mapa.stop?.(); } catch (_) {}
      mapa.easeTo({center:[Number(alvo.longitude),Number(alvo.latitude)],zoom:interna?17:Math.max(15,mapa.getZoom()),pitch:interna?48:0,duration:240,easing:t=>1-Math.pow(1-t,3)});
    }
  }
  async function abrirExterno(provider){
    if (modoMapaNavegacao === 'navigation-active') definirModoMapa('overview',{duracao:0,acompanhar:false});
    moduloVozNavegacao()?.limparEstado?.({cancelar:true});
    const destino = emDestinoFinal() ? destinoFinalDaRota() : null;
    const p=destino ? {id:'__PONTO_FINAL__',latitude:destino.lat,longitude:destino.lon,enderecoOriginal:destino.descricao} : (paradasPorOrdem().find(s=>String(s.id)===String(cartaoSelecionadoId))||proxima());if(!p)return;
    if(!destino) cartaoSelecionadoId=p.id;
    await persistirSelecao({motivo:`abrir_${provider}`,navegacaoProvider:provider});
    try{if(!destino)sessionStorage.setItem('pemato_parada_externa',String(p.id));sessionStorage.setItem('pemato_provider_externo',String(provider));}catch(_){}
    const lat=Number(p.latitude),lon=Number(p.longitude), endereco=String(p.enderecoOriginal||'').trim();
    const coord=coordenadaValida(p.latitude,p.longitude)?`${lat},${lon}`:endereco;
    const ua=navigator.userAgent||''; const android=/Android/i.test(ua), ios=/iPhone|iPad|iPod/i.test(ua);
    let url='';
    if(provider==='waze'){
      if(android) url=coordenadaValida(p.latitude,p.longitude)?`waze://?ll=${encodeURIComponent(coord)}&navigate=yes`:`waze://?q=${encodeURIComponent(endereco)}&navigate=yes`;
      else if(ios) url=coordenadaValida(p.latitude,p.longitude)?`waze://?ll=${encodeURIComponent(coord)}&navigate=yes`:`waze://?q=${encodeURIComponent(endereco)}&navigate=yes`;
      else url=coordenadaValida(p.latitude,p.longitude)?`https://www.waze.com/ul?ll=${encodeURIComponent(coord)}&navigate=yes`:`https://www.waze.com/ul?q=${encodeURIComponent(endereco)}&navigate=yes`;
    } else if(provider==='google'){
      if(android) url=`google.navigation:q=${encodeURIComponent(coord)}&mode=d`;
      else if(ios) url=`comgooglemaps://?daddr=${encodeURIComponent(coord)}&directionsmode=driving`;
      else url=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coord)}&travelmode=driving`;
    }
    if(!url)return;
    // Em Android/iOS prioriza o app nativo e não navega o PWA para uma página web.
    if(android||ios){ global.location.href=url; } else { const aberta=global.open(url,'_blank','noopener'); if(!aberta) global.location.href=url; }
  }


  async function salvarStatusParadaAtual(status,motivo,observacao){
    if(processandoStatus) return; const atual=paradasPorOrdem().find(s=>String(s.id)===String(cartaoSelecionadoId))||proxima(); if(!rota||!atual)return; const parada=rota.paradas.find(p=>String(p.id)===String(atual.id)); if(!parada||['entregue','concluida','nao_entregue'].includes(parada.statusEntrega))return;
    processandoStatus=true; try{
      if(!['entregue','nao_entregue'].includes(status)) return;
      const motivoFinal=status==='nao_entregue'?String(motivo||'').trim():'';
      const timestamp=Date.now(); parada.statusEntrega=status; parada.statusAtualizadoEm=timestamp; parada.observacaoEntrega=String($('navDeliveryNote')?.value||'').trim();
      if(status==='entregue'){parada.motivoNaoEntrega='';parada.observacaoNaoEntrega='';parada.entregueEm=timestamp;parada.naoEntregueEm=null;}
      else {parada.motivoNaoEntrega=motivoFinal;parada.observacaoNaoEntrega=String(observacao||'').trim();parada.entregueEm=null;parada.naoEntregueEm=timestamp;}
      parada.alteradoEm=timestamp;
      const idTratado=parada.id;
      atualizarPendentes();
      const proximaDepois=proximaPendenteDepois(idTratado) || proxima();
      cartaoSelecionadoId=proximaDepois?.id || idTratado;
      rota.paradaSelecionadaId=cartaoSelecionadoId;
      rota.proximaParadaId=proximaDepois?.id||null;
      rota.duracaoParadasSegundos=ordemPendente.length*Number(rota.tempoParadaSegundos||0);
      if(Number.isFinite(Number(rota.duracaoDirecaoSegundos))){rota.duracaoTotalSegundos=Number(rota.duracaoDirecaoSegundos||0)+Number(rota.duracaoParadasSegundos||0);rota.horarioTerminoEstimado=Date.now()+rota.duracaoTotalSegundos*1000;}
      await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});
      await global.PacoteEMatoSessao?.persistirAgora?.({motivo:status==='entregue'?'parada_entregue':'parada_nao_entregue',paradaSelecionadaId:cartaoSelecionadoId,proximaParadaId:cartaoSelecionadoId,navegacaoAtiva:true});
      if($('navDeliveryNote'))$('navDeliveryNote').value=''; if($('navExtrasPanel'))$('navExtrasPanel').style.display='none'; ultimoIdNota='';
      animarCardParada('left');
      atualizarPainel(); desenharRota(); global.PacoteEMatoHistorico?.renderizar?.(); global.PacoteEMatoAppShell?.atualizarInicio?.();
      if(ordemPendente.length){if(global.PacoteEMatoServicoRota?.endpoint?.('route'))await recalcular('proxima');else {atualizarFontesPontos();desenharRota();}}
      else if(destinoFinalDaRota()){
        rota.status='ativa'; rota.conclusaoPendente=false;
        await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});
        atualizarPainel();
        if(global.PacoteEMatoServicoRota?.endpoint?.('route')&&ultimaPosicao) await recalcular('ponto_final');
        else {atualizarFontesPontos();desenharRota();}
        global.notificar?.('Entregas concluídas. Agora siga até o ponto final da rota.');
        falar('Entregas concluídas. Siga até o ponto final da rota.','route:final-destination');
      }
      else{rota.status='aguardando_finalizacao';rota.conclusaoPendente=true;await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});mostrarConclusao();}
    }finally{processandoStatus=false;}
  }

  async function concluirPontoFinal(){
    if(!rota||!emDestinoFinal())return;
    rota.pontoFinalConcluidoEm=Date.now();
    rota.status='aguardando_finalizacao';
    rota.conclusaoPendente=true;
    await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});
    mostrarConclusao();
  }

  async function finalizarRota(){
    if(!rota)return;
    const anterior={status:rota.status,concluidoEm:rota.concluidoEm,conclusaoPendente:rota.conclusaoPendente};
    try{
      rota.status='concluida';rota.concluidoEm=Date.now();rota.conclusaoPendente=false;
      await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true,exigirPersistenciaLocal:true});
      const persistida=await global.PacoteEMatoRotaStore.obterRota(rota.id);
      if(!persistida||persistida.status!=='concluida'||Number(persistida.paradas?.length||0)!==Number(rota.paradas?.length||0)) throw new Error('A cópia concluída ainda não foi confirmada no histórico local.');
      pararGPS();
      moduloVozNavegacao()?.limparEstado?.({cancelar:true});
      if($('navCompletionBackdrop'))$('navCompletionBackdrop').style.display='none';
      await global.PacoteEMatoRotaStore.limparRotaAtiva();
      global.PacoteEMatoAppShell?.abrirModulo?.('historico');
    }catch(erro){
      rota.status=anterior.status;rota.concluidoEm=anterior.concluidoEm;rota.conclusaoPendente=anterior.conclusaoPendente;
      try{await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true,firestore:false});}catch(_){}
      console.warn('Pacote É Mato: finalização preservada porque o histórico não foi confirmado.',erro);
      global.notificar?.('Não foi possível confirmar o salvamento da rota. Ela continua aberta para evitar perda de dados.');
    }
  }
  function revisarResultados(){if($('navCompletionBackdrop'))$('navCompletionBackdrop').style.display='none';global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');}

  async function navegarPreferido(){
    const pref=String(global.PacoteEMatoConfiguracoes?.obter?.().navegacao||'pacote_emato');
    if(global.appState?.navegacao)global.appState.navegacao.provider=pref;
    if(pref==='waze'||pref==='google') {
      definirModoMapa('overview',{duracao:0,acompanhar:false});
      moduloVozNavegacao()?.limparEstado?.({cancelar:true});
      atualizarBotaoVoz(); atualizarFontesPontos();
      return abrirExterno(pref);
    }
    // Não recalcula nem recarrega: usa a geometria/instruções já salvas da rota.
    definirModoMapa('navigation-active',{duracao:220,acompanhar:true});
    if (vozAtiva) moduloVozNavegacao()?.desbloquear?.({confirmar:false});
    await persistirSelecao({motivo:'navegacao_interna',navegacaoProvider:'pacote_emato',modoNavegacao:'navigation-active'});
    if(watchId==null)iniciarGPS();
    if($('navGpsStatus'))$('navGpsStatus').textContent=emDestinoFinal()?'Navegando até o ponto final':'Navegação Pacote É Mato ativa';
  }

  async function iniciar(rotaEntrada){
    rota=rotaEntrada?global.PacoteEMatoRotaStore.normalizarRota(rotaEntrada):await global.PacoteEMatoRotaStore.obterRotaAtiva();
    if(rota?.precisaRecalculo){global.notificar?.('A rota foi alterada. Recalcule o trajeto antes de iniciar a navegação.');return;}
    if(!rota||!geometriaValida(rota.geometria)){global.notificar?.('Calcule uma rota válida antes de iniciar a navegação.');return;}
    global.PacoteEMatoMarcadores?.capturarBaseVisualStatus?.(rota, false);
    atualizarPendentes();let idExterno=null;try{idExterno=sessionStorage.getItem('pemato_parada_externa');sessionStorage.removeItem('pemato_parada_externa');}catch(_){}cartaoSelecionadoId=idExterno||rota.paradaSelecionadaId||global.appState?.navegacao?.paradaExibidaId||proxima()?.id||null;posicaoAnterior=null;ultimaPosicaoBruta=null;posicaoVisual=null;alvoVisual=null;headingVisual=null;ultimoIndiceVisualRota=null;ultimoProgressoVisual=null;ultimoTimestampGps=0; const pref=global.PacoteEMatoConfiguracoes?.obter?.().navegacao||'pacote_emato';
    const retomarAtiva = pref==='pacote_emato' && global.appState?.navegacao?.modo === 'navigation-active';
    vozAtiva=pref==='pacote_emato' && (moduloVozNavegacao()?.estaAtiva?.() ?? (global.appState?.navegacao?.vozAtiva!==false));
    if(global.appState?.navegacao){global.appState.navegacao.ativa=true;global.appState.navegacao.provider=pref;global.appState.navegacao.iniciadaEm=global.appState.navegacao.iniciadaEm||Date.now();global.appState.navegacao.paradaExibidaId=cartaoSelecionadoId;rota.iniciadoEm=rota.iniciadoEm||global.appState.navegacao.iniciadaEm;global.appState.navegacao.vozAtiva=vozAtiva;}
    modoMapaNavegacao=retomarAtiva?'navigation-active':'overview';
    seguirPosicao=retomarAtiva;
    document.body.dataset.pematoNavMode=modoMapaNavegacao;
    if(global.appState?.navegacao){global.appState.navegacao.modo=modoMapaNavegacao;global.appState.navegacao.seguirPosicao=seguirPosicao;}
    definirPainelNav(retomarAtiva?'collapsed':'expanded');
    garantirMapa(); desenharRota(); atualizarPainel(); atualizarBotaoFollow(); atualizarBotaoVoz();
    if(mapReady) definirModoMapa(modoMapaNavegacao,{duracao:0,acompanhar:retomarAtiva});
    iniciarGPS();
    if($('navGpsStatus')) $('navGpsStatus').textContent=retomarAtiva?'Navegação Pacote É Mato retomada':(pref!=='pacote_emato'?`GPS ativo · navegação preferida: ${pref==='waze'?'Waze':'Google Maps'}`:'Visualização da rota · toque Navegar para iniciar o GPS guiado');
    await persistirSelecao({motivo:'abrir_navegacao',navegacaoProvider:pref,modoNavegacao:modoMapaNavegacao});
    if(!ordemPendente.length && !destinoFinalDaRota())mostrarConclusao();
  }

  async function encerrar(){const ok=await global.PacoteEMatoDialog?.confirmar?.({titulo:'Sair da navegação?',mensagem:'A rota e todo o progresso serão preservados para você continuar depois.',confirmar:'Sair da navegação',cancelar:'Continuar na rota'});if(ok===false)return;pararGPS();moduloVozNavegacao()?.limparEstado?.({cancelar:true});if(global.appState?.navegacao){global.appState.navegacao.ativa=false;global.appState.navegacao.modo='overview';}modoMapaNavegacao='overview';global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');}
  function pausar(){pararGPS();moduloVozNavegacao()?.limparEstado?.({cancelar:true});}
  function mapaNavegacaoSaudavel(){
    try {
      const container=$('mapaNavegacao'); const canvas=mapa?.getCanvas?.();
      return !!(mapa&&mapReady&&container&&container.isConnected&&container.clientWidth>0&&container.clientHeight>0&&canvas&&canvas.isConnected&&mapa.getStyle?.()?.layers?.length);
    } catch(_){ return false; }
  }

  function reconstruirMapaNavegacao(){
    if(reconstruindoMapa) return;
    reconstruindoMapa=true;
    try{ mapa?.remove?.(); }catch(_){}
    mapa=null; mapReady=false; fallbackBaseAtivo=false; clearTimeout(mapLoadTimer); assinaturaParadasV11='';
    const container=$('mapaNavegacao'); if(container) container.innerHTML='';
    const fallback=$('navMapFallback'); if(fallback) fallback.style.display='none';
    garantirMapa();
    setTimeout(()=>{ try{mapa?.resize?.();mapa?.triggerRepaint?.();}catch(_){} desenharRota();atualizarFontesPontos();reconstruindoMapa=false; },320);
  }

  async function retomar(opcoes){
    const agora=Date.now(); if(agora-ultimoRetomar<350)return; ultimoRetomar=agora;
    if(!global.appState?.navegacao?.ativa)return;
    if(!rota) try{ const salva=await global.PacoteEMatoRotaStore?.obterRotaAtiva?.(); if(salva) rota=global.PacoteEMatoRotaStore.normalizarRota(salva); }catch(_){}
    atualizarPendentes();
    const forcar=!mapa || contextoPerdido || !mapa.getCanvas?.()?.isConnected;
    if(forcar) reconstruirMapaNavegacao();
    else { try{mapa.resize();mapa.triggerRepaint?.();}catch(_){} garantirCamadas();desenharRota();atualizarFontesPontos(); }
    aplicarModoVisualMapa();
    if(navegacaoInternaAtiva()&&vozAtiva) moduloVozNavegacao()?.retomarDoBackground?.();
    if(navegacaoInternaAtiva()&&seguirPosicao) acompanharCamera(0);
    else if(modoOverview()) enquadrarOverview(0);
    atualizarPainel(); atualizarBotaoFollow(); atualizarBotaoVoz();
    pararGPS(); iniciarGPS();
    if($('navGpsStatus'))$('navGpsStatus').textContent=navegacaoInternaAtiva()?'Retorno ao Pacote É Mato · GPS retomado':'Visualização da rota';
    persistirSelecao({motivo:'retorno_primeiro_plano'});
  }

  function abrirAcoesRota(){const el=$('navRouteActionsBackdrop');if(el)el.style.display='flex';registrarRetornoInterno('nav_menu');}
  function fecharAcoesRota(){const el=$('navRouteActionsBackdrop');if(el)el.style.display='none';}
  async function abrirRefinoDaNavegacao(){fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>{global.PacoteEMatoRoteirizacao?.abrirRevisaoOtimizacao?.();setTimeout(()=>$('routingReviewRefineBtn')?.click?.(),80);},140);}
  async function abrirBipagemDaNavegacao(){fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>global.PacoteEMatoRoteirizacao?.abrirEscolhaBipagem?.(),140);}
  async function exportarPdfNavegacao(){fecharAcoesRota();if(rota)await global.PacoteEMatoPDF?.exportar?.(rota);}

  function definirPainelNav(estado){
    estadoPainelNav=['expanded','intermediate','collapsed'].includes(estado)?estado:'collapsed';
    const panel=$('navigationPanel'); if(!panel)return;
    panel.classList.remove('is-expanded','is-intermediate','is-collapsed');
    panel.classList.add(`is-${estadoPainelNav}`);
    panel.dataset.state=estadoPainelNav;
    panel.dataset.internal=navegacaoInternaAtiva()?'true':'false';
    document.body.dataset.pematoNavPanelState=estadoPainelNav;
    const grabber=$('navPanelGrabber');
    if(grabber){grabber.hidden=!navegacaoInternaAtiva();grabber.setAttribute('aria-expanded',estadoPainelNav==='expanded'?'true':'false');grabber.setAttribute('aria-label',estadoPainelNav==='expanded'?'Minimizar painel da entrega':'Expandir painel da entrega');}
  }

  function atualizarStatusCard(p){
    const badge=$('navStopStatusBadge'),delivery=$('navDeliveredBtn'),fail=$('navNotDeliveredBtn'),undo=$('navUndoStatusBtn');
    const status=String(p?.statusEntrega||'pendente'); const finalizado=['entregue','concluida','nao_entregue'].includes(status);
    if(badge){badge.className='nav-stop-status-badge'; if(status==='nao_entregue'){badge.classList.add('is-failed');badge.textContent='Não entregue';}else if(['entregue','concluida'].includes(status)){badge.classList.add('is-delivered');badge.textContent='Entregue';}else{badge.classList.add('is-pending');badge.textContent='Pendente';}}
    if(delivery){delivery.style.display=finalizado?'none':'';delivery.textContent='Entregue';}
    if(fail){fail.style.display=finalizado?'none':'';fail.textContent='Não entregue';}
    // O Desfazer pertence somente ao card de uma parada já tratada. Como a navegação
    // avança automaticamente após Entregue/Não entregue, ele não aparece na próxima parada.
    if(undo){undo.style.display=finalizado?'inline-flex':'none';undo.textContent=status==='nao_entregue'?'Desfazer não entrega':'Desfazer entrega';}
  }

  async function desfazerStatusAtual(){
    if(processandoStatus||!rota)return;
    const alvo=rota.paradas?.find(s=>String(s.id)===String(cartaoSelecionadoId||''));
    if(!alvo||!['entregue','concluida','nao_entregue'].includes(String(alvo.statusEntrega||'')))return;
    processandoStatus=true;
    try{
      alvo.statusEntrega='pendente';
      alvo.entregueEm=null;
      alvo.naoEntregueEm=null;
      alvo.motivoNaoEntrega='';
      alvo.observacaoNaoEntrega='';
      alvo.statusAtualizadoEm=Date.now();
      alvo.alteradoEm=Date.now();
      rota.conclusaoPendente=false;
      if($('navCompletionBackdrop'))$('navCompletionBackdrop').style.display='none';
      atualizarPendentes();
      rota.paradaSelecionadaId=alvo.id;
      rota.proximaParadaId=alvo.id;
      cartaoSelecionadoId=alvo.id;
      await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});
      await global.PacoteEMatoSessao?.persistirAgora?.({motivo:'desfazer_status_parada',paradaSelecionadaId:alvo.id,proximaParadaId:alvo.id,navegacaoAtiva:true});
      atualizarPainel(); desenharRota();
      if(global.PacoteEMatoServicoRota?.endpoint?.('route')&&ultimaPosicao) await recalcular('desfazer');
      else {atualizarFontesPontos();desenharRota();}
    }finally{processandoStatus=false;}
  }

  function bind(){
    definirPainelNav('collapsed');
    const grabber=$('navPanelGrabber');
    let dragPainel=null;
    grabber?.addEventListener('pointerdown',e=>{dragPainel={y:e.clientY,movimento:0};try{grabber.setPointerCapture(e.pointerId);}catch(_){};});
    grabber?.addEventListener('pointermove',e=>{if(!dragPainel)return;dragPainel.movimento=e.clientY-dragPainel.y;});
    grabber?.addEventListener('pointerup',e=>{if(!dragPainel)return;const dy=dragPainel.movimento;dragPainel=null;try{grabber.releasePointerCapture(e.pointerId);}catch(_){};if(Math.abs(dy)<18)definirPainelNav(estadoPainelNav==='expanded'?'collapsed':'expanded');else definirPainelNav(dy<0?'expanded':'collapsed');});
    const swipe=$('navStopCard');let startX=0,startY=0;
    swipe?.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;startY=e.touches[0].clientY;},{passive:true});
    swipe?.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)selecionarCartao(dx<0?1:-1);},{passive:true});
    $('navBackBtn')?.addEventListener('click',()=>global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao'));
    $('navUndoStatusBtn')?.addEventListener('click',desfazerStatusAtual);
    $('navNavigateBtn')?.addEventListener('click',navegarPreferido);
    $('navDeliveredBtn')?.addEventListener('click',()=>emDestinoFinal()?concluirPontoFinal():salvarStatusParadaAtual('entregue'));
    $('navNotDeliveredBtn')?.addEventListener('click',()=>salvarStatusParadaAtual('nao_entregue'));
    $('navMoreBtn')?.addEventListener('click',abrirAcoesRota);
    $('navRouteActionsClose')?.addEventListener('click',fecharAcoesRota);
    $('navRouteActionsBackdrop')?.addEventListener('click',e=>{if(e.target===$('navRouteActionsBackdrop'))fecharAcoesRota();});
    $('navActionImport')?.addEventListener('click',()=>{fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>$('routingXlsxInput')?.click?.(),140);});
    $('navActionNewRoute')?.addEventListener('click',()=>{fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>global.PacoteEMatoRoteirizacao?.criarNovaRotaVazia?.(),140);});
    $('navActionAddStop')?.addEventListener('click',()=>{fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>global.PacoteEMatoRoteirizacao?.abrirEditor?.(null),140);});
    $('navActionPackages')?.addEventListener('click', async ()=>{fecharAcoesRota();await mostrarTutorialPacotesSeNecessario();if($('navPackagesChooserBackdrop'))$('navPackagesChooserBackdrop').style.display='flex';registrarRetornoInterno('nav_pacotes');});
    $('navPackagesChooserClose')?.addEventListener('click',()=>{if($('navPackagesChooserBackdrop'))$('navPackagesChooserBackdrop').style.display='none';});
    $('navPackagesChooserBackdrop')?.addEventListener('click',e=>{if(e.target===$('navPackagesChooserBackdrop'))e.currentTarget.style.display='none';});
    $('navAddPackagesBtn')?.addEventListener('click',()=>{if($('navPackagesChooserBackdrop'))$('navPackagesChooserBackdrop').style.display='none';global.PacoteEMatoOperacoesPacotes?.iniciar?.('adicionar');});
    $('navRemovePackagesBtn')?.addEventListener('click',()=>{if($('navPackagesChooserBackdrop'))$('navPackagesChooserBackdrop').style.display='none';global.PacoteEMatoOperacoesPacotes?.iniciar?.('remover');});
    $('navActionValidate')?.addEventListener('click',()=>{fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>global.PacoteEMatoRoteirizacao?.geocodificarTodas?.(),140);});
    $('navActionOptimize')?.addEventListener('click',()=>{fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>global.PacoteEMatoRoteirizacao?.otimizarRota?.(),140);});
    $('navActionRefine')?.addEventListener('click',abrirRefinoDaNavegacao);
    $('navActionBipagem')?.addEventListener('click',abrirBipagemDaNavegacao);
    $('navActionExportPdf')?.addEventListener('click',exportarPdfNavegacao);
    $('navActionSettings')?.addEventListener('click',()=>{fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('configuracoes');});
    $('navActionRecalculate')?.addEventListener('click',()=>{fecharAcoesRota();recalcular('manual');});
    $('navActionClearRoutes')?.addEventListener('click',()=>{fecharAcoesRota();global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');setTimeout(()=>global.PacoteEMatoRoteirizacao?.removerTodasRotas?.(),140);});
    $('navActionExit')?.addEventListener('click',()=>{fecharAcoesRota();encerrar();});
    $('navRecalculateBtn')?.addEventListener('click',()=>recalcular('manual')); $('navEndBtn')?.addEventListener('click',encerrar);
    $('navFollowBtn')?.addEventListener('click',()=>{
      if(!navegacaoInternaAtiva()){enquadrarOverview(180);return;}
      definirAcompanhamento(true);
      acompanharCamera(180);
      iniciarGPS();
    });
    $('navVoiceBtn')?.addEventListener('click',()=>{
      if(!navegacaoInternaAtiva())return;
      vozAtiva=!vozAtiva;
      const modulo=moduloVozNavegacao();
      modulo?.definirAtiva?.(vozAtiva);
      if(global.appState?.navegacao)global.appState.navegacao.vozAtiva=vozAtiva;
      atualizarBotaoVoz();
      if(vozAtiva) modulo?.desbloquear?.({confirmar:true});
    });
    $('navCompletionFinishBtn')?.addEventListener('click',finalizarRota); $('navCompletionReviewBtn')?.addEventListener('click',revisarResultados);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden&&global.appState?.navegacao?.ativa){backgroundEm=Date.now();if($('navGpsStatus'))$('navGpsStatus').textContent='Aplicativo em segundo plano; rota preservada.';persistirSelecao({motivo:'background_navegacao'});}
      else if(!document.hidden&&document.body.dataset.pematoModule==='navegacao'&&global.appState?.navegacao?.ativa){const tempo=Date.now()-backgroundEm;setTimeout(()=>retomar({forcarMapa:tempo>1200}),120);}
    });
    global.addEventListener('pageshow',()=>{if(document.body.dataset.pematoModule==='navegacao'&&global.appState?.navegacao?.ativa)setTimeout(()=>retomar({forcarMapa:true}),120);});
    global.addEventListener('focus',()=>{if(document.body.dataset.pematoModule==='navegacao'&&global.appState?.navegacao?.ativa&&Date.now()-backgroundEm>1200)setTimeout(()=>retomar({forcarMapa:true}),150);});
    global.addEventListener('pemato:resume',()=>{if(document.body.dataset.pematoModule==='navegacao')retomar({forcarMapa:true});});
    $('navDeliveryNote')?.addEventListener('change',async()=>{const p=paradasPorOrdem().find(s=>String(s.id)===String(cartaoSelecionadoId))||proxima();if(!p||!rota)return;p.observacaoEntrega=String($('navDeliveryNote').value||'');await global.PacoteEMatoRotaStore.salvarRota(rota,{ativa:true});});
  }

  if (global.ResizeObserver) {
    const observar = () => {
      const card = document.querySelector('.nav-maneuver-card');
      if (card) new ResizeObserver(posicionarSobreposicoes).observe(card);
    };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', observar, {once:true}); else observar();
  }
  global.addEventListener('resize', posicionarSobreposicoes);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true}); else bind();
  global.PacoteEMatoNavegacao=Object.freeze({iniciar,recalcular,encerrar,pausar,abrirExterno,navegarPreferido,salvarStatusParadaAtual,finalizarRota,selecionarCartao,persistirSelecao,retomar});
})(window);
