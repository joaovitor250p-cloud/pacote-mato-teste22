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
    if (status === 'nao_entregue') return { fundo: selecionado ? '#b91c1c' : '#dc2626', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    if (status === 'concluida') return { fundo: selecionado ? '#15803d' : '#16a34a', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    if (status === 'parcial') return { fundo: selecionado ? '#b45309' : '#e59b24', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    if (selecionado) return { fundo: '#0F7351', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
    return { fundo: '#168B61', borda: '#ffffff', numero: '#ffffff', multi: '#ffffff', simbolo: '#ffffff' };
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


  // Bandeirinha inspirada na imagem: haste, tecido ondulado e anel no solo.
  // A haste central coincide com icon-anchor=bottom e com a localização real.
  function desenharBandeira(ctx, x, y, largura, altura) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + largura * .27, y - 2, x + largura * .51, y + 1);
    ctx.quadraticCurveTo(x + largura * .77, y + 3, x + largura, y);
    ctx.lineTo(x + largura, y + altura - 2);
    ctx.quadraticCurveTo(x + largura * .76, y + altura + 2, x + largura * .5, y + altura - 1);
    ctx.quadraticCurveTo(x + largura * .25, y + altura - 4, x, y + altura);
    ctx.closePath();
  }

  function desenharBaseBandeira(ctx, centro, y, raioX, raioY) {
    ctx.beginPath();
    ctx.moveTo(centro - raioX, y);
    ctx.quadraticCurveTo(centro - raioX, y - raioY, centro, y - raioY);
    ctx.quadraticCurveTo(centro + raioX, y - raioY, centro + raioX, y);
    ctx.quadraticCurveTo(centro + raioX, y + raioY, centro, y + raioY);
    ctx.quadraticCurveTo(centro - raioX, y + raioY, centro - raioX, y);
    ctx.closePath();
  }

  function criarIcone(mapa, opcoes) {
    if (!mapa || !global.document) return '';
    const prefixo = String(opcoes?.prefixo || 'pemato-stop-v13') + '-flag-v3-compact';
    const mostrarNumero = opcoes?.mostrarNumero !== false;
    const ordem = mostrarNumero ? Math.max(1, Math.round(numeroSeguro(opcoes?.ordem, 1))) : 0;
    const quantidade = Math.max(1, Math.round(numeroSeguro(opcoes?.quantidade, 1)));
    const selecionado = opcoes?.selecionado === true;
    const status = statusSeguro(opcoes?.status);
    const nome = nomeIcone(prefixo, ordem, quantidade, selecionado, status, mostrarNumero);
    if (mapa.hasImage?.(nome)) return nome;

    const ratio = Math.max(2, Math.min(3, Number(global.devicePixelRatio || 2)));
    const canvas = global.document.createElement('canvas');
    const larguraCss = mostrarNumero ? 48 : 32;
    const alturaCss = mostrarNumero ? 39 : 29;
    canvas.width = Math.round(larguraCss * ratio);
    canvas.height = Math.round(alturaCss * ratio);
    const c = contexto2d(canvas);
    if (!c) return '';
    // Renderiza o mesmo desenho em uma bandeira 25% menor, sem perder nitidez.
    c.scale(ratio * larguraCss / (mostrarNumero ? 64 : 42), ratio * alturaCss / (mostrarNumero ? 52 : 38));
    c.clearRect(0, 0, mostrarNumero ? 64 : 42, mostrarNumero ? 52 : 38);

    const cores = paleta(status, selecionado);
    const centro = (mostrarNumero ? 64 : 42) / 2;
    const escala = mostrarNumero ? 1 : .71;
    const topo = mostrarNumero ? 7 : 5;
    const base = (mostrarNumero ? 52 : 38) - (mostrarNumero ? 5 : 4);
    const hasteX = centro;
    const inicioTecido = hasteX + 3 * escala;
    const larguraTecido = 28 * escala;
    const alturaTecido = 22 * escala;

    c.save();
    c.shadowColor = 'rgba(9, 47, 35, .19)';
    c.shadowBlur = selecionado ? 6 : 3;
    c.shadowOffsetY = 1.5;
    // Anel de localização como na imagem, sem corpo arredondado.
    c.strokeStyle = selecionado ? '#0d6848' : '#629b85';
    c.lineWidth = selecionado ? 2.5 : 2.1;
    desenharBaseBandeira(c, centro, base - 1.5 * escala, 11 * escala, 4.5 * escala);
    c.stroke();

    c.beginPath();
    c.moveTo(hasteX, topo - 1 * escala);
    c.lineTo(hasteX, base - 2.7 * escala);
    c.strokeStyle = '#e9f6f0';
    c.lineWidth = 5.2 * escala;
    c.lineCap = 'round';
    c.stroke();
    c.beginPath();
    c.moveTo(hasteX, topo - 1 * escala);
    c.lineTo(hasteX, base - 2.7 * escala);
    c.strokeStyle = selecionado ? '#07533a' : '#116e51';
    c.lineWidth = 2.9 * escala;
    c.stroke();

    desenharBandeira(c, inicioTecido, topo, larguraTecido, alturaTecido);
    c.fillStyle = cores.fundo;
    c.fill();
    c.strokeStyle = selecionado ? '#084b35' : '#e5f5ed';
    c.lineWidth = selecionado ? 1.8 : 1.5;
    c.lineJoin = 'round';
    c.stroke();
    c.restore();

    if (mostrarNumero) {
      const numero = String(ordem);
      c.fillStyle = cores.numero;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '800 ' + (numero.length >= 4 ? 9.4 : numero.length === 3 ? 11 : 14) + 'px Arial, sans-serif';
      c.fillText(numero, inicioTecido + larguraTecido * .5, topo + alturaTecido * .51);
    }

    if (mostrarNumero && quantidade > 1) {
      // Mini etiqueta retangular de pacotes presa à lateral da bandeira.
      const selo = quantidade > 99 ? '99+' : String(quantidade);
      const bx = 64 - 18, by = 29;
      c.fillStyle = '#ffffff';
      c.strokeStyle = cores.fundo;
      c.lineWidth = 1.4;
      desenharCapsula(c, bx, by, 17, 13, 2.5);
      c.fill();
      c.stroke();
      c.fillStyle = '#16442F';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '800 ' + (selo.length > 2 ? 7 : 9) + 'px Arial, sans-serif';
      c.fillText(selo, bx + 8.5, by + 6.8);
    }

    try {
      mapa.addImage(nome, c.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
      let nomes = REGISTRY.get(mapa);
      if (!nomes) { nomes = new Set(); REGISTRY.set(mapa, nomes); }
      nomes.add(nome);
    } catch (_) {}
    return nome;
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
    prepararFeatures,
    assinatura,
    nomeIcone,
    chaveMultiplo,
    quantidadePacotesDaParada,
    chaveFisicaMarcador,
    capturarBaseVisualStatus,
    segmentosStatusDaRota
  });
})(window);
