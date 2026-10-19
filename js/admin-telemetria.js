(function iniciarTelemetriaOperacional(global) {
  'use strict';
  const VERSAO = String(global.PEMATO_VERSION || 'V75');
  const BUILD = String(global.PEMATO_BUILD || '75');
  let ultimoHeartbeat = 0;
  let ultimoUsuario = '';

  function usuarioId() {
    try { return String(localStorage.getItem('usuario_zap_salvo') || '').trim(); } catch (_) { return ''; }
  }
  function banco() {
    try { return global.firebase?.apps?.length ? global.firebase.firestore() : null; } catch (_) { return null; }
  }
  function plataforma() {
    const ua = String(navigator.userAgent || '');
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    return 'Web';
  }
  function limpar(texto, limite=240) {
    return String(texto || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limite);
  }
  async function atualizar(dados) {
    const id = usuarioId();
    const db = banco();
    if (!id || !db) return false;
    try {
      await db.collection('usuarios').doc(id).set(dados, { merge: true });
      return true;
    } catch (_) { return false; }
  }
  async function heartbeat(forcar=false) {
    const id = usuarioId();
    if (!id) return false;
    const agora = Date.now();
    if (!forcar && id === ultimoUsuario && agora - ultimoHeartbeat < 5 * 60 * 1000) return true;
    const ok = await atualizar({
      versaoApp: VERSAO,
      buildWeb: BUILD,
      plataformaApp: plataforma(),
      ultimoAcessoAppEm: agora,
      telemetriaOperacionalV75: true
    });
    if (ok) { ultimoHeartbeat = agora; ultimoUsuario = id; }
    return ok;
  }
  async function registrarProblema(tipo, mensagem, detalhe={}) {
    const db = banco();
    const id = usuarioId();
    if (!db || !id) return false;
    const agora = Date.now();
    const incremento = global.firebase?.firestore?.FieldValue?.increment ? global.firebase.firestore.FieldValue.increment(1) : null;
    const dados = {
      versaoApp: VERSAO,
      buildWeb: BUILD,
      plataformaApp: plataforma(),
      ultimoAcessoAppEm: agora,
      ultimoErroEm: agora,
      ultimoErroTipo: limpar(tipo, 80) || 'erro_operacional',
      ultimoErroMensagem: limpar(mensagem, 280),
      ultimoErroModulo: limpar(detalhe?.modulo, 80),
      ultimoErroCodigo: limpar(detalhe?.codigo, 80),
      telemetriaOperacionalV75: true
    };
    if (incremento) dados.totalErrosOperacionais = incremento;
    else dados.totalErrosOperacionais = Number(detalhe?.totalAnterior || 0) + 1;
    return atualizar(dados);
  }

  global.PacoteEMatoTelemetria = Object.freeze({ heartbeat, registrarProblema });
  const tentar = () => heartbeat(false).catch(() => {});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tentar, { once: true }); else tentar();
  setTimeout(tentar, 1800); setTimeout(tentar, 5000);
  global.addEventListener('pemato:resume', tentar);
})(window);
