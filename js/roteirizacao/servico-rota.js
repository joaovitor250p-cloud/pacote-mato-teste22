(function iniciarServicoRota(global) {
  'use strict';

  function cfg() { return global.PEMATO_MAP_CONFIG || {}; }

  function endpoint(nome) {
    // V66: não usa mais endpoints antigos salvos no aparelho.
    return nome === 'optimize' ? String(cfg().optimizeEndpoint || '') : String(cfg().routeEndpoint || '');
  }

  function healthEndpoint() { return String(cfg().healthEndpoint || ''); }

  async function verificarServico() {
    const url = healthEndpoint();
    if (!url) return { ok: false, configured: false, providerConfigured: false, reason: 'worker_not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { method: 'GET', headers: { 'X-Pacote-Em-Mato-Client': 'routing-v1' }, credentials: 'omit', signal: controller.signal });
      let data = null;
      try { data = await response.json(); } catch (_) {}
      return { ok: response.ok && data?.ok === true, configured: true, providerConfigured: data?.providerConfigured === true, status: response.status, detail: data };
    } catch (erro) {
      return { ok: false, configured: true, providerConfigured: false, reason: erro?.name === 'AbortError' ? 'timeout' : 'unavailable' };
    } finally { clearTimeout(timer); }
  }

  async function post(url, body, timeoutMs) {
    if (!url) {
      const e = new Error('Serviço seguro de roteirização não configurado.');
      e.code = 'WORKER_NAO_CONFIGURADO';
      throw e;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || Number(cfg().routingRequestTimeoutMs || 45000));
    try {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pacote-Em-Mato-Client': 'routing-v1' },
          credentials: 'omit', body: JSON.stringify(body), signal: controller.signal
        });
      } catch (redeErro) {
        const erro = new Error('Não foi possível conectar ao Holy-Frog de rotas. O app já está apontando para o backend oficial; verifique a publicação do Worker e tente novamente.');
        erro.code = redeErro?.name === 'AbortError' ? 'ROUTING_TIMEOUT' : 'ROUTING_NETWORK';
        erro.cause = redeErro;
        throw erro;
      }
      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok || !data?.ok) {
        const code = data?.error || `HTTP_${response.status}`;
        const mensagens = {
          provider_not_configured: 'O serviço de rotas está publicado, mas a chave do provedor ainda não foi configurada no servidor.',
          origin_not_allowed: 'Este domínio não está autorizado no serviço de rotas.',
          rate_limited: 'O serviço de rotas atingiu o limite temporário de requisições. Aguarde e tente novamente.',
          optimizer_timeout: 'A otimização demorou mais que o limite do serviço.',
          optimizer_unavailable: 'O otimizador está temporariamente indisponível.',
          optimizer_error: 'O provedor recusou ou falhou ao otimizar a rota. A rota anterior foi preservada.',
          route_timeout: 'O cálculo da rota demorou mais que o limite do serviço.',
          route_unavailable: 'O serviço de geometria da rota está temporariamente indisponível.',
          route_error: 'O provedor falhou ao calcular um trecho da rota pelas ruas.'
        };
        const erro = new Error(mensagens[code] || data?.message || `Falha no serviço de rota (${response.status}).`);
        erro.code = code; erro.status = response.status; erro.detail = data;
        throw erro;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  function coord(p) {
    if (!p) return null;
    const latBruto = p.lat ?? p.latitude;
    const lonBruto = p.lon ?? p.longitude;
    if (latBruto === null || latBruto === undefined || String(latBruto).trim() === '') return null;
    if (lonBruto === null || lonBruto === undefined || String(lonBruto).trim() === '') return null;
    const lat = Number(latBruto), lon = Number(lonBruto);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  function perfilVeiculo(veiculo) {
    if (veiculo === 'moto') return 'motorcycle';
    if (veiculo === 'caminhao_leve') return 'light_truck';
    if (veiculo === 'caminhao') return 'truck';
    return 'drive';
  }

  function tipoRota(rota) {
    const preferencia = String(rota?.preferenciaRota || 'short');
    if (preferencia === 'less_maneuvers' && perfilVeiculo(rota?.veiculo) === 'motorcycle') return 'balanced';
    return ['short', 'balanced', 'less_maneuvers'].includes(preferencia) ? preferencia : 'short';
  }

  function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function erroTransitórioRota(erro) {
    const status = Number(erro?.status || 0);
    const code = String(erro?.code || '');
    return status >= 500 || ['optimizer_timeout','optimizer_unavailable','optimizer_error','route_timeout','route_unavailable','route_error'].includes(code);
  }

  async function postComRetry(url, body, timeoutMs, tentativas) {
    const total = Math.max(1, Number(tentativas || 1));
    let ultimoErro = null;
    for (let i = 0; i < total; i++) {
      try { return await post(url, body, timeoutMs); }
      catch (erro) {
        ultimoErro = erro;
        if (i >= total - 1 || !erroTransitórioRota(erro)) throw erro;
        await esperar(700 * (i + 1));
      }
    }
    throw ultimoErro || new Error('Falha no serviço de rota.');
  }

  function chaveFisicaParada(parada) {
    try {
      const chave = global.PacoteEMatoMarcadores?.chaveFisicaMarcador?.(parada);
      if (chave) return String(chave);
    } catch (_) {}
    const c = coord(parada);
    if (c) return `coord:${c.lat.toFixed(5)}|${c.lon.toFixed(5)}`;
    return `id:${String(parada?.id || '')}`;
  }

  function gruposFisicosPendentes(rota) {
    const paradas = Array.isArray(rota?.paradas) ? rota.paradas : [];
    const finalizada = p => ['entregue', 'concluida', 'nao_entregue'].includes(String(p?.statusEntrega || ''));
    const rank = new Map();
    (Array.isArray(rota?.ordem) ? rota.ordem : []).forEach((id, i) => rank.set(String(id), i));
    const ordenadas = paradas
      .map((p, i) => ({ p, i, r: rank.has(String(p.id)) ? rank.get(String(p.id)) : 100000 + i }))
      .filter(x => !finalizada(x.p))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(x => x.p);

    const mapa = new Map();
    ordenadas.forEach(p => {
      const chave = chaveFisicaParada(p);
      if (!mapa.has(chave)) mapa.set(chave, { chave, representante: p, paradas: [] });
      mapa.get(chave).paradas.push(p);
    });
    return [...mapa.values()];
  }

  function expandirOrdemFisica(grupos, idsRepresentantes) {
    const porRepresentante = new Map((grupos || []).map(g => [String(g.representante?.id || ''), g]));
    const saida = [];
    const usados = new Set();
    (idsRepresentantes || []).forEach(id => {
      const g = porRepresentante.get(String(id));
      if (!g || usados.has(g.chave)) return;
      usados.add(g.chave);
      g.paradas.forEach(p => saida.push(String(p.id)));
    });
    (grupos || []).forEach(g => {
      if (usados.has(g.chave)) return;
      usados.add(g.chave);
      g.paradas.forEach(p => saida.push(String(p.id)));
    });
    return saida;
  }

  function normalizarOrdemPorParadaFisica(rota, ordemIds) {
    const paradas = Array.isArray(rota?.paradas) ? rota.paradas : [];
    const byId = new Map(paradas.map(p => [String(p.id), p]));
    const finalizada = p => ['entregue', 'concluida', 'nao_entregue'].includes(String(p?.statusEntrega || ''));
    const ordemBase = Array.isArray(ordemIds) && ordemIds.length ? ordemIds.map(String) : paradas.map(p => String(p.id));
    const rank = new Map(ordemBase.map((id, i) => [String(id), i]));

    const finalizadas = ordemBase.map(id => byId.get(String(id))).filter(p => p && finalizada(p));
    paradas.filter(finalizada).forEach(p => { if (!finalizadas.includes(p)) finalizadas.push(p); });

    const grupos = new Map();
    paradas.filter(p => !finalizada(p)).forEach((p, i) => {
      const chave = chaveFisicaParada(p);
      if (!grupos.has(chave)) grupos.set(chave, { chave, paradas: [], primeiraPosicao: Infinity, fallback: i });
      const g = grupos.get(chave);
      g.paradas.push(p);
      if (rank.has(String(p.id))) g.primeiraPosicao = Math.min(g.primeiraPosicao, rank.get(String(p.id)));
    });

    const ordenados = [...grupos.values()].sort((a, b) => a.primeiraPosicao - b.primeiraPosicao || a.fallback - b.fallback);
    const pendentes = [];
    ordenados.forEach(g => {
      g.paradas.sort((a, b) => (rank.get(String(a.id)) ?? 1e9) - (rank.get(String(b.id)) ?? 1e9));
      g.paradas.forEach(p => pendentes.push(p));
    });
    return [...finalizadas, ...pendentes].map(p => String(p.id));
  }

  function removerPontosConsecutivosRepetidos(points) {
    const saida = [];
    let ultima = null;
    (points || []).forEach(p => {
      const c = coord(p);
      if (!c) return;
      const chave = `${c.lat.toFixed(7)}|${c.lon.toFixed(7)}`;
      if (chave === ultima) return;
      saida.push(c);
      ultima = chave;
    });
    return saida;
  }

  async function otimizar(rota) {
    const start = coord(rota?.pontoInicial);
    if (!start) throw new Error('Defina um ponto de partida válido antes de otimizar.');

    const grupos = gruposFisicosPendentes(rota);
    if (!grupos.length) throw new Error('Não existem paradas pendentes para otimizar.');
    const semCoordenada = grupos.filter(g => !coord(g.representante));
    if (semCoordenada.length) {
      const erro = new Error(`${semCoordenada.length} parada(s) física(s) ainda não possuem coordenadas válidas.`);
      erro.code = 'PARADAS_SEM_COORDENADA';
      erro.paradas = semCoordenada.flatMap(g => g.paradas.map(p => p.id));
      throw erro;
    }

    // V64: o Route Planner recebe uma visita por endereço físico, e não uma visita
    // por pacote/entrega. Ex.: 30 entregas em 26 imóveis => 26 jobs. Depois a ordem
    // física é expandida novamente para os 30 IDs, mantendo múltiplos juntos.
    const mode = perfilVeiculo(rota.veiculo);
    const jobs = grupos.map(g => ({
      id: String(g.representante.id),
      location: coord(g.representante),
      duration: Math.max(0, Number(rota.tempoParadaSegundos || 0))
    }));

    const resultado = await postComRetry(endpoint('optimize'), {
      mode,
      start,
      end: rota.pontoFinal ? coord(rota.pontoFinal) : null,
      returnToStart: rota.retornarAoInicio === true,
      stopDurationSeconds: Math.max(0, Number(rota.tempoParadaSegundos || 0)),
      traffic: 'free_flow',
      type: tipoRota(rota),
      stops: jobs
    }, Number(cfg().routingRequestTimeoutMs || 45000), 2);

    const naoAtribuidas = Array.isArray(resultado?.issues?.unassignedJobs) ? resultado.issues.unassignedJobs : [];
    const esperado = new Set(jobs.map(j => String(j.id)));
    const ordemFisica = Array.isArray(resultado?.orderIds) ? [...new Set(resultado.orderIds.map(String))] : [];
    const desconhecidas = ordemFisica.filter(id => !esperado.has(id));
    const faltantes = [...esperado].filter(id => !ordemFisica.includes(id));
    if (naoAtribuidas.length || desconhecidas.length || faltantes.length || ordemFisica.length !== grupos.length) {
      const erro = new Error('O serviço não conseguiu atribuir todas as paradas físicas. Nenhuma entrega foi descartada.');
      erro.code = 'OTIMIZACAO_INCOMPLETA';
      erro.detail = { ...resultado, faltantes, desconhecidas, naoAtribuidas, paradasFisicas: grupos.length };
      throw erro;
    }

    const orderIds = expandirOrdemFisica(grupos, ordemFisica);
    return {
      ...resultado,
      orderIds,
      physicalOrderIds: ordemFisica,
      physicalStopCount: grupos.length,
      deliveryCount: orderIds.length
    };
  }

  function ordenarParadas(rota, orderIds) {
    const mapa = new Map((rota.paradas || []).map(p => [String(p.id), p]));
    const concluidas = (rota.paradas || []).filter(p => ['entregue', 'concluida', 'nao_entregue'].includes(p.statusEntrega));
    const pendentesOrdenadas = [];
    (orderIds || []).forEach(id => { const p = mapa.get(String(id)); if (p && !pendentesOrdenadas.includes(p)) pendentesOrdenadas.push(p); });
    (rota.paradas || []).forEach(p => { if (!['entregue', 'concluida', 'nao_entregue'].includes(p.statusEntrega) && !pendentesOrdenadas.includes(p)) pendentesOrdenadas.push(p); });
    const ordem = [...concluidas, ...pendentesOrdenadas];
    ordem.forEach((p, index) => { p.ordemOtimizada = index + 1; });
    return ordem;
  }

  function pontosDaRota(rota) {
    const start = coord(rota?.pontoInicial);
    if (!start) return [];
    const byId = new Map((rota.paradas || []).map(p => [String(p.id), p]));
    const ordemIds = Array.isArray(rota.ordem) && rota.ordem.length ? rota.ordem : (rota.paradas || []).map(p => p.id);
    const points = [start];
    const fisicasVisitadas = new Set();

    ordemIds.forEach(id => {
      const p = byId.get(String(id));
      if (!p || ['entregue', 'concluida', 'nao_entregue'].includes(p.statusEntrega)) return;
      const c = coord(p);
      if (!c) return;
      const chave = chaveFisicaParada(p);
      // Uma parada múltipla é uma visita física só. Os demais pacotes continuam
      // na ordem operacional, mas não viram waypoints repetidos no provedor.
      if (fisicasVisitadas.has(chave)) return;
      fisicasVisitadas.add(chave);
      points.push(c);
    });

    if (rota.retornarAoInicio === true) points.push(start);
    else if (rota.pontoFinal) {
      const end = coord(rota.pontoFinal);
      if (end) points.push(end);
    }
    return removerPontosConsecutivosRepetidos(points);
  }

  function geometriaValida(geometry) {
    if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) return false;
    const linhas = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    return Array.isArray(linhas) && linhas.length > 0 && linhas.every(l => Array.isArray(l) && l.length >= 2 && l.every(c => Array.isArray(c) && coord({ lon: c[0], lat: c[1] })));
  }

  const MAX_PONTOS_POR_TRECHO = 24;

  function dividirPontos(points, tamanhoMaximo) {
    const limite = Math.max(3, Number(tamanhoMaximo || MAX_PONTOS_POR_TRECHO));
    if (points.length <= limite) return [points.slice()];
    const blocos = [];
    let inicio = 0;
    while (inicio < points.length - 1) {
      const fim = Math.min(points.length, inicio + limite);
      const bloco = points.slice(inicio, fim);
      if (bloco.length >= 2) blocos.push(bloco);
      if (fim >= points.length) break;
      inicio = fim - 1; // o último ponto também inicia o bloco seguinte
    }
    return blocos;
  }

  function linhasDaGeometria(geometry) {
    if (!geometriaValida(geometry)) return [];
    return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  }

  function mesclarRespostasRota(respostas) {
    const linhas = [];
    const legs = [];
    const waypoints = [];
    let distance = 0;
    let time = 0;
    let provider = '';

    respostas.forEach((resposta, indiceResposta) => {
      const feature = resposta?.feature;
      if (!feature || !geometriaValida(feature.geometry)) throw new Error('Trecho incompleto: rota preservada.');
      provider = provider || String(resposta?.provider || '');
      linhasDaGeometria(feature.geometry).forEach(linha => linhas.push(linha));
      distance += Math.max(0, Number(feature.properties?.distance || 0));
      time += Math.max(0, Number(feature.properties?.time || 0));
      (Array.isArray(feature.properties?.legs) ? feature.properties.legs : []).forEach(leg => legs.push(leg));
      const ws = Array.isArray(feature.properties?.waypoints) ? feature.properties.waypoints : [];
      ws.forEach((w, i) => {
        if (indiceResposta > 0 && i === 0) return;
        waypoints.push(w);
      });
    });

    if (!linhas.length) {
      const erro = new Error('Nenhum trecho rodoviário válido foi retornado pelo serviço.');
      erro.code = 'GEOMETRIA_INVALIDA';
      throw erro;
    }

    return {
      ok: true,
      provider: provider || 'geoapify-routing-segmentado',
      segmentado: respostas.length > 1,
      segmentos: respostas.length,
      feature: {
        type: 'Feature',
        geometry: linhas.length === 1 ? { type: 'LineString', coordinates: linhas[0] } : { type: 'MultiLineString', coordinates: linhas },
        properties: { distance, time, legs, waypoints }
      }
    };
  }

  async function calcularBlocoRota(rota, bloco, blocoIndex, totalBlocos) {
    const mode = perfilVeiculo(rota.veiculo);
    try {
      const tipoPrincipal = tipoRota(rota);
      let resposta;
      try {
        resposta = await postComRetry(endpoint('route'), {
          mode,
          points: removerPontosConsecutivosRepetidos(bloco),
          traffic: 'free_flow',
          type: tipoPrincipal,
          intermediateWaypointMode: 'stopover'
        }, Number(cfg().routingRequestTimeoutMs || 45000), 2);
      } catch (erroPrincipal) {
        // Alguns percursos recusam a preferência "short" mas aceitam o mesmo
        // conjunto de vias em modo balanced. Mantemos o MESMO perfil de veículo.
        if (tipoPrincipal === 'balanced') throw erroPrincipal;
        resposta = await postComRetry(endpoint('route'), {
          mode,
          points: removerPontosConsecutivosRepetidos(bloco),
          traffic: 'free_flow',
          type: 'balanced',
          intermediateWaypointMode: 'stopover'
        }, Number(cfg().routingRequestTimeoutMs || 45000), 2);
      }
      if (!geometriaValida(resposta?.feature?.geometry)) {
        const erro = new Error(`O trecho ${blocoIndex + 1}/${totalBlocos} voltou sem geometria rodoviária válida.`);
        erro.code = 'GEOMETRIA_INVALIDA'; erro.detail = resposta; throw erro;
      }
      const props = resposta.feature.properties;
      if (props?.distance == null || props?.time == null || !Number.isFinite(Number(props.distance)) || Number(props.distance) < 0 || !Number.isFinite(Number(props.time)) || Number(props.time) < 0) throw new Error('O serviço retornou métricas inválidas.');
      return resposta;
    } catch (erro) {
      const detalheStatus = Number(erro?.detail?.status || erro?.detail?.detail?.status || 0);
      const msg = detalheStatus
        ? `Falha ao calcular o trecho ${blocoIndex + 1}/${totalBlocos} da rota (provedor HTTP ${detalheStatus}).`
        : `Falha ao calcular o trecho ${blocoIndex + 1}/${totalBlocos} da rota.`;
      const enriquecido = new Error(msg);
      enriquecido.code = 'ROTA_TRECHO_FALHOU';
      enriquecido.cause = erro;
      enriquecido.status = erro?.status || 0;
      enriquecido.detail = { blocoIndex, totalBlocos, pontos: bloco.length, erro: erro?.detail || null };
      throw enriquecido;
    }
  }

  async function calcularRotaPelasRuas(rota, pontosOverride) {
    const points = removerPontosConsecutivosRepetidos(Array.isArray(pontosOverride) && pontosOverride.length ? pontosOverride.map(coord).filter(Boolean) : pontosDaRota(rota));
    if (points.length < 2) throw new Error('São necessários ao menos dois pontos válidos para calcular a rota.');

    // V62: blocos menores e divisão adaptativa. Alguns provedores aceitam a
    // otimização, mas falham ao traçar 20+ waypoints de uma vez. Quando isso
    // acontecer, o mesmo trecho é dividido automaticamente, sem descartar paradas.
    const limite = Math.min(12, Number(cfg().routingMaxPointsPerRequest || MAX_PONTOS_POR_TRECHO));
    const blocos = dividirPontos(points, limite);
    const respostas = [];

    async function calcularAdaptativo(bloco, indiceBase, totalBase, profundidade) {
      try {
        return [await calcularBlocoRota(rota, bloco, indiceBase, totalBase)];
      } catch (erro) {
        if (bloco.length <= 3 || profundidade >= 4) throw erro;
        const meio = Math.max(2, Math.ceil(bloco.length / 2));
        const a = bloco.slice(0, meio);
        const b = bloco.slice(meio - 1); // mantém continuidade no ponto de junção
        const ra = await calcularAdaptativo(a, indiceBase, totalBase, profundidade + 1);
        const rb = await calcularAdaptativo(b, indiceBase, totalBase, profundidade + 1);
        return [...ra, ...rb];
      }
    }

    for (let i = 0; i < blocos.length; i++) {
      const partes = await calcularAdaptativo(blocos[i], i, blocos.length, 0);
      respostas.push(...partes);
    }
    return mesclarRespostasRota(respostas);
  }

  // Cada alternativa é medida na rede viária, no sentido real de deslocamento.
  // Não usamos distâncias simétricas/em linha reta para escolher a vencedora.
  async function otimizarComparando(rota, progresso = () => {}) {
    const ativas = (rota.paradas || []).filter(p => !['entregue','concluida','nao_entregue'].includes(p.statusEntrega));
    if (!coord(rota.pontoInicial) || !ativas.length || ativas.some(p => !coord(p))) throw new Error('Confira as coordenadas de todas as paradas antes de otimizar.');
    if (new Set(ativas.map(p => String(p.id))).size !== ativas.length) throw new Error('Há identificadores repetidos de paradas. Corrija a importação antes de otimizar.');
    if (rota.pontoFinal && !coord(rota.pontoFinal)) throw new Error('O destino final não tem coordenadas válidas.');

    const copia = () => JSON.parse(JSON.stringify(rota));
    const candidatos = [], vistos = new Set(), falhas = [];
    const objetivo = tipoRota(rota);
    const tiposPlanejados = [...new Set([objetivo, 'short', 'balanced'])];

    // V81: concorrência limitada apenas entre alternativas independentes. A lista de
    // candidatos e a regra de comparação são as mesmas da V80. O ordinal conserva
    // a preferência histórica em empates exatos mesmo que as requisições terminem
    // em outra ordem por causa da paralelização.
    async function mapLimit(items, limite, worker) {
      const saida = new Array(items.length);
      let cursor = 0;
      async function executar() {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          try { saida[i] = await worker(items[i], i); }
          catch (erro) { saida[i] = { erro }; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(limite, items.length) }, executar));
      return saida;
    }

    async function avaliar(ordem, tipo, origem, ordinal) {
      const teste = copia();
      const ordemNormalizada = normalizarOrdemPorParadaFisica(teste, ordem);
      teste.ordem = ordemNormalizada;
      teste.preferenciaRota = tipo;
      const chave = JSON.stringify([ordemNormalizada.map(String), tipo]);
      if (vistos.has(chave)) return null;
      vistos.add(chave);
      progresso('Calculando o percurso', 'Conferindo distância e tempo pelas ruas…');
      try {
        const route = await calcularRotaPelasRuas(teste);
        const d = Number(route.feature.properties.distance), t = Number(route.feature.properties.time);
        if (!Number.isFinite(d) || d < 0 || !Number.isFinite(t) || t < 0) throw new Error('Métricas de rota inválidas.');
        const c = {ordem: ordemNormalizada, tipo, origem, route, distance:d, drivingTime:t, ordinal:Number(ordinal || 0)};
        candidatos.push(c);
        return c;
      } catch (e) {
        falhas.push({origem, mensagem:e.message});
        return null;
      }
    }

    const atual = ordenarParadas(copia(), rota.ordem || []).map(p => p.id);
    await avaliar(atual, objetivo, 'Sequência atual', 0);

    progresso('Analisando a melhor sequência', 'Comparando alternativas pela malha viária…');
    await mapLimit(tiposPlanejados, 2, async (tipo, indice) => {
      try {
        const teste = copia();
        teste.preferenciaRota = tipo;
        const plano = await otimizar(teste);
        const ordem = ordenarParadas(teste, plano.orderIds).map(p => p.id);
        return await avaliar(ordem, tipo, `Planejamento ${tipo}`, indice + 1);
      } catch (e) {
        falhas.push({origem:tipo, mensagem:e.message});
        return null;
      }
    });

    const comparar = (a,b) => {
      const principal = objetivo === 'short'
        ? a.distance - b.distance || a.drivingTime - b.drivingTime
        : a.drivingTime - b.drivingTime || a.distance - b.distance;
      return principal || Number(a.ordinal || 0) - Number(b.ordinal || 0);
    };

    if (!candidatos.length) {
      const mensagens = [...new Set(falhas.map(f => String(f?.mensagem || '')).filter(Boolean))];
      const rede = mensagens.find(m => /Worker de rotas|ALLOWED_ORIGINS|acessar o Worker/i.test(m));
      const erro = new Error(rede || 'Não foi possível confirmar um percurso completo pelas ruas. A rota anterior foi preservada.');
      erro.code = rede ? 'WORKER_ORIGEM_OU_REDE' : 'PERCURSO_COMPLETO_INDISPONIVEL';
      erro.detail = { falhas };
      throw erro;
    }

    candidatos.sort(comparar);
    const base = candidatos[0];
    const pendentes = base.ordem.filter(id => !(rota.paradas || []).some(p => String(p.id) === String(id) && ['entregue','concluida','nao_entregue'].includes(p.statusEntrega)));
    if (pendentes.length >= 3 && pendentes.length <= 60 && gruposFisicosPendentes(rota).length === pendentes.length) {
      const legs = base.route.feature.properties.legs || [];
      let pior = 0;
      for(let i=1;i<Math.min(legs.length,pendentes.length);i++) if(Number(legs[i].distance)>Number(legs[pior]?.distance||0)) pior=i;
      const finalizadas = base.ordem.filter(id => !pendentes.includes(id));
      const refinamentos = [-1, 1].map((deslocamento, indice) => ({ deslocamento, ordinal: tiposPlanejados.length + 1 + indice }));
      await mapLimit(refinamentos, 2, async ({deslocamento, ordinal}) => {
        const destino = pior + deslocamento;
        if(destino < 0 || destino >= pendentes.length) return null;
        const ordem = pendentes.slice();
        const [id] = ordem.splice(pior,1);
        ordem.splice(destino,0,id);
        return avaliar([...finalizadas,...ordem], base.tipo, 'Refinamento de trecho', ordinal);
      });
    }

    candidatos.sort(comparar);
    const melhor = candidatos[0];
    const totalFisicas = gruposFisicosPendentes(rota).length;
    return {...melhor, orderIds:melhor.ordem, provider:'geoapify-comparacao-viaria',
      physicalStopCount: totalFisicas,
      deliveryCount: melhor.ordem.length,
      totalTime:melhor.drivingTime + totalFisicas * Math.max(0,Number(rota.tempoParadaSegundos||0)),
      comparacao:{objetivo, avaliadas:candidatos.map(c => ({origem:c.origem,tipo:c.tipo,distancia:c.distance,tempo:c.drivingTime})), falhas}};
  }

  function textoInstrucao(step) {
    const instrucao = step?.instruction;
    if (typeof instrucao === 'string') return instrucao;
    if (instrucao && typeof instrucao === 'object') return String(instrucao.text || instrucao.transition_instruction || instrucao.pre_transition_instruction || '');
    return String(step?.instruction_text || step?.text || '');
  }

  function extrairInstrucoes(feature) {
    const legs = feature?.properties?.legs || [];
    const linhasGeometria = linhasDaGeometria(feature?.geometry);
    const offsetsLeg = [];
    let cursorGeometria = 0;

    // Geoapify documenta from_index/to_index relativamente à geometria de cada leg.
    // Quando a geometria é MultiLineString, o navegador a achata com .flat(), portanto
    // o offset global precisa reproduzir exatamente essa mesma concatenação.
    legs.forEach((leg, legIndex) => {
      offsetsLeg[legIndex] = cursorGeometria;
      if (feature?.geometry?.type === 'MultiLineString' && Array.isArray(linhasGeometria[legIndex])) {
        cursorGeometria += linhasGeometria[legIndex].length;
        return;
      }
      const passos = Array.isArray(leg?.steps) ? leg.steps : [];
      const maiorTo = passos.reduce((m, step) => Number.isFinite(Number(step?.to_index)) ? Math.max(m, Number(step.to_index)) : m, 0);
      // Em LineString contínua, o último ponto de uma leg é o primeiro da seguinte.
      cursorGeometria += Math.max(0, maiorTo);
    });

    const instrucoes = [];
    legs.forEach((leg, legIndex) => {
      const offsetLeg = Number(offsetsLeg[legIndex] || 0);
      (leg?.steps || []).forEach((step, stepIndex) => {
        const detalhe = step?.instruction && typeof step.instruction === 'object' ? step.instruction : {};
        const type = String(detalhe?.type || step?.type || '');
        const modifier = String(detalhe?.modifier || detalhe?.direction || step?.modifier || step?.direction || '');
        const streetsRaw = detalhe?.streets ?? step?.streets ?? [];
        const streets = Array.isArray(streetsRaw) ? streetsRaw.map(v => String(v || '')).filter(Boolean) : (streetsRaw ? [String(streetsRaw)] : []);
        const exitRoadNameRaw = detalhe?.exitRoadName ?? detalhe?.exit_road_name ?? step?.exitRoadName ?? step?.exit_road_name ?? [];
        const exitRoadName = Array.isArray(exitRoadNameRaw) ? exitRoadNameRaw.map(v => String(v || '')).filter(Boolean) : (exitRoadNameRaw ? [String(exitRoadNameRaw)] : []);
        const exitTowardsRaw = detalhe?.exitTowards ?? detalhe?.exit_towards ?? step?.exitTowards ?? step?.exit_towards ?? [];
        const exitTowards = Array.isArray(exitTowardsRaw) ? exitTowardsRaw.map(v => String(v || '')).filter(Boolean) : (exitTowardsRaw ? [String(exitTowardsRaw)] : []);
        const streetName = String(streets[0] || detalhe?.street_name || step?.street_name || step?.name || exitRoadName[0] || '');
        const roundaboutExit = detalhe?.roundabout_exit ?? step?.roundabout_exit ?? null;
        const exitNumber = roundaboutExit ?? detalhe?.exitNumber ?? detalhe?.exit_number ?? step?.exitNumber ?? step?.exit_number ?? null;
        const transitionInstruction = String(detalhe?.transition_instruction || step?.transition_instruction || '');
        const preTransitionInstruction = String(detalhe?.pre_transition_instruction || step?.pre_transition_instruction || '');
        const postTransitionInstruction = String(detalhe?.post_transition_instruction || step?.post_transition_instruction || '');
        const fromIndexLeg = Number.isFinite(Number(step?.from_index)) ? Number(step.from_index) : null;
        const toIndexLeg = Number.isFinite(Number(step?.to_index)) ? Number(step.to_index) : null;
        const globalFromIndex = fromIndexLeg == null ? null : offsetLeg + fromIndexLeg;
        const globalToIndex = toIndexLeg == null ? null : offsetLeg + toIndexLeg;
        const distance = Number(step?.distance || 0);
        const time = Number(step?.time || 0);
        instrucoes.push({
          id: `${legIndex}:${stepIndex}`,
          legIndex, stepIndex,
          texto: textoInstrucao(step) || transitionInstruction || preTransitionInstruction || postTransitionInstruction || 'Continue pela rota',
          distancia: distance, tempo: time,
          // Compatibilidade: índices originais continuam preservados como locais da leg.
          fromIndex: fromIndexLeg, toIndex: toIndexLeg,
          fromIndexLeg, toIndexLeg, globalFromIndex, globalToIndex,
          tipo: type,
          modificador: modifier,
          direcao: String(detalhe?.direction || step?.direction || ''),
          angulo: Number.isFinite(Number(detalhe?.turn_angle ?? step?.turn_angle)) ? Number(detalhe?.turn_angle ?? step?.turn_angle) : null,
          rua: streetName,
          streets,
          exitNumber,
          exitRoadName,
          exitTowards,
          roundabout_exit: roundaboutExit,
          // Preserva também os nomes do payload Geoapify para o renderer não
          // precisar reconstruir/inventar uma manobra.
          type,
          modifier,
          street_name: streetName,
          exit_number: exitNumber,
          transition_instruction: transitionInstruction,
          pre_transition_instruction: preTransitionInstruction,
          post_transition_instruction: postTransitionInstruction,
          distance,
          time,
          from_index: fromIndexLeg,
          to_index: toIndexLeg
        });
      });
    });
    return instrucoes;
  }


  global.PacoteEMatoServicoRota = Object.freeze({ endpoint, healthEndpoint, verificarServico, perfilVeiculo, tipoRota, otimizar, otimizarComparando, ordenarParadas, calcularRotaPelasRuas, pontosDaRota, extrairInstrucoes, coord, geometriaValida, gruposFisicosPendentes, chaveFisicaParada, normalizarOrdemPorParadaFisica });
})(window);
