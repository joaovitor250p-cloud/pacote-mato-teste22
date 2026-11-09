(function iniciarMarcadoresPacoteEMato(global) {
  'use strict';

  const REGISTRY = new WeakMap();

  function numeroSeguro(valor, fallback) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : fallback;
  }

  function statusSeguro(status) {
    const s = String(status || 'pendente');
    if (s === 'nao_entregue') return 'nao_entregue';
    if (s === 'entregue' || s === 'concluida') return 'concluida';
    if (s === 'parcial') return 'parcial';
    return 'pendente';
  }

  function paleta(status, selecionado) {
    // Marcadores compactos de navegação: verde para paradas e cores operacionais
    // apenas para os estados reais de entrega.
    if (status === 'nao_entregue') return { fundo: selecionado ? '#b81408' : '#E71506', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    if (status === 'concluida') return { fundo: selecionado ? '#15803d' : '#16a34a', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    if (status === 'parcial') return { fundo: selecionado ? '#b45309' : '#e59b24', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    if (selecionado) return { fundo: '#006D32', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    return { fundo: '#018D3E', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
  }

  function simboloStatus(status) {
    const normalizado = statusSeguro(status);
    if (normalizado === 'concluida') return '✓';
    if (normalizado === 'nao_entregue') return '×';
    return '';
  }


  function chaveMultiplo(parada) {
    const numero = String(parada?.numero || (String(parada?.enderecoFonte || parada?.enderecoOriginal || '').match(/\b\d+[A-Za-z]?\b/) || [''])[0] || '').toLowerCase();
    let rua = String(parada?.logradouro || parada?.enderecoFonte || parada?.enderecoOriginal || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (numero) rua = rua.replace(new RegExp(`\\b${numero.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`, 'i'), '');
    rua = rua.replace(/\b(ap|apto|apartamento|casa|bloco|sala|loja|suite|fundos|frente)\b.*$/i, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return rua && numero ? `${rua}|${numero}` : '';
  }

  function quantidadePacotesDaParada(parada) {
    const n = Number(parada?.pacotes?.length || parada?.quantidadePacotes || 1);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : 1;
  }


  // Cada ocorrência cadastrada é um pacote: BR repetido em outra parada
  // continua sendo outro registro. Nunca deduplicar pelo texto do BR.
  function pacotesRegistradosDoGrupo(grupo) {
    const resultado = [];
    (Array.isArray(grupo) ? grupo : []).forEach(parada => {
      const pacotes = Array.isArray(parada?.pacotes) ? parada.pacotes : [];
      pacotes.forEach(valor => {
        const codigo = typeof valor === 'string' || typeof valor === 'number'
          ? String(valor).trim()
          : String(valor?.codigoRastreio || valor?.codigoBarras ||
            valor?.codigo || valor?.br || '').trim();
        resultado.push({ parada, codigo });
      });
      // Registros legados podem informar somente a quantidade de pacotes.
      // Eles continuam visíveis, mas sem inventar códigos BR inexistentes.
      const informada = Math.max(0, Math.round(Number(parada?.quantidadePacotes) || 0));
      for (let i = pacotes.length; i < informada; i++) {
        resultado.push({ parada, codigo: '' });
      }
    });
    return resultado;
  }

  function quantidadePacotesRegistradosDoGrupo(grupo) {
    return pacotesRegistradosDoGrupo(grupo).length;
  }

  function chaveFisicaMarcador(parada) {
    const chave = chaveMultiplo(parada);
    if (chave) return `end:${chave}`;
    const lat = Number(parada?.latitude), lon = Number(parada?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return `coord:${lat.toFixed(5)}|${lon.toFixed(5)}`;
    return `id:${String(parada?.id || '')}`;
  }


  function cloneSeguro(valor) {
    try { return JSON.parse(JSON.stringify(valor)); } catch (_) { return null; }
  }

  function geometriaRotaValida(geometry) {
    if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) return false;
    const linhas = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    return Array.isArray(linhas) && linhas.some(linha => Array.isArray(linha) && linha.length >= 2);
  }

  function distanciaMetros(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const lon1 = Number(a[0]), lat1 = Number(a[1]), lon2 = Number(b[0]), lat2 = Number(b[1]);
    if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) return Infinity;
    const rad = Math.PI / 180, R = 6371000;
    const p1 = lat1 * rad, p2 = lat2 * rad;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function capturarBaseVisualStatus(rota, forcar) {
    if (!rota || !geometriaRotaValida(rota.geometria)) return null;
    if (!forcar && rota.visualStatusBase && geometriaRotaValida(rota.visualStatusBase.geometria)) return rota.visualStatusBase;
    const ordem = Array.isArray(rota.ordem) && rota.ordem.length
      ? rota.ordem.map(String)
      : (Array.isArray(rota.paradas) ? rota.paradas.map(p => String(p.id)) : []);
    rota.visualStatusBase = {
      geometria: cloneSeguro(rota.geometria),
      ordem,
      capturadoEm: Date.now()
    };
    return rota.visualStatusBase;
  }

  function recortarGeometriaEntre(partes, origem, destino) {
    if (!origem || !destino || destino.global <= origem.global) return null;
    const linhas = [];
    if (origem.parte === destino.parte) {
      const linha = partes[origem.parte].slice(origem.indice, destino.indice + 1);
      if (linha.length >= 2) linhas.push(linha);
    } else {
      const primeira = partes[origem.parte].slice(origem.indice);
      if (primeira.length >= 2) linhas.push(primeira);
      for (let p = origem.parte + 1; p < destino.parte; p++) {
        const meio = partes[p].slice();
        if (meio.length >= 2) linhas.push(meio);
      }
      const ultima = partes[destino.parte].slice(0, destino.indice + 1);
      if (ultima.length >= 2) linhas.push(ultima);
    }
    if (!linhas.length) return null;
    return linhas.length === 1
      ? { type: 'LineString', coordinates: linhas[0] }
      : { type: 'MultiLineString', coordinates: linhas };
  }

  function segmentosStatusDaRota(rota) {
    if (!rota) return [];
    const base = (rota.visualStatusBase && geometriaRotaValida(rota.visualStatusBase.geometria))
      ? rota.visualStatusBase
      : { geometria: rota.geometria, ordem: Array.isArray(rota.ordem) ? rota.ordem.map(String) : [] };
    if (!geometriaRotaValida(base.geometria)) return [];

    const partes = (base.geometria.type === 'LineString' ? [base.geometria.coordinates] : base.geometria.coordinates)
      .map(linha => (Array.isArray(linha) ? linha.filter(c => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))) : []))
      .filter(linha => linha.length >= 2);
    if (!partes.length) return [];

    const entradas = [];
    let globalIndex = 0;
    partes.forEach((linha, parte) => linha.forEach((coord, indice) => entradas.push({ parte, indice, global: globalIndex++, coord })));
    if (entradas.length < 2) return [];

    const byId = new Map((Array.isArray(rota.paradas) ? rota.paradas : []).map(p => [String(p.id), p]));
    const ordemIds = Array.isArray(base.ordem) && base.ordem.length ? base.ordem.map(String) : [...byId.keys()];

    // V28: em vez de pintar um trecho diferente para CADA entrega concluída,
    // localizamos as paradas na geometria uma única vez e produzimos só dois
    // estados operacionais: caminho já percorrido (cinza) e próximo trecho
    // ativo (azul destacado). Os ✓/× continuam sendo responsabilidade dos
    // marcadores, evitando o "mapa arco-íris" que deixava a rota confusa.
    const ancoras = [];
    let cursor = entradas[0];
    ordemIds.forEach(id => {
      const parada = byId.get(String(id));
      if (!parada) return;
      const lat = Number(parada.latitude), lon = Number(parada.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      let melhor = null, melhorDist = Infinity;
      for (let i = cursor.global; i < entradas.length; i++) {
        const item = entradas[i];
        const d = distanciaMetros(item.coord, [lon, lat]);
        if (d < melhorDist) { melhor = item; melhorDist = d; }
        if (melhorDist <= 4) break;
      }
      if (!melhor) return;
      ancoras.push({ id: String(id), parada, ponto: melhor, status: statusSeguro(parada.statusEntrega) });
      cursor = melhor;
    });
    if (!ancoras.length) return [];

    const features = [];
    const inicio = entradas[0];

    // V42: cada parada tratada pinta de cinza o trecho que chega até ela,
    // mesmo quando a entrega é feita fora da ordem. Antes, somente uma sequência
    // concluída desde a parada 1 ficava cinza.
    ancoras.forEach((ancora, indice) => {
      if (ancora.status !== 'concluida' && ancora.status !== 'nao_entregue') return;
      const origemTrecho = indice > 0 ? ancoras[indice - 1].ponto : inicio;
      const geometry = recortarGeometriaEntre(partes, origemTrecho, ancora.ponto);
      if (geometry) features.push({
        type: 'Feature',
        properties: { status: 'passado', ateParadaId: ancora.id, trechoIndice: indice },
        geometry
      });
    });

    // O verde segue a continuidade operacional (proximaParadaId), e não
    // necessariamente a primeira parada pendente da lista.
    let indiceAtivo = ancoras.findIndex(a => String(a.id) === String(rota.proximaParadaId || '') && a.status !== 'concluida' && a.status !== 'nao_entregue');
    if (indiceAtivo < 0) indiceAtivo = ancoras.findIndex(a => a.status !== 'concluida' && a.status !== 'nao_entregue');
    const proximaAncora = indiceAtivo >= 0 ? ancoras[indiceAtivo] : null;
    if (proximaAncora) {
      let geometry = null;
      // Para a parada ativa preferimos a rota recalculada atual, que começa na
      // posição real do motorista e termina na continuação escolhida.
      if (geometriaRotaValida(rota.geometria)) {
        const atuais = (rota.geometria.type === 'LineString' ? [rota.geometria.coordinates] : rota.geometria.coordinates)
          .map(linha => (Array.isArray(linha) ? linha.filter(c => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))) : []))
          .filter(linha => linha.length >= 2);
        const entradasAtuais = [];
        let globalAtual = 0;
        atuais.forEach((linha, parte) => linha.forEach((coord, indice) => entradasAtuais.push({ parte, indice, global: globalAtual++, coord })));
        if (entradasAtuais.length >= 2) {
          const alvo = [Number(proximaAncora.parada.longitude), Number(proximaAncora.parada.latitude)];
          let melhor = null, melhorDist = Infinity;
          for (const item of entradasAtuais) {
            const d = distanciaMetros(item.coord, alvo);
            if (d < melhorDist) { melhor = item; melhorDist = d; }
            if (melhorDist <= 4) break;
          }
          if (melhor && melhor.global > 0) geometry = recortarGeometriaEntre(atuais, entradasAtuais[0], melhor);
        }
      }
      if (!geometry) {
        const origemAtiva = indiceAtivo > 0 ? ancoras[indiceAtivo - 1].ponto : inicio;
        geometry = recortarGeometriaEntre(partes, origemAtiva, proximaAncora.ponto);
      }
      if (geometry) features.push({
        type: 'Feature',
        properties: { status: 'proxima', paradaId: proximaAncora.id },
        geometry
      });
    }

    return features;
  }

  function nomeIcone(prefixo, ordem, quantidade, selecionado, status, mostrarNumero) {
    const qtdInt = Math.max(1, Math.round(numeroSeguro(quantidade, 1)));
    const statusNorm = statusSeguro(status);
    if (mostrarNumero === false) return `${prefixo}-draft-${qtdInt}-${statusNorm}-${selecionado ? 'sel' : 'std'}`;
    const ordemInt = Math.max(1, Math.round(numeroSeguro(ordem, 1)));
    return `${prefixo}-${ordemInt}-${qtdInt}-${statusNorm}-${selecionado ? 'sel' : 'std'}`;
  }

  function contexto2d(canvas) {
    try { return canvas.getContext('2d'); } catch (_) { return null; }
  }

  function desenharCapsula(ctx, x, y, largura, altura, raio) {
    ctx.beginPath();
    ctx.moveTo(x + raio, y);
    ctx.lineTo(x + largura - raio, y);
    ctx.quadraticCurveTo(x + largura, y, x + largura, y + raio);
    ctx.lineTo(x + largura, y + altura - raio);
    ctx.quadraticCurveTo(x + largura, y + altura, x + largura - raio, y + altura);
    ctx.lineTo(x + raio, y + altura);
    ctx.quadraticCurveTo(x, y + altura, x, y + altura - raio);
    ctx.lineTo(x, y + raio);
    ctx.quadraticCurveTo(x, y, x + raio, y);
    ctx.closePath();
  }

  // A ponta do balão aponta para a coordenada real da entrega. Por isso as
  // camadas MapLibre usam icon-anchor=bottom para as duas formas de marcador.
  function desenharBalao(ctx, x, y, largura, altura, raio, ponta) {
    const centro = x + largura / 2;
    ctx.beginPath();
    ctx.moveTo(x + raio, y);
    ctx.lineTo(x + largura - raio, y);
    ctx.quadraticCurveTo(x + largura, y, x + largura, y + raio);
    ctx.lineTo(x + largura, y + altura - raio);
    ctx.quadraticCurveTo(x + largura, y + altura, x + largura - raio, y + altura);
    ctx.lineTo(centro + 7, y + altura);
    ctx.lineTo(centro, y + altura + ponta);
    ctx.lineTo(centro - 7, y + altura);
    ctx.lineTo(x + raio, y + altura);
    ctx.quadraticCurveTo(x, y + altura, x, y + altura - raio);
    ctx.lineTo(x, y + raio);
    ctx.quadraticCurveTo(x, y, x + raio, y);
    ctx.closePath();
  }



  // Bandeirola premium: plaqueta facetada sem haste, com pequeno vértice
  // alinhado ao ponto geográfico (MapLibre icon-anchor=bottom).
  function desenharBandeirola(ctx, x, y, w, h, centro) {
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - 8);
    // Recorte sutil de bandeirola à direita, sem ondulação infantil.
    ctx.lineTo(x + w - 4, y + h - 11);
    ctx.lineTo(x + w - 8, y + h - 8);
    ctx.lineTo(centro + 5, y + h - 8);
    ctx.lineTo(centro, y + h);
    ctx.lineTo(centro - 5, y + h - 8);
    ctx.lineTo(x + 4, y + h - 8);
    ctx.quadraticCurveTo(x, y + h - 8, x, y + h - 12);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }


  function criarIcone(mapa, opcoes) {
    if (!mapa || !global.document) return '';
    const prefixo = String(opcoes?.prefixo || 'pemato-stop-v13') + '-bandeirola-premium-v3-multi';
    const mostrarNumero = opcoes?.mostrarNumero !== false;
    const ordem = mostrarNumero ? Math.max(1, Math.round(numeroSeguro(opcoes?.ordem, 1))) : 0;
    const quantidade = Math.max(1, Math.round(numeroSeguro(opcoes?.quantidade, 1)));
    const selecionado = opcoes?.selecionado === true;
    const status = statusSeguro(opcoes?.status);
    const nome = nomeIcone(prefixo, ordem, quantidade, selecionado, status, mostrarNumero);
    if (mapa.hasImage?.(nome)) return nome;

    const multiplo = mostrarNumero && quantidade > 1;
    const ratio = Math.max(2, Math.min(3, Number(global.devicePixelRatio || 2)));
    // A bandeirola mantém SEMPRE 34 px de largura. Apenas a área
    // transparente do sprite cresce para caber a etiqueta de pacotes.
    const larguraCss = mostrarNumero ? (multiplo ? 49 : 34) : 26;
    const alturaCss = mostrarNumero ? 34 : 24;
    const canvas = global.document.createElement('canvas');
    canvas.width = Math.round(larguraCss * ratio);
    canvas.height = Math.round(alturaCss * ratio);
    const c = contexto2d(canvas);
    if (!c) return '';
    c.scale(ratio, ratio);
    c.clearRect(0, 0, larguraCss, alturaCss);

    const cores = paleta(status, selecionado);
    const centro = larguraCss / 2;
    const bandeiraLargura = mostrarNumero ? 34 : 26;
    const bandeiraAltura = mostrarNumero ? 26 : 21;
    const topo = mostrarNumero ? 7 : 2;
    c.save();
    c.shadowColor = 'rgba(9, 43, 31, .17)';
    c.shadowBlur = selecionado ? 5 : 3;
    c.shadowOffsetY = 1.5;
    desenharBandeirola(c, centro - bandeiraLargura / 2 + 2, topo,
      bandeiraLargura - 4, bandeiraAltura, centro);
    c.fillStyle = cores.fundo;
    c.fill();
    c.shadowColor = 'transparent';
    c.strokeStyle = selecionado ? '#c9f2df' : '#ffffff';
    c.lineWidth = selecionado ? 2 : 1.4;
    c.lineJoin = 'round';
    c.stroke();
    c.restore();

    if (mostrarNumero) {
      const numero = String(ordem);
      c.fillStyle = cores.numero;
      c.font = '800 ' + (numero.length >= 4 ? 8.5 : numero.length === 3 ? 10.5 : 14) + 'px Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      // Número principal fica independente do contador de pacotes.
      c.fillText(numero, centro, 18);
    } else {
      c.fillStyle = '#ffffff';
      desenharCapsula(c, centro - 2, 11, 4, 4, 1);
      c.fill();
    }

    if (multiplo) {
      // O "×2" não parece outra parada: etiqueta própria acima e ao lado,
      // nunca cobrindo o número da bandeirola.
      const texto = quantidade > 99 ? '99+' : '×' + quantidade;
      const bx = larguraCss - 17, by = 1;
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#b8d7c6';
      c.lineWidth = 1;
      desenharCapsula(c, bx, by, 16, 12, 3);
      c.fill();
      c.stroke();
      c.fillStyle = '#116744';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '800 ' + (texto.length >= 3 ? 7 : 8.5) + 'px Arial, sans-serif';
      c.fillText(texto, bx + 8, by + 6);
    }

    try {
      mapa.addImage(nome, c.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
      let nomes = REGISTRY.get(mapa);
      if (!nomes) { nomes = new Set(); REGISTRY.set(mapa, nomes); }
      nomes.add(nome);
    } catch (_) {}
    return nome;
  }

  // Um toque num endereço com vários pacotes abre as paradas e seus códigos
  // sem inventar pinos deslocados nem esconder entregas na mesma coordenada.
  let popupPacotesAtual = null;
  function abrirDetalhesPacotes(mapa, feature, paradas, selecionarParada) {
    const props = feature?.properties || {};
    const ids = new Set(String(props.ids || props.id || '').split(',').filter(Boolean));
    const grupo = (Array.isArray(paradas) ? paradas : []).filter(p => ids.has(String(p?.id)));
    if (!grupo.length) return false;
    const total = quantidadePacotesRegistradosDoGrupo(grupo);
    if (total <= 1 && grupo.length <= 1) return false;
    if (!mapa || !global.document || typeof global.maplibregl?.Popup !== 'function') return false;
    try {
      if (popupPacotesAtual) popupPacotesAtual.remove();
      const doc = global.document;
      const painel = doc.createElement('div');
      painel.className = 'pemato-multi-popup';

      const pacotes = pacotesRegistradosDoGrupo(grupo);
      const semPacotes = pacotes.length === 0;
      const entradas = semPacotes
        ? grupo.map(parada => ({ parada, codigo: '' }))
        : pacotes;
      const titulo = doc.createElement('strong');
      titulo.className = 'pemato-multi-popup-title';
      titulo.textContent = semPacotes
        ? 'Nenhum pacote cadastrado neste ponto'
        : total + (total === 1 ? ' pacote neste ponto' : ' pacotes neste ponto');
      const subtitulo = doc.createElement('span');
      subtitulo.className = 'pemato-multi-popup-subtitle';
      subtitulo.textContent = grupo.length +
        (grupo.length === 1 ? ' parada cadastrada' : ' paradas cadastradas') +
        (semPacotes ? ' · escolha uma parada' : ' · cada pacote aparece separadamente');
      const lista = doc.createElement('div');
      lista.className = 'pemato-multi-popup-lista';
      const itens = [];
      entradas.forEach((item, indice) => {
        const p = item.parada;
        const botao = doc.createElement('button');
        botao.type = 'button';
        botao.className = 'pemato-multi-popup-stop';
        const rotulo = doc.createElement('strong');
        const ordem = Number(p?.ordemOtimizada || p?.ordemOriginal || 0);
        // Mostrar o BR original de cada ocorrência, mesmo que igual ao anterior.
        rotulo.textContent = item.codigo || (semPacotes
          ? (ordem > 0 ? 'Parada ' + ordem : 'Ver parada')
          : 'Código BR não informado');
        const endereco = doc.createElement('span');
        endereco.className = 'pemato-multi-popup-endereco';
        const nomeEndereco = String(p?.enderecoFonte || p?.enderecoOriginal ||
          [p?.logradouro, p?.numero].filter(Boolean).join(', ') || 'Endereço não informado');
        endereco.textContent = (ordem > 0 ? 'Parada ' + ordem + ' · ' : '') + nomeEndereco;
        botao.append(rotulo, endereco);
        botao.addEventListener('click', () => {
          popupPacotesAtual?.remove();
          popupPacotesAtual = null;
          if (typeof selecionarParada === 'function') selecionarParada(String(p.id));
        });
        itens.push(botao);
        lista.append(botao);
      });
      painel.append(titulo, subtitulo, lista);
      // Muitos pacotes ficam numa lista interna com rolagem, sem cobrir o mapa.
      if (itens.length > 4) {
        const verMais = doc.createElement('button');
        verMais.type = 'button';
        verMais.className = 'pemato-multi-popup-mais';
        let expandido = false;
        const atualizarLista = () => {
          itens.forEach((item, indice) => {
            item.hidden = !expandido && indice >= 4;
          });
          verMais.textContent = expandido ? 'Mostrar menos'
            : semPacotes ? 'Ver todas as ' + itens.length + ' paradas'
            : 'Ver todos os ' + itens.length + ' pacotes';
          verMais.setAttribute('aria-expanded', String(expandido));
          if (!expandido) lista.scrollTop = 0;
        };
        verMais.addEventListener('click', () => {
          expandido = !expandido;
          atualizarLista();
        });
        painel.append(verMais);
        atualizarLista();
      }
      const centro = feature?.geometry?.coordinates;
      if (!Array.isArray(centro) || centro.length < 2) return false;
      // A janela não deve variar de posição conforme o entregador se move
      // ou conforme o pino escolhido fica mais alto/baixo na tela.
      // Fixá-la no topo do MAPA, sem alterar o centro ou o zoom.
      const containerMapa = mapa.getContainer?.();
      if (containerMapa && typeof containerMapa.appendChild === 'function') {
        const flutuante = doc.createElement('section');
        flutuante.className = 'pemato-packages-top-panel';
        flutuante.setAttribute('role', 'region');
        flutuante.setAttribute('aria-label', 'Pacotes neste ponto do mapa');
        const fechar = doc.createElement('button');
        fechar.type = 'button';
        fechar.className = 'pemato-packages-top-close';
        fechar.setAttribute('aria-label', 'Fechar detalhes dos pacotes');
        fechar.textContent = '×';
        fechar.addEventListener('click', () => {
          popupPacotesAtual?.remove();
          popupPacotesAtual = null;
        });
        flutuante.addEventListener('click', event => event.stopPropagation());
        flutuante.append(fechar, painel);
        containerMapa.appendChild(flutuante);
        popupPacotesAtual = { remove() { flutuante.remove(); } };
        return true;
      }
      // Compatibilidade com mapas que não fornecem container DOM.
      popupPacotesAtual = new global.maplibregl.Popup({
        closeButton: true, closeOnClick: true, anchor: 'bottom',
        maxWidth: '288px', offset: 18, className: 'pemato-packages-popup'
      }).setLngLat(centro).setDOMContent(painel).addTo(mapa);
      return true;
    } catch (erro) {
      try { console.warn('Pacote É Mato: detalhes de pacotes indisponíveis', erro); } catch (_) {}
      return false;
    }
  }

  function prepararFeatures(mapa, features, opcoes) {
    const propriedadeSelecao = String(opcoes?.propriedadeSelecao || 'selected');
    const propriedadeIcone = String(opcoes?.propriedadeIcone || 'iconV12');
    const prefixo = String(opcoes?.prefixo || 'pemato-stop-v12');
    (features || []).forEach(feature => {
      const props = feature.properties || (feature.properties = {});
      const raw = props[propriedadeSelecao];
      const selecionado = raw === true || raw === 1 || raw === '1' || raw === 'true';
      const rawNumbered = props.numbered;
      const mostrarNumero = rawNumbered === undefined || rawNumbered === null || rawNumbered === true || rawNumbered === 1 || rawNumbered === '1' || rawNumbered === 'true';
      props[propriedadeIcone] = criarIcone(mapa, {
        prefixo,
        ordem: props.order,
        quantidade: props.multi,
        selecionado,
        status: props.status,
        mostrarNumero
      });
    });
    return features;
  }

  function assinatura(features, propriedadeIcone) {
    const prop = propriedadeIcone || 'iconV12';
    return (features || []).map(feature => {
      const p = feature.properties || {};
      const c = feature.geometry?.coordinates || [];
      return `${p.id || ''}:${p.order || ''}:${p.numbered ?? ''}:${p.multi || ''}:${p.status || ''}:${p[prop] || ''}:${c[0] || ''}:${c[1] || ''}`;
    }).join('|');
  }

  global.PacoteEMatoMarcadores = Object.freeze({
    criarIcone,
    abrirDetalhesPacotes,
    prepararFeatures,
    assinatura,
    nomeIcone,
    chaveMultiplo,
    quantidadePacotesDaParada,
    quantidadePacotesRegistradosDoGrupo,
    pacotesRegistradosDoGrupo,
    chaveFisicaMarcador,
    capturarBaseVisualStatus,
    segmentosStatusDaRota
  });
})(window);
