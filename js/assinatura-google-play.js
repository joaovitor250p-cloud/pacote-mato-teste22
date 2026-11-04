/*
 * Preparação da assinatura Google Play. Desativada até existir Worker de produção
 * validado, produto publicado na Play e versão Android com ponte de compra.
 * Este JavaScript não cria assinaturas, não decide pagamentos e não guarda tokens.
 */
(function () {
  'use strict';
  const cfg = window.PEMATO_PLAY_CONFIG || { enabled: false, apiBase: '' };
  let promise = null;

  function aviso(texto) {
    if (typeof window.notificar === 'function') window.notificar(texto);
    else window.alert(texto);
  }

  async function confirmarAcesso() {
    if (!cfg.enabled || !/^https:\/\/[^/]+$/.test(cfg.apiBase || '')) {
      throw new Error('PLAY_NAO_CONFIGURADO');
    }
    const usuario = window.firebase?.auth()?.currentUser;
    if (!usuario) throw new Error('LOGIN_NECESSARIO');
    if (promise) return promise;
    promise = (async () => {
      const token = await usuario.getIdToken();
      if (window.firebase.auth().currentUser?.uid !== usuario.uid) throw new Error('SESSAO_ALTERADA');
      const response = await fetch(`${cfg.apiBase}/api/access/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('SERVIDOR_INDISPONIVEL');
      const body = await response.json();
      if (body?.success !== true || typeof body.access?.active !== 'boolean') {
        throw new Error('RESPOSTA_INVALIDA');
      }
      if (window.firebase.auth().currentUser?.uid !== usuario.uid) throw new Error('SESSAO_ALTERADA');
      return body.access;
    })();
    try { return await promise; } finally { promise = null; }
  }

  function iniciarCompra() {
    if (!cfg.enabled) {
      aviso('A assinatura pela Google Play ainda está em preparação. Nenhuma cobrança foi iniciada.');
      return;
    }
    if (!window.firebase?.auth()?.currentUser) {
      aviso('Entre na sua conta antes de começar o teste grátis.');
      return;
    }
    // A compra passa exclusivamente pela tela nativa do Google Play.
    // Nunca gerar Pix, cobrar via WebView ou aceitar comprovantes enviados pelo JS.
    if (typeof window.Android?.iniciarAssinaturaGooglePlay !== 'function') {
      aviso('Para assinar, abra o aplicativo instalado pela Google Play Store.');
      return;
    }
    window.Android.iniciarAssinaturaGooglePlay();
  }

  async function liberarDias(uid, days) {
    if (!cfg.enabled || !/^https:\/\/[^/]+$/.test(cfg.apiBase || '')) {
      throw new Error('PLAY_NAO_CONFIGURADO');
    }
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid || '') ||
        !Number.isSafeInteger(days) || days < 1 || days > 3650) {
      throw new Error('DIAS_INVALIDOS');
    }
    const user = window.firebase?.auth()?.currentUser;
    if (!user) throw new Error('LOGIN_NECESSARIO');
    const token = await user.getIdToken(true);
    const response = await fetch(`${cfg.apiBase}/api/admin/grant-days`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, days }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success !== true) throw new Error(payload.code || 'ACESSO_NAO_LIBERADO');
    return payload;
  }

  async function listarCortesias() {
    if (!cfg.enabled || !/^https:\/\/[^/]+$/.test(cfg.apiBase || '')) throw new Error('PLAY_NAO_CONFIGURADO');
    const user = window.firebase?.auth()?.currentUser;
    if (!user) throw new Error('LOGIN_NECESSARIO');
    const response = await fetch(`${cfg.apiBase}/api/admin/grants`, {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store',
    });
    if (!response.ok) throw new Error('ACESSO_ADMIN_NEGADO');
    const body = await response.json();
    if (!body?.success || !Array.isArray(body.grants)) throw new Error('RESPOSTA_INVALIDA');
    return body.grants;
  }

  async function revogarCortesia(uid) {
    if (!cfg.enabled || !/^https:\/\/[^/]+$/.test(cfg.apiBase || '')) throw new Error('PLAY_NAO_CONFIGURADO');
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid || '')) throw new Error('UID_INVALIDO');
    const user = window.firebase?.auth()?.currentUser;
    if (!user) throw new Error('LOGIN_NECESSARIO');
    const response = await fetch(`${cfg.apiBase}/api/admin/revoke-grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await user.getIdToken(true)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.code || 'CORTESIA_NAO_REVOGADA');
    return data;
  }

  window.PEMATO_ASSINATURA_PLAY = { confirmarAcesso, iniciarCompra, liberarDias, listarCortesias, revogarCortesia };
  window.iniciarAssinaturaGooglePlay = iniciarCompra;
})();
