(function configurarMapaPacoteEMato(global) {
  'use strict';

  const STORAGE_KEY = 'pemato_worker_base_url';
  const HOLY_FROG_BASE_URL = 'https://holy-frog-272c.joaovitor250p.workers.dev';
  const existente = global.PEMATO_MAP_CONFIG || {};

  function limparBase(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function limparOverridesAntigos() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      [
        'pemato_geocoding_endpoint',
        'pemato_optimize_endpoint',
        'pemato_route_endpoint',
        'pemato_health_endpoint',
        'pemato_worker_url',
        'workerBaseUrl'
      ].forEach(k => localStorage.removeItem(k));
    } catch (_) {}
  }

  // V66: o sistema usa exclusivamente o holy-frog unificado.
  // Endereços antigos armazenados no aparelho não podem mais sobrescrever o backend oficial.
  limparOverridesAntigos();
  const inicial = HOLY_FROG_BASE_URL;

  const cfg = global.PEMATO_MAP_CONFIG = Object.assign({
    mapStyleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    fallbackMapStyle: {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }]
    },
    workerBaseUrl: inicial,
    geocodingEndpoint: '',
    optimizeEndpoint: '',
    routeEndpoint: '',
    healthEndpoint: '',
    geocodingProvider: 'geoapify-worker',
    geocodingRequestTimeoutMs: 12000,
    routingRequestTimeoutMs: 45000,
    routingMaxPointsPerRequest: 12,
    geocodingRequestGapMs: 400,
    geocodingCacheTtlMs: 90 * 24 * 60 * 60 * 1000,
    geocodingNegativeCacheTtlMs: 24 * 60 * 60 * 1000,
    geocodingMinConfidence: 0.90,
    geocodingMinStreetConfidence: 0.90,
    initialCenter: [-46.6333, -23.5505],
    initialZoom: 10
  }, existente, { workerBaseUrl: inicial });

  function derivarEndpoints() {
    const b = HOLY_FROG_BASE_URL;
    cfg.workerBaseUrl = b;
    cfg.geocodingEndpoint = `${b}/geocode`;
    cfg.optimizeEndpoint = `${b}/optimize`;
    cfg.routeEndpoint = `${b}/route`;
    cfg.healthEndpoint = `${b}/health`;
    return cfg;
  }

  function limparPontosInteresse(mapa) {
    if (!mapa?.getStyle) return;
    const padrao = /(poi|amenity|hospital|clinic|pharmacy|school|university|college|kindergarten|bus|transit|station|railway|subway|tram|airport|aeroway|shop|store|restaurant|cafe|bar|fast.?food|hotel|motel|lodging|tourism|attraction|museum|theatre|cinema|place.?of.?worship|religion|parking)/i;
    const preservar = /(road|street|highway|motorway|trunk|primary|secondary|tertiary|route|place|city|town|village|neighbourhood|neighborhood|water|boundary)/i;
    (mapa.getStyle()?.layers || []).forEach(layer => {
      if (layer.type !== 'symbol') return;
      const texto = `${layer.id || ''} ${layer['source-layer'] || ''}`;
      if (padrao.test(texto) && !preservar.test(texto)) {
        try { mapa.setLayoutProperty(layer.id, 'visibility', 'none'); } catch (_) {}
      }
    });
  }

  const estiloCleanAplicado = new WeakSet();

  function textoLayer(layer) {
    return `${layer?.id || ''} ${layer?.['source-layer'] || ''}`.toLowerCase();
  }

  function setPaintSeguro(mapa, layer, propriedade, valor) {
    if (!mapa?.getLayer?.(layer?.id)) return;
    try { mapa.setPaintProperty(layer.id, propriedade, valor); } catch (_) {}
  }

  function setLayoutSeguro(mapa, layer, propriedade, valor) {
    if (!mapa?.getLayer?.(layer?.id)) return;
    try { mapa.setLayoutProperty(layer.id, propriedade, valor); } catch (_) {}
  }

  function categoriaVia(txt) {
    // HOTFIX FINAL 6: hierarquia visual explícita. A classificação continua
    // baseada em id + source-layer e não depende de um único ID do Liberty.
    if (/(motorway|trunk|freeway)/i.test(txt)) return 'rodovia';
    if (/(primary)/i.test(txt)) return 'primary';
    if (/(secondary)/i.test(txt)) return 'secondary';
    if (/(tertiary)/i.test(txt)) return 'tertiary';
    if (/(residential|living_street|street|road|service|transportation|highway)/i.test(txt)) return 'local';
    return '';
  }

  function larguraViaClean(categoria, casing, navegacaoAtiva) {
    const extra = navegacaoAtiva ? 0.28 : 0;
    const tabela = {
      // HOTFIX FINAL 7: malha mais definida sem transformar o mapa em desenho pesado.
      rodovia:   [10,1.75,13,3.35,16,5.95,19,9.20],
      primary:   [10,1.48,13,2.88,16,5.15,19,8.05],
      secondary: [10,1.18,13,2.38,16,4.30,19,6.80],
      tertiary:  [10,0.98,13,1.98,16,3.58,19,5.58],
      local:     [10,0.82,13,1.62,16,3.02,19,4.68]
    };
    const valores = tabela[categoria] || tabela.local;
    const casingExtra = casing ? ({rodovia:2.35,primary:2.08,secondary:1.76,tertiary:1.56,local:1.38}[categoria] || 1.38) : 0;
    const expr = ['interpolate', ['linear'], ['zoom']];
    for (let i = 0; i < valores.length; i += 2) expr.push(valores[i], valores[i + 1] + extra + casingExtra);
    return expr;
  }

  function coresViaClean(categoria, casing) {
    const cores = {
      rodovia:   {base:'#efd39a', borda:'#cbae6d'},
      primary:   {base:'#f4e2ba', borda:'#d2bb87'},
      secondary: {base:'#f7ead2', borda:'#d9caa8'},
      tertiary:  {base:'#fcf8ed', borda:'#d7d7cf'},
      local:     {base:'#ffffff', borda:'#cfd6d9'}
    };
    const c = cores[categoria] || cores.local;
    return casing ? c.borda : c.base;
  }

  // HOTFIX FINAL 2: identidade base única para OVERVIEW e NAVIGATION-ACTIVE.
  // A classificação usa id + source-layer; nenhum ID específico do Liberty é obrigatório.
  function aplicarEstiloMapaClean(mapa, opcoes = {}) {
    if (!mapa?.getStyle) return false;
    const navegacaoAtiva = opcoes.navegacaoAtiva === true;
    const layers = mapa.getStyle()?.layers || [];

    layers.forEach(layer => {
      if (!layer?.id || /^pemato-/i.test(layer.id)) return;
      const txt = textoLayer(layer);

      if (layer.type === 'background') {
        setPaintSeguro(mapa, layer, 'background-color', '#f7f8f7');
        setPaintSeguro(mapa, layer, 'background-opacity', 1);
        return;
      }

      if (layer.type === 'fill') {
        if (/(water|ocean|lake|river|waterway)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'fill-color', '#e5f2f7');
          setPaintSeguro(mapa, layer, 'fill-opacity', 0.94);
        } else if (/(park|grass|wood|forest|green|nature|landcover)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'fill-color', '#edf5ed');
          setPaintSeguro(mapa, layer, 'fill-opacity', 0.78);
        } else if (/(building)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'fill-color', '#e9ecee');
          setPaintSeguro(mapa, layer, 'fill-opacity', 0.42);
          setPaintSeguro(mapa, layer, 'fill-outline-color', '#dfe3e5');
        } else if (/(landuse|industrial|commercial|retail|residential-area)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'fill-color', '#f4f5f3');
          setPaintSeguro(mapa, layer, 'fill-opacity', 0.32);
        }
        return;
      }

      if (layer.type === 'fill-extrusion') {
        setLayoutSeguro(mapa, layer, 'visibility', 'none');
        return;
      }

      if (layer.type === 'line') {
        const via = categoriaVia(txt);
        if (via) {
          const casing = /(casing|outline|border)/i.test(txt);
          const cor = coresViaClean(via, casing);
          setPaintSeguro(mapa, layer, 'line-color', cor);
          setPaintSeguro(mapa, layer, 'line-opacity', casing ? 0.98 : 1);
          setPaintSeguro(mapa, layer, 'line-width', larguraViaClean(via, casing, navegacaoAtiva));
          setPaintSeguro(mapa, layer, 'line-blur', 0);
          return;
        }
        if (/(boundary|admin)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'line-color', '#d8dde0');
          setPaintSeguro(mapa, layer, 'line-opacity', 0.45);
        }
        if (/(waterway|river|stream)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'line-color', '#bcdfea');
          setPaintSeguro(mapa, layer, 'line-opacity', 0.82);
        }
        return;
      }

      if (layer.type !== 'symbol') return;

      const ehRoadLabel = /(road|street|transportation_name|highway|motorway|trunk|primary|secondary|tertiary|residential)/i.test(txt)
        && !/(shield|route.?number|road.?number|highway.?ref|motorway.?ref)/i.test(txt);
      const ehPlaceLabel = /(place|city|town|village|neighbourhood|neighborhood|suburb)/i.test(txt);
      const ehShield = /(shield|route.?number|road.?number|highway.?ref|motorway.?ref)/i.test(txt);
      const ehPoi = /(poi|amenity|shop|store|restaurant|cafe|bar|fast.?food|tourism|attraction|museum|theatre|cinema|school|college|university|kindergarten|church|place.?of.?worship|religion|hotel|motel|lodging|hospital|clinic|pharmacy|parking)/i.test(txt);

      if (ehRoadLabel) {
        setLayoutSeguro(mapa, layer, 'visibility', 'visible');
        setLayoutSeguro(mapa, layer, 'text-size', ['interpolate', ['linear'], ['zoom'], 11, 11.0, 14, 12.9, 16, navegacaoAtiva ? 15.2 : 14.5, 19, navegacaoAtiva ? 17.3 : 16.5]);
        setPaintSeguro(mapa, layer, 'text-color', '#2f3438');
        setPaintSeguro(mapa, layer, 'text-halo-color', '#fffefa');
        setPaintSeguro(mapa, layer, 'text-halo-width', navegacaoAtiva ? 2.05 : 1.75);
        setPaintSeguro(mapa, layer, 'text-halo-blur', 0.12);
        setPaintSeguro(mapa, layer, 'text-opacity', 1);
        setPaintSeguro(mapa, layer, 'icon-opacity', 0.38);
        return;
      }

      if (ehPlaceLabel) {
        setLayoutSeguro(mapa, layer, 'visibility', 'visible');
        setPaintSeguro(mapa, layer, 'text-color', '#687177');
        setPaintSeguro(mapa, layer, 'text-halo-color', '#f6f7f7');
        setPaintSeguro(mapa, layer, 'text-halo-width', 1.25);
        setPaintSeguro(mapa, layer, 'text-opacity', /neigh|suburb/i.test(txt) ? 0.72 : 0.62);
        setPaintSeguro(mapa, layer, 'icon-opacity', 0.18);
        return;
      }

      if (ehShield) {
        // Road shields continuam possíveis, porém discretos; deixam de competir com a rota.
        setPaintSeguro(mapa, layer, 'text-opacity', navegacaoAtiva ? 0.22 : 0.28);
        setPaintSeguro(mapa, layer, 'icon-opacity', navegacaoAtiva ? 0.16 : 0.22);
        return;
      }

      if (ehPoi) {
        setLayoutSeguro(mapa, layer, 'visibility', 'none');
      }
    });

    estiloCleanAplicado.add(mapa);
    return true;
  }

  function aplicarEstiloNavegacaoAtiva(mapa) {
    return aplicarEstiloMapaClean(mapa, { navegacaoAtiva: true });
  }

  function restaurarEstiloMapaOverview(mapa) {
    // O overview não volta ao Liberty colorido: a identidade clean é permanente.
    return aplicarEstiloMapaClean(mapa, { navegacaoAtiva: false });
  }

  function configurarWorkerBaseUrl() {
    // Mantido por compatibilidade com telas antigas, mas o backend oficial não pode ser trocado.
    limparOverridesAntigos();
    derivarEndpoints();
    try {
      global.dispatchEvent(new CustomEvent('pemato:worker:update', { detail: { workerBaseUrl: HOLY_FROG_BASE_URL } }));
    } catch (_) {}
    return HOLY_FROG_BASE_URL;
  }

  function obterWorkerBaseUrl() {
    return HOLY_FROG_BASE_URL;
  }

  derivarEndpoints();

  function exibirConstrucoes2D(mapa) {
    const camadas = mapa?.getStyle?.()?.layers || [];
    const bases = camadas.filter(l => l['source-layer'] &&
      /building/i.test(l['source-layer']) && ['fill','fill-extrusion'].includes(l.type));
    const fontes = new Map();
    bases.forEach(l => fontes.set(`${l.source}:${l['source-layer']}`, l));
    let indice = 0;
    fontes.forEach(base => {
      const id = `pemato-construcoes-2d-${indice++}`;
      if (mapa.getLayer(id)) return;
      const antes = camadas.find(l => l.source === base.source && l['source-layer'] === base['source-layer'])?.id;
      mapa.addLayer({
        id, type:'fill', source:base.source, 'source-layer':base['source-layer'], minzoom:14,
        layout:{visibility:'visible'},
        paint:{'fill-color':'#f0efed', 'fill-outline-color':'#b5b9bd',
          'fill-opacity':['interpolate',['linear'],['zoom'],14,0.45,16,0.85]}
      }, antes);
      bases.filter(l => l.source === base.source && l['source-layer'] === base['source-layer'])
        .forEach(l => mapa.setLayoutProperty(l.id, 'visibility', 'none'));
    });
  }

  global.PacoteEMatoMapaConfig = Object.freeze({
    exibirConstrucoes2D,
    limparPontosInteresse,
    aplicarEstiloMapaClean,
    aplicarEstiloNavegacaoAtiva,
    restaurarEstiloMapaOverview,
    configurarWorkerBaseUrl,
    obterWorkerBaseUrl,
    derivarEndpoints
  });
})(window);
