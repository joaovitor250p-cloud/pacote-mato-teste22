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
    // Cartografia de ruas detalhada, clara e legível no celular, com base
    // aberta (o aplicativo não incorpora mapas nem recursos proprietários).
    mapStyleUrl: 'https://tiles.openfreemap.org/styles/bright',
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
    // Não engrossar caminhos de pedestres/ciclovias/ferrovias como se fossem ruas.
    if (/(footway|pedestrian|sidewalk|cycleway|bicycle|path|steps|railway|rail|tram|subway|ferry)/i.test(txt)) return '';
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
      rodovia:   [10,2.1,13,4.2,16,8.4,19,15.0],
      primary:   [10,1.8,13,3.7,16,7.4,19,13.0],
      secondary: [10,1.5,13,3.2,16,6.8,19,12.0],
      tertiary:  [10,1.3,13,2.9,16,6.2,19,11.0],
      local:     [10,1.1,13,2.6,16,5.8,19,10.0]
    };
    const valores = tabela[categoria] || tabela.local;
    const casingExtra = casing ? ({rodovia:2.2,primary:1.9,secondary:1.7,tertiary:1.5,local:1.2}[categoria] || 1.2) : 0;
    const expr = ['interpolate', ['linear'], ['zoom']];
    for (let i = 0; i < valores.length; i += 2) expr.push(valores[i], valores[i + 1] + extra + casingExtra);
    return expr;
  }

  function coresViaClean(categoria, casing) {
    const cores = {
      rodovia:   {base:'#c6d6e6', borda:'#a8bed2'},
      primary:   {base:'#ccdbe9', borda:'#b0c3d6'},
      secondary: {base:'#d0deeb', borda:'#b6c7d8'},
      tertiary:  {base:'#d3e0ec', borda:'#bdcddb'},
      local:     {base:'#d7e2ed', borda:'#c2d0dd'}
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
        setPaintSeguro(mapa, layer, 'background-color', '#f9f9fb');
        setPaintSeguro(mapa, layer, 'background-opacity', 1);
        return;
      }

      if (layer.type === 'fill') {
        if (/(water|ocean|lake|river|waterway)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'fill-color', '#dceaf3');
          setPaintSeguro(mapa, layer, 'fill-opacity', 0.94);
        } else if (/(park|grass|wood|forest|green|nature|landcover)/i.test(txt)) {
          // Parques permanecem identificáveis, mas sem dominar a malha urbana.
          setPaintSeguro(mapa, layer, 'fill-color', '#f0f2f1');
          setPaintSeguro(mapa, layer, 'fill-opacity', 0.78);
        } else if (/(building)/i.test(txt)) {
          // Casas visíveis sem preenchimento pesado: contorno cinza suave.
          setPaintSeguro(mapa, layer, 'fill-color', '#f1f3f5');
          setPaintSeguro(mapa, layer, 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 13, 0.45, 15, 0.76, 17, 0.94, 19, 1]);
          setPaintSeguro(mapa, layer, 'fill-outline-color', '#cdd5de');
        } else if (/(landuse|industrial|commercial|retail|residential-area)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'fill-color', '#f4f5f7');
          setPaintSeguro(mapa, layer, 'fill-opacity', 0.22);
        }
        return;
      }

      if (layer.type === 'fill-extrusion') {
        setLayoutSeguro(mapa, layer, 'visibility', 'none');
        return;
      }

      if (layer.type === 'line') {
        if (/(building|building_outline)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'line-color', '#cdd5de');
          setPaintSeguro(mapa, layer, 'line-opacity', 0.45);
          setPaintSeguro(mapa, layer, 'line-width', 0.55);
          return;
        }
        // A base Bright tem trilhas, passagens e caminhos de pedestres
        // com tracejado marrom. Antes, a classificação os ignorava,
        // deixando-os muito evidentes após a simplificação das bordas de rua.
        // Mantém a informação cartográfica, mas em traço fino e neutro.
        const camadaPedestre = /(?:^|[-_ ])(footway|footpath|pedestrian|sidewalk|cycleway|bicycle|path|walkway|trail|steps|bridleway)(?:$|[-_ ])/i.test(txt);
        const caminhoTracejado = layer.paint?.['line-dasharray'] != null
          && /(?:^|[-_ ])(walkway|pedestrian|footway|footpath|path|cycleway|trail|track|sidewalk)(?:$|[-_ ])/i.test(String(layer.id || ''));
        // Não classificar vias comuns como trilhas só por pertencerem à
        // source-layer "transportation". Ruas também podem ter dash no estilo.
        if (camadaPedestre || caminhoTracejado) {
          setPaintSeguro(mapa, layer, 'line-color', '#d5dce4');
          setPaintSeguro(mapa, layer, 'line-opacity', 0.32);
          setPaintSeguro(mapa, layer, 'line-dasharray', [1, 0]);
          setPaintSeguro(mapa, layer, 'line-gap-width', 0);
          setPaintSeguro(mapa, layer, 'line-width', ['interpolate', ['linear'], ['zoom'], 12, 0.25, 16, 0.55, 19, 0.85]);
          return;
        }
        const via = categoriaVia(txt);
        if (via) {
          // A base Bright separa o corpo da via e linhas decorativas de borda.
          // Ao ampliar todas indiscriminadamente, as bordas tracejadas viravam
          // blocos retangulares repetidos dos dois lados das ruas.
          const id = String(layer.id || '').toLowerCase();
          const camadaDeBorda = /(?:^|[-_])(casing|outline|border|edge|kerb|curb)(?:$|[-_])/.test(id);
          if (camadaDeBorda) {
            setLayoutSeguro(mapa, layer, 'visibility', 'none');
            return;
          }

          const cor = coresViaClean(via, false);
          setPaintSeguro(mapa, layer, 'line-color', cor);
          setPaintSeguro(mapa, layer, 'line-opacity', 1);
          // É preciso usar os valores concretos aceitos pelo MapLibre.
          // 'null' não assegurava que o tracejado e a largura do vão sumissem.
          setPaintSeguro(mapa, layer, 'line-dasharray', [1, 0]);
          setPaintSeguro(mapa, layer, 'line-gap-width', 0);
          setPaintSeguro(mapa, layer, 'line-width', larguraViaClean(via, false, navegacaoAtiva));
          setPaintSeguro(mapa, layer, 'line-blur', 0);
          return;
        }
        if (/(boundary|admin)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'line-color', '#d8dde0');
          setPaintSeguro(mapa, layer, 'line-opacity', 0.45);
        }
        if (/(waterway|river|stream)/i.test(txt)) {
          setPaintSeguro(mapa, layer, 'line-color', '#a8d3ee');
          setPaintSeguro(mapa, layer, 'line-opacity', 0.82);
        }
        return;
      }

      if (layer.type !== 'symbol') return;

      // Preserve directional arrows: they are essential for urban delivery routes.
      if (/(oneway|one-way|direction|arrow)/i.test(txt)) {
        setLayoutSeguro(mapa, layer, 'visibility', 'visible');
        setPaintSeguro(mapa, layer, 'icon-opacity', 0.88);
        setPaintSeguro(mapa, layer, 'text-opacity', 0.88);
        return;
      }

      const ehRoadLabel = /(road|street|transportation_name|highway|motorway|trunk|primary|secondary|tertiary|residential)/i.test(txt)
        && !/(shield|route.?number|road.?number|highway.?ref|motorway.?ref)/i.test(txt);
      const ehPlaceLabel = /(place|city|town|village|neighbourhood|neighborhood|suburb)/i.test(txt);
      const ehShield = /(shield|route.?number|road.?number|highway.?ref|motorway.?ref)/i.test(txt);
      const ehPoi = /(poi|amenity|shop|store|restaurant|cafe|bar|fast.?food|tourism|attraction|museum|theatre|cinema|school|college|university|kindergarten|church|place.?of.?worship|religion|hotel|motel|lodging|hospital|clinic|pharmacy|parking)/i.test(txt);

      if (ehRoadLabel) {
        setLayoutSeguro(mapa, layer, 'visibility', 'visible');
        setLayoutSeguro(mapa, layer, 'text-size', ['interpolate', ['linear'], ['zoom'], 11, 11.0, 14, 12.9, 16, navegacaoAtiva ? 15.2 : 14.5, 19, navegacaoAtiva ? 17.3 : 16.5]);
        setPaintSeguro(mapa, layer, 'text-color', '#526070');
        setPaintSeguro(mapa, layer, 'text-halo-color', '#ffffff');
        setPaintSeguro(mapa, layer, 'text-halo-width', navegacaoAtiva ? 2.05 : 1.75);
        setPaintSeguro(mapa, layer, 'text-halo-blur', 0.12);
        setPaintSeguro(mapa, layer, 'text-opacity', 1);
        setPaintSeguro(mapa, layer, 'icon-opacity', 0.38);
        return;
      }

      if (ehPlaceLabel) {
        setLayoutSeguro(mapa, layer, 'visibility', 'visible');
        setPaintSeguro(mapa, layer, 'text-color', '#65717a');
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
    // O mapa-base já contém os polígonos dos prédios. Criar outra camada 2D
    // duplicava os contornos e tornava o desenho das casas excessivamente técnico.
    (mapa?.getStyle?.()?.layers || []).slice().forEach(layer => {
      if (/^pemato-construcoes-2d-/i.test(layer.id || '')) {
        try { if (mapa.getLayer?.(layer.id)) mapa.removeLayer(layer.id); } catch (_) {}
      }
      if (layer.type === 'fill-extrusion' && /building/i.test(textoLayer(layer))) {
        setLayoutSeguro(mapa, layer, 'visibility', 'none');
      }
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
