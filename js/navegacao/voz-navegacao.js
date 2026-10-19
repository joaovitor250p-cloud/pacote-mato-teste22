(function iniciarVozNavegacaoPacoteEMato(global) {
  'use strict';

  const STORAGE_KEY = 'pemato_nav_voice_enabled_v81';
  const MAX_RETRY = 3;
  const WATCHDOG_MS = 1000;
  const RETRY_DELAY_MS = 260;
  const falasExecutadas = new Set();
  const falasPendentes = new Set();
  const falasFalhadas = new Set();

  let ativa = true;
  let desbloqueada = false;
  let contextoProvider = null;
  let instructionIdAtual = '';
  let ultimaChave = '';
  let ultimaFalaEm = 0;
  let utteranceAtual = null;
  let vozPreferida = null;
  let ultimoTexto = '';
  let ultimaFase = '';
  let ultimoStatus = 'idle';
  let ultimoStart = 0;
  let ultimoEnd = 0;
  let ultimoErro = '';
  let retryCount = 0;
  let watchdogAtual = null;
  let background = false;
  let voicesListenerRegistrado = false;
  let ultimaFalaNativaGpsEm = 0;

  function vozNativaDisponivel() {
    return typeof global.Android?.falar === 'function';
  }
  function disponivel() {
    return vozNativaDisponivel() || !!(global.speechSynthesis && global.SpeechSynthesisUtterance);
  }

  function detectarRuntime() {
    const ua = String(global.navigator?.userAgent || '');
    if (global.Capacitor?.isNativePlatform?.()) return 'capacitor';
    if (global.cordova) return 'cordova';
    if (/; wv\)|\bwv\b/i.test(ua) || (/Android/i.test(ua) && /Version\/\d+/i.test(ua))) return 'android-webview';
    if (/Android/i.test(ua) && /(Chrome|CriOS)/i.test(ua)) return 'android-browser-ou-twa';
    if (/Android/i.test(ua)) return 'android-runtime';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios-web-runtime';
    return 'browser';
  }

  function carregarPreferencia() {
    try {
      const salvo = global.localStorage?.getItem(STORAGE_KEY);
      if (salvo === '0') ativa = false;
      if (salvo === '1') ativa = true;
    } catch (_) {}
    return ativa;
  }

  function persistirPreferencia() {
    try { global.localStorage?.setItem(STORAGE_KEY, ativa ? '1' : '0'); } catch (_) {}
  }

  function escolherVoz() {
    if (vozNativaDisponivel() || !global.speechSynthesis) return null;
    const vozes = global.speechSynthesis.getVoices?.() || [];
    vozPreferida = vozes.find(v => String(v.lang || '').toLowerCase() === 'pt-br')
      || vozes.find(v => String(v.lang || '').toLowerCase().startsWith('pt-br'))
      || vozes.find(v => String(v.lang || '').toLowerCase().startsWith('pt'))
      || vozes.find(v => v?.default)
      || vozes[0]
      || null;
    return vozPreferida;
  }

  function contextoAtual() {
    let contexto = {};
    try { contexto = typeof contextoProvider === 'function' ? (contextoProvider() || {}) : {}; } catch (_) { contexto = {}; }
    return {
      navigationMode: String(contexto.navigationMode || ''),
      navegacaoInternaAtiva: contexto.navegacaoInternaAtiva === true,
      vozNavegacaoAtiva: contexto.vozNavegacaoAtiva !== false,
      temInstrucaoValida: contexto.temInstrucaoValida === true,
      modulo: String(contexto.modulo || global.document?.body?.dataset?.pematoModule || ''),
      provider: String(contexto.provider || '')
    };
  }

  function podeFalarNavegacao({ exigirInstrucao = true } = {}) {
    const c = contextoAtual();
    if (!ativa || !disponivel() || background || global.document?.hidden) return false;
    if (c.navigationMode !== 'navigation-active') return false;
    if (c.navegacaoInternaAtiva !== true) return false;
    if (c.vozNavegacaoAtiva !== true) return false;
    if (c.modulo && c.modulo !== 'navegacao') return false;
    if (c.provider && c.provider !== 'pacote_emato') return false;
    if (exigirInstrucao && c.temInstrucaoValida !== true) return false;
    return true;
  }

  function limparWatchdog() {
    if (watchdogAtual != null) {
      try { global.clearTimeout?.(watchdogAtual); } catch (_) {}
      watchdogAtual = null;
    }
  }

  function atualizarDiagnostico(extra) {
    const c = contextoAtual();
    global.diagnosticoTTSAndroidV81 = Object.assign(global.diagnosticoTTSAndroidV81 || {}, {
      runtime: detectarRuntime(),
      navigationMode: c.navigationMode || null,
      navegacaoInternaAtiva: c.navegacaoInternaAtiva,
      vozNavegacaoAtiva: ativa && c.vozNavegacaoAtiva,
      podeFalar: podeFalarNavegacao({ exigirInstrucao:false }),
      speechSynthesisDisponivel: !!global.speechSynthesis,
      androidBridgeDisponivel: vozNativaDisponivel(),
      provedorVoz: vozNativaDisponivel() ? 'android-native-tts' : 'browser-speech-synthesis',
      utteranceDisponivel: !!global.SpeechSynthesisUtterance,
      voicesCount: global.speechSynthesis ? Number(global.speechSynthesis.getVoices?.()?.length || 0) : 0,
      selectedVoice: vozPreferida ? { name:String(vozPreferida.name || ''), lang:String(vozPreferida.lang || '') } : null,
      ttsState: ultimoStatus,
      lastInstructionId: instructionIdAtual || null,
      lastText: ultimoTexto || '',
      lastPhase: ultimaFase || null,
      lastStart: ultimoStart || null,
      lastEnd: ultimoEnd || null,
      lastError: ultimoErro || null,
      retryCount,
      failedKeysCount: falasFalhadas.size
    }, extra || {});

    // Compatibilidade com o diagnóstico já usado pelo HOTFIX FINAL 6/7.
    global.diagnosticoNavegacaoVozV81 = Object.assign(global.diagnosticoNavegacaoVozV81 || {}, {
      instructionId: instructionIdAtual || null,
      faseFalando: ultimoStatus,
      fraseTTS: ultimoTexto,
      vozAtiva: ativa,
      ttsDesbloqueado: desbloqueada,
      speechSynthesisDisponivel: disponivel(),
      voiceLang: vozPreferida?.lang || null,
      ultimaChaveFala: ultimaChave || null,
      ultimaFalaEm: ultimaFalaEm || null
    });
  }

  function registrarVoicesChanged() {
    if (vozNativaDisponivel() || !disponivel() || voicesListenerRegistrado) return;
    voicesListenerRegistrado = true;
    try {
      global.speechSynthesis.addEventListener?.('voiceschanged', () => {
        escolherVoz();
        atualizarDiagnostico({ voicesChangedAt: Date.now() });
      });
    } catch (_) {}
  }

  function inicializar() {
    carregarPreferencia();
    escolherVoz();
    registrarVoicesChanged();
    ultimoStatus = disponivel() ? (ativa ? 'idle' : 'muted') : 'unavailable';
    atualizarDiagnostico();
    return ativa;
  }

  function configurarContexto(provider) {
    contextoProvider = typeof provider === 'function' ? provider : null;
    atualizarDiagnostico();
  }

  function estaAtiva() { return ativa; }

  function cancelarSomenteGps() {
    limparWatchdog();
    const haviaFalaGps = !!utteranceAtual || falasPendentes.size > 0 || ['initializing','speaking','retrying'].includes(ultimoStatus) || (ultimaFalaNativaGpsEm > 0 && Date.now() - ultimaFalaNativaGpsEm < 15000);
    if (haviaFalaGps) {
      if (vozNativaDisponivel()) {
        try { global.Android.pararVoz(); } catch (_) {}
      } else {
        try { global.speechSynthesis?.cancel?.(); } catch (_) {}
      }
    }
    utteranceAtual = null;
    ultimaFalaNativaGpsEm = 0;
    falasPendentes.clear();
  }

  function definirAtiva(valor) {
    ativa = valor !== false;
    persistirPreferencia();
    if (!ativa) {
      cancelarSomenteGps();
      ultimoStatus = 'muted';
      desbloqueada = false;
    } else {
      falasFalhadas.clear();
      ultimoStatus = disponivel() ? 'idle' : 'unavailable';
    }
    atualizarDiagnostico();
    return ativa;
  }

  function definirInstrucaoAtual(id) {
    const novo = String(id || '');
    if (instructionIdAtual && novo && novo !== instructionIdAtual && utteranceAtual && ultimoStatus === 'speaking') {
      // Só interrompe quando a instrução realmente mudou e a anterior ficou velha.
      cancelarSomenteGps();
    }
    instructionIdAtual = novo;
    atualizarDiagnostico();
  }

  function chaveFala(instructionId, fase) {
    return `${String(instructionId || 'sem-instrucao')}|${String(fase || 'agora')}`;
  }

  function agendar(fn, atraso) {
    if (typeof global.setTimeout === 'function') return global.setTimeout(fn, atraso);
    return null;
  }

  function tentativaFala({instructionId, fase, texto, urgente=false, minIntervaloMs=1800, exigirInstrucao=true, onStarted, onEnded, onError, tentativa=0, chaveForcada=''} = {}) {
    const id = String(instructionId || '');
    const frase = String(texto || '').trim();
    const faseNorm = String(fase || 'agora');
    const chave = chaveForcada || chaveFala(id, faseNorm);
    const agora = Date.now();

    if (!frase || !podeFalarNavegacao({ exigirInstrucao })) return false;
    if (id && instructionIdAtual && id !== instructionIdAtual && !id.startsWith('stop:') && !id.startsWith('route:') && !id.startsWith('system:')) return false;
    if (falasExecutadas.has(chave) || falasPendentes.has(chave) || falasFalhadas.has(chave)) return false;
    if (agora - ultimaFalaEm < Number(minIntervaloMs || 0)) return false;

    try {
      // A WebView instalada não garante speechSynthesis funcional.
      // No Android, encaminha manobras reais para TextToSpeech nativo.
      // A confirmação abaixo significa "enviado à ponte", não prova de áudio ouvido.
      if (vozNativaDisponivel()) {
        falasPendentes.add(chave);
        ultimoTexto = frase;
        ultimaFase = faseNorm;
        ultimaChave = chave;
        ultimoErro = '';
        ultimoStatus = 'native-dispatching';
        try {
          global.Android.falar(frase);
          falasPendentes.delete(chave);
          falasExecutadas.add(chave);
          desbloqueada = true;
          ultimaFalaEm = Date.now();
          ultimaFalaNativaGpsEm = ultimaFalaEm;
          ultimoStart = ultimaFalaEm;
          ultimoStatus = 'native-dispatched';
          atualizarDiagnostico();
          try { onStarted?.(); } catch (_) {}
          return true;
        } catch (erroNativo) {
          falasPendentes.delete(chave);
          ultimoErro = String(erroNativo?.message || erroNativo || 'TTS_ANDROID_ERROR');
          ultimoStatus = 'error';
          atualizarDiagnostico();
          try { onError?.(ultimoErro); } catch (_) {}
          return false;
        }
      }

      if (global.speechSynthesis.speaking) {
        if (!urgente) return false;
        if (ultimaChave && ultimaChave !== chave && utteranceAtual) cancelarSomenteGps();
      }

      falasPendentes.add(chave);
      retryCount = tentativa;
      ultimoTexto = frase;
      ultimaFase = faseNorm;
      ultimaChave = chave;
      ultimoErro = '';
      ultimoStatus = tentativa > 0 ? 'retrying' : 'initializing';

      try { global.speechSynthesis.resume?.(); } catch (_) {}
      const u = new global.SpeechSynthesisUtterance(frase);
      u.lang = 'pt-BR';
      u.rate = 1.02;
      u.pitch = 1.0;
      u.volume = 1.0;
      const v = escolherVoz(); if (v) u.voice = v;
      utteranceAtual = u;

      let iniciou = false;
      let terminou = false;
      const finalizarTimeout = () => {
        if (iniciou || terminou || utteranceAtual !== u) return;
        falasPendentes.delete(chave);
        ultimoErro = 'TTS_START_TIMEOUT';
        ultimoStatus = 'timeout';
        atualizarDiagnostico();
        if (tentativa + 1 < MAX_RETRY && podeFalarNavegacao({ exigirInstrucao })) {
          try { global.speechSynthesis.cancel?.(); } catch (_) {}
          try { global.speechSynthesis.resume?.(); } catch (_) {}
          agendar(() => tentativaFala({instructionId:id,fase:faseNorm,texto:frase,urgente:true,minIntervaloMs:0,exigirInstrucao,onStarted,onEnded,onError,tentativa:tentativa+1,chaveForcada:chave}), RETRY_DELAY_MS);
        } else {
          falasFalhadas.add(chave);
          try { onError?.('TTS_START_TIMEOUT'); } catch (_) {}
        }
      };

      u.onstart = () => {
        if (utteranceAtual !== u) return;
        iniciou = true;
        limparWatchdog();
        falasPendentes.delete(chave);
        falasExecutadas.add(chave); // FINAL 8: só marca como falada após onstart real.
        desbloqueada = true;
        ultimoStatus = 'speaking';
        ultimoStart = Date.now();
        ultimaFalaEm = ultimoStart;
        retryCount = tentativa;
        atualizarDiagnostico();
        try { onStarted?.(); } catch (_) {}
      };
      u.onend = () => {
        terminou = true;
        limparWatchdog();
        falasPendentes.delete(chave);
        if (utteranceAtual === u) utteranceAtual = null;
        ultimoEnd = Date.now();
        if (!iniciou) {
          ultimoErro = 'TTS_END_SEM_ONSTART';
          ultimoStatus = 'error';
          try { onError?.(ultimoErro); } catch (_) {}
        } else {
          ultimoStatus = 'ready';
          try { onEnded?.(); } catch (_) {}
        }
        atualizarDiagnostico();
      };
      u.onerror = event => {
        terminou = true;
        limparWatchdog();
        falasPendentes.delete(chave);
        if (utteranceAtual === u) utteranceAtual = null;
        ultimoErro = String(event?.error || 'TTS_ERROR');
        ultimoStatus = 'error';
        atualizarDiagnostico();
        if (!iniciou && tentativa + 1 < MAX_RETRY && podeFalarNavegacao({ exigirInstrucao })) {
          try { global.speechSynthesis.cancel?.(); } catch (_) {}
          try { global.speechSynthesis.resume?.(); } catch (_) {}
          agendar(() => tentativaFala({instructionId:id,fase:faseNorm,texto:frase,urgente:true,minIntervaloMs:0,exigirInstrucao,onStarted,onEnded,onError,tentativa:tentativa+1,chaveForcada:chave}), RETRY_DELAY_MS);
        } else {
          if (!iniciou) falasFalhadas.add(chave);
          try { onError?.(ultimoErro); } catch (_) {}
        }
      };

      global.speechSynthesis.speak(u);
      watchdogAtual = agendar(finalizarTimeout, WATCHDOG_MS);
      atualizarDiagnostico();
      return true;
    } catch (erro) {
      falasPendentes.delete(chave);
      ultimoErro = String(erro?.message || erro || 'TTS_EXCEPTION');
      ultimoStatus = 'error';
      atualizarDiagnostico();
      try { onError?.(ultimoErro); } catch (_) {}
      return false;
    }
  }

  function desbloquear({ confirmar=false } = {}) {
    escolherVoz();
    registrarVoicesChanged();
    if (!disponivel()) {
      ultimoStatus = 'unavailable';
      atualizarDiagnostico();
      return false;
    }
    if (!podeFalarNavegacao({ exigirInstrucao:false })) {
      atualizarDiagnostico({ unlockBlocked:true });
      return false;
    }
    if (vozNativaDisponivel()) {
      // Não pronuncia "Voz ativada" nem utiliza Web Speech em WebView.
      desbloqueada = true;
      ultimoStatus = 'native-ready';
      atualizarDiagnostico();
      return true;
    }
    if (confirmar) {
      return tentativaFala({
        instructionId:'system:voice-enabled', fase:'confirmacao', texto:'Voz de navegação ativada.',
        urgente:true, minIntervaloMs:0, exigirInstrucao:false, chaveForcada:`system:voice-enabled|${Date.now()}`
      });
    }
    if (desbloqueada) return true;
    // Gesto do usuário: acorda/resume o engine sem afirmar que a voz está READY.
    // O estado READY só será confirmado quando uma utterance real disparar onstart.
    try { global.speechSynthesis.resume?.(); } catch (_) {}
    ultimoStatus = 'initializing';
    atualizarDiagnostico();
    return true;
  }

  function falarInstrucaoNavegacao(opcoes = {}) {
    return tentativaFala(Object.assign({}, opcoes, { exigirInstrucao:true }));
  }

  function pausarParaBackground() {
    background = true;
    cancelarSomenteGps();
    ultimoStatus = 'background';
    atualizarDiagnostico();
  }

  function retomarDoBackground() {
    background = false;
    if (!vozNativaDisponivel()) {
      try { global.speechSynthesis?.resume?.(); } catch (_) {}
    }
    ultimoStatus = ativa && disponivel() ? 'idle' : (ativa ? 'unavailable' : 'muted');
    atualizarDiagnostico();
    return podeFalarNavegacao({ exigirInstrucao:false });
  }

  function limparEstado({cancelar=true} = {}) {
    falasExecutadas.clear();
    falasPendentes.clear();
    falasFalhadas.clear();
    instructionIdAtual = '';
    ultimaChave = '';
    ultimaFalaEm = 0;
    ultimoTexto = '';
    ultimaFase = '';
    ultimoErro = '';
    retryCount = 0;
    desbloqueada = false;
    if (cancelar) cancelarSomenteGps();
    else { limparWatchdog(); utteranceAtual = null; }
    ultimoStatus = ativa && disponivel() ? 'idle' : (ativa ? 'unavailable' : 'muted');
    atualizarDiagnostico();
  }

  function diagnostico() {
    escolherVoz();
    atualizarDiagnostico();
    return Object.assign({}, global.diagnosticoTTSAndroidV81 || {});
  }

  try {
    global.document?.addEventListener?.('visibilitychange', () => {
      if (global.document.hidden) pausarParaBackground();
      else retomarDoBackground();
    });
  } catch (_) {}

  inicializar();

  global.PacoteEMatoVozNavegacao = Object.freeze({
    inicializar,
    configurarContexto,
    desbloquear,
    disponivel,
    estaAtiva,
    definirAtiva,
    definirInstrucaoAtual,
    podeFalarNavegacao,
    falarInstrucaoNavegacao,
    pausarParaBackground,
    retomarDoBackground,
    limparEstado,
    diagnostico
  });
})(window);
