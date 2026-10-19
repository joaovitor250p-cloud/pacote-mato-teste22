(function iniciarHistoricoRotas(global) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function formatarDistancia(m) {
    const n = Number(m);
    return Number.isFinite(n) ? `${(n / 1000).toFixed(1).replace('.', ',')} km` : '—';
  }

  function formatarTempo(s) {
    const min = Math.max(0, Math.round(Number(s || 0) / 60));
    if (!Number.isFinite(min)) return '—';
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  }

  function textoStatus(p) {
    if (p?.statusEntrega === 'nao_entregue') return 'Não entregue';
    if (['entregue','concluida'].includes(String(p?.statusEntrega || ''))) return 'Entregue';
    return 'Pendente';
  }

  function datasDoFiltro() {
    const tipo = $('historyFilter')?.value || 'semana';
    const hoje = new Date();
    let inicio = null;
    let fim = null;
    if (tipo === 'semana') {
      const day = (hoje.getDay() + 6) % 7;
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - day);
      inicio = d.toISOString().slice(0, 10);
      fim = hoje.toISOString().slice(0, 10);
    } else if (tipo === 'data') {
      const d = $('historyDate')?.value;
      inicio = d || null;
      fim = d || null;
    } else if (tipo === 'periodo') {
      inicio = $('historyStart')?.value || null;
      fim = $('historyEnd')?.value || null;
    }
    return { inicio, fim };
  }

  function criarLinha(label, value) {
    const div = document.createElement('div');
    div.className = 'history-detail-row';
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('strong'); b.textContent = value;
    div.append(a, b);
    return div;
  }

  function prepararRotaParaCorrecao(rotaEntrada, paradaId) {
    const rota = global.PacoteEMatoRotaStore?.normalizarRota
      ? global.PacoteEMatoRotaStore.normalizarRota(rotaEntrada)
      : JSON.parse(JSON.stringify(rotaEntrada || {}));
    const alvo = (rota.paradas || []).find(p => String(p.id) === String(paradaId));
    if (!alvo) return null;
    if (!['entregue','concluida','nao_entregue'].includes(String(alvo.statusEntrega || ''))) return null;

    alvo.statusEntrega = 'pendente';
    alvo.entregueEm = null;
    alvo.naoEntregueEm = null;
    alvo.motivoNaoEntrega = '';
    alvo.observacaoNaoEntrega = '';
    alvo.statusAtualizadoEm = Date.now();
    alvo.alteradoEm = Date.now();

    rota.status = 'ativa';
    rota.concluidoEm = null;
    rota.conclusaoPendente = false;
    rota.paradaSelecionadaId = alvo.id;
    rota.proximaParadaId = alvo.id;
    rota.alteradoEm = Date.now();
    // Intencionalmente não toca em ordem, pacotes, coordenadas, geometria, instruções
    // nem marca precisaRecalculo. A correção histórica não reotimiza a rota.
    return rota;
  }

  async function corrigirStatusRotaConcluida(rotaId, paradaId) {
    const store = global.PacoteEMatoRotaStore;
    const rota = await store?.obterRota?.(rotaId);
    if (!rota) return false;
    const alvo = (rota.paradas || []).find(p => String(p.id) === String(paradaId));
    if (!alvo || !['entregue','concluida','nao_entregue'].includes(String(alvo.statusEntrega || ''))) return false;

    const ativa = await store?.obterRotaAtiva?.();
    const complemento = ativa && String(ativa.id) !== String(rota.id)
      ? ' A rota que está aberta agora continuará salva no Histórico.'
      : '';
    const ok = await global.PacoteEMatoDialog?.confirmar?.({
      titulo: 'Reabrir rota para correção?',
      mensagem: `A parada “${alvo.enderecoOriginal || 'selecionada'}” voltará para Pendente. A mesma rota será reaberta sem mudar a ordem, os pacotes ou a otimização.${complemento}`,
      confirmar: 'Reabrir e corrigir',
      cancelar: 'Cancelar'
    });
    if (ok === false) return false;

    const corrigida = prepararRotaParaCorrecao(rota, paradaId);
    if (!corrigida) return false;
    await store.salvarRota(corrigida, { ativa: true, exigirPersistenciaLocal: true });
    try {
      await global.PacoteEMatoSessao?.persistirAgora?.({
        motivo: 'historico_corrigir_status',
        rotaAtivaId: corrigida.id,
        moduloAtual: 'roteirizacao',
        paradaSelecionadaId: String(paradaId),
        proximaParadaId: String(paradaId)
      });
    } catch (_) {}
    if ($('routeHistoryDetailModal')) $('routeHistoryDetailModal').style.display = 'none';
    await global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');
    global.notificar?.('Rota reaberta. Somente a parada escolhida voltou para Pendente.');
    return true;
  }

  function criarParadaDetalhe(rota, p, indice) {
    const item = document.createElement('article');
    item.className = 'history-stop-item history-stop-item-v81';
    item.dataset.status = String(p.statusEntrega || 'pendente');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'history-stop-toggle';
    const numero = Number(p.ordemOtimizada || 0) || (indice + 1);
    const title = document.createElement('strong');
    title.textContent = `${numero}. ${p.enderecoOriginal || 'Endereço'}`;
    const status = document.createElement('span');
    status.textContent = textoStatus(p);
    toggle.append(title, status);

    const detail = document.createElement('div');
    detail.className = 'history-stop-expanded';
    detail.hidden = true;
    detail.append(
      criarLinha('Número', String(numero)),
      criarLinha('Endereço', p.enderecoOriginal || '—'),
      criarLinha('Status', textoStatus(p)),
      criarLinha('Observação', String(p.observacao || p.complemento || '—'))
    );
    if (p.statusEntrega === 'nao_entregue') detail.appendChild(criarLinha('Motivo', String(p.motivoNaoEntrega || p.observacaoNaoEntrega || 'Não informado')));
    if (p.observacaoEntrega) detail.appendChild(criarLinha('Nota da entrega', String(p.observacaoEntrega)));

    if (['entregue','concluida','nao_entregue'].includes(String(p.statusEntrega || ''))) {
      const corrigir = document.createElement('button');
      corrigir.type = 'button';
      corrigir.className = 'pemato-secondary history-correct-status';
      corrigir.textContent = 'Corrigir status';
      corrigir.addEventListener('click', () => corrigirStatusRotaConcluida(rota.id, p.id));
      detail.appendChild(corrigir);
    }

    toggle.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      toggle.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true');
    });
    toggle.setAttribute('aria-expanded', 'false');
    item.append(toggle, detail);
    return item;
  }

  async function abrirDetalhes(id) {
    const rota = await global.PacoteEMatoRotaStore.obterRota(id);
    if (!rota) return;
    const modal = $('routeHistoryDetailModal');
    const body = $('routeHistoryDetailBody');
    if (!modal || !body) return;
    body.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = rota.nome || 'Rota';
    body.append(
      title,
      criarLinha('Data', rota.data || '—'),
      criarLinha('Paradas', String(rota.paradas.length)),
      criarLinha('Distância', formatarDistancia(rota.distanciaTotalMetros)),
      criarLinha('Direção', formatarTempo(rota.duracaoDirecaoSegundos)),
      criarLinha('Tempo total', formatarTempo(rota.duracaoTotalSegundos)),
      criarLinha('Entregues', String(rota.paradas.filter(p => ['entregue','concluida'].includes(p.statusEntrega)).length)),
      criarLinha('Não entregues', String(rota.paradas.filter(p => p.statusEntrega === 'nao_entregue').length))
    );
    const stops = document.createElement('div');
    stops.className = 'history-stop-list';
    const porId = new Map((rota.paradas || []).map(p => [String(p.id), p]));
    const ordenadas = (rota.ordem || []).map(idParada => porId.get(String(idParada))).filter(Boolean);
    (rota.paradas || []).forEach(p => { if (!ordenadas.includes(p)) ordenadas.push(p); });
    ordenadas.forEach((p, indice) => stops.appendChild(criarParadaDetalhe(rota, p, indice)));
    body.appendChild(stops);
    modal.style.display = 'flex';
  }

  async function abrirNoMapa(id) {
    const rota = await global.PacoteEMatoRotaStore?.obterRota?.(id);
    if (!rota) return;
    const ativa = await global.PacoteEMatoRotaStore?.obterRotaAtiva?.();
    if (ativa && String(ativa.id) !== String(rota.id)) {
      const ok = await global.PacoteEMatoDialog.confirmar({titulo:'Abrir rota no mapa?',mensagem:`A rota “${rota.nome || 'esta rota'}” será aberta agora. A rota atual continuará salva no Histórico.`,confirmar:'Abrir rota',cancelar:'Cancelar'});
      if (!ok) return;
    }
    const carregada = await global.PacoteEMatoRotaStore?.ativarRotaExistente?.(rota.id);
    if (!carregada) return;
    try { await global.PacoteEMatoSessao?.persistirAgora?.({ motivo: 'historico_mapa', rotaAtivaId: carregada.id, moduloAtual: 'roteirizacao', paradaSelecionadaId: carregada.paradaSelecionadaId || carregada.ordem?.[0] || null }); } catch (_) {}
    await global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');
  }

  async function renderizar() {
    const container = $('historyRoutesList');
    if (!container || !global.PacoteEMatoRotaStore) return;
    const { inicio, fim } = datasDoFiltro();
    const rotas = await global.PacoteEMatoRotaStore.listarRotas({ dataInicio: inicio, dataFim: fim });
    container.replaceChildren();
    if (!rotas.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'Nenhuma rota encontrada para este período.';
      container.appendChild(empty);
      return;
    }
    rotas.forEach(rota => {
      const card = document.createElement('article');
      card.className = 'history-route-card-v2';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'history-route-open';
      open.addEventListener('click', () => abrirNoMapa(rota.id));
      const top = document.createElement('div');
      top.className = 'history-route-top';
      const name = document.createElement('strong');
      name.textContent = rota.nome || 'Rota';
      const date = document.createElement('span');
      date.textContent = rota.data ? new Date(rota.data + 'T12:00:00').toLocaleDateString('pt-BR') : '';
      top.append(name, date);
      const meta = document.createElement('div');
      meta.className = 'history-route-meta';
      const delivered = rota.paradas.filter(p => ['entregue','concluida'].includes(p.statusEntrega)).length;
      const failed = rota.paradas.filter(p => p.statusEntrega === 'nao_entregue').length;
      meta.textContent = `${rota.paradas.length} paradas · ${formatarDistancia(rota.distanciaTotalMetros)} · ${formatarTempo(rota.duracaoTotalSegundos)} · ${delivered} entregues · ${failed} não entregues`;
      open.append(top, meta);
      const actions = document.createElement('div');
      actions.className = 'history-route-actions';
      const mapBtn = document.createElement('button');
      mapBtn.type = 'button'; mapBtn.className = 'pemato-primary'; mapBtn.textContent = 'Abrir no mapa';
      mapBtn.addEventListener('click', () => abrirNoMapa(rota.id));
      const detailBtn = document.createElement('button');
      detailBtn.type = 'button'; detailBtn.className = 'pemato-secondary'; detailBtn.textContent = 'Ver detalhes';
      detailBtn.addEventListener('click', () => abrirDetalhes(rota.id));
      actions.append(mapBtn, detailBtn);
      card.append(open, actions);
      container.appendChild(card);
    });
  }

  function bind() {
    ['historyFilter','historyDate','historyStart','historyEnd'].forEach(id => $(id)?.addEventListener('change', renderizar));
    $('historyRefreshBtn')?.addEventListener('click', renderizar);
    $('historyLegacyBtn')?.addEventListener('click', () => {
      if (typeof global.abrirModalHistorico === 'function') global.abrirModalHistorico();
    });
    $('routeHistoryDetailClose')?.addEventListener('click', () => { if ($('routeHistoryDetailModal')) $('routeHistoryDetailModal').style.display = 'none'; });
    global.addEventListener('pemato:rota:salva', renderizar);
    renderizar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();

  global.PacoteEMatoHistorico = Object.freeze({ renderizar, abrirDetalhes, abrirNoMapa, corrigirStatusRotaConcluida, prepararRotaParaCorrecao });
})(window);
