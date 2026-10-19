(function iniciarRoteirizacao(global) {
  'use strict';

  let rotaAtual = null;
  let salvamentoTimer = null;
  let stopEmEdicao = null;
  let modoEdicaoNovo = false;
  let contextoEditor = 'rota';
  let rotaImportacaoPendente = null;
  let resultadoImportacaoPendente = null;
  let resolverDecisaoReotimizacao = null;
  let importacaoPendente = null;
  let resolverMapeamentoImportacao = null;
  let resolverModoImportacao = null;
  let modoImportacaoAtual = 'substituir';
  let estadoPainel = (()=>{try{return sessionStorage.getItem('pemato_route_sheet')||'collapsed';}catch(_){return 'collapsed';}})();
  let sheetDragStartY = null;
  let sheetDragLastY = null;
  let estadoPainelAntesDesenho = null;
  let sugestaoEnderecoSelecionada = null;
  let sugestaoEditorSelecionada = null;
  let sugestaoPontoFinalSelecionada = null;
  let paradaEdicaoBuscaId = null;
  let buscaEnderecoTimer = null;
  let buscaEnderecoSeq = 0;
  let buscaEditorTimer = null;
  let buscaEditorSeq = 0;
  let buscaPontoFinalTimer = null;
  let buscaPontoFinalSeq = 0;
  let gruposDesenhoRefino = [];

  function $(id) { return document.getElementById(id); }

  function contarParadasFisicas(lista) {
    const paradas = Array.isArray(lista) ? lista : [];
    const chaves = new Set();
    paradas.forEach((p, i) => {
      let chave = '';
      try { chave = global.PacoteEMatoMarcadores?.chaveFisicaMarcador?.(p) || ''; } catch (_) {}
      if (!chave) {
        const lat = Number(p?.latitude), lon = Number(p?.longitude);
        chave = Number.isFinite(lat) && Number.isFinite(lon)
          ? `coord:${lat.toFixed(5)}|${lon.toFixed(5)}`
          : `id:${String(p?.id || i)}`;
      }
      chaves.add(chave);
    });
    return chaves.size;
  }
  function clone(v) { return global.PacoteEMatoRotaStore?.clone?.(v) || JSON.parse(JSON.stringify(v)); }
  function agora() { return Date.now(); }

  function coordenadaValida(lat, lon) {
    if (lat === null || lat === undefined || lon === null || lon === undefined) return false;
    if (String(lat).trim() === '' || String(lon).trim() === '') return false;
    const a = Number(lat);
    const o = Number(lon);
    return Number.isFinite(a) && a >= -90 && a <= 90 && Number.isFinite(o) && o >= -180 && o <= 180;
  }

  function pontoValido(p) { return !!p && coordenadaValida(p.lat, p.lon); }
  function paradaLocalizada(p) { return !!p && p.statusGeocodificacao === 'ok' && coordenadaValida(p.latitude, p.longitude); }

  function notificar(msg) {
    if (typeof global.notificar === 'function') global.notificar(msg);
    else console.log(msg);
  }

  function registrarRetornoInterno(tag) {
    global.PacoteEMatoAppShell?.registrarRetornoInterno?.(tag || 'roteirizacao');
  }

  async function mostrarTutorialUnico(chave, titulo, mensagem) {
    try { if (localStorage.getItem(chave) === '1') return false; } catch (_) {}
    await global.PacoteEMatoDialog?.avisar?.({ titulo, mensagem, confirmar: 'Entendi' });
    try { localStorage.setItem(chave, '1'); } catch (_) {}
    return true;
  }

  function garantirConfiguracoesObrigatorias(contexto) {
    return global.PacoteEMatoConfiguracoes?.garantirObrigatorias?.(contexto);
  }

  async function mostrarTutorialPacotesSeNecessario() {
    return mostrarTutorialUnico(
      'pemato_tutorial_pacotes_qr_v58',
      'Como usar Pacotes da rota',
      'Quando você tocar nesta opção, escolha Adicionar pacotes ou Remover pacotes. Em seguida importe a planilha dessa operação e bipe o QR code ou digite o código manualmente. Cada leitura marca somente os pacotes desejados. Ao final, revise a conferência antes de concluir.'
    );
  }

  async function mostrarTutorialRefinoSeNecessario() {
    return mostrarTutorialUnico(
      'pemato_tutorial_refino_v58',
      'Como funciona o refinamento da rota',
      'Refinar rota ajusta somente as paradas pendentes. Você pode inverter a ordem ou desenhar livremente vários grupos no mapa. O Grupo 1 vem primeiro, depois o Grupo 2 e assim por diante. Depois do ajuste, o sistema recalcula a rota preservando o progresso já feito.'
    );
  }

  function idNovo(prefix) {
    if (global.crypto?.randomUUID) return `${prefix}-${global.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function enderecoDaParada(p) {
    const numero = String(p.numero || '').trim();
    const logradouro = limparLogradouroComNumeroDuplicado(String(p.logradouro || '').trim(), numero);
    const principal = [logradouro, numero].filter(Boolean).join(', ');
    const base = principal || String(p.enderecoOriginal || '').trim();
    const local = [p.bairro, p.cidade, p.estado, p.cep].map(v => String(v || '').trim()).filter(Boolean).join(', ');
    return [base, local].filter(Boolean).join(' - ').trim();
  }

  function detalheComplemento(p) {
    const itens = [];
    const chaves = new Set();
    const canon = valor => String(valor || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\b(apartamento|apto|ap)\b/g, 'ap')
      .replace(/\b(bloco|bl)\b/g, 'bloco')
      .replace(/\b(sala|sl)\b/g, 'sala')
      .replace(/\b(loja|lj)\b/g, 'loja')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const add = valor => {
      const texto = String(valor || '').trim();
      if (!texto) return;
      const chave = canon(texto);
      if (!chave || chaves.has(chave)) return;
      chaves.add(chave);
      itens.push(texto);
    };
    add(p.complemento);
    if (p.bloco) add(`Bloco ${p.bloco}`);
    if (p.apartamento) add(`Apartamento ${p.apartamento}`);
    if (p.sala) add(`Sala ${p.sala}`);
    if (p.loja) add(`Loja ${p.loja}`);
    add(p.observacao);
    return itens.join(' · ');
  }

  function enderecoExibicao(p) {
    if (!p) return '';
    const normalizado = enderecoDaParada(p);
    return normalizado || String(p.enderecoOriginal || '').trim();
  }


  function chaveEnderecoMultiplo(p) {
    const texto = String(p?.logradouro || p?.enderecoFonte || p?.enderecoOriginal || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const numero = String(p?.numero || (texto.match(/\b\d+[a-z]?\b/i) || [''])[0] || '').toLowerCase();
    let rua = String(p?.logradouro || p?.enderecoFonte || p?.enderecoOriginal || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (numero) rua = rua.replace(new RegExp(`\\b${numero.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b.*$`, 'i'), '');
    rua = rua.replace(/\b(ap|apto|apartamento|casa|bloco|sala|loja|suite|fundos|frente)\b.*$/i,'').replace(/[^a-z0-9]+/g,' ').trim();
    return rua && numero ? `${rua}|${numero}` : '';
  }

  function mapaMultiplicidades() {
    const counts = new Map();
    (rotaAtual?.paradas || []).forEach(p => { const k = chaveEnderecoMultiplo(p); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
    return counts;
  }

  function multiplicidadeDaParada(p, counts) {
    const k = chaveEnderecoMultiplo(p);
    return k ? Number((counts || mapaMultiplicidades()).get(k) || 1) : 1;
  }

  function statusGeoTexto(p) {
    const map = {
      ok: 'Localizada',
      consultando: 'Localizando',
      ambiguo: 'Precisa de correção',
      nao_encontrado: 'Endereço não localizado',
      nao_configurado: 'Serviço não configurado',
      erro: 'Falha ao localizar',
      pendente: 'Aguardando localização'
    };
    return map[p?.statusGeocodificacao] || 'Aguardando localização';
  }

  function statusEntregaTexto(p) {
    if (p.statusEntrega === 'nao_entregue') return 'Não entregue';
    if (['entregue', 'concluida'].includes(p.statusEntrega)) return 'Entregue';
    if (Number(p.quantidadeBipada || 0) > 0) return 'Parcial';
    return 'Pendente';
  }

  function formatarDistancia(m) {
    const n = Number(m);
    if (!Number.isFinite(n)) return '—';
    return n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(n)} m`;
  }

  function formatarTempo(seg) {
    const n = Number(seg);
    if (!Number.isFinite(n)) return '—';
    const min = Math.max(0, Math.round(n / 60));
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return `${m} min`;
    return `${h}h${String(m).padStart(2, '0')}`;
  }

  function horaLocal(timestamp) {
    if (!timestamp) return '—';
    try { return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return '—'; }
  }

  function mostrarProcessamento(titulo, mensagem) {
    const overlay = $('routingBusyOverlay');
    if (!overlay) return;
    if ($('routingBusyTitle')) $('routingBusyTitle').textContent = titulo || 'Processando rota';
    if ($('routingBusyMessage')) $('routingBusyMessage').textContent = mensagem || 'Aguarde um instante.';
    overlay.style.display = 'flex';
  }

  function atualizarProcessamento(titulo, mensagem) {
    if ($('routingBusyTitle') && titulo) $('routingBusyTitle').textContent = titulo;
    if ($('routingBusyMessage') && mensagem) $('routingBusyMessage').textContent = mensagem;
  }

  function esconderProcessamento() {
    const overlay = $('routingBusyOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function garantirPontoInicialParaOtimizacao() {
    const atual = rotaAtual?.pontoInicial;
    atualizarProcessamento('Obtendo ponto de partida', 'Atualizando sua posição antes de calcular a rota.');
    try {
      const local = await global.PacoteEMatoLocalizacaoAtual?.obter?.({ forcar: true });
      if (local && coordenadaValida(local.lat, local.lon)) {
        rotaAtual.pontoInicial = {
          tipo: 'gps',
          descricao: 'Posição GPS usada ao otimizar',
          lat: Number(local.lat),
          lon: Number(local.lon),
          accuracy: Number(local.accuracy || 0),
          obtidaEm: Number(local.timestamp || Date.now()),
          status: 'ok'
        };
        return rotaAtual.pontoInicial;
      }
    } catch (_) {}

    // Contingência: uma rota já carregada pode manter a última origem válida.
    if (pontoValido(atual)) return atual;
    throw new Error('Não foi possível obter sua localização. Ative a permissão de localização e tente novamente.');
  }

  function preencherRevisaoOtimizacao() {
    if (!rotaAtual) return;
    if ($('routingReviewStops')) $('routingReviewStops').textContent = String(contarParadasFisicas(rotaAtual.paradas));
    if ($('routingReviewDistance')) $('routingReviewDistance').textContent = formatarDistancia(rotaAtual.distanciaTotalMetros);
    if ($('routingReviewDrive')) $('routingReviewDrive').textContent = formatarTempo(rotaAtual.duracaoDirecaoSegundos);
    if ($('routingReviewService')) $('routingReviewService').textContent = formatarTempo(rotaAtual.duracaoParadasSegundos);
    if ($('routingReviewTotal')) $('routingReviewTotal').textContent = formatarTempo(rotaAtual.duracaoTotalSegundos);
    if ($('routingReviewEnd')) $('routingReviewEnd').textContent = horaLocal(rotaAtual.horarioTerminoEstimado);
    if ($('routingReviewStart')) $('routingReviewStart').textContent = rotaAtual.pontoInicial?.descricao || 'Ponto de partida';
    if ($('routingReviewEndPoint')) $('routingReviewEndPoint').textContent = rotaAtual.retornarAoInicio === true
      ? 'Retornar ao ponto de partida'
      : (rotaAtual.pontoFinal?.descricao || 'Sem ponto final adicional');

    const list = $('routingReviewStopsList');
    if (list) {
      list.replaceChildren();
      const byId = new Map((rotaAtual.paradas || []).map(p => [String(p.id), p]));
      (rotaAtual.ordem || []).forEach((id, index) => {
        const parada = byId.get(String(id));
        if (!parada) return;
        const row = document.createElement('div');
        row.className = 'routing-review-stop';
        const num = document.createElement('span');
        num.className = 'routing-review-number';
        num.textContent = String(index + 1);
        const copy = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = parada.enderecoFonte || parada.enderecoOriginal || 'Parada';
        const small = document.createElement('small');
        small.textContent = [detalheComplemento(parada), parada.bairro, parada.cidade, `${parada.pacotes?.length || 0} pacote(s)`].filter(Boolean).join(' · ');
        copy.append(strong, small);
        row.append(num, copy);
        list.appendChild(row);
      });
    }

    atualizarBotoesRefino();
  }

  function abrirRevisaoOtimizacao() {
    preencherRevisaoOtimizacao();
    const backdrop = $('routingOptimizationReviewBackdrop');
    if (backdrop) backdrop.style.display = 'flex';
    registrarRetornoInterno('review_otimizacao');
  }

  function fecharRevisaoOtimizacao() {
    const backdrop = $('routingOptimizationReviewBackdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  async function confirmarRevisaoOtimizacao() {
    if (!rotaAtual) return;
    rotaAtual.confirmadaEm = Date.now();
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    fecharRevisaoOtimizacao();
    renderizarTudo({ fit: true });
    notificar('Rota confirmada. Você pode iniciar a navegação ou abrir a Bipagem.');
  }

  function abrirRefinoStandalone() {
    atualizarBotoesRefino();
    const backdrop = $('routingRefineBackdrop');
    const painel = $('routingRefinePanel');
    if (!backdrop || !painel) return;
    painel.style.display = 'grid';
    backdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    registrarRetornoInterno('refino');
  }

  async function abrirRefinoComTutorial() {
    await mostrarTutorialRefinoSeNecessario();
    abrirRefinoStandalone();
  }

  function fecharRefinoStandalone() {
    const backdrop = $('routingRefineBackdrop');
    if (backdrop) backdrop.style.display = 'none';
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  async function alternarRefino() {
    const backdrop = $('routingRefineBackdrop');
    if (!backdrop) return;
    if (backdrop.style.display === 'flex') {
      fecharRefinoStandalone();
      return;
    }
    await mostrarTutorialRefinoSeNecessario();
    abrirRefinoStandalone();
  }


  function paradaFinalizada(p) {
    return !!p && ['entregue', 'concluida', 'nao_entregue'].includes(String(p.statusEntrega || ''));
  }

  function atualizarBotoesRefino() {
    const temRota = !!rotaAtual?.geometria;
    const historico = Array.isArray(rotaAtual?.historicoRefino) ? rotaAtual.historicoRefino : [];
    if ($('routingRefineInvertBtn')) $('routingRefineInvertBtn').disabled = !temRota;
    if ($('routingRefineDrawBtn')) $('routingRefineDrawBtn').disabled = !temRota;
    if ($('routingRefineUndoBtn')) $('routingRefineUndoBtn').disabled = !historico.length;
  }

  function atualizarIndicesOrdem() {
    if (!rotaAtual) return;
    const byId = new Map((rotaAtual.paradas || []).map(p => [String(p.id), p]));
    (rotaAtual.ordem || []).forEach((id, index) => {
      const p = byId.get(String(id));
      if (p) p.ordemOtimizada = index + 1;
    });
  }

  function reconstruirComPendentes(novaOrdemPendentes) {
    if (!rotaAtual) return [];
    const byId = new Map((rotaAtual.paradas || []).map(p => [String(p.id), p]));
    const fila = [...novaOrdemPendentes].map(String);
    let cursor = 0;
    return (rotaAtual.ordem || []).map(id => {
      const p = byId.get(String(id));
      if (paradaFinalizada(p)) return String(id);
      return fila[cursor++] || String(id);
    });
  }

  function snapshotRefino(tipo) {
    return { tipo: String(tipo || 'manual'), em: Date.now(), ordem: [...(rotaAtual?.ordem || [])] };
  }

  async function recalcularAposRefino(tipo, mensagem, opcoes) {
    if (!rotaAtual) return false;
    const antes = opcoes?.rollback ? clone(opcoes.rollback) : clone(rotaAtual);
    try {
      mostrarProcessamento('Atualizando sua rota', 'Recalculando o trajeto pelas ruas sem perder o progresso das entregas.');
      atualizarIndicesOrdem();
      const route = await global.PacoteEMatoServicoRota.calcularRotaPelasRuas(rotaAtual);
      const feature = route.feature;
      rotaAtual.geometria = feature.geometry;
      if (!(rotaAtual.paradas || []).some(paradaFinalizada)) global.PacoteEMatoMarcadores?.capturarBaseVisualStatus?.(rotaAtual, true);
      rotaAtual.distanciaTotalMetros = Number(feature.properties?.distance || 0);
      rotaAtual.duracaoDirecaoSegundos = Number(feature.properties?.time || 0);
      rotaAtual.pernas = Array.isArray(feature.properties?.legs) ? feature.properties.legs : [];
      rotaAtual.instrucoes = global.PacoteEMatoServicoRota.extrairInstrucoes(feature);
      const pendentes = rotaAtual.paradas.filter(p => !paradaFinalizada(p)).length;
      rotaAtual.duracaoParadasSegundos = pendentes * Number(rotaAtual.tempoParadaSegundos || 0);
      rotaAtual.duracaoTotalSegundos = rotaAtual.duracaoDirecaoSegundos + rotaAtual.duracaoParadasSegundos;
      rotaAtual.horarioTerminoEstimado = Date.now() + rotaAtual.duracaoTotalSegundos * 1000;
      rotaAtual.rotaOtimizada = true;
      rotaAtual.precisaRecalculo = false;
      rotaAtual.tipoRefino = tipo || 'manual';
      rotaAtual.otimizadoEm = Date.now();
      rotaAtual.confirmadaEm = null;

      // V45: antes de a operação começar, qualquer refinamento redefine a
      // primeira parada operacional pela NOVA ordem. Assim, ao inverter a rota,
      // a antiga última parada passa de fato a ser a primeira da corrida.
      if (!rotaAtual.iniciadoEm) {
        const porId = new Map((rotaAtual.paradas || []).map(p => [String(p.id), p]));
        const primeiraPendenteNovaOrdem = (rotaAtual.ordem || []).map(String)
          .find(id => porId.get(id) && !paradaFinalizada(porId.get(id))) || null;
        rotaAtual.paradaSelecionadaId = primeiraPendenteNovaOrdem;
        rotaAtual.proximaParadaId = primeiraPendenteNovaOrdem;
        if (global.appState?.roteirizacao) {
          global.appState.roteirizacao.paradaSelecionadaId = primeiraPendenteNovaOrdem;
          global.appState.roteirizacao.proximaParadaId = primeiraPendenteNovaOrdem;
        }
        if (global.appState?.navegacao) {
          global.appState.navegacao.paradaExibidaId = primeiraPendenteNovaOrdem;
          global.appState.navegacao.paradaAtualId = primeiraPendenteNovaOrdem;
          global.appState.navegacao.proximaParadaId = primeiraPendenteNovaOrdem;
        }
        try { sessionStorage.removeItem('pemato_parada_externa'); } catch (_) {}
      }

      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      renderizarTudo({ fit: true });
      atualizarBotoesRefino();
      if (opcoes?.abrirRevisao !== false) abrirRevisaoOtimizacao();
      if (mensagem) notificar(mensagem);
      return true;
    } catch (erro) {
      rotaAtual = antes;
      aplicarRotaNoState();
      renderizarTudo({ fit: true });
      notificar(erro?.message || 'Não foi possível recalcular a rota depois da alteração. A ordem anterior foi restaurada.');
      return false;
    } finally {
      esconderProcessamento();
    }
  }

  async function aplicarOrdemRefinada(novaOrdem, tipo, mensagem, opcoes) {
    if (!rotaAtual || !Array.isArray(novaOrdem) || novaOrdem.length !== rotaAtual.ordem.length) return false;
    const rollback = clone(rotaAtual);
    const idsAtuais = new Set((rotaAtual.ordem || []).map(String));
    if (novaOrdem.some(id => !idsAtuais.has(String(id)))) return false;
    if (opcoes?.registrarHistorico !== false) {
      const historico = Array.isArray(rotaAtual.historicoRefino) ? [...rotaAtual.historicoRefino] : [];
      historico.push(snapshotRefino(tipo));
      rotaAtual.historicoRefino = historico.slice(-8);
    }
    rotaAtual.ordem = novaOrdem.map(String);
    return recalcularAposRefino(tipo, mensagem, Object.assign({}, opcoes || {}, { rollback }));
  }

  async function desfazerUltimoRefino() {
    if (!rotaAtual) return;
    const rollback = clone(rotaAtual);
    fecharRefinoStandalone();
    fecharRevisaoOtimizacao();
    const historico = Array.isArray(rotaAtual.historicoRefino) ? [...rotaAtual.historicoRefino] : [];
    const ultimo = historico.pop();
    if (!ultimo?.ordem?.length) return notificar('Não há uma alteração manual para desfazer.');
    const ordemAntes = [...rotaAtual.ordem];
    rotaAtual.historicoRefino = historico;
    rotaAtual.ordem = ultimo.ordem.map(String);
    const ok = await recalcularAposRefino('desfazer', 'Última alteração de ordem desfeita.', { abrirRevisao: false, rollback });
    if (ok) abrirRefinoStandalone();
    if (!ok) {
      rotaAtual.ordem = ordemAntes;
      rotaAtual.historicoRefino = [...historico, ultimo];
    }
  }

  async function otimizarAutomaticamenteRefino() {
    if (!rotaAtual) return;
    rotaAtual.preferenciaRota = 'short';
    fecharRefinoStandalone();
    fecharRevisaoOtimizacao();
    await otimizarRota({ refinamento: true });
  }

  function idsPendentesOrdenados() {
    if (!rotaAtual) return [];
    const byId = new Map((rotaAtual.paradas || []).map(p => [String(p.id), p]));
    return (rotaAtual.ordem || []).map(String).filter(id => !paradaFinalizada(byId.get(id)));
  }

  function atualizarResumoGruposDesenho() {
    const host = $('routingDrawGroups');
    if (host) {
      host.replaceChildren();
      gruposDesenhoRefino.forEach((grupo, index) => {
        const chip = document.createElement('span');
        chip.className = 'routing-draw-group-chip';
        chip.innerHTML = `<strong>Grupo ${index + 1}</strong> · ${grupo.length} ${grupo.length === 1 ? 'parada' : 'paradas'}`;
        host.appendChild(chip);
      });
    }
    const proximoNumero = gruposDesenhoRefino.length + 1;
    const btnAdicionar = $('routingDrawAddGroupBtn');
    if (btnAdicionar) btnAdicionar.textContent = `Adicionar como Grupo ${proximoNumero}`;
    const btnAplicar = $('routingDrawApplyGroupsBtn');
    if (btnAplicar) btnAplicar.disabled = gruposDesenhoRefino.length < 1 && !(global.PacoteEMatoMapa?.obterSelecaoDesenho?.().length);
    const btnUndo = $('routingDrawUndoGroupBtn');
    if (btnUndo) btnUndo.disabled = gruposDesenhoRefino.length < 1;
    const btnClear = $('routingDrawClearGroupsBtn');
    if (btnClear) btnClear.disabled = gruposDesenhoRefino.length < 1;
  }

  function atualizarToolbarDesenho(detail) {
    const count = Number(detail?.count ?? global.PacoteEMatoMapa?.obterSelecaoDesenho?.().length ?? 0);
    if ($('routingDrawCount')) {
      const grupos = gruposDesenhoRefino.length;
      const atual = `${count} ${count === 1 ? 'parada no desenho atual' : 'paradas no desenho atual'}`;
      $('routingDrawCount').textContent = grupos ? `${atual} · ${grupos} ${grupos === 1 ? 'grupo salvo' : 'grupos salvos'}` : atual;
    }
    if ($('routingDrawAddGroupBtn')) $('routingDrawAddGroupBtn').disabled = count < 1;
    const mode = detail?.mode || 'draw';
    if ($('routingDrawInteractionBtn')) $('routingDrawInteractionBtn').textContent = mode === 'draw' ? 'Mover mapa' : 'Voltar a desenhar';
    atualizarResumoGruposDesenho();
    atualizarBotoesRefino();
  }

  function iniciarRefinoDesenho() {
    if (!rotaAtual?.geometria) return notificar('Calcule a rota antes de organizar pelo mapa.');
    const localizadasPendentes = rotaAtual.paradas.filter(p => !paradaFinalizada(p) && paradaLocalizada(p));
    if (!localizadasPendentes.length) return notificar('Não há paradas pendentes com coordenadas válidas para selecionar.');
    fecharRefinoStandalone();
    fecharRevisaoOtimizacao();
    fecharMenuAcoes();
    gruposDesenhoRefino = [];
    estadoPainelAntesDesenho = estadoPainel;
    definirEstadoPainel('collapsed');
    $('routingWorkspace')?.classList.add('is-draw-mode');
    if ($('routingDrawToolbar')) $('routingDrawToolbar').style.display = 'block';
    global.PacoteEMatoMapa?.iniciarSelecaoDesenho?.({ ids: [], mode: 'draw' });
    atualizarToolbarDesenho({ count: 0, mode: 'draw' });
    setTimeout(() => global.PacoteEMatoMapa?.renderizar?.(), 60);
  }

  function cancelarRefinoDesenho(opcoes) {
    global.PacoteEMatoMapa?.encerrarSelecaoDesenho?.({ limpar: true });
    gruposDesenhoRefino = [];
    $('routingWorkspace')?.classList.remove('is-draw-mode');
    if ($('routingDrawToolbar')) $('routingDrawToolbar').style.display = 'none';
    if (estadoPainelAntesDesenho && opcoes?.restaurarPainel !== false) definirEstadoPainel(estadoPainelAntesDesenho);
    estadoPainelAntesDesenho = null;
    if (opcoes?.reabrir !== false && rotaAtual?.geometria) abrirRefinoStandalone();
  }

  function adicionarGrupoDesenho() {
    if (!rotaAtual) return false;
    const selecionados = new Set((global.PacoteEMatoMapa?.obterSelecaoDesenho?.() || []).map(String));
    if (!selecionados.size) { notificar('Desenhe ao redor das paradas que formarão o próximo grupo.'); return false; }
    const jaUsados = new Set(gruposDesenhoRefino.flat().map(String));
    const grupo = idsPendentesOrdenados().filter(id => selecionados.has(id) && !jaUsados.has(id));
    if (!grupo.length) { notificar('Todas as paradas desse desenho já estão em grupos anteriores.'); return false; }
    const numero = gruposDesenhoRefino.length + 1;
    const salvo = global.PacoteEMatoMapa?.salvarGrupoDesenho?.({ numero, ids: grupo });
    if (!salvo) { notificar('Feche um desenho ao redor das paradas antes de salvar o grupo.'); return false; }
    gruposDesenhoRefino.push(grupo);
    atualizarToolbarDesenho({ count: 0, mode: 'draw' });
    notificar(`Grupo ${numero} salvo com ${grupo.length} ${grupo.length === 1 ? 'parada' : 'paradas'}. Desenhe o próximo grupo.`);
    return true;
  }

  function desfazerUltimoGrupoDesenho() {
    if (!gruposDesenhoRefino.length) return notificar('Ainda não há grupo desenhado para desfazer.');
    const numero = gruposDesenhoRefino.length;
    gruposDesenhoRefino.pop();
    global.PacoteEMatoMapa?.desfazerUltimoGrupoDesenho?.();
    atualizarToolbarDesenho({ count: global.PacoteEMatoMapa?.obterSelecaoDesenho?.().length || 0, mode: 'draw' });
    notificar(`Grupo ${numero} removido.`);
  }

  function limparGruposDesenho() {
    gruposDesenhoRefino = [];
    global.PacoteEMatoMapa?.limparGruposDesenho?.();
    atualizarToolbarDesenho({ count: 0, mode: 'draw' });
  }

  async function aplicarGruposDesenho() {
    if (!rotaAtual) return;
    if ((global.PacoteEMatoMapa?.obterSelecaoDesenho?.() || []).length) adicionarGrupoDesenho();
    if (!gruposDesenhoRefino.length) return notificar('Desenhe e salve pelo menos um grupo antes de aplicar a sequência.');
    const pendentes = idsPendentesOrdenados();
    const pendentesSet = new Set(pendentes);
    const usados = new Set();
    const sequencia = [];
    gruposDesenhoRefino.forEach(grupo => grupo.forEach(id => {
      const key = String(id);
      if (pendentesSet.has(key) && !usados.has(key)) { usados.add(key); sequencia.push(key); }
    }));
    pendentes.forEach(id => { if (!usados.has(id)) sequencia.push(id); });
    const novaOrdem = reconstruirComPendentes(sequencia);
    const quantidadeGrupos = gruposDesenhoRefino.length;
    const ok = await aplicarOrdemRefinada(
      novaOrdem,
      'desenho_grupos',
      `${quantidadeGrupos} ${quantidadeGrupos === 1 ? 'grupo desenhado foi aplicado' : 'grupos desenhados foram aplicados'} na sequência escolhida.`,
      { abrirRevisao: false }
    );
    if (ok) {
      cancelarRefinoDesenho({ reabrir: false });
      abrirRefinoStandalone();
    }
  }

  function aplicarRotaNoState() {
    if (!rotaAtual || !global.appState?.roteirizacao) return;
    const s = global.appState.roteirizacao;
    s.rotaAtivaId = rotaAtual.id;
    s.origem = rotaAtual.origem;
    s.nome = rotaAtual.nome;
    s.pontoInicial = rotaAtual.pontoInicial;
    s.pontoFinal = rotaAtual.pontoFinal;
    s.retornarAoInicio = rotaAtual.retornarAoInicio;
    s.veiculo = rotaAtual.veiculo;
    s.modoRoteamento = rotaAtual.modoRoteamento;
    s.preferenciaRota = rotaAtual.preferenciaRota || 'short';
    s.tempoParadaSegundos = rotaAtual.tempoParadaSegundos;
    s.paradas = rotaAtual.paradas;
    s.ordem = rotaAtual.ordem;
    s.geometria = rotaAtual.geometria;
    s.visualStatusBase = rotaAtual.visualStatusBase || null;
    s.instrucoes = rotaAtual.instrucoes;
    s.pernas = rotaAtual.pernas;
    s.distanciaTotalMetros = rotaAtual.distanciaTotalMetros;
    s.duracaoDirecaoSegundos = rotaAtual.duracaoDirecaoSegundos;
    s.duracaoParadasSegundos = rotaAtual.duracaoParadasSegundos;
    s.duracaoTotalSegundos = rotaAtual.duracaoTotalSegundos;
    s.horarioTerminoEstimado = rotaAtual.horarioTerminoEstimado;
    s.rotaOtimizada = rotaAtual.rotaOtimizada === true;
    s.precisaRecalculo = rotaAtual.precisaRecalculo === true;
    if (!s.paradaSelecionadaId || !rotaAtual.paradas.some(p => p.id === s.paradaSelecionadaId)) {
      s.paradaSelecionadaId = rotaAtual.ordem[0] || rotaAtual.paradas[0]?.id || null;
    }
  }

  function agendarSalvar() {
    clearTimeout(salvamentoTimer);
    salvamentoTimer = setTimeout(async () => {
      if (!rotaAtual) return;
      rotaAtual.alteradoEm = agora();
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      aplicarRotaNoState();
      renderizarTudo();
    }, 220);
  }

  function invalidarRotaCalculada() {
    if (!rotaAtual) return;
    rotaAtual.rotaOtimizada = false;
    rotaAtual.geometria = null;
    rotaAtual.instrucoes = [];
    rotaAtual.pernas = [];
    rotaAtual.distanciaTotalMetros = null;
    rotaAtual.duracaoDirecaoSegundos = null;
    rotaAtual.duracaoParadasSegundos = null;
    rotaAtual.duracaoTotalSegundos = null;
    rotaAtual.horarioTerminoEstimado = null;
    rotaAtual.otimizadoEm = null;
  }

  async function recalcularOrdemAtual() {
    if (!rotaAtual) return false;
    if (!pontoValido(rotaAtual.pontoInicial)) {
      notificar('Defina um ponto de partida válido para recalcular a rota atual.');
      return false;
    }
    const semCoordenada = rotaAtual.paradas.filter(p => !['entregue', 'concluida', 'nao_entregue'].includes(p.statusEntrega) && (
      !paradaLocalizada(p)
    ));
    if (semCoordenada.length) {
      notificar(`Existem ${semCoordenada.length} parada(s) sem localização válida.`);
      return false;
    }
    try {
      await validarCoordenadasXlsxAntesDaRota();
      const byId = new Map(rotaAtual.paradas.map(p => [p.id, p]));
      (rotaAtual.ordem || []).forEach((id, index) => {
        const parada = byId.get(id);
        if (parada) parada.ordemOtimizada = index + 1;
      });
      const route = await global.PacoteEMatoServicoRota.calcularRotaPelasRuas(rotaAtual);
      const feature = route.feature;
      rotaAtual.geometria = feature.geometry;
      if (!(rotaAtual.paradas || []).some(paradaFinalizada)) global.PacoteEMatoMarcadores?.capturarBaseVisualStatus?.(rotaAtual, true);
      rotaAtual.distanciaTotalMetros = Number(feature.properties?.distance || 0);
      rotaAtual.duracaoDirecaoSegundos = Number(feature.properties?.time || 0);
      rotaAtual.pernas = Array.isArray(feature.properties?.legs) ? feature.properties.legs : [];
      rotaAtual.instrucoes = global.PacoteEMatoServicoRota.extrairInstrucoes(feature);
      const pendentes = rotaAtual.paradas.filter(p => !['entregue', 'concluida', 'nao_entregue'].includes(p.statusEntrega)).length;
      rotaAtual.duracaoParadasSegundos = pendentes * Number(rotaAtual.tempoParadaSegundos || 0);
      rotaAtual.duracaoTotalSegundos = rotaAtual.duracaoDirecaoSegundos + rotaAtual.duracaoParadasSegundos;
      rotaAtual.horarioTerminoEstimado = Date.now() + rotaAtual.duracaoTotalSegundos * 1000;
      rotaAtual.status = 'ativa';
      rotaAtual.rotaOtimizada = false;
      rotaAtual.precisaRecalculo = false;
      rotaAtual.otimizadoEm = null;
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      renderizarTudo({ fit: true });
      return true;
    } catch (erro) {
      console.error(erro);
      notificar(erro?.message || 'Não foi possível recalcular a rota na ordem atual.');
      return false;
    }
  }

  function perguntarReotimizacao(titulo, texto) {
    const modal = $('routeReoptDecisionModal');
    if (!modal) return Promise.resolve('manter');
    if ($('routeReoptDecisionTitle')) $('routeReoptDecisionTitle').textContent = titulo || 'Rota alterada';
    if ($('routeReoptDecisionText')) $('routeReoptDecisionText').textContent = texto || 'Escolha como atualizar a rota.';
    modal.style.display = 'flex';
    return new Promise(resolve => { resolverDecisaoReotimizacao = resolve; });
  }

  function concluirDecisaoReotimizacao(decisao) {
    const modal = $('routeReoptDecisionModal');
    if (modal) modal.style.display = 'none';
    const resolver = resolverDecisaoReotimizacao;
    resolverDecisaoReotimizacao = null;
    if (resolver) resolver(decisao);
  }

  function obterParadasOrdenadas() {
    if (!rotaAtual) return [];
    const mapa = new Map(rotaAtual.paradas.map(p => [p.id, p]));
    const lista = [];
    (rotaAtual.ordem || []).forEach(id => { const p = mapa.get(id); if (p) lista.push(p); });
    rotaAtual.paradas.forEach(p => { if (!lista.includes(p)) lista.push(p); });
    return lista;
  }

  function workerConfigurado() {
    return !!String(global.PEMATO_MAP_CONFIG?.workerBaseUrl || global.PacoteEMatoMapaConfig?.obterWorkerBaseUrl?.() || '').trim();
  }


  function ambienteMobile() {
    try { return global.matchMedia?.('(max-width: 820px)')?.matches === true; }
    catch (_) { return global.innerWidth <= 820; }
  }

  function definirEstadoPainel(estado) {
    const root = $('routingWorkspace');
    if (!root) return;
    estadoPainel = ['expanded','intermediate','collapsed'].includes(estado) ? estado : 'collapsed';
    root.classList.toggle('sheet-expanded', estadoPainel === 'expanded');
    root.classList.toggle('sheet-intermediate', estadoPainel === 'intermediate');
    root.classList.toggle('sheet-collapsed', estadoPainel === 'collapsed');
    try{sessionStorage.setItem('pemato_route_sheet',estadoPainel);}catch(_){}
    if (global.appState?.ui) global.appState.ui.painelRoteirizacao = estadoPainel;
    $('routingSheetToggle')?.setAttribute('aria-expanded', estadoPainel === 'expanded' ? 'true' : 'false');
    if (estadoPainel === 'expanded') setTimeout(() => $('routingStopSearch')?.focus?.({ preventScroll: true }), 180);
    else setTimeout(() => global.PacoteEMatoMapa?.renderizar?.(), 220);
  }

  function alternarPainel() {
    definirEstadoPainel(estadoPainel === 'expanded' ? 'collapsed' : 'expanded');
  }

  function abrirMenuAcoes() {
    const backdrop = $('routingActionsBackdrop');
    if (!backdrop) return;
    atualizarDisponibilidadeAcoes();
    backdrop.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    registrarRetornoInterno('menu_rota');
  }

  function fecharMenuAcoes() {
    const backdrop = $('routingActionsBackdrop');
    if (backdrop) backdrop.style.display = 'none';
    // O menu bloqueia o scroll somente enquanto está aberto. Manter overflow:hidden
    // depois de fechá-lo travava a tela Início em alguns navegadores móveis.
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  function atualizarDisponibilidadeAcoes() {
    const serviceReady = workerConfigurado();
    document.querySelectorAll('.routing-service-action').forEach(el => { el.style.display = serviceReady ? '' : 'none'; });
    const note = $('routingServiceDeferredNote');
    if (note) note.style.display = serviceReady ? 'none' : 'block';
    const routeReady = !!rotaAtual?.geometria && rotaAtual?.precisaRecalculo !== true;
    document.querySelectorAll('.routing-route-ready-action').forEach(el => { el.style.display = routeReady ? '' : 'none'; });
    if ($('routingInvertBtn')) $('routingInvertBtn').style.display = routeReady ? '' : 'none';
    const mainOptimize = $('routingMainOptimizeBtn');
    if (mainOptimize) {
      mainOptimize.disabled = !rotaAtual?.paradas?.length;
      mainOptimize.dataset.serviceReady = serviceReady ? 'true' : 'false';
      mainOptimize.title = serviceReady ? 'Otimizar a sequência pela rede viária' : 'Serviço seguro de otimização ainda não configurado';
    }
  }

  function atualizarAcaoPrincipal() {
    const btn = $('routingPrimaryActionBtn');
    const empty = $('routingEmptyState');
    const total = rotaAtual?.paradas?.length || 0;
    if (empty) empty.style.display = total ? 'none' : 'flex';
    const primaryGrid = document.querySelector('.routing-primary-grid');
    const rotaPronta = !!rotaAtual?.geometria && rotaAtual?.precisaRecalculo !== true;
    if (primaryGrid) primaryGrid.style.display = rotaPronta ? 'none' : 'grid';
    if (!btn) return;
    if (rotaPronta) {
      btn.textContent = 'Iniciar rota';
      btn.dataset.action = 'iniciar';
      btn.style.display = '';
    } else {
      btn.textContent = '';
      btn.dataset.action = '';
      btn.style.display = 'none';
    }
  }

  function executarAcaoPrincipal() {
    const acao = $('routingPrimaryActionBtn')?.dataset.action || '';
    if (acao === 'importar') return $('routingXlsxInput')?.click();
    if (acao === 'iniciar') return abrirNavegacao();
    if (acao === 'localizar') return geocodificarTodas();
    if (acao === 'otimizar') return otimizarRota();
    definirEstadoPainel('expanded');
  }

  function iniciarArrastePainel() {
    const handle = $('routingSheetHandle');
    if (!handle || handle.dataset.dragBound === '1') return;
    handle.dataset.dragBound = '1';
    handle.addEventListener('pointerdown', event => {
      if (!ambienteMobile()) return;
      sheetDragStartY = event.clientY;
      sheetDragLastY = event.clientY;
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    });
    handle.addEventListener('pointermove', event => {
      if (sheetDragStartY == null) return;
      sheetDragLastY = event.clientY;
    });
    const concluir = () => {
      if (sheetDragStartY == null) return;
      const delta = (sheetDragLastY ?? sheetDragStartY) - sheetDragStartY;
      sheetDragStartY = null;
      sheetDragLastY = null;
      if (Math.abs(delta) < 18) return alternarPainel();
      const estados=['collapsed','intermediate','expanded'];
      const indice=estados.indexOf(estadoPainel);
      definirEstadoPainel(estados[Math.max(0,Math.min(2,indice+(delta<0?1:-1)))]);
    };
    handle.addEventListener('pointerup', concluir);
    handle.addEventListener('pointercancel', concluir);
  }

  function definirStatusImportacao(texto, tom) {
    const el = $('routingImportStatus');
    if (!el) return;
    el.textContent = texto || '';
    el.style.display = texto ? 'block' : 'none';
    if (tom) el.dataset.tone = tom;
    else delete el.dataset.tone;
  }

  function renderizarPreferencias() {
    if (!rotaAtual) return;
    const veiculos = { carro: 'Carro', moto: 'Moto', caminhao: 'Caminhão' };
    if ($('routingPrefsVehicle')) $('routingPrefsVehicle').textContent = veiculos[rotaAtual.veiculo] || 'Carro';
    if ($('routingPrefsStopTime')) $('routingPrefsStopTime').textContent = `${Math.max(0, Math.round(Number(rotaAtual.tempoParadaSegundos || 0) / 60))} min`;
    if ($('routingPrefsStart')) $('routingPrefsStart').textContent = rotaAtual.pontoInicial?.descricao || 'Não definido';
    const service = $('routingServiceStatus');
    if (service) {
      const ok = workerConfigurado();
      service.textContent = ok ? 'Configurado' : 'Não configurado';
      service.dataset.status = ok ? 'ok' : 'warn';
    }
  }

  function renderizarResumo() {
    if (!rotaAtual) return;
    const totalEntregas = rotaAtual.paradas.length;
    const total = contarParadasFisicas(rotaAtual.paradas);
    const localizadasFisicas = contarParadasFisicas(rotaAtual.paradas.filter(p => paradaLocalizada(p)));
    const problemas = Math.max(0, total - localizadasFisicas);
    if ($('routingImportedCount')) $('routingImportedCount').textContent = String(total);
    if ($('routingDeliveryCount')) $('routingDeliveryCount').textContent = String(totalEntregas);
    if ($('routingLocatedCount')) $('routingLocatedCount').textContent = String(localizadasFisicas);
    if ($('routingProblemCount')) $('routingProblemCount').textContent = String(problemas);
    const concluidas = rotaAtual.paradas.filter(p => ['entregue','concluida'].includes(p.statusEntrega)).length;
    const naoEntregues = rotaAtual.paradas.filter(p => p.statusEntrega === 'nao_entregue').length;
    const pendentes = Math.max(0, totalEntregas - concluidas - naoEntregues);
    const calculada = !rotaAtual.precisaRecalculo && !!rotaAtual.geometria && Number.isFinite(Number(rotaAtual.distanciaTotalMetros));
    if ($('routeMetricStops')) $('routeMetricStops').textContent = String(total);
    if ($('routeMetricDelivered')) $('routeMetricDelivered').textContent = String(concluidas);
    if ($('routeMetricPending')) $('routeMetricPending').textContent = String(pendentes);
    if ($('routeMetricDistance')) $('routeMetricDistance').textContent = calculada ? formatarDistancia(rotaAtual.distanciaTotalMetros) : 'Aguardando cálculo';
    if ($('routeMetricDrive')) $('routeMetricDrive').textContent = calculada ? formatarTempo(rotaAtual.duracaoDirecaoSegundos) : 'Aguardando cálculo';
    if ($('routeMetricStopTime')) $('routeMetricStopTime').textContent = calculada ? formatarTempo(rotaAtual.duracaoParadasSegundos) : 'Aguardando cálculo';
    if ($('routeMetricTotal')) $('routeMetricTotal').textContent = calculada ? formatarTempo(rotaAtual.duracaoTotalSegundos) : 'Aguardando cálculo';
    if ($('routeMetricEnd')) $('routeMetricEnd').textContent = calculada ? horaLocal(rotaAtual.horarioTerminoEstimado) : 'Aguardando cálculo';
    if ($('routingRouteName') && document.activeElement !== $('routingRouteName')) $('routingRouteName').value = rotaAtual.nome || '';
    if ($('routingRouteNameMirror') && document.activeElement !== $('routingRouteNameMirror')) $('routingRouteNameMirror').value = rotaAtual.nome || '';
    if ($('routingMapTitle')) $('routingMapTitle').textContent = rotaAtual.nome || 'Rota de hoje';
    const flag = $('routingOptimizedFlag');
    if (flag) {
      flag.textContent = rotaAtual.precisaRecalculo ? 'Recalcular trajeto' : (rotaAtual.rotaOtimizada ? 'Rota otimizada' : 'Rota em planejamento');
      flag.dataset.optimized = rotaAtual.rotaOtimizada && !rotaAtual.precisaRecalculo ? 'true' : 'false';
    }
    const headline = $('routingSheetHeadline');
    const meta = $('routingSheetMeta');
    if (headline) {
      headline.textContent = rotaAtual.precisaRecalculo
        ? 'Rota alterada · recalcule o trajeto'
        : (rotaAtual.horarioTerminoEstimado
          ? `Término: ${horaLocal(rotaAtual.horarioTerminoEstimado)}`
          : (rotaAtual.rotaOtimizada ? 'Rota pronta' : 'Rota em planejamento'));
    }
    if (meta) {
      const paradaTexto = `${total} ${total === 1 ? 'parada' : 'paradas'}`;
      const distancia = formatarDistancia(rotaAtual.distanciaTotalMetros);
      meta.textContent = distancia === '—' ? paradaTexto : `${paradaTexto} · ${distancia}`;
    }
    renderizarPreferencias();
    atualizarDisponibilidadeAcoes();
    atualizarAcaoPrincipal();
  }

  function criarBotao(texto, classe, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classe || 'route-list-action';
    b.textContent = texto;
    b.addEventListener('click', event => { event.stopPropagation(); handler(); });
    return b;
  }

  function renderizarLista() {
    const container = $('routePlannerStops');
    if (!container) return;
    container.replaceChildren();
    if (!rotaAtual?.paradas?.length) {
      const vazio = document.createElement('div');
      vazio.className = 'routing-empty';
      vazio.textContent = 'Importe uma planilha ou adicione uma parada para começar.';
      container.appendChild(vazio);
      return;
    }

    const termoBusca = String($('routingStopSearch')?.value || '').trim().toLowerCase();
    const multiplicidades = mapaMultiplicidades();
    const listaFiltrada = obterParadasOrdenadas().filter(p => {
      if (!termoBusca) return true;
      const alvo = [enderecoExibicao(p), p.cidade, p.observacao, ...(p.pacotes || [])].join(' ').toLowerCase();
      return alvo.includes(termoBusca);
    });
    listaFiltrada.forEach((p, index) => {
      const card = document.createElement('article');
      card.className = 'routing-stop-card';
      if (global.appState?.roteirizacao?.paradaSelecionadaId === p.id) card.classList.add('is-selected');
      if (p.statusGeocodificacao !== 'ok') card.classList.add('needs-location');
      if (p.statusEntrega === 'nao_entregue') card.classList.add('is-failed');
      if (['entregue', 'concluida'].includes(p.statusEntrega)) card.classList.add('is-delivered');
      card.dataset.stopId = p.id;
      card.addEventListener('click', () => selecionarParada(p.id, 'lista'));

      const order = document.createElement('div');
      order.className = 'routing-stop-order';
      const mostrarNumero = numeracaoVisivel();
      order.textContent = mostrarNumero ? String(index + 1) : '';
      if (!mostrarNumero) {
        order.style.display = 'none';
        card.classList.add('is-unordered');
      }

      const body = document.createElement('div');
      body.className = 'routing-stop-body';
      const address = document.createElement('strong');
      address.textContent = enderecoExibicao(p) || 'Endereço não informado';
      const complement = document.createElement('span');
      complement.className = 'routing-stop-complement';
      complement.textContent = detalheComplemento(p) || p.observacao || '';
      const meta = document.createElement('div');
      meta.className = 'routing-stop-meta';
      const multi = multiplicidadeDaParada(p, multiplicidades);
      const quantidadeFisica = global.PacoteEMatoOperacoesPacotes?.quantidadePacotesFisicos?.(rotaAtual, p) ?? (p.pacotes?.length || 0);
      const pacoteTexto = quantidadeFisica ? `${quantidadeFisica} ${quantidadeFisica === 1 ? 'pacote' : 'pacotes'}` : 'Sem código de pacote';
      meta.textContent = `${p.rotaGrupoTipo === 'adicao-bipagem' ? 'Adicionada por bipagem · ' : ''}${multi > 1 ? `${multi}x no mesmo endereço · ` : ''}${pacoteTexto} · ${statusGeoTexto(p)} · ${statusEntregaTexto(p)}`;
      body.append(address);
      if (complement.textContent) body.append(complement);
      body.append(meta);

      const actions = document.createElement('div');
      actions.className = 'routing-stop-actions';
      actions.append(
        criarBotao('Editar', 'route-list-action', () => iniciarEdicaoBusca(p.id)),
        criarBotao('Duplicar', 'route-list-action', () => duplicarParada(p.id)),
        criarBotao('Remover', 'route-list-action danger', () => removerParada(p.id))
      );
      card.append(order, body, actions);
      container.appendChild(card);
    });
  }

  function renderizarParadaSelecionada() {
    const card = $('routingSelectedStopCard');
    if (!card || !rotaAtual) return;
    const id = global.appState?.roteirizacao?.paradaSelecionadaId;
    const p = rotaAtual.paradas.find(item => item.id === id);
    if (!p) {
      card.style.display = 'none';
      return;
    }
    const index = obterParadasOrdenadas().findIndex(item => item.id === p.id);
    const mostrarNumero = numeracaoVisivel();
    card.style.display = 'grid';
    card.classList.toggle('is-unordered', !mostrarNumero);
    if ($('routingSelectedStopOrder')) {
      $('routingSelectedStopOrder').textContent = mostrarNumero ? String(index + 1) : '';
      $('routingSelectedStopOrder').style.display = mostrarNumero ? 'grid' : 'none';
    }
    if ($('routingSelectedStopAddress')) $('routingSelectedStopAddress').textContent = enderecoExibicao(p) || 'Endereço não informado';
    if ($('routingSelectedStopComplement')) $('routingSelectedStopComplement').textContent = detalheComplemento(p) || p.observacao || '';
    if ($('routingSelectedStopMeta')) {
      const quantidadeFisica = global.PacoteEMatoOperacoesPacotes?.quantidadePacotesFisicos?.(rotaAtual, p) ?? (p.pacotes?.length || 0);
      $('routingSelectedStopMeta').textContent = `${quantidadeFisica} ${quantidadeFisica === 1 ? 'pacote' : 'pacotes'} · ${statusGeoTexto(p)} · ${statusEntregaTexto(p)}`;
    }
  }

  function renderizarTudo(opcoes) {
    if (!rotaAtual) return;
    aplicarRotaNoState();
    renderizarResumo();
    renderizarLista();
    renderizarParadaSelecionada();
    global.PacoteEMatoMapa?.renderizar({ fit: opcoes?.fit === true });
    global.PacoteEMatoAppShell?.atualizarInicio?.();
  }

  async function carregarRotaAtiva() {
    const rota = await global.PacoteEMatoRotaStore.obterRotaAtiva();
    if (rota) rotaAtual = rota;
    if (!rotaAtual) {
      const cfg = global.PacoteEMatoConfiguracoes?.obter?.() || {};
      rotaAtual = global.PacoteEMatoRotaStore.criarRota({
        veiculo: cfg.veiculo || 'carro',
        modoRoteamento: global.PacoteEMatoRotaStore.modoPorVeiculo(cfg.veiculo || 'carro'),
        tempoParadaSegundos: Number(cfg.tempoParadaSegundos ?? 0),
        pontoInicial: cfg.pontoInicial || null,
        retornarAoInicio: cfg.retornarAoInicio === true
      });
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true, firestore: false });
    }
    renderizarTudo({ fit: true });
    atualizarBotoesRefino();
    global.PacoteEMatoLocalizacaoAtual?.iniciarAutomaticamente?.().then(() => global.PacoteEMatoMapa?.renderizar?.()).catch(() => {});
    return rotaAtual;
  }

  function renderizarPreviewImportacao(inspecao, headerIndex) {
    const table = $('routeImportPreview');
    if (!table) return;
    table.replaceChildren();
    const headers = (inspecao.matriz?.[headerIndex] || []).map(v => String(v ?? '').trim());
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    headers.forEach((h, i) => { const th = document.createElement('th'); th.textContent = h || `Coluna ${i + 1}`; trh.appendChild(th); });
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    (inspecao.matriz || []).slice(headerIndex + 1, headerIndex + 5).forEach(row => {
      const tr = document.createElement('tr');
      headers.forEach((_, i) => { const td = document.createElement('td'); td.textContent = String(row?.[i] ?? ''); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function preencherMapeamentoImportacao(inspecao, headerIndex) {
    const headers = (inspecao.matriz?.[headerIndex] || []).map(v => String(v ?? '').trim());
    const auto = global.PacoteEMatoImportacaoXLSX.identificarColunas(headers);
    // O mapeamento técnico continua automático. A tela mostra apenas as opções úteis ao motorista.
    importacaoPendente.mapeamentoAutomatico = auto;
    const vis = $('routeImportVisibleFields');
    if (vis) {
      vis.replaceChildren();
      const principais = [
        ['atId','AT ID'],['sequenceOrigem','Sequence'],['stopOrigem','Stop'],['pacote','SPX TN'],
        ['endereco','Destination Address'],['bairro','Bairro'],['cidade','City'],['cep','Zipcode/Postal code'],['latitude','Latitude'],['longitude','Longitude']
      ];
      principais.forEach(([campo,label]) => {
        const item=document.createElement('label'); item.className='route-import-visible-item';
        const input=document.createElement('input'); input.type='checkbox'; input.dataset.importVisible=campo; input.checked=['pacote','endereco','bairro','cidade'].includes(campo);
        const copy=document.createElement('span'); const st=document.createElement('strong'); st.textContent=label; const sm=document.createElement('small');
        const idx=auto[campo]; sm.textContent=idx!=null ? String((inspecao.matriz?.[headerIndex+1]||[])[idx] ?? 'Campo reconhecido') : 'Opcional';
        copy.append(st,sm); item.append(input,copy); vis.appendChild(item);
      });
    }
    renderizarPreviewImportacao(inspecao, headerIndex);
  }

  function concluirMapeamentoImportacao(valor) {
    const modal = $('routeImportMappingModal');
    if (modal) modal.style.display = 'none';
    const resolver = resolverMapeamentoImportacao;
    resolverMapeamentoImportacao = null;
    if (resolver) resolver(valor);
  }

  function abrirMapeamentoImportacao(inspecao) {
    const modal = $('routeImportMappingModal');
    if (!modal) return Promise.resolve(null);
    importacaoPendente = inspecao;
    if ($('routeImportFileName')) $('routeImportFileName').textContent = inspecao.nomeArquivo || 'Planilha';
    if ($('routeImportSheetInfo')) $('routeImportSheetInfo').textContent = `${inspecao.sheetName || 'Planilha'} · ${inspecao.totalLinhasDados || 0} linha(s) de dados`;
    preencherMapeamentoImportacao(inspecao, inspecao.headerIndex);
    if ($('routeImportMappingError')) { $('routeImportMappingError').style.display = 'none'; $('routeImportMappingError').textContent = ''; }
    modal.style.display = 'flex';
    return new Promise(resolve => { resolverMapeamentoImportacao = resolve; });
  }

  function confirmarMapeamentoImportacao() {
    if (!importacaoPendente) return concluirMapeamentoImportacao(null);
    const headerIndex = Number(importacaoPendente.headerIndex || 0);
    const headers = (importacaoPendente.matriz?.[headerIndex] || []).map(v => String(v ?? '').trim());
    const columnMapping = importacaoPendente.mapeamentoAutomatico || global.PacoteEMatoImportacaoXLSX.identificarColunas(headers);
    if (columnMapping.endereco == null && columnMapping.logradouro == null) {
      const err = $('routeImportMappingError');
      if (err) { err.textContent = 'Não consegui reconhecer a coluna de endereço nesta planilha.'; err.style.display = 'block'; }
      return;
    }
    const visibleFields = [...document.querySelectorAll('[data-import-visible]:checked')].map(el => el.dataset.importVisible).filter(Boolean);
    concluirMapeamentoImportacao({ headerIndex, columnMapping, visibleFields });
  }

  async function lerPlanilhaComMapeamento(file) {
    if (!file) throw new Error('Arquivo não informado.');
    if (!global.PacoteEMatoImportacaoXLSX) throw new Error('Módulo de importação não carregado.');
    const inspecao = await global.PacoteEMatoImportacaoXLSX.inspecionarArquivo(file);
    try {
      return await global.PacoteEMatoImportacaoXLSX.lerArquivo(file, { inspecao });
    } catch (erroAuto) {
      if (erroAuto?.code !== 'MAPEAMENTO_NECESSARIO') throw erroAuto;
      const mapeamento = await abrirMapeamentoImportacao(inspecao);
      if (!mapeamento) {
        const erro = new Error('Seleção da planilha cancelada.');
        erro.code = 'IMPORTACAO_CANCELADA';
        throw erro;
      }
      return global.PacoteEMatoImportacaoXLSX.lerArquivo(file, Object.assign({ inspecao }, mapeamento));
    }
  }

  function escolherModoImportacao() {
    if (!rotaAtual?.paradas?.length) return Promise.resolve('substituir');
    const modal = $('routeImportModeModal');
    if (!modal) return Promise.resolve('substituir');
    modal.style.display = 'flex';
    return new Promise(resolve => { resolverModoImportacao = resolve; });
  }

  function concluirModoImportacao(modo) {
    const modal = $('routeImportModeModal');
    if (modal) modal.style.display = 'none';
    const resolver = resolverModoImportacao; resolverModoImportacao = null;
    if (resolver) resolver(modo || null);
  }

  async function criarNovaRotaVazia() {
    const cfg = global.PacoteEMatoConfiguracoes?.obter?.() || {};
    rotaAtual = global.PacoteEMatoRotaStore.criarRota({
      nome: 'Nova rota', origem: 'manual', status: 'planejamento',
      veiculo: cfg.veiculo || 'carro', modoRoteamento: global.PacoteEMatoRotaStore.modoPorVeiculo(cfg.veiculo || 'carro'),
      tempoParadaSegundos: Number(cfg.tempoParadaSegundos ?? 0), pontoInicial: cfg.pontoInicial || null, retornarAoInicio: cfg.retornarAoInicio === true,
      paradas: [], ordem: []
    });
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: true });
    fecharMenuAcoes();
    notificar('Nova rota criada. Importe uma planilha para começar.');
  }

  async function removerTodasRotas() {
    if (!(await global.PacoteEMatoDialog.confirmar({titulo:'Remover rotas do mapa?',mensagem:'As rotas carregadas serão removidas do mapa. O histórico que já foi salvo continuará disponível.',confirmar:'Remover rotas',cancelar:'Cancelar',perigo:true}))) return;
    try { await global.PacoteEMatoRotaStore.limparRotaAtiva?.(); } catch (_) {}
    await criarNovaRotaVazia();
    notificar('Rotas removidas do mapa.');
  }

  async function importarArquivo(file, opcoesEntrada = {}) {
    if (!file) return false;
    const fluxo = global.PacoteEMatoFluxoImportacao;
    fluxo?.iniciar?.(file.name, 'Lendo a planilha e identificando as colunas.');
    definirStatusImportacao('Lendo a planilha e identificando as colunas...', null);
    try {
      if (!global.PacoteEMatoImportacaoXLSX) throw new Error('Módulo de importação não carregado. Recarregue a página e tente novamente.');
      fluxo?.atualizarEtapa?.('Analisando o cabeçalho e os campos disponíveis.');
      const inspecao = await global.PacoteEMatoImportacaoXLSX.inspecionarArquivo(file);
      const modo = await escolherModoImportacao();
      if (!modo) { fluxo?.fechar?.(); definirStatusImportacao('Importação cancelada. Nenhuma parada foi alterada.', 'warning'); return false; }
      modoImportacaoAtual = modo;
      let opcoes = { inspecao };
      fluxo?.atualizarEtapa?.('Confira AT ID, Sequence, Stop, SPX TN, endereço, bairro, cidade, CEP, latitude e longitude.');
      const mapeamento = await abrirMapeamentoImportacao(inspecao);
      if (!mapeamento) {
        fluxo?.fechar?.();
        definirStatusImportacao('Importação cancelada. Nenhuma parada foi alterada.', 'warning');
        return;
      }
      opcoes = Object.assign(opcoes, mapeamento);

      fluxo?.atualizarEtapa?.('Convertendo as linhas em paradas e preservando pacotes e observações.');
      const resultado = await global.PacoteEMatoImportacaoXLSX.lerArquivo(file, opcoes);
      const cfg = global.PacoteEMatoConfiguracoes?.obter?.() || {};
      const candidata = global.PacoteEMatoRotaStore.criarRota({
        nome: file.name.replace(/\.(xlsx|xls|csv)$/i, ''),
        origem: 'xlsx', status: 'planejamento', veiculo: cfg.veiculo || 'carro',
        modoRoteamento: global.PacoteEMatoRotaStore.modoPorVeiculo(cfg.veiculo || 'carro'),
        tempoParadaSegundos: Number(cfg.tempoParadaSegundos ?? 0), pontoInicial: cfg.pontoInicial || null,
        retornarAoInicio: cfg.retornarAoInicio === true, paradas: resultado.paradas, ordem: resultado.paradas.map(p => p.id),
        perfilImportacao: resultado.perfil || 'generico', arquivoOrigem: file.name,
        camposVisiveisParada: Array.isArray(opcoes.visibleFields) ? opcoes.visibleFields.slice() : ['pacote','endereco','bairro','cidade']
      });
      rotaImportacaoPendente = candidata;
      resultadoImportacaoPendente = resultado;
      fluxo?.atualizarEtapa?.('Finalizando a importação e preparando o mapa.');
      await confirmarImportacaoPendente();
      // Documento aberto pelo Android: ao concluir a conferência do arquivo,
      // executa o otimizador original com os mesmos controles de configuração.
      // Jamais calcula uma ordem em linha reta ou ignora o mapeamento do motorista.
      if (opcoesEntrada.otimizarAoImportar === true && rotaAtual?.paradas?.length) {
        await otimizarRota();
      }
      return true;
    } catch (erro) {
      console.error('Pacote É Mato: falha na importação XLSX.', erro);
      fluxo?.mostrarErro?.(erro?.message || 'Não foi possível importar a planilha.', file.name);
      definirStatusImportacao(erro?.message || 'Não foi possível importar a planilha.', 'error');
      notificar(erro?.message || 'Falha ao importar planilha.');
      return false;
    } finally {
      if ($('routingXlsxInput')) $('routingXlsxInput').value = '';
    }
  }

  function numeracaoVisivel() {
    return rotaAtual?.rotaOtimizada === true && rotaAtual?.precisaRecalculo !== true;
  }

  async function confirmarImportacaoPendente() {
    if (!rotaImportacaoPendente) return;
    const candidata = rotaImportacaoPendente;
    const resultado = resultadoImportacaoPendente;
    rotaImportacaoPendente = null; resultadoImportacaoPendente = null;
    if (modoImportacaoAtual === 'adicionar' && rotaAtual?.paradas?.length) {
      const existentes = new Set(rotaAtual.paradas.map(p => String(p.id)));
      const grupo = `rota-${Date.now().toString(36)}`;
      candidata.paradas.forEach((p, i) => {
        let id = String(p.id); if (existentes.has(id)) id = `${id}-${grupo}-${i+1}`; existentes.add(id); p.id = id; p.rotaGrupoId = grupo; p.rotaGrupoNome = candidata.nome;
        p.ordemOriginal = rotaAtual.paradas.length + 1; rotaAtual.paradas.push(p); rotaAtual.ordem.push(p.id);
      });
      rotaAtual.nome = `${rotaAtual.nome || 'Rota'} + ${candidata.nome || 'rota'}`;
      invalidarRotaCalculada();
    } else {
      rotaAtual = candidata;
    }
    modoImportacaoAtual = 'substituir';
    // V42: toda importação volta o foco operacional para a parada 1.
    // Evita restaurar uma seleção antiga/aleatória de uma sessão anterior.
    const primeiraImportada = Array.isArray(rotaAtual.ordem) && rotaAtual.ordem.length
      ? String(rotaAtual.ordem[0])
      : (rotaAtual.paradas?.[0]?.id ? String(rotaAtual.paradas[0].id) : null);
    rotaAtual.paradaSelecionadaId = primeiraImportada;
    rotaAtual.proximaParadaId = primeiraImportada;
    if (global.appState?.roteirizacao) {
      global.appState.roteirizacao.paradaSelecionadaId = primeiraImportada;
      global.appState.roteirizacao.proximaParadaId = primeiraImportada;
    }
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    global.PacoteEMatoFluxoImportacao?.fechar?.();
    renderizarTudo({ fit: true });
    definirEstadoPainel('expanded');
    // Após importar, leva o mapa imediatamente para a área real das paradas.
    // O pequeno atraso permite o bottom sheet assumir o tamanho final antes do fit.
    setTimeout(() => global.PacoteEMatoMapa?.ajustarParadasImportadas?.(), 180);
    const avisos = resultado?.erros?.length || 0;
    const jaLocalizadas = rotaAtual.paradas.filter(paradaLocalizada).length;
    const semCoordenada = Math.max(0, rotaAtual.paradas.length - jaLocalizadas);
    const origemCoords = rotaAtual.paradas.some(p => p.fonteCoordenada === 'xlsx')
      ? ' Ao otimizar, o app fará uma checagem rápida das posições mais suspeitas. A auditoria completa fica em “Validar endereços e posições”.'
      : '';
    const pendentesTexto = semCoordenada
      ? ` ${semCoordenada} parada(s) sem coordenadas serão localizadas somente na otimização.`
      : '';
    definirStatusImportacao(
      `${rotaAtual.paradas.length} parada(s) importada(s).${pendentesTexto}${origemCoords} A numeração será criada somente depois da otimização.`,
      avisos || semCoordenada ? 'warning' : 'success'
    );
  }

  function cancelarImportacaoPendente() {
    rotaImportacaoPendente = null;
    resultadoImportacaoPendente = null;
    global.PacoteEMatoFluxoImportacao?.fechar?.();
    definirStatusImportacao('Importação cancelada. A rota ativa anterior foi preservada.', 'warning');
  }

  function hashTexto(texto) {
    let h = 2166136261;
    const s = String(texto || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  async function usarRotaLegada() {
    const mapa = global.mapaRotas && typeof global.mapaRotas === 'object' ? global.mapaRotas : {};
    const keys = Object.keys(mapa);
    if (!keys.length) {
      notificar('Carregue primeiro uma rota PDF na Bipagem para importá-la para a Roteirização.');
      return;
    }
    const names = global.nomeExibicao || {};
    const stops = global.stopCorrespondente || {};
    const paradas = keys.map((key, index) => {
      const pacotes = Array.isArray(mapa[key]) ? mapa[key].slice() : [];
      const pacotesJaBipados = pacotes.filter(c => global.pacotesBipados?.has(c));
      const related = [...new Set(pacotes.map(c => Number(stops[c])).filter(Number.isFinite))].sort((a, b) => a - b);
      return {
        id: `pdf-${hashTexto(key)}`,
        ordemOriginal: related[0] || index + 1,
        stopsRelacionados: related,
        enderecoOriginal: String(names[key] || key),
        enderecoNormalizado: key,
        pacotes,
        pacotesBipados: pacotesJaBipados,
        quantidadePacotes: pacotes.length,
        quantidadeBipada: pacotesJaBipados.length,
        statusEntrega: pacotes.length && pacotesJaBipados.length >= pacotes.length ? 'concluida' : (pacotesJaBipados.length ? 'parcial' : 'pendente'),
        statusGeocodificacao: 'pendente',
        origem: 'pdf-legado',
        chaveFisica: key
      };
    }).sort((a, b) => a.ordemOriginal - b.ordemOriginal);
    const cfg = global.PacoteEMatoConfiguracoes?.obter?.() || {};
    rotaAtual = global.PacoteEMatoRotaStore.criarRota({
      nome: 'Rota importada da Bipagem',
      origem: 'pdf-legado',
      status: 'planejamento',
      veiculo: cfg.veiculo || 'carro',
      modoRoteamento: global.PacoteEMatoRotaStore.modoPorVeiculo(cfg.veiculo || 'carro'),
      tempoParadaSegundos: Number(cfg.tempoParadaSegundos ?? 0),
      pontoInicial: cfg.pontoInicial || null,
      retornarAoInicio: cfg.retornarAoInicio === true,
      paradas,
      ordem: paradas.map(p => p.id)
    });
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: true });
    await geocodificarTodas();
  }

  async function geocodificarTodas(opcoes) {
    if (!rotaAtual?.paradas?.length) {
      if (!opcoes?.silencioso) notificar('Importe ou adicione paradas antes de validar endereços.');
      return null;
    }
    aplicarRotaNoState();
    const btn = $('routingGeocodeBtn');
    if (btn) btn.disabled = true;
    try {
      if (!global.PacoteEMatoGeocodificacao?.endpointAtual?.()) {
        throw new Error('Localização automática indisponível nesta versão sem o serviço externo. Nenhuma coordenada será inventada.');
      }
      if (!opcoes?.silencioso) definirStatusImportacao('Validando endereços e posições...', null);

      const resumoGeo = await global.PacoteEMatoGeocodificacao.geocodificarParadas(rotaAtual.paradas, {
        concorrencia: 3,
        gapMs: 220
      });

      const resumoCoords = await global.PacoteEMatoGeocodificacao.validarCoordenadasImportadas(rotaAtual.paradas, {
        limiteMetros: 120,
        somenteXlsx: true,
        concorrencia: 4,
        gapMs: 220
      });

      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      renderizarTudo({ fit: true });
      if (!opcoes?.silencioso) {
        const problemas = resumoGeo.total - resumoGeo.ok;
        const corrigidas = Number(resumoCoords?.corrigidas || 0);
        const textoCorrigidas = corrigidas ? ` ${corrigidas} posição(ões) da planilha corrigida(s).` : '';
        definirStatusImportacao(`${resumoGeo.ok} endereço(s) localizado(s). ${problemas} parada(s) precisam de correção.${textoCorrigidas}`, problemas ? 'warning' : 'success');
      }
      return { geocodificacao: resumoGeo, coordenadas: resumoCoords };
    } catch (erro) {
      if (!opcoes?.silencioso) {
        definirStatusImportacao(erro?.message || 'Falha ao validar endereços.', 'error');
        notificar(erro?.message || 'Falha ao validar endereços.');
      }
      return null;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function geocodificarParada(p) {
    if (!p) return;
    await global.PacoteEMatoGeocodificacao.geocodificarParada(p);
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: p.statusGeocodificacao === 'ok' });
  }

  async function usarLocalizacaoAtual() {
    if (!navigator.geolocation) {
      notificar('Geolocalização não disponível neste navegador.');
      return;
    }
    const btn = $('routingUseLocationBtn');
    if (btn) btn.disabled = true;
    navigator.geolocation.getCurrentPosition(async pos => {
      rotaAtual.pontoInicial = {
        tipo: 'gps', descricao: 'Localização atual', lat: pos.coords.latitude, lon: pos.coords.longitude, status: 'ok'
      };
      invalidarRotaCalculada();
      global.PacoteEMatoConfiguracoes?.salvar?.({ pontoInicial: rotaAtual.pontoInicial });
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      renderizarTudo({ fit: true });
      if (btn) btn.disabled = false;
    }, err => {
      if (btn) btn.disabled = false;
      notificar(err?.message || 'Não foi possível acessar sua localização.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 });
  }

  async function localizarPontoInicial() {
    const texto = String($('routingStartAddress')?.value || '').trim();
    if (!texto) return notificar('Informe um endereço para o ponto de partida.');
    const p = await global.PacoteEMatoGeocodificacao.geocodificarEnderecoLivre(texto);
    if (p.statusGeocodificacao !== 'ok') {
      rotaAtual.pontoInicial = { tipo: 'endereco', descricao: texto, lat: null, lon: null, status: p.statusGeocodificacao };
      renderizarTudo();
      return notificar('Não foi possível validar esse ponto de partida com confiança.');
    }
    rotaAtual.pontoInicial = { tipo: 'endereco', descricao: texto, lat: p.latitude, lon: p.longitude, status: 'ok' };
    invalidarRotaCalculada();
    global.PacoteEMatoConfiguracoes?.salvar?.({ pontoInicial: rotaAtual.pontoInicial });
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: true });
  }

  async function usarPontoInicialSalvo() {
    const cfg = global.PacoteEMatoConfiguracoes?.obter?.() || {};
    const salvo = cfg.pontoInicial;
    if (!pontoValido(salvo)) {
      return notificar('Nenhum ponto de partida validado foi salvo ainda.');
    }
    rotaAtual.pontoInicial = clone(salvo);
    invalidarRotaCalculada();
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: true });
    notificar('Ponto de partida salvo aplicado à rota.');
  }

  function salvarPontoInicialAtual() {
    const p = rotaAtual?.pontoInicial;
    if (!pontoValido(p)) {
      return notificar('Valide um ponto de partida antes de salvá-lo.');
    }
    global.PacoteEMatoConfiguracoes?.salvar?.({ pontoInicial: clone(p) });
    notificar('Ponto de partida salvo nas configurações.');
  }

  async function validarCoordenadasXlsxAntesDaRota() {
    const geo = global.PacoteEMatoGeocodificacao;
    if (!rotaAtual?.paradas?.length || !geo?.validarCoordenadasImportadas) {
      return { total: 0, corrigidas: 0, confirmadas: 0, naoConfirmadas: 0, erros: 0, modo: 'rapido' };
    }
    const limparConsulta = geo?.limparEnderecoParaConsulta || (v => String(v || '').trim());
    const pendentes = rotaAtual.paradas.filter(p => {
      if (String(p?.fonteCoordenada || '') !== 'xlsx') return false;
      if (p?.statusEntrega === 'entregue' || p?.statusEntrega === 'concluida' || p?.statusEntrega === 'nao_entregue') return false;
      const consultaAtual = limparConsulta(p?.enderecoOriginal || '');
      return !p?.validacaoCoordenadaStatus || String(p?.validacaoCoordenadaEndereco || '') !== consultaAtual;
    });
    if (!pendentes.length) return { total: 0, corrigidas: 0, confirmadas: 0, naoConfirmadas: 0, erros: 0, modo: 'rapido' };

    // V25: a otimização não bloqueia mais a rua validando 100+ pontos um por um.
    // A checagem rápida escolhe pontos suspeitos e uma amostra distribuída da planilha.
    // Quem quiser a auditoria completa continua tendo a ação “Validar endereços”.
    const ids = geo.selecionarCoordenadasParaValidacaoRapida
      ? geo.selecionarCoordenadasParaValidacaoRapida(rotaAtual.paradas, { maximo: 14 })
      : pendentes.slice(0, 14).map(p => String(p.id));

    if (!ids.length) return { total: 0, corrigidas: 0, confirmadas: 0, naoConfirmadas: 0, erros: 0, modo: 'rapido' };

    atualizarProcessamento(
      'Confirmando posições',
      `Verificando uma amostra de ${ids.length} parada(s) antes de calcular a rota.`
    );
    const resumo = await geo.validarCoordenadasImportadas(rotaAtual.paradas, {
      limiteMetros: 120,
      somenteXlsx: true,
      ids,
      concorrencia: 4,
      gapMs: 210
    });
    if (resumo?.corrigidas > 0) {
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      renderizarTudo({ fit: true });
      notificar(`${resumo.corrigidas} posição(ões) suspeita(s) foram corrigidas antes da otimização.`);
    }
    return Object.assign({ modo: 'rapido', totalPendentes: pendentes.length }, resumo || {});
  }

  async function otimizarRota(opcoes) {
    if (!rotaAtual) return;
    if (await garantirConfiguracoesObrigatorias('otimizar a rota') === false) return;
    if (!workerConfigurado() || !global.PacoteEMatoServicoRota?.endpoint?.('optimize')) {
      const msg = 'O serviço de otimização ainda não está disponível. As paradas foram preservadas.';
      definirStatusImportacao(msg, 'warning');
      return notificar(msg);
    }

    const botoes = [$('routingOptimizeBtn'), $('routingMainOptimizeBtn')].filter(Boolean);
    botoes.forEach(btn => { btn.disabled = true; });

    try {
      mostrarProcessamento('Preparando sua rota', 'Validando ponto de partida e paradas…');

      let unresolved = rotaAtual.paradas.filter(p => !paradaLocalizada(p));
      if (unresolved.length) {
        if (!global.PacoteEMatoGeocodificacao?.endpointAtual?.()) {
          throw new Error(`${unresolved.length} parada(s) estão sem coordenadas e o serviço de localização não está disponível.`);
        }
        atualizarProcessamento('Localizando paradas', `Confirmando a posição de ${unresolved.length} endereço(s)…`);
        const resumoGeo = await global.PacoteEMatoGeocodificacao.geocodificarParadas(rotaAtual.paradas);
        await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
        aplicarRotaNoState();
        renderizarTudo({ fit: true });
        unresolved = rotaAtual.paradas.filter(p => !paradaLocalizada(p));
        if (unresolved.length) {
          throw new Error(`Não foi possível localizar ${unresolved.length} parada(s). Corrija esses endereços antes de otimizar.`);
        }
        if (resumoGeo?.ok) atualizarProcessamento('Localizando paradas', `${resumoGeo.ok} parada(s) confirmada(s). Validando a sequência…`);
      }

      await validarCoordenadasXlsxAntesDaRota();
      await garantirPontoInicialParaOtimizacao();

      // A otimização é montada primeiro em uma cópia. Assim, se o serviço de
      // geometria falhar, a ordem/linha anterior continuam intactas na tela.
      const candidata = clone(rotaAtual);
      if (!candidata.preferenciaRota) candidata.preferenciaRota = 'short';
      atualizarProcessamento('Analisando a melhor sequência', 'Comparando alternativas pela malha viária…');
      const otimizada = await global.PacoteEMatoServicoRota.otimizarComparando(candidata, atualizarProcessamento);
      const orderIds = Array.isArray(otimizada.orderIds) ? otimizada.orderIds : [];
      if (!orderIds.length) throw new Error('O otimizador não retornou uma ordem de paradas.');

      const ordered = global.PacoteEMatoServicoRota.ordenarParadas(candidata, orderIds);
      candidata.ordem = ordered.map(p => p.id);

      atualizarProcessamento('Calculando o percurso', 'Traçando o caminho pelas ruas…');
      const route = otimizada.route;
      const feature = route.feature;
      candidata.geometria = feature.geometry;
      if (!(candidata.paradas || []).some(paradaFinalizada)) global.PacoteEMatoMarcadores?.capturarBaseVisualStatus?.(candidata, true);
      candidata.pernas = Array.isArray(feature.properties?.legs) ? feature.properties.legs : [];
      candidata.instrucoes = global.PacoteEMatoServicoRota.extrairInstrucoes(feature);

      // Distância, tempo e instruções pertencem ao MESMO percurso confirmado.
      const distanciaGeometria = Number(feature.properties.distance);
      const direcaoGeometria = Number(feature.properties.time);
      const pendentes = candidata.paradas.filter(p => !['entregue','concluida','nao_entregue'].includes(p.statusEntrega)).length;
      const pendentesFisicas = Number(otimizada.physicalStopCount || global.PacoteEMatoServicoRota?.gruposFisicosPendentes?.(candidata)?.length || pendentes);
      candidata.distanciaGeometriaMetros = candidata.distanciaTotalMetros = distanciaGeometria;
      candidata.duracaoGeometriaSegundos = candidata.duracaoDirecaoSegundos = direcaoGeometria;
      candidata.duracaoParadasSegundos = pendentesFisicas * Math.max(0, Number(candidata.tempoParadaSegundos || 0));
      candidata.duracaoTotalSegundos = direcaoGeometria + candidata.duracaoParadasSegundos;
      candidata.duracaoPlanejadorSegundos = null;
      candidata.horarioTerminoEstimado = Date.now() + candidata.duracaoTotalSegundos * 1000;
      candidata.rotaOtimizada = true;
      candidata.precisaRecalculo = false;
      candidata.confirmadaEm = null;
      candidata.status = 'ativa';
      candidata.otimizadoEm = Date.now();

      // V43: depois de qualquer otimização nova, a operação sempre começa na
      // primeira parada da NOVA ordem calculada. Isso evita herdar o ID que
      // estava selecionado antes da otimização (que podia virar a parada 6, 15 etc.).
      const primeiraDaNovaOrdem = candidata.ordem?.[0] ? String(candidata.ordem[0]) : null;
      candidata.paradaSelecionadaId = primeiraDaNovaOrdem;
      candidata.proximaParadaId = primeiraDaNovaOrdem;
      if (global.appState?.roteirizacao) {
        global.appState.roteirizacao.paradaSelecionadaId = primeiraDaNovaOrdem;
        global.appState.roteirizacao.proximaParadaId = primeiraDaNovaOrdem;
      }
      if (global.appState?.navegacao) {
        global.appState.navegacao.paradaExibidaId = primeiraDaNovaOrdem;
        global.appState.navegacao.paradaAtualId = primeiraDaNovaOrdem;
        global.appState.navegacao.proximaParadaId = primeiraDaNovaOrdem;
      }
      try { sessionStorage.removeItem('pemato_parada_externa'); } catch (_) {}

      candidata.resumoOtimizacao = {
        provider: otimizada.provider || 'geoapify-route-planner',
        comparacao: otimizada.comparacao,
        tipoPercursoEscolhido: otimizada.tipo,
        preferencia: candidata.preferenciaRota || 'short',
        pontoInicial: clone(candidata.pontoInicial),
        distanciaPlanejadorMetros: Number(otimizada.distance || 0),
        tempoDirecaoPlanejadorSegundos: Number(otimizada.drivingTime || 0),
        totalPlanejadorSegundos: Number(otimizada.totalTime || 0),
        distanciaGeometriaMetros: Number(feature.properties?.distance || 0),
        tempoGeometriaSegundos: Number(feature.properties?.time || 0),
        trafegoPlanejamento: 'free_flow',
        geometriaSegmentada: route.segmentado === true,
        segmentosGeometria: Number(route.segmentos || 1),
        paradasFisicasOtimizadas: Number(otimizada.physicalStopCount || pendentesFisicas),
        entregasOtimizadas: Number(otimizada.deliveryCount || pendentes)
      };

      atualizarProcessamento('Finalizando sua rota', 'Consolidando distância, tempo e instruções…');
      rotaAtual = candidata;
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      renderizarTudo({ fit: true });
      atualizarProcessamento('Rota pronta', 'Confira a sequência antes de iniciar.');
      definirStatusImportacao('Rota calculada. Confira a sequência antes de iniciar.', 'success');
      await new Promise(resolve => global.requestAnimationFrame ? global.requestAnimationFrame(() => resolve()) : resolve());
      esconderProcessamento();
      if (opcoes?.refinamento) abrirRefinoStandalone();
      else abrirRevisaoOtimizacao();
      if (!opcoes?.refinamento) notificar('Rota calculada. Confira a sequência e confirme.');
    } catch (erro) {
      console.error(erro);

      // V62: se a sequência foi aceita pelo otimizador mas o provedor não
      // conseguiu traçar o percurso completo, faz uma correção completa das
      // coordenadas importadas e tenta novamente uma única vez. Nenhuma parada
      // é apagada e a rota anterior continua preservada até uma geometria válida.
      const falhaPercurso = /percurso completo|trecho .* rota|geometria/i.test(String(erro?.message || ''));
      if (falhaPercurso && opcoes?.reparoAutomatico !== true && global.PacoteEMatoGeocodificacao?.validarCoordenadasImportadas) {
        try {
          atualizarProcessamento('Confirmando posições', 'Algumas paradas precisam ser conferidas antes de tentar novamente.');
          const ids = (rotaAtual.paradas || [])
            .filter(p => !paradaFinalizada(p) && paradaLocalizada(p))
            .map(p => String(p.id));
          if (ids.length) {
            await global.PacoteEMatoGeocodificacao.validarCoordenadasImportadas(rotaAtual.paradas, {
              limiteMetros: 90,
              ids,
              concorrencia: 4,
              gapMs: 180
            });
            await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
            renderizarTudo({ fit: true });
          }
          esconderProcessamento();
          return await otimizarRota(Object.assign({}, opcoes || {}, { reparoAutomatico: true }));
        } catch (erroReparo) {
          console.warn('Pacote É Mato: reparo automático de coordenadas não concluiu.', erroReparo);
        }
      }

      esconderProcessamento();
      global.PacoteEMatoTelemetria?.registrarProblema?.('otimizacao_rota', erro?.message || 'Falha ao otimizar rota', { modulo: 'roteirizacao' });
      definirStatusImportacao(erro?.message || 'Não foi possível otimizar a rota.', 'error');
      notificar(erro?.message || 'Não foi possível otimizar a rota.');
    } finally {
      botoes.forEach(btn => { btn.disabled = false; });
    }
  }

  async function inverterRota() {
    if (!rotaAtual?.geometria) return notificar('Calcule a rota antes de inverter.');
    const byId = new Map((rotaAtual.paradas || []).map(p => [String(p.id), p]));
    const pendentes = (rotaAtual.ordem || []).map(String).filter(id => !paradaFinalizada(byId.get(id)));
    if (pendentes.length < 2) return notificar('Não há paradas pendentes suficientes para inverter.');
    if (rotaAtual.iniciadoEm && !(await global.PacoteEMatoDialog.confirmar({titulo:'Inverter paradas pendentes?',mensagem:'As entregas já registradas serão preservadas. Apenas as paradas que ainda estão pendentes terão a ordem invertida.',confirmar:'Inverter pendentes',cancelar:'Cancelar'}))) return;
    fecharRefinoStandalone();
    fecharRevisaoOtimizacao();
    const novaOrdem = reconstruirComPendentes([...pendentes].reverse());
    const ok = await aplicarOrdemRefinada(novaOrdem, 'inverter', 'Ordem das paradas pendentes invertida.', { abrirRevisao: false });
    if (ok) abrirRefinoStandalone();
  }


  function esconderSugestoesEndereco() {
    const box = $('routingAddressSuggestions');
    if (!box) return;
    box.style.display = 'none';
    box.replaceChildren();
  }

  function textoPrimarioSugestao(item) {
    const rua = String(item?.street || '').trim();
    const numero = String(item?.housenumber || '').trim();
    if (rua) return [rua, numero].filter(Boolean).join(', ');
    return String(item?.formatted || 'Endereço encontrado').split(',').slice(0,2).join(',').trim();
  }

  function textoSecundarioSugestao(item) {
    return [item?.city, item?.state, item?.postcode].map(v => String(v || '').trim()).filter(Boolean).join(' · ');
  }


  function escaparRegex(texto) {
    return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function limparLogradouroComNumeroDuplicado(logradouro, numero) {
    let rua = String(logradouro || '').trim().replace(/[\s,;\-]+$/g, '');
    const n = String(numero || '').trim();
    if (!rua || !n) return rua;
    const re = new RegExp(`[\\s,;\\-]+${escaparRegex(n)}(?=\\s|,|;|$)`, 'i');
    const achou = re.exec(rua);
    if (achou && achou.index > 1) rua = rua.slice(0, achou.index).trim().replace(/[\s,;\-]+$/g, '');
    return rua;
  }

  function enderecoBaseEditor(p) {
    const numero = String(p?.numero || '').trim();
    const fonte = String(p?.logradouro || p?.enderecoFonte || p?.enderecoOriginal || '').trim();
    const rua = limparLogradouroComNumeroDuplicado(fonte, numero);
    if (rua && numero) return `${rua}, ${numero}`;
    return rua || numero || '';
  }

  function separarEnderecoDigitado(texto) {
    let bruto = String(texto || '').trim().replace(/\s+/g, ' ');
    if (!bruto) return { logradouro: '', numero: '', detalhe: '' };
    let detalhe = '';
    const detalheMatch = bruto.match(/\s+(?=(?:ap\.?|apto\.?|apartamento|casa|bloco|sala|loja|fundos|frente|conj\.?|conjunto|torre|edif[ií]cio|portaria|recep[cç][aã]o)\b)/i);
    if (detalheMatch && detalheMatch.index != null) {
      detalhe = bruto.slice(detalheMatch.index).trim().replace(/^[,;\-\s]+/, '');
      bruto = bruto.slice(0, detalheMatch.index).trim().replace(/[,;\-\s]+$/, '');
    }
    const encontrados = [...bruto.matchAll(/(?:^|[\s,])([0-9]+[A-Za-z]?)(?=$|[\s,;\-])/g)];
    const ultimo = encontrados.at(-1);
    if (!ultimo) return { logradouro: bruto, numero: '', detalhe };
    const numero = String(ultimo[1] || '').trim();
    const inicioNumero = Number(ultimo.index || 0) + String(ultimo[0] || '').indexOf(numero);
    const logradouro = bruto.slice(0, inicioNumero).trim().replace(/[,;\-\s]+$/, '');
    const sobra = bruto.slice(inicioNumero + numero.length).trim().replace(/^[,;\-\s]+/, '');
    return { logradouro: logradouro || bruto, numero: logradouro ? numero : '', detalhe: [sobra, detalhe].filter(Boolean).join(' ').trim() };
  }

  function preencherCamposEnderecoSugestao(item) {
    if (!item) return;
    const mapa = {
      logradouro: item.street,
      numero: item.housenumber,
      bairro: item.suburb,
      cidade: item.city,
      estado: item.state,
      cep: item.postcode
    };
    Object.entries(mapa).forEach(([key, value]) => {
      const el = $(`routeEdit_${key}`);
      if (el) el.value = String(value || '').trim();
    });
    const input = $('routeEdit_fullAddress');
    if (input) input.value = textoPrimarioSugestao(item);
  }

  function esconderSugestoesEm(id) {
    const box = $(id);
    if (!box) return;
    box.style.display = 'none';
    box.replaceChildren();
  }

  function renderizarSugestoesEm(box, itens, aoSelecionar, vazio) {
    box.replaceChildren();
    if (!itens.length) {
      const el = document.createElement('div');
      el.className = 'routing-address-suggestion-empty';
      el.textContent = vazio || 'Nenhum endereço confirmado.';
      box.appendChild(el);
      return;
    }
    itens.forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'routing-address-suggestion';
      const principal = document.createElement('strong');
      principal.textContent = textoPrimarioSugestao(item);
      const secundario = document.createElement('span');
      secundario.textContent = textoSecundarioSugestao(item) || String(item.formatted || '');
      btn.append(principal, secundario);
      btn.addEventListener('click', () => aoSelecionar(item));
      box.appendChild(btn);
    });
  }

  async function atualizarSugestoesEditor(texto) {
    const box = $('routeEditAddressSuggestions');
    const termo = String(texto || '').trim();
    if (!box || termo.length < 4 || !global.PacoteEMatoGeocodificacao?.consultarSugestoesEndereco) { esconderSugestoesEm('routeEditAddressSuggestions'); return; }
    const seq = ++buscaEditorSeq;
    box.style.display = 'block';
    box.innerHTML = '<div class="routing-address-suggestion-loading">Buscando endereços…</div>';
    try {
      const itens = await global.PacoteEMatoGeocodificacao.consultarSugestoesEndereco(termo);
      if (seq !== buscaEditorSeq) return;
      renderizarSugestoesEm(box, itens, item => {
        sugestaoEditorSelecionada = item;
        preencherCamposEnderecoSugestao(item);
        esconderSugestoesEm('routeEditAddressSuggestions');
      }, 'Nenhum endereço confirmado. Continue digitando ou salve o endereço manualmente.');
    } catch (_) {
      if (seq !== buscaEditorSeq) return;
      box.innerHTML = '<div class="routing-address-suggestion-empty">Busca indisponível agora. O endereço digitado será preservado.</div>';
    }
  }

  async function atualizarSugestoesPontoFinal(texto) {
    const box = $('routingEndPointSuggestions');
    const termo = String(texto || '').trim();
    if (!box || termo.length < 4 || !global.PacoteEMatoGeocodificacao?.consultarSugestoesEndereco) { esconderSugestoesEm('routingEndPointSuggestions'); return; }
    const seq = ++buscaPontoFinalSeq;
    box.style.display = 'block';
    box.innerHTML = '<div class="routing-address-suggestion-loading">Buscando endereços…</div>';
    try {
      const itens = await global.PacoteEMatoGeocodificacao.consultarSugestoesEndereco(termo);
      if (seq !== buscaPontoFinalSeq) return;
      renderizarSugestoesEm(box, itens, item => {
        sugestaoPontoFinalSelecionada = item;
        const input = $('routingEndPointInput');
        if (input) input.value = String(item.formatted || textoPrimarioSugestao(item));
        const status = $('routingEndPointStatus');
        if (status) { status.textContent = 'Endereço selecionado e confirmado.'; status.dataset.status = 'ok'; }
        esconderSugestoesEm('routingEndPointSuggestions');
      }, 'Nenhum endereço confirmado. Continue digitando para tentar novamente.');
    } catch (_) {
      if (seq !== buscaPontoFinalSeq) return;
      box.innerHTML = '<div class="routing-address-suggestion-empty">Busca indisponível agora. Você ainda pode salvar o endereço digitado.</div>';
    }
  }

  async function atualizarSugestoesEndereco(texto) {
    const box = $('routingAddressSuggestions');
    if (!box) return;
    const termo = String(texto || '').trim();
    if (termo.length < 4 || !global.PacoteEMatoGeocodificacao?.consultarSugestoesEndereco) { esconderSugestoesEndereco(); return; }
    const seq = ++buscaEnderecoSeq;
    box.style.display = 'block';
    box.innerHTML = '<div class="routing-address-suggestion-loading">Buscando endereços…</div>';
    try {
      const itens = await global.PacoteEMatoGeocodificacao.consultarSugestoesEndereco(termo);
      if (seq !== buscaEnderecoSeq) return;
      box.replaceChildren();
      if (!itens.length) {
        const vazio = document.createElement('div');
        vazio.className = 'routing-address-suggestion-empty';
        vazio.textContent = 'Nenhum endereço confirmado. Você ainda pode adicionar digitando manualmente.';
        box.appendChild(vazio);
        return;
      }
      itens.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'routing-address-suggestion';
        const principal = document.createElement('strong');
        principal.textContent = textoPrimarioSugestao(item);
        const secundario = document.createElement('span');
        secundario.textContent = textoSecundarioSugestao(item) || String(item.formatted || '');
        btn.append(principal, secundario);
        btn.addEventListener('click', () => {
          sugestaoEnderecoSelecionada = item;
          const input = $('routingStopSearch');
          if (input) input.value = String(item.formatted || textoPrimarioSugestao(item));
          esconderSugestoesEndereco();
          atualizarControlesBuscaEndereco();
        });
        box.appendChild(btn);
      });
    } catch (_) {
      if (seq !== buscaEnderecoSeq) return;
      box.innerHTML = '<div class="routing-address-suggestion-empty">Busca de endereços indisponível agora. Você pode continuar digitando manualmente.</div>';
    }
  }

  function atualizarControlesBuscaEndereco() {
    const input = $('routingStopSearch');
    const btn = $('routingSearchAddBtn');
    const modo = $('routingSearchModeBar');
    const label = $('routingSearchModeLabel');
    const texto = String(input?.value || '').trim();
    const editando = !!paradaEdicaoBuscaId;
    if (btn) {
      btn.style.display = texto.length >= 4 ? 'inline-flex' : 'none';
      btn.textContent = editando ? 'Salvar endereço da parada' : '+ Adicionar endereço';
      btn.setAttribute('aria-label', editando ? 'Salvar novo endereço desta parada' : 'Adicionar endereço digitado');
    }
    if (modo) modo.style.display = editando ? 'flex' : 'none';
    if (label && editando) {
      const p = rotaAtual?.paradas?.find(item => String(item.id) === String(paradaEdicaoBuscaId));
      const n = p ? Math.max(1, obterParadasOrdenadas().findIndex(item => item.id === p.id) + 1) : '';
      label.textContent = n ? `Editando parada ${n}` : 'Editando parada';
    }
  }

  function encerrarEdicaoBusca({ limpar = true } = {}) {
    paradaEdicaoBuscaId = null;
    sugestaoEnderecoSelecionada = null;
    const input = $('routingStopSearch');
    if (input) {
      if (limpar) input.value = '';
      input.placeholder = 'Buscar pacote ou digitar um novo endereço';
    }
    esconderSugestoesEndereco();
    atualizarControlesBuscaEndereco();
    renderizarLista();
  }

  function iniciarAdicaoBusca() {
    paradaEdicaoBuscaId = null;
    sugestaoEnderecoSelecionada = null;
    definirEstadoPainel('expanded');
    const input = $('routingStopSearch');
    if (input) {
      input.value = '';
      input.placeholder = 'Digite o endereço da nova parada';
      input.focus();
    }
    atualizarControlesBuscaEndereco();
    renderizarLista();
  }

  function iniciarEdicaoBusca(id) {
    const p = rotaAtual?.paradas?.find(item => String(item.id) === String(id));
    if (!p) return;
    paradaEdicaoBuscaId = String(p.id);
    sugestaoEnderecoSelecionada = null;
    definirEstadoPainel('expanded');
    const input = $('routingStopSearch');
    if (input) {
      input.value = enderecoBaseEditor(p) || enderecoExibicao(p);
      input.placeholder = 'Pesquise o novo endereço desta parada';
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    }
    atualizarControlesBuscaEndereco();
    renderizarLista();
    const termo = String(input?.value || '').trim();
    if (termo.length >= 4) atualizarSugestoesEndereco(termo);
  }

  function dadosEnderecoBuscaPrincipal(texto, atual) {
    const dados = {
      logradouro: String(atual?.logradouro || '').trim(),
      numero: String(atual?.numero || '').trim(),
      bairro: String(atual?.bairro || '').trim(),
      cidade: String(atual?.cidade || '').trim(),
      estado: String(atual?.estado || '').trim(),
      cep: String(atual?.cep || '').trim()
    };
    let detalheDigitado = '';
    if (sugestaoEnderecoSelecionada) {
      dados.logradouro = String(sugestaoEnderecoSelecionada.street || textoPrimarioSugestao(sugestaoEnderecoSelecionada) || '').trim();
      dados.numero = String(sugestaoEnderecoSelecionada.housenumber || '').trim();
      dados.bairro = String(sugestaoEnderecoSelecionada.suburb || dados.bairro || '').trim();
      dados.cidade = String(sugestaoEnderecoSelecionada.city || dados.cidade || '').trim();
      dados.estado = String(sugestaoEnderecoSelecionada.state || dados.estado || '').trim();
      dados.cep = String(sugestaoEnderecoSelecionada.postcode || dados.cep || '').trim();
    } else {
      const partes = separarEnderecoDigitado(texto);
      dados.logradouro = partes.logradouro || texto;
      dados.numero = partes.numero || '';
      detalheDigitado = partes.detalhe || '';
    }
    dados.logradouro = limparLogradouroComNumeroDuplicado(dados.logradouro, dados.numero);
    return { dados, detalheDigitado };
  }

  async function salvarEnderecoBuscaPrincipal() {
    if (!rotaAtual) return;
    const input = $('routingStopSearch');
    const texto = String(input?.value || '').trim();
    if (texto.length < 4) return notificar('Digite um endereço para continuar.');
    const btn = $('routingSearchAddBtn');
    if (btn) btn.disabled = true;
    const idEditado = paradaEdicaoBuscaId;
    const atual = idEditado ? rotaAtual.paradas.find(item => String(item.id) === String(idEditado)) : null;
    if (idEditado && !atual) { if (btn) btn.disabled = false; return encerrarEdicaoBusca(); }
    const eraOtimizada = rotaAtual.rotaOtimizada === true || !!rotaAtual.geometria;
    const assinaturaAnterior = atual ? [atual.logradouro,atual.numero,atual.bairro,atual.cidade,atual.estado,atual.cep].map(v=>String(v||'').trim().toLocaleLowerCase('pt-BR')).join('|') : '';
    try {
      const { dados, detalheDigitado } = dadosEnderecoBuscaPrincipal(texto, atual);
      if (!dados.logradouro) throw new Error('Não foi possível identificar o logradouro desse endereço.');
      let p = atual;
      if (!p) {
        p = global.PacoteEMatoRotaStore.normalizarParada({
          id: idNovo('manual'), ordemOriginal: rotaAtual.paradas.length + 1, origem: 'manual',
          ...dados, complemento: detalheDigitado || '', apartamento: '', bloco: '', sala: '', loja: '', observacao: '', pacotes: [], statusEntrega: 'pendente'
        }, rotaAtual.paradas.length);
        rotaAtual.paradas.push(p);
        rotaAtual.ordem.push(p.id);
      } else {
        Object.assign(p, dados);
        if (detalheDigitado) {
          p.complemento = detalheDigitado;
          p.apartamento = '';
          p.bloco = '';
          p.sala = '';
          p.loja = '';
        }
        p.alteradoEm = Date.now();
      }
      p.enderecoOriginal = enderecoDaParada(p);
      const sugestaoAplicavel = sugestaoEnderecoSelecionada && coordenadaValida(sugestaoEnderecoSelecionada.lat, sugestaoEnderecoSelecionada.lon);
      if (sugestaoAplicavel) {
        p.latitude = Number(sugestaoEnderecoSelecionada.lat);
        p.longitude = Number(sugestaoEnderecoSelecionada.lon);
        p.statusGeocodificacao = 'ok';
        p.precisaoGeocodificacao = 'sugestao_confirmada';
        p.enderecoGeocodificado = String(sugestaoEnderecoSelecionada.formatted || p.enderecoOriginal);
        p.geocodificadoEm = Date.now();
        p.fonteCoordenada = 'sugestao-geocodificacao';
        p.geocodificacao = clone(sugestaoEnderecoSelecionada);
      } else {
        p.latitude = null;
        p.longitude = null;
        p.statusGeocodificacao = 'pendente';
        p.enderecoGeocodificado = '';
        p.geocodificadoEm = null;
        p.confiabilidade = null;
        p.confiabilidadeRua = null;
      }
      const assinaturaNova = [p.logradouro,p.numero,p.bairro,p.cidade,p.estado,p.cep].map(v=>String(v||'').trim().toLocaleLowerCase('pt-BR')).join('|');
      const enderecoMudou = !atual || assinaturaNova !== assinaturaAnterior;
      if (enderecoMudou) invalidarRotaCalculada();
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      encerrarEdicaoBusca();
      renderizarTudo({ fit: !!sugestaoAplicavel });
      if (enderecoMudou && !sugestaoAplicavel) await geocodificarParada(p);
      if (eraOtimizada && (!enderecoMudou || p.statusGeocodificacao === 'ok')) {
        const decisao = await perguntarReotimizacao(atual ? 'Rota alterada' : 'Parada adicionada', atual
          ? 'O endereço foi atualizado. Você pode manter a ordem atual ou otimizar novamente usando a rede viária.'
          : 'A nova parada foi adicionada. Você pode manter a ordem atual ou otimizar novamente usando a rede viária.');
        if (decisao === 'otimizar') await otimizarRota();
        else await recalcularOrdemAtual();
      }
      notificar(atual ? 'Endereço da parada atualizado.' : 'Parada adicionada.');
    } catch (erro) {
      notificar(erro?.message || 'Não foi possível salvar esse endereço.');
    } finally {
      if (btn) btn.disabled = false;
      atualizarControlesBuscaEndereco();
    }
  }

  function selecionarParada(id, origem) {
    if (!rotaAtual?.paradas.some(p => p.id === id)) return;
    global.appState.roteirizacao.paradaSelecionadaId = id;
    renderizarLista();
    renderizarParadaSelecionada();
    global.PacoteEMatoMapa?.renderizar();
    if (origem !== 'mapa') global.PacoteEMatoMapa?.centralizarParada(id);
    const card = document.querySelector(`.routing-stop-card[data-stop-id="${CSS.escape(id)}"]`);
    if (card && origem === 'mapa') card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function abrirEditor(id, contexto = 'rota', prefill = '') {
    const modal = $('routeStopEditorModal');
    if (!modal) return;
    contextoEditor = contexto === 'conferencia' ? 'conferencia' : 'rota';
    const alvo = contextoEditor === 'conferencia' ? rotaImportacaoPendente : rotaAtual;
    modoEdicaoNovo = !id;
    stopEmEdicao = id ? alvo?.paradas.find(p => p.id === id) : null;
    const p = stopEmEdicao || {
      id: idNovo('manual'), logradouro: '', numero: '', complemento: '', apartamento: '', bloco: '', sala: '', loja: '',
      bairro: '', cidade: '', estado: '', cep: '', observacao: '', pacotes: [], statusEntrega: 'pendente', motivoNaoEntrega: '', observacaoNaoEntrega: ''
    };
    const fields = ['logradouro','numero','complemento','apartamento','bloco','sala','loja','bairro','cidade','estado','cep','observacao'];
    fields.forEach(key => { const el = $(`routeEdit_${key}`); if (el) el.value = p[key] || ''; });
    sugestaoEditorSelecionada = (!id && sugestaoEnderecoSelecionada) ? clone(sugestaoEnderecoSelecionada) : null;
    let textoBase = id ? enderecoBaseEditor(p) : String(prefill || '').trim();
    let detalheVisivel = detalheComplemento(p);
    if (!id && sugestaoEditorSelecionada) {
      preencherCamposEnderecoSugestao(sugestaoEditorSelecionada);
      textoBase = textoPrimarioSugestao(sugestaoEditorSelecionada);
    } else if (!id && textoBase) {
      const partes = separarEnderecoDigitado(textoBase);
      if (partes.numero) textoBase = [partes.logradouro, partes.numero].filter(Boolean).join(', ');
      if (partes.detalhe) detalheVisivel = partes.detalhe;
    }
    if ($('routeEdit_fullAddress')) $('routeEdit_fullAddress').value = textoBase;
    if ($('routeEdit_details')) {
      $('routeEdit_details').value = detalheVisivel;
      $('routeEdit_details').dataset.original = detalheVisivel;
    }
    esconderSugestoesEm('routeEditAddressSuggestions');
    if ($('routeEdit_pacotes')) $('routeEdit_pacotes').value = (p.pacotes || []).join('\n');
    if ($('routeEdit_status')) $('routeEdit_status').value = p.statusEntrega || 'pendente';
    if ($('routeEdit_motivo')) $('routeEdit_motivo').value = p.motivoNaoEntrega || '';
    if ($('routeEdit_observacaoNaoEntrega')) $('routeEdit_observacaoNaoEntrega').value = p.observacaoNaoEntrega || '';
    if ($('routeStopEditorTitle')) $('routeStopEditorTitle').textContent = modoEdicaoNovo ? 'Adicionar parada' : 'Editar parada';
    modal.style.display = 'flex';
  }

  function fecharEditor() {
    const modal = $('routeStopEditorModal');
    if (modal) modal.style.display = 'none';
    esconderSugestoesEm('routeEditAddressSuggestions');
    stopEmEdicao = null;
    modoEdicaoNovo = false;
    contextoEditor = 'rota';
    sugestaoEnderecoSelecionada = null;
    sugestaoEditorSelecionada = null;
  }

  function pacotesDoCampo(texto) {
    const brs = String(texto || '').match(/BR[A-Za-z0-9]{8,25}/gi) || [];
    if (brs.length) return [...new Set(brs.map(v => v.toUpperCase()))];
    return [...new Set(String(texto || '').split(/[\n,;|]+/).map(v => v.trim()).filter(Boolean))];
  }

  async function salvarEditor() {
    const contextoSalvo = contextoEditor;
    const alvo = contextoSalvo === 'conferencia' ? rotaImportacaoPendente : rotaAtual;
    if (!alvo) return;
    const fields = ['logradouro','numero','complemento','apartamento','bloco','sala','loja','bairro','cidade','estado','cep','observacao'];
    const dados = {};
    fields.forEach(key => { dados[key] = String($(`routeEdit_${key}`)?.value || '').trim(); });
    const textoUnico = String($('routeEdit_fullAddress')?.value || '').trim();
    if (sugestaoEditorSelecionada) {
      dados.logradouro = String(sugestaoEditorSelecionada.street || textoPrimarioSugestao(sugestaoEditorSelecionada) || '').trim();
      dados.numero = String(sugestaoEditorSelecionada.housenumber || '').trim();
      dados.bairro = String(sugestaoEditorSelecionada.suburb || dados.bairro || '').trim();
      dados.cidade = String(sugestaoEditorSelecionada.city || dados.cidade || '').trim();
      dados.estado = String(sugestaoEditorSelecionada.state || dados.estado || '').trim();
      dados.cep = String(sugestaoEditorSelecionada.postcode || dados.cep || '').trim();
    } else if (textoUnico) {
      const partes = separarEnderecoDigitado(textoUnico);
      dados.logradouro = partes.logradouro || textoUnico;
      dados.numero = partes.numero || '';
      if (partes.detalhe && !String($('routeEdit_details')?.value || '').trim()) dados.complemento = partes.detalhe;
    }
    const detalhesEl = $('routeEdit_details');
    if (detalhesEl && String(detalhesEl.value || '').trim() !== String(detalhesEl.dataset.original || '').trim()) {
      dados.complemento = String(detalhesEl.value || '').trim();
      dados.apartamento = '';
      dados.bloco = '';
      dados.sala = '';
      dados.loja = '';
      dados.observacao = '';
    }
    dados.observacao = dados.observacao || '';
    dados.pacotes = pacotesDoCampo($('routeEdit_pacotes')?.value || '');
    dados.statusEntrega = String($('routeEdit_status')?.value || 'pendente');
    dados.motivoNaoEntrega = dados.statusEntrega === 'nao_entregue' ? String($('routeEdit_motivo')?.value || '') : '';
    dados.observacaoNaoEntrega = dados.statusEntrega === 'nao_entregue' ? String($('routeEdit_observacaoNaoEntrega')?.value || '') : '';
    if (!dados.logradouro) return notificar('Informe o endereço/logradouro da parada.');

    const eraOtimizada = contextoSalvo === 'rota' && (alvo.rotaOtimizada === true || !!alvo.geometria);
    const eraNova = !stopEmEdicao;
    let p = stopEmEdicao;
    const assinaturaEnderecoAnterior = p ? [p.logradouro,p.numero,p.bairro,p.cidade,p.estado,p.cep].map(v=>String(v||'').trim().toLocaleLowerCase('pt-BR')).join('|') : '';
    if (!p) {
      p = global.PacoteEMatoRotaStore.normalizarParada({
        id: idNovo('manual'), ordemOriginal: alvo.paradas.length + 1, origem: 'manual', ...dados
      }, alvo.paradas.length);
      alvo.paradas.push(p);
      alvo.ordem.push(p.id);
    } else {
      Object.assign(p, dados);
      p.alteradoEm = Date.now();
    }
    p.quantidadePacotes = p.pacotes.length;
    p.enderecoOriginal = enderecoDaParada(p);
    const sugestaoAplicavel = sugestaoEditorSelecionada && coordenadaValida(sugestaoEditorSelecionada.lat, sugestaoEditorSelecionada.lon);
    if (sugestaoAplicavel) {
      p.latitude = Number(sugestaoEditorSelecionada.lat);
      p.longitude = Number(sugestaoEditorSelecionada.lon);
      p.statusGeocodificacao = 'ok';
      p.precisaoGeocodificacao = 'sugestao_confirmada';
      p.enderecoGeocodificado = String(sugestaoEditorSelecionada.formatted || p.enderecoOriginal);
      p.geocodificadoEm = Date.now();
      p.fonteCoordenada = 'sugestao-geocodificacao';
      p.geocodificacao = clone(sugestaoEditorSelecionada);
    }
    if (p.statusEntrega === 'entregue') p.entregueEm = p.entregueEm || Date.now();
    if (p.statusEntrega !== 'entregue') p.entregueEm = null;

    const assinaturaEnderecoNova = [p.logradouro,p.numero,p.bairro,p.cidade,p.estado,p.cep].map(v=>String(v||'').trim().toLocaleLowerCase('pt-BR')).join('|');
    const enderecoMudou = eraNova || assinaturaEnderecoNova !== assinaturaEnderecoAnterior;
    if (enderecoMudou && !sugestaoAplicavel) {
      p.latitude = null;
      p.longitude = null;
      p.statusGeocodificacao = 'pendente';
      p.enderecoGeocodificado = '';
      p.geocodificadoEm = null;
      p.confiabilidade = null;
      p.confiabilidadeRua = null;
    }
    if (enderecoMudou && contextoSalvo === 'rota') invalidarRotaCalculada();
    fecharEditor();
    if (contextoSalvo === 'conferencia') {
      global.PacoteEMatoFluxoImportacao?.mostrarConferencia?.(alvo, resultadoImportacaoPendente?.erros || []);
      return;
    }
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo();

    if (enderecoMudou && !sugestaoAplicavel) await geocodificarParada(p);
    sugestaoEnderecoSelecionada = null;
    sugestaoEditorSelecionada = null;

    if (eraOtimizada && (!enderecoMudou || p.statusGeocodificacao === 'ok')) {
      const titulo = eraNova ? 'Parada adicionada' : 'Rota alterada';
      const texto = eraNova
        ? 'A nova parada já foi adicionada. Você pode manter a ordem atual ou otimizar novamente usando a rede viária.'
        : 'O endereço foi atualizado e validado. Você pode manter a ordem atual ou otimizar novamente usando a rede viária.';
      const decisao = await perguntarReotimizacao(titulo, texto);
      if (decisao === 'otimizar') await otimizarRota();
      else await recalcularOrdemAtual();
    }
  }

  async function removerParada(id) {
    const p = rotaAtual?.paradas.find(item => item.id === id);
    if (!p) return;
    if (!(await global.PacoteEMatoDialog.confirmar({titulo:'Remover esta parada?',mensagem:`${p.enderecoOriginal || 'Parada sem endereço'}\n\nEla será retirada da rota atual.`,confirmar:'Remover parada',cancelar:'Cancelar',perigo:true}))) return;
    const tinhaRotaCalculada = !!rotaAtual.geometria;
    rotaAtual.paradas = rotaAtual.paradas.filter(item => item.id !== id);
    rotaAtual.ordem = rotaAtual.ordem.filter(item => item !== id);
    invalidarRotaCalculada();
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: true });
    if (tinhaRotaCalculada && rotaAtual.paradas.length) await recalcularOrdemAtual();
  }

  async function duplicarParada(id) {
    const p = rotaAtual?.paradas.find(item => item.id === id);
    if (!p) return;
    const tinhaRotaCalculada = !!rotaAtual.geometria;
    const copia = clone(p);
    copia.id = idNovo('duplicada');
    copia.ordemOriginal = rotaAtual.paradas.length + 1;
    copia.ordemOtimizada = null;
    // Códigos de pacote são identificadores únicos; não são duplicados para evitar uma mesma etiqueta em duas paradas.
    copia.pacotes = [];
    copia.quantidadePacotes = 0;
    copia.quantidadeBipada = 0;
    copia.statusEntrega = 'pendente';
    copia.motivoNaoEntrega = '';
    copia.observacaoNaoEntrega = '';
    copia.entregueEm = null;
    copia.origem = 'duplicada';
    copia.criadoEm = Date.now();
    copia.alteradoEm = Date.now();
    rotaAtual.paradas.push(copia);
    rotaAtual.ordem.push(copia.id);
    invalidarRotaCalculada();
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: true });
    if (tinhaRotaCalculada) {
      const decisao = await perguntarReotimizacao(
        'Parada duplicada',
        'A nova parada foi adicionada com identificação própria. Você pode manter a ordem atual ou otimizar novamente.'
      );
      if (decisao === 'otimizar') await otimizarRota();
      else await recalcularOrdemAtual();
    }
  }

  async function alterarNomeRota() {
    if (!rotaAtual) return;
    const nome = String($('routingRouteName')?.value || rotaAtual.nome || 'Rota').trim();
    if (nome === rotaAtual.nome) return;
    rotaAtual.nome = nome || 'Rota';
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarResumo();
  }

  async function aplicarConfiguracoesNaRota(cfgRecebida) {
    const cfg = cfgRecebida || {};
    const campos = cfg.camposAlterados || [];
    const relevantes = campos.filter(k => ['veiculo','tempoParadaSegundos','retornarAoInicio','pontoInicial'].includes(k));
    if (!relevantes.length) return; // Troca de app de mapa não altera a rota.
    const atual = await global.PacoteEMatoRotaStore.obterRotaAtiva();
    if (!atual) return;
    rotaAtual = atual; // Inclui as entregas mais recentes feitas na navegação.
    const mudouVeiculo = relevantes.includes('veiculo') && rotaAtual.veiculo !== cfg.veiculo;
    if(relevantes.includes('veiculo')) {
      rotaAtual.veiculo=cfg.veiculo;
      rotaAtual.modoRoteamento=global.PacoteEMatoRotaStore.modoPorVeiculo(cfg.veiculo);
    }
    if(relevantes.includes('tempoParadaSegundos')) rotaAtual.tempoParadaSegundos=Math.max(0,Number(cfg.tempoParadaSegundos||0));
    if(relevantes.includes('retornarAoInicio')) rotaAtual.retornarAoInicio=cfg.retornarAoInicio===true;
    if(relevantes.includes('pontoInicial')) rotaAtual.pontoInicial=clone(cfg.pontoInicial);
    const refazer=mudouVeiculo || relevantes.includes('pontoInicial') || relevantes.includes('retornarAoInicio');
    if(refazer && rotaAtual.geometria) rotaAtual.precisaRecalculo=true;
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual,{ativa:true});
    renderizarTudo({fit:false});
    if(mudouVeiculo && rotaAtual.paradas.some(p=>!paradaFinalizada(p))) {
      await otimizarRota();
      if(rotaAtual.precisaRecalculo) notificar('Veículo salvo. Recalcule a rota antes de navegar com o novo perfil.');
    }
  }

  async function abrirEscolhaPacotes() {
    fecharMenuAcoes();
    await mostrarTutorialPacotesSeNecessario();
    const backdrop = $('routingPackagesChooserBackdrop');
    if (backdrop) backdrop.style.display = 'flex';
    registrarRetornoInterno('pacotes_rota');
  }
  function fecharEscolhaPacotes(){ const backdrop=$('routingPackagesChooserBackdrop'); if(backdrop)backdrop.style.display='none'; }

  function abrirEscolhaBipagem() {
    fecharMenuAcoes();
    const backdrop = $('routingBipagemChooserBackdrop');
    if (backdrop) backdrop.style.display = 'flex';
    registrarRetornoInterno('bipagem_chooser');
    const totalPacotes = (rotaAtual?.paradas || []).reduce((n, p) => n + (p.pacotes?.length || 0), 0);
    if ($('routingBipagemCurrentRouteBtn')) $('routingBipagemCurrentRouteBtn').disabled = !rotaAtual?.paradas?.length || !totalPacotes;
  }

  function fecharEscolhaBipagem() {
    const backdrop = $('routingBipagemChooserBackdrop');
    if (backdrop) backdrop.style.display = 'none';
  }

  async function abrirBipagemDaRota() {
    const totalPacotes = (rotaAtual?.paradas || []).reduce((n, p) => n + (p.pacotes?.length || 0), 0);
    if (!rotaAtual?.paradas?.length || !totalPacotes) return notificar('A rota atual ainda não possui códigos de pacote para bipar.');
    fecharEscolhaBipagem();
    await global.PacoteEMatoRotaStore?.salvarRota?.(rotaAtual, { ativa: true });
    await global.PacoteEMatoSessao?.persistirAgora?.({ motivo: 'abrir_bipagem_rota', paradaSelecionadaId: global.appState?.roteirizacao?.paradaSelecionadaId || null });
    await global.PacoteEMatoAppShell?.abrirModulo?.('bipagem', { usarRotaAtiva: true });
  }

  async function abrirBipagemPdf() {
    fecharEscolhaBipagem();
    await global.PacoteEMatoSessao?.persistirAgora?.({ motivo: 'abrir_bipagem_pdf' });
    await global.PacoteEMatoAppShell?.abrirModulo?.('bipagem', { usarRotaAtiva: false });
    setTimeout(() => $('pdfInput')?.click?.(), 120);
  }

  async function abrirNavegacao() {
    if (await garantirConfiguracoesObrigatorias('iniciar a rota') === false) return;
    if (rotaAtual?.precisaRecalculo) return notificar('A rota foi alterada. Recalcule o trajeto antes de iniciar a navegação.');
    if (!rotaAtual?.geometria) return notificar('Calcule a rota pelas ruas antes de iniciar a operação.');
    rotaAtual.status = rotaAtual.status === 'concluida' ? 'concluida' : 'ativa';
    const iniciandoAgora = !rotaAtual.iniciadoEm;
    rotaAtual.iniciadoEm = rotaAtual.iniciadoEm || Date.now();
    if (iniciandoAgora && Number.isFinite(Number(rotaAtual.duracaoTotalSegundos))) {
      rotaAtual.horarioTerminoEstimado = Date.now() + Number(rotaAtual.duracaoTotalSegundos) * 1000;
    }
    const byId = new Map((rotaAtual.paradas || []).map(p => [String(p.id), p]));
    const selecionada = global.appState?.roteirizacao?.paradaSelecionadaId;
    const proxima = (selecionada && byId.get(String(selecionada)) && !paradaFinalizada(byId.get(String(selecionada))))
      ? byId.get(String(selecionada))
      : (rotaAtual.ordem || []).map(id => byId.get(String(id))).find(p => p && !paradaFinalizada(p));
    if (proxima) rotaAtual.paradaSelecionadaId = proxima.id;
    global.PacoteEMatoMarcadores?.capturarBaseVisualStatus?.(rotaAtual, false);
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    await global.PacoteEMatoSessao?.persistirAgora?.({ motivo: 'iniciar_rota', paradaSelecionadaId: proxima?.id || null, navegacaoAtiva: true });
    await global.PacoteEMatoAppShell?.abrirModulo?.('navegacao');
  }

  function abrirPontoFinal() {
    if (!rotaAtual) return;
    fecharMenuAcoes();
    sugestaoPontoFinalSelecionada = null;
    esconderSugestoesEm('routingEndPointSuggestions');
    const modal = $('routingEndPointModal');
    const input = $('routingEndPointInput');
    if (input) input.value = rotaAtual.pontoFinal?.descricao || '';
    const status = $('routingEndPointStatus');
    if (status) {
      status.textContent = rotaAtual.pontoFinal?.descricao
        ? `Atual: ${rotaAtual.pontoFinal.descricao}`
        : 'Digite e escolha o endereço correto na lista abaixo.';
      status.dataset.status = rotaAtual.pontoFinal ? 'ok' : 'warning';
    }
    if ($('routingEndPointRemoveBtn')) $('routingEndPointRemoveBtn').disabled = !rotaAtual.pontoFinal;
    if (modal) modal.style.display = 'flex';
    registrarRetornoInterno('ponto_final');
    setTimeout(() => input?.focus?.(), 0);
  }

  function fecharPontoFinal() {
    const modal = $('routingEndPointModal');
    if (modal) modal.style.display = 'none';
    esconderSugestoesEm('routingEndPointSuggestions');
    sugestaoPontoFinalSelecionada = null;
  }

  async function salvarPontoFinal() {
    if (!rotaAtual) return;
    const texto = String($('routingEndPointInput')?.value || '').trim();
    const status = $('routingEndPointStatus');
    if (!texto) {
      if (status) { status.textContent = 'Informe o endereço do ponto final.'; status.dataset.status = 'warning'; }
      return;
    }
    const btn = $('routingEndPointSaveBtn');
    if (btn) btn.disabled = true;
    if (status) { status.textContent = 'Confirmando o ponto final...'; delete status.dataset.status; }
    try {
      let descricao = texto;
      let lat = null;
      let lon = null;
      if (sugestaoPontoFinalSelecionada && coordenadaValida(sugestaoPontoFinalSelecionada.lat, sugestaoPontoFinalSelecionada.lon)) {
        lat = Number(sugestaoPontoFinalSelecionada.lat);
        lon = Number(sugestaoPontoFinalSelecionada.lon);
        descricao = String(sugestaoPontoFinalSelecionada.formatted || textoPrimarioSugestao(sugestaoPontoFinalSelecionada) || texto).trim();
      } else {
        if (!global.PacoteEMatoGeocodificacao?.geocodificarEnderecoLivre) throw new Error('Serviço de localização de endereço indisponível.');
        const p = await global.PacoteEMatoGeocodificacao.geocodificarEnderecoLivre(texto);
        if (p?.statusGeocodificacao !== 'ok' || !coordenadaValida(p.latitude, p.longitude)) {
          throw new Error('Não foi possível confirmar esse endereço. Escolha uma sugestão da lista ou revise o ponto final.');
        }
        lat = Number(p.latitude);
        lon = Number(p.longitude);
        descricao = String(p.enderecoGeocodificado || texto).trim();
      }
      rotaAtual.pontoFinal = { tipo: 'endereco', descricao, lat, lon, status: 'ok' };
      rotaAtual.pontoFinalConcluidoEm = null;
      rotaAtual.retornarAoInicio = false;
      invalidarRotaCalculada();
      rotaAtual.precisaRecalculo = true;
      rotaAtual.alteradoEm = Date.now();
      await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
      renderizarTudo({ fit: true });
      fecharPontoFinal();
      notificar('Ponto final salvo. Recalcule ou otimize a rota para incluir esse destino depois da última entrega.');
    } catch (erro) {
      if (status) { status.textContent = erro?.message || 'Não foi possível salvar o ponto final.'; status.dataset.status = 'error'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function removerPontoFinal() {
    if (!rotaAtual?.pontoFinal) return fecharPontoFinal();
    rotaAtual.pontoFinal = null;
    rotaAtual.pontoFinalConcluidoEm = null;
    invalidarRotaCalculada();
    rotaAtual.precisaRecalculo = true;
    rotaAtual.alteradoEm = Date.now();
    await global.PacoteEMatoRotaStore.salvarRota(rotaAtual, { ativa: true });
    renderizarTudo({ fit: true });
    fecharPontoFinal();
    notificar('Ponto final removido da rota.');
  }

  async function avisarLocalizacaoAntesImportar() {
    const loc = global.PacoteEMatoLocalizacaoAtual;
    if (!loc) return true;
    let permissao = 'desconhecida';
    try {
      if (loc.ultimaValida?.()) return true;
      permissao = await loc.permissao?.() || 'desconhecida';
      try {
        const pos = await loc.obter?.({ forcar: false });
        if (pos) return true;
      } catch (erro) {
        const code = String(erro?.code || '');
        // Permissão liberada mas sem fix momentâneo (timeout/sinal fraco) não é
        // motivo para mandar o usuário de volta às Configurações.
        if (permissao === 'granted' && code !== 'GEO_NEGADA') return true;
        if (code !== 'GEO_NEGADA') return true;
      }
    } catch (_) { return true; }
    const abrirConfig = await global.PacoteEMatoDialog?.confirmar?.({
      titulo: 'Ative a localização nas Configurações',
      mensagem: 'A permissão de localização está bloqueada para o Pacote É Mato. Abra Configurações > Localização e permita o acesso, ou continue sem GPS.',
      confirmar: 'Abrir configurações',
      cancelar: 'Continuar sem localização'
    });
    if (abrirConfig === true) {
      await global.PacoteEMatoAppShell?.abrirModulo?.('configuracoes');
      return false;
    }
    return true;
  }

  async function exportarPdf() {
    if (!rotaAtual) return;
    try { await global.PacoteEMatoPDF?.exportar?.(rotaAtual); }
    catch (erro) { global.PacoteEMatoTelemetria?.registrarProblema?.('exportacao_pdf', erro?.message || 'Falha ao exportar PDF', { modulo: 'roteirizacao' }); notificar(erro?.message || 'Não foi possível gerar o PDF.'); }
  }

  function abrirMobilePane(tipo) {
    definirEstadoPainel(tipo === 'lista' ? 'expanded' : 'collapsed');
  }

  function bind() {
    const abrirImportacao = async () => {
      fecharMenuAcoes();
      if (await avisarLocalizacaoAntesImportar() === false) return;
      const input = $('routingXlsxInput');
      if (!input) return definirStatusImportacao('Seletor de planilha não encontrado. Recarregue a página.', 'error');
      input.click();
    };
    $('routingImportBtn')?.addEventListener('click', abrirImportacao);
    $('routingMainImportBtn')?.addEventListener('click', abrirImportacao);
    $('routingEmptyImportBtn')?.addEventListener('click', abrirImportacao);
    $('routingXlsxInput')?.addEventListener('change', event => importarArquivo(event.target.files?.[0]));
    $('routingAddStopBtn')?.addEventListener('click', () => { fecharMenuAcoes(); iniciarAdicaoBusca(); });
    $('routingEndPointBtn')?.addEventListener('click', abrirPontoFinal);
    $('routingNewRouteBtn')?.addEventListener('click', criarNovaRotaVazia);
    $('routingClearRoutesBtn')?.addEventListener('click', removerTodasRotas);
    $('routeImportAppendBtn')?.addEventListener('click', () => concluirModoImportacao('adicionar'));
    $('routeImportReplaceBtn')?.addEventListener('click', () => concluirModoImportacao('substituir'));
    $('routeImportModeCancelBtn')?.addEventListener('click', () => concluirModoImportacao(null));
    $('routingMapSettingsBtn')?.addEventListener('click', () => global.PacoteEMatoAppShell?.abrirModulo?.('configuracoes'));
    $('routingGeocodeBtn')?.addEventListener('click', () => { fecharMenuAcoes(); geocodificarTodas(); });
    $('routingOptimizeBtn')?.addEventListener('click', () => { fecharMenuAcoes(); otimizarRota(); });
    $('routingRefineMenuBtn')?.addEventListener('click', async () => { fecharMenuAcoes(); await abrirRefinoComTutorial(); });
    $('routingMainOptimizeBtn')?.addEventListener('click', otimizarRota);
    $('routingInvertBtn')?.addEventListener('click', () => { fecharMenuAcoes(); inverterRota(); });
    $('routingExportPdfBtn')?.addEventListener('click', () => { fecharMenuAcoes(); exportarPdf(); });
    $('routingStartNavBtn')?.addEventListener('click', () => { fecharMenuAcoes(); abrirNavegacao(); });
    $('routingPackagesMenuBtn')?.addEventListener('click', abrirEscolhaPacotes);
    $('routingPackagesChooserClose')?.addEventListener('click', fecharEscolhaPacotes);
    $('routingPackagesChooserBackdrop')?.addEventListener('click',event=>{if(event.target===$('routingPackagesChooserBackdrop'))fecharEscolhaPacotes();});
    $('routingAddPackagesBtn')?.addEventListener('click',()=>fecharEscolhaPacotes());
    $('routingRemovePackagesBtn')?.addEventListener('click',()=>fecharEscolhaPacotes());
    $('routingBipagemMenuBtn')?.addEventListener('click', abrirEscolhaBipagem);
    $('routingBipagemChooserClose')?.addEventListener('click', fecharEscolhaBipagem);
    $('routingBipagemChooserBackdrop')?.addEventListener('click', event => { if (event.target === $('routingBipagemChooserBackdrop')) fecharEscolhaBipagem(); });
    $('routingBipagemCurrentRouteBtn')?.addEventListener('click', abrirBipagemDaRota);
    $('routingBipagemPdfBtn')?.addEventListener('click', abrirBipagemPdf);
    $('routingReviewCloseBtn')?.addEventListener('click', fecharRevisaoOtimizacao);
    $('routingRefineBackdrop')?.addEventListener('click', event => { if (event.target === $('routingRefineBackdrop')) fecharRefinoStandalone(); });
    $('routingReviewConfirmBtn')?.addEventListener('click', confirmarRevisaoOtimizacao);
    $('routingReviewRefineBtn')?.addEventListener('click', alternarRefino);
    $('routingRefineCloseBtn')?.addEventListener('click', fecharRefinoStandalone);
    const refinePanel = $('routingRefinePanel');
    ['touchmove','wheel'].forEach(tipo => refinePanel?.addEventListener(tipo, event => event.stopPropagation(), { passive: true }));
    $('routingRefineInvertBtn')?.addEventListener('click', inverterRota);
    $('routingRefineDrawBtn')?.addEventListener('click', iniciarRefinoDesenho);
    $('routingRefineUndoBtn')?.addEventListener('click', desfazerUltimoRefino);
    $('routingOptimizationReviewBackdrop')?.addEventListener('click', event => { if (event.target === $('routingOptimizationReviewBackdrop')) fecharRevisaoOtimizacao(); });
    $('routingEndPointCancelBtn')?.addEventListener('click', fecharPontoFinal);
    $('routingEndPointSaveBtn')?.addEventListener('click', salvarPontoFinal);
    $('routingEndPointRemoveBtn')?.addEventListener('click', removerPontoFinal);
    $('routingEndPointModal')?.addEventListener('click', event => { if (event.target === $('routingEndPointModal')) fecharPontoFinal(); });
    $('routingEndPointInput')?.addEventListener('input', event => {
      sugestaoPontoFinalSelecionada = null;
      const texto = String(event.currentTarget.value || '').trim();
      clearTimeout(buscaPontoFinalTimer);
      buscaPontoFinalTimer = setTimeout(() => atualizarSugestoesPontoFinal(texto), 280);
    });
    $('routingEndPointInput')?.addEventListener('focus', event => { const texto = String(event.currentTarget.value || '').trim(); if (texto.length >= 4) atualizarSugestoesPontoFinal(texto); });
    $('routingEndPointInput')?.addEventListener('keydown', event => { if (event.key === 'Escape') esconderSugestoesEm('routingEndPointSuggestions'); if (event.key === 'Enter') { event.preventDefault(); salvarPontoFinal(); } });
    $('routingDrawCancelBtn')?.addEventListener('click', () => cancelarRefinoDesenho({ reabrir: true }));
    $('routingDrawClearBtn')?.addEventListener('click', () => global.PacoteEMatoMapa?.limparSelecaoDesenho?.());
    $('routingDrawAddGroupBtn')?.addEventListener('click', adicionarGrupoDesenho);
    $('routingDrawApplyGroupsBtn')?.addEventListener('click', aplicarGruposDesenho);
    $('routingDrawUndoGroupBtn')?.addEventListener('click', desfazerUltimoGrupoDesenho);
    $('routingDrawClearGroupsBtn')?.addEventListener('click', limparGruposDesenho);
    $('routingDrawInteractionBtn')?.addEventListener('click', () => {
      const atual = $('routingDrawInteractionBtn')?.textContent === 'Mover mapa' ? 'draw' : 'pan';
      const proximo = atual === 'draw' ? 'pan' : 'draw';
      global.PacoteEMatoMapa?.definirModoInteracaoSelecao?.(proximo);
    });
    $('routingOpenSettingsBtn')?.addEventListener('click', () => { fecharMenuAcoes(); global.PacoteEMatoAppShell?.abrirModulo?.('configuracoes'); });
    $('routingActionsBtn')?.addEventListener('click', abrirMenuAcoes);
    $('routingActionsCloseBtn')?.addEventListener('click', fecharMenuAcoes);
    $('routingActionsBackdrop')?.addEventListener('click', event => { if (event.target === $('routingActionsBackdrop')) fecharMenuAcoes(); });
    $('routingSheetToggle')?.addEventListener('click', alternarPainel);
    $('routingPrimaryActionBtn')?.addEventListener('click', executarAcaoPrincipal);
    const atualizarBuscaAdicionar = () => {
      const texto=String($('routingStopSearch')?.value||'').trim();
      sugestaoEnderecoSelecionada = null;
      if(global.appState?.ui)global.appState.ui.buscaParadas=texto;
      atualizarControlesBuscaEndereco();
      clearTimeout(buscaEnderecoTimer);
      buscaEnderecoTimer=setTimeout(()=>atualizarSugestoesEndereco(texto),320);
      renderizarLista();
    };
    $('routingStopSearch')?.addEventListener('input',atualizarBuscaAdicionar);
    $('routingStopSearch')?.addEventListener('focus',()=>{const texto=String($('routingStopSearch')?.value||'').trim();if(texto.length>=4)atualizarSugestoesEndereco(texto);});
    $('routingStopSearch')?.addEventListener('keydown',e=>{if(e.key==='Escape'){if(paradaEdicaoBuscaId)encerrarEdicaoBusca();else esconderSugestoesEndereco();}if(e.key==='Enter'){const texto=String(e.currentTarget.value||'').trim();if(texto.length>=4){e.preventDefault();esconderSugestoesEndereco();salvarEnderecoBuscaPrincipal();}}});
    $('routingSearchAddBtn')?.addEventListener('click',()=>{const texto=String($('routingStopSearch')?.value||'').trim();if(texto){esconderSugestoesEndereco();salvarEnderecoBuscaPrincipal();}});
    $('routingSearchModeCancel')?.addEventListener('click',()=>encerrarEdicaoBusca());
    iniciarArrastePainel();

    $('routingSelectedStopEdit')?.addEventListener('click', () => {
      const id = global.appState?.roteirizacao?.paradaSelecionadaId;
      if (id) iniciarEdicaoBusca(id);
    });
    $('routeStopEditorSave')?.addEventListener('click', salvarEditor);
    $('routeEdit_fullAddress')?.addEventListener('input', event => {
      sugestaoEditorSelecionada = null;
      const texto = String(event.currentTarget.value || '').trim();
      clearTimeout(buscaEditorTimer);
      buscaEditorTimer = setTimeout(() => atualizarSugestoesEditor(texto), 280);
    });
    $('routeEdit_fullAddress')?.addEventListener('focus', event => {
      const texto = String(event.currentTarget.value || '').trim();
      if (texto.length >= 4) atualizarSugestoesEditor(texto);
    });
    $('routeEdit_fullAddress')?.addEventListener('keydown', event => {
      if (event.key === 'Escape') esconderSugestoesEm('routeEditAddressSuggestions');
    });
    $('routeStopEditorCancel')?.addEventListener('click', fecharEditor);
    $('routeStopEditorClose')?.addEventListener('click', fecharEditor);
    $('routeKeepOrderBtn')?.addEventListener('click', () => concluirDecisaoReotimizacao('manter'));
    $('routeReoptBtn')?.addEventListener('click', () => concluirDecisaoReotimizacao('otimizar'));
    $('routingRouteName')?.addEventListener('change', alterarNomeRota);
    $('routingRouteNameMirror')?.addEventListener('change', async () => {
      if ($('routingRouteName')) $('routingRouteName').value = $('routingRouteNameMirror').value;
      await alterarNomeRota();
    });

    $('routeImportMappingClose')?.addEventListener('click', () => concluirMapeamentoImportacao(null));
    $('routeImportMappingCancel')?.addEventListener('click', () => concluirMapeamentoImportacao(null));
    $('routeImportMappingConfirm')?.addEventListener('click', confirmarMapeamentoImportacao);

    global.addEventListener('pemato:import:confirmar', () => confirmarImportacaoPendente());
    global.addEventListener('pemato:import:cancelar', cancelarImportacaoPendente);
    global.addEventListener('pemato:import:tentar-outro', () => $('routingXlsxInput')?.click());
    global.addEventListener('pemato:import:editar', event => { if (rotaImportacaoPendente && event.detail?.id) abrirEditor(event.detail.id, 'conferencia'); });
    global.addEventListener('pemato:import:adicionar', () => { if (rotaImportacaoPendente) abrirEditor(null, 'conferencia'); });

    global.addEventListener('pemato:map-selection-change', event => atualizarToolbarDesenho(event.detail || {}));

    global.addEventListener('pemato:worker:update', () => { renderizarPreferencias(); atualizarDisponibilidadeAcoes(); atualizarAcaoPrincipal(); });
    global.addEventListener('pemato:geo:update', () => { renderizarResumo(); renderizarLista(); global.PacoteEMatoMapa?.renderizar(); });
    global.addEventListener('pemato:geo:progress', event => {
      renderizarResumo();
      const overlay = $('routingBusyOverlay');
      const detalhe = event.detail || {};
      if ((!overlay || overlay.style.display === 'none') && Number(detalhe.total || 0) > 0) {
        definirStatusImportacao(`Localizando endereços: ${Math.min(Number(detalhe.processadas || 0), Number(detalhe.total || 0))}/${Number(detalhe.total || 0)}.`, null);
      }
    });
    global.addEventListener('pemato:geo:coordinate-validation-progress', event => {
      const overlay = $('routingBusyOverlay');
      const detalhe = event.detail || {};
      if (Number(detalhe.total || 0) <= 0) return;
      const texto = `Conferindo posições: ${Math.min(Number(detalhe.processadas || 0), Number(detalhe.total || 0))}/${Number(detalhe.total || 0)}.`;
      if (overlay && overlay.style.display !== 'none') {
        atualizarProcessamento('Checagem rápida de posições', texto);
      } else {
        definirStatusImportacao(texto, null);
      }
    });
    global.addEventListener('pemato:rota:salva', e => {
      if (e.detail?.rota?.id === rotaAtual?.id) global.PacoteEMatoAppShell?.atualizarInicio?.();
    });
    global.addEventListener('resize', () => {
      if (!ambienteMobile()) definirEstadoPainel('expanded');
      else if (!['expanded','intermediate','collapsed'].includes(estadoPainel)) definirEstadoPainel('collapsed');
      setTimeout(() => global.PacoteEMatoMapa?.renderizar?.(), 80);
    });
  }

  function iniciar() {
    bind();
    const buscaRestaurada = String(global.appState?.ui?.buscaParadas || '');
    if ($('routingStopSearch') && buscaRestaurada) $('routingStopSearch').value = buscaRestaurada;
    const painelRestaurado = global.appState?.ui?.painelRoteirizacao;
    definirEstadoPainel(ambienteMobile()
      ? (['expanded','intermediate','collapsed'].includes(painelRestaurado) ? painelRestaurado : estadoPainel)
      : 'expanded');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();

  global.PacoteEMatoRoteirizacao = Object.freeze({
    carregarRotaAtiva,
    // Entrada nativa Android reutiliza rigorosamente o importador oficial.
    importarArquivoExterno: file => importarArquivo(file, { otimizarAoImportar: true }),
    obterRotaAtual: () => clone(rotaAtual),
    renderizarTudo,
    selecionarParada,
    abrirEditor,
    geocodificarTodas,
    otimizarRota,
    aplicarConfiguracoesNaRota,
    inverterRota,
    recalcularOrdemAtual,
    usarRotaLegada,
    lerPlanilhaComMapeamento,
    abrirNavegacao,
    abrirBipagemDaRota,
    abrirEscolhaBipagem,
    abrirEscolhaPacotes,
    abrirRevisaoOtimizacao,
    iniciarRefinoDesenho,
    aplicarGruposDesenho,
    cancelarRefinoDesenho,
    desfazerUltimoRefino,
    criarNovaRotaVazia,
    removerTodasRotas
  });
})(window);
