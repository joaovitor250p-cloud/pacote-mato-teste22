(function iniciarOnboardingLocalizacao(global){
  'use strict';

  const KEY_OK = 'pemato_localizacao_aceita_v61';
  const KEY_BLOCKED_SESSION = 'pemato_localizacao_bloqueada_v61';
  let verificando = false;

  function $(id){ return document.getElementById(id); }

  function telaPrincipalLiberada(){
    const bloqueio = $('telaBloqueio');
    if (!bloqueio) return true;
    const st = global.getComputedStyle ? global.getComputedStyle(bloqueio) : null;
    return bloqueio.style.display === 'none' || st?.display === 'none';
  }

  function statusUI(texto, tipo){
    const b = $('settingsLocationStatus');
    [b].forEach(el=>{
      if(!el) return;
      el.textContent = texto || '';
      if(tipo) el.dataset.status = tipo; else delete el.dataset.status;
    });
  }

  function tituloConfig(texto){
    const el = $('settingsLocationTitle');
    if(el) el.textContent = texto;
  }

  function setBotoesBloqueados(bloqueado){
    const config = $('settingsLocationBtn');
    if (config) {
      config.disabled = false;
      config.textContent = bloqueado ? 'Tentar novamente' : 'Ativar localização';
    }
  }

  function abrir(){ return false; }

  function fechar(){ return false; }

  async function estadoPermissao(){
    try { return await global.PacoteEMatoLocalizacaoAtual?.permissao?.() || 'desconhecida'; }
    catch(_){ return 'desconhecida'; }
  }

  async function atualizarStatus(){
    const p = await estadoPermissao();
    if(p === 'granted'){
      tituloConfig('Localização permitida');
      statusUI('O Pacote É Mato pode usar sua posição durante a rota.', 'ok');
      setBotoesBloqueados(false);
      try{
        localStorage.setItem(KEY_OK,'1');
        sessionStorage.removeItem(KEY_BLOCKED_SESSION);
      }catch(_){}
      return p;
    }
    if(p === 'denied'){
      tituloConfig('Localização bloqueada pelo Android/WebView');
      statusUI('A permissão de localização está bloqueada. Abra as configurações do Android para o Pacote É Mato e permita a localização, ou tente novamente pelo botão abaixo.', 'error');
      setBotoesBloqueados(true);
      try{ sessionStorage.setItem(KEY_BLOCKED_SESSION,'1'); }catch(_){}
      return p;
    }
    tituloConfig('Localização ainda não autorizada');
    statusUI('Toque em Ativar localização para solicitar a permissão ao aparelho.', 'warning');
    setBotoesBloqueados(false);
    return p;
  }

  async function solicitar(){
    if(verificando) return false;
    verificando = true;
    const botoes = [$('settingsLocationBtn')].filter(Boolean);
    botoes.forEach(b=>b.disabled=true);
    tituloConfig('Solicitando localização...');
    statusUI('Aguardando a resposta do Android/WebView.', 'warning');
    try{
      const pos = await global.PacoteEMatoLocalizacaoAtual?.obter?.({forcar:true});
      if(!pos) throw new Error('O aparelho não retornou uma posição válida.');
      try{
        localStorage.setItem(KEY_OK,'1');
        sessionStorage.removeItem(KEY_BLOCKED_SESSION);
      }catch(_){}
      tituloConfig('Localização permitida');
      statusUI('Localização ativada com sucesso.', 'ok');
      setBotoesBloqueados(false);
      global.notificar?.('Localização ativada.');
      return true;
    }catch(erro){
      const code = String(erro?.code || '');
      if(code === 'GEO_NEGADA'){
        tituloConfig('Localização bloqueada pelo Android/WebView');
        statusUI('O Android não liberou a localização. Abra as configurações do Pacote É Mato no aparelho e permita a localização, ou continue sem GPS.', 'error');
        setBotoesBloqueados(true);
        try{ sessionStorage.setItem(KEY_BLOCKED_SESSION,'1'); }catch(_){}
      }else if(code === 'CONTEXTO_INSEGURO'){
        tituloConfig('Localização indisponível');
        statusUI('A localização exige uma conexão segura HTTPS.', 'error');
      }else{
        tituloConfig('Não foi possível ativar');
        statusUI(erro?.message || 'Não foi possível obter a localização agora.', 'error');
      }
      return false;
    }finally{
      verificando=false;
      botoes.forEach(b=>b.disabled=false);
    }
  }

  function continuarSemLocalizacao(){ return true; }

  function bind(){
    $('settingsLocationBtn')?.addEventListener('click', solicitar);
    global.addEventListener('pemato:localizacao-atual', atualizarStatus);
    global.addEventListener('pemato:resume', atualizarStatus);
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) atualizarStatus(); });
    atualizarStatus();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();

  global.PacoteEMatoLocalizacaoUI = Object.freeze({ solicitar, atualizarStatus, abrir, fechar, continuarSemLocalizacao });
})(window);
