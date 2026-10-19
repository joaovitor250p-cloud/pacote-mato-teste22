(function iniciarAppShell(global) {
  'use strict';

  const CHAVE_UI = 'pemato_ui_resume_v1';
  const modulos = ['roteirizacao', 'bipagem', 'operacoes-pacotes', 'navegacao', 'historico', 'configuracoes'];
  const IDS_CAMADAS_RETORNO = [
    'routingActionsBackdrop','routingBipagemChooserBackdrop','routingPackagesChooserBackdrop','navPackagesChooserBackdrop',
    'routeImportMappingModal','routingOptimizationReviewBackdrop','routeStopEditorModal','routeReoptDecisionModal',
    'navCompletionBackdrop','routingRefineBackdrop','navRouteActionsBackdrop','routeHistoryDetailModal','pkgOpReviewBackdrop'
  ];
  let iniciando = true;
  let consumindoHistorico = false;

  function $(id) { return document.getElementById(id); }

  function idModulo(nome) {
    return {
      roteirizacao: 'moduloRoteirizacao', bipagem: 'moduloBipagem', 'operacoes-pacotes': 'moduloOperacoesPacotes',
      navegacao: 'moduloNavegacao', historico: 'moduloHistorico', configuracoes: 'moduloConfiguracoes'
    }[nome];
  }

  function fecharSidebar() {
    $('sidebar')?.classList.remove('active');
    if ($('overlay')) $('overlay').style.display = 'none';
  }

  function camadaVisivel(id) {
    const el = $(id);
    if (!el) return false;
    const display = global.getComputedStyle ? global.getComputedStyle(el).display : el.style.display;
    return display !== 'none';
  }

  function fecharCamadaVisualAtual() {
    if ($('sidebar')?.classList.contains('active')) { fecharSidebar(); return true; }
    const dialogo = document.querySelector('.pemato-dialog-backdrop');
    if (dialogo) {
      const cancelar = dialogo.querySelector('.pemato-dialog-cancel');
      const confirmar = dialogo.querySelector('.pemato-dialog-confirm');
      (cancelar || confirmar)?.click?.();
      return true;
    }
    for (const id of IDS_CAMADAS_RETORNO) {
      const el = $(id);
      if (el && camadaVisivel(id)) {
        el.style.display = 'none';
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        return true;
      }
    }
    if ($('routeImportFlow')?.classList.contains('is-open')) {
      global.PacoteEMatoFluxoImportacao?.fechar?.();
      return true;
    }
    return false;
  }

  function liberarTravasVisuais() {
    try {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      ['modal-open','no-scroll','overflow-hidden','sheet-open'].forEach(cls => {
        document.body.classList.remove(cls);
        document.documentElement.classList.remove(cls);
      });
      IDS_CAMADAS_RETORNO.forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
      $('routingWorkspace')?.classList.remove('is-draw-mode');
      $('routeImportFlow')?.classList.remove('is-open');
    } catch (_) {}
  }

  function prepararHistoricoBase() {
    try {
      const atual = global.history.state || {};
      if (!atual.pematoBase && !atual.pematoUi) {
        global.history.replaceState(Object.assign({}, atual, { pematoBase: true, pematoUi: false }), '', global.location.href);
      }
    } catch (_) {}
  }

  function registrarRetornoInterno(tag, opcoes) {
    try {
      const tipo = opcoes?.tipo || 'camada';
      const atual = global.history.state || {};
      const novo = { pematoUi: true, pematoTipo: tipo, pematoTag: tag || tipo, em: Date.now() };
      // Troca uma camada por outra sem acumular passos extras. Camada sobre módulo
      // cria um nível próprio para que Voltar feche a camada e mantenha o módulo.
      if (tipo === 'modulo' && atual.pematoUi) global.history.replaceState(novo, '', global.location.href);
      else if (tipo === 'camada' && atual.pematoUi && atual.pematoTipo === 'camada') global.history.replaceState(novo, '', global.location.href);
      else global.history.pushState(novo, '', global.location.href);
    } catch (_) {}
  }

  function consumirRetornoInterno() {
    try {
      const atual = global.history.state || {};
      if (!atual.pematoUi || consumindoHistorico) return false;
      consumindoHistorico = true;
      global.history.back();
      setTimeout(() => { consumindoHistorico = false; }, 120);
      return true;
    } catch (_) { return false; }
  }

  async function abrirModulo(nome, opcoes) {
    if (nome === 'inicio') nome = 'roteirizacao';
    if (!modulos.includes(nome)) nome = 'roteirizacao';
    if (document.body.dataset.pematoModule === 'navegacao' && nome !== 'navegacao') {
      await global.PacoteEMatoNavegacao?.persistirSelecao?.({ motivo: 'troca_modulo' });
    }
    // V75: somente o retorno Configurações -> Rota deixa de esperar uma
    // aplicação assíncrona. As demais trocas preservam o comportamento anterior.
    const retornoConfiguracoesParaRota = (document.body.dataset.pematoModule === 'configuracoes' && nome === 'roteirizacao');
    if (!retornoConfiguracoesParaRota) await global.PacoteEMatoConfiguracoes?.aguardarAplicacao?.();
    if (nome === 'navegacao') {
      const rotaParaNavegar = await global.PacoteEMatoRotaStore?.obterRotaAtiva?.();
      if (rotaParaNavegar?.precisaRecalculo) {
        global.notificar?.('A rota foi alterada. Recalcule o trajeto antes de abrir a navegação.');
        nome = 'roteirizacao';
      }
    }

    const anterior = document.body.dataset.pematoModule || global.appState?.ui?.moduloAtual || 'roteirizacao';
    if (!iniciando && anterior === nome) { fecharSidebar(); return; }

    if (!iniciando && opcoes?.registrarHistorico !== false && nome !== 'roteirizacao') {
      registrarRetornoInterno('modulo:' + nome, { tipo: 'modulo' });
    }

    liberarTravasVisuais();
    if (anterior === 'navegacao' && nome !== 'navegacao') global.PacoteEMatoNavegacao?.pausar?.();
    if (anterior === 'operacoes-pacotes' && nome !== 'operacoes-pacotes') { try { await global.finalizarCameraHardware?.(); } catch (_) {} }
    if (anterior === 'roteirizacao' && nome !== 'roteirizacao') {
      global.PacoteEMatoMapa?.encerrarSelecaoDesenho?.({ limpar: true });
      const draw = $('routingDrawToolbar'); if (draw) draw.style.display = 'none';
    }

    document.body.dataset.pematoModule = nome;
    modulos.forEach(m => {
      const el = $(idModulo(m));
      if (el) el.style.display = m === nome ? '' : 'none';
      document.querySelectorAll(`[data-pemato-nav="${m}"]`).forEach(btn => btn.classList.toggle('active', m === nome));
    });
    if (global.appState?.ui) global.appState.ui.moduloAtual = nome;
    salvarEstadoUI();
    fecharSidebar();

    if (nome === 'roteirizacao') {
      await global.PacoteEMatoRoteirizacao?.carregarRotaAtiva?.();
      setTimeout(() => global.PacoteEMatoMapa?.renderizar({ fit: true }), 100);
    } else if (nome === 'bipagem') {
      global.PacoteEMatoBipagemArea?.abrir?.('scanner');
      if (opcoes?.usarRotaAtiva === true) await global.PacoteEMatoBipagemBridge?.prepararRotaAtivaParaBipagem?.({ iniciarScanner: true });
    } else if (nome === 'historico') {
      global.PacoteEMatoHistorico?.renderizar?.();
    } else if (nome === 'configuracoes') {
      global.PacoteEMatoConfiguracoes?.renderizar?.();
    } else if (nome === 'navegacao') {
      const rota = await global.PacoteEMatoRotaStore?.obterRotaAtiva?.();
      if (rota?.geometria) global.PacoteEMatoNavegacao?.iniciar?.(rota);
    }

    // Quando o próprio app volta de uma tela interna para o mapa, consome o
    // estado interno correspondente. Assim não ficam vários "voltar" presos.
    if (!iniciando && nome === 'roteirizacao' && anterior !== 'roteirizacao' && opcoes?.veioDoPop !== true && opcoes?.retornoDireto !== true) {
      setTimeout(() => consumirRetornoInterno(), 0);
    }
  }

  async function tratarPopstate() {
    consumindoHistorico = false;
    if (fecharCamadaVisualAtual()) return true;
    const atual = document.body.dataset.pematoModule || global.appState?.ui?.moduloAtual || 'roteirizacao';
    if (atual !== 'roteirizacao') {
      await abrirModulo('roteirizacao', { registrarHistorico: false, veioDoPop: true });
      return true;
    }
    // No mapa principal não recriamos histórico: o navegador/PWA pode sair normalmente.
    return false;
  }

  function formatarDistancia(m) {
    const n = Number(m); return Number.isFinite(n) ? `${(n / 1000).toFixed(1).replace('.', ',')} km` : '—';
  }
  function formatarTempo(s) {
    const min = Math.max(0, Math.round(Number(s || 0) / 60));
    if (!Number.isFinite(min)) return '—';
    return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`;
  }

  async function atualizarInicio() {
    const rota = await global.PacoteEMatoRotaStore?.obterRotaAtiva?.();
    const card = $('homeActiveRouteCard'), empty = $('homeNoRoute');
    if (!rota) { if (card) card.style.display = 'none'; if (empty) empty.style.display = 'block'; return; }
    if (card) card.style.display = 'block'; if (empty) empty.style.display = 'none';
    if ($('homeRouteName')) $('homeRouteName').textContent = rota.nome || 'Rota ativa';
    if ($('homeRouteStatus')) $('homeRouteStatus').textContent = rota.rotaOtimizada ? 'Otimizada' : 'Em planejamento';
    if ($('homeRouteStops')) $('homeRouteStops').textContent = String(rota.paradas.length);
    if ($('homeRouteDistance')) $('homeRouteDistance').textContent = formatarDistancia(rota.distanciaTotalMetros);
    if ($('homeRouteTime')) $('homeRouteTime').textContent = formatarTempo(rota.duracaoTotalSegundos);
    const delivered = rota.paradas.filter(p => ['entregue','concluida'].includes(p.statusEntrega)).length;
    if ($('homeRouteProgress')) $('homeRouteProgress').textContent = `${delivered} de ${rota.paradas.length}`;
    const packages = rota.paradas.reduce((sum, p) => sum + (p.pacotes?.length || 0), 0);
    if ($('homeRoutePackages')) $('homeRoutePackages').textContent = String(packages);
  }

  function salvarEstadoUI() {
    try {
      const dados = { modulo: document.body.dataset.pematoModule || 'roteirizacao', painel: $('routingBottomSheet')?.dataset?.state || null, atualizadoEm: Date.now() };
      sessionStorage.setItem(CHAVE_UI, JSON.stringify(dados)); localStorage.setItem(CHAVE_UI, JSON.stringify(dados));
    } catch (_) {}
  }
  function recuperarEstadoUI() {
    try {
      const raw = sessionStorage.getItem(CHAVE_UI) || localStorage.getItem(CHAVE_UI), d = JSON.parse(raw || 'null');
      let modulo = d?.modulo === 'inicio' ? 'roteirizacao' : d?.modulo;
      if (modulo === 'operacoes-pacotes') modulo = 'roteirizacao';
      return modulo && modulos.includes(modulo) ? modulo : null;
    } catch (_) { return null; }
  }

  function bindFechamentosHistorico() {
    const ids = ['routingActionsCloseBtn','routingPackagesChooserClose','routingBipagemChooserClose','routingReviewCloseBtn','routingRefineCloseBtn','navRouteActionsClose','navPackagesChooserClose','routeStopEditorClose','routeStopEditorCancel','routeHistoryDetailClose'];
    ids.forEach(id => $(id)?.addEventListener('click', () => setTimeout(() => consumirRetornoInterno(), 0)));
  }

  async function bind() {
    prepararHistoricoBase();
    document.querySelectorAll('[data-pemato-nav]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.classList.contains('pemato-back-route') && (document.body.dataset.pematoModule || '') === 'configuracoes') {
        try { global.history.replaceState({ pematoBase: true, pematoUi: false }, '', global.location.href); } catch (_) {}
        abrirModulo('roteirizacao', { registrarHistorico: false, retornoDireto: true });
        return;
      }
      abrirModulo(btn.dataset.pematoNav);
    }));
    bindFechamentosHistorico();
    global.addEventListener('pemato:rota:salva', atualizarInicio);
    global.addEventListener('pemato:rota:ativa-limpa', atualizarInicio);
    global.addEventListener('pagehide', salvarEstadoUI);
    global.addEventListener('popstate', () => { tratarPopstate().catch?.(() => {}); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) salvarEstadoUI(); else global.dispatchEvent(new CustomEvent('pemato:resume')); });
    global.addEventListener('pageshow', () => global.dispatchEvent(new CustomEvent('pemato:resume')));

    try { await global.PacoteEMatoSessao?.restaurar?.(); } catch (_) {}
    const restaurado = recuperarEstadoUI();
    const desejado = restaurado || (global.appState?.ui?.moduloAtual === 'inicio' ? 'roteirizacao' : global.appState?.ui?.moduloAtual) || 'roteirizacao';
    await abrirModulo(desejado, { registrarHistorico: false });
    iniciando = false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bind(); }, { once: true });
  else bind();

  global.PacoteEMatoAppShell = Object.freeze({ abrirModulo, atualizarInicio, fecharSidebar, liberarTravasVisuais, registrarRetornoInterno, consumirRetornoInterno, tratarPopstate });
})(window);
