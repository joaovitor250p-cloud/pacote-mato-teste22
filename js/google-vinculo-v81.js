/* Pacote É Mato - V81 - FASE 1: vincular Google ao Firebase UID existente.
 * Sem criação de conta, alteração de assinaturas, Firestore writes ou Billing.
 */
(function () {
  'use strict';
  if (window.PEMATO_VINCULO_GOOGLE_V81) return;

  let pendente = null;
  let busy = false;
  let statusEl, botao;
  const CHAVE_VINCULO_LOCAL = 'pemato_google_v81_vinculo_confirmado_teste22';

  // Este registro LOCAL serve apenas como proteção adicional no TESTE22.
  // Não substitui a autenticação Firebase nem uma verificação em backend.
  function memorizarVinculo(uid, zap, user) {
    const google = user?.providerData?.find(p => p.providerId === 'google.com');
    const identificadorGoogle = google?.uid;
    if (!identificadorGoogle || !uid || !zap) return;
    localStorage.setItem(CHAVE_VINCULO_LOCAL, JSON.stringify({
      uid, zap, googleSub: String(identificadorGoogle), salvoEm: Date.now()
    }));
  }

  const firebaseDisponivel = () => typeof window.firebase !== 'undefined' && firebase.apps?.length > 0;
  const auth = () => firebase.auth();
  const db = () => firebase.firestore();
  const numero = s => String(s || '').replace(/\D/g, '');

  function status(mensagem, erro = false) {
    if (!statusEl) return;
    statusEl.textContent = mensagem;
    statusEl.style.color = erro ? '#d97706' : '#047857';
  }

  async function usuarioValidoParaVincular() {
    if (!firebaseDisponivel()) throw new Error('Aguarde o Firebase inicializar.');
    const atual = auth().currentUser;
    if (!atual) throw new Error('Primeiro entre na sua conta atual pelo WhatsApp e senha.');
    const zap = numero(localStorage.getItem('usuario_zap_salvo'));
    if (zap.length < 10 || zap.length > 13) {
      throw new Error('Não foi possível identificar o WhatsApp desta conta. Entre novamente.');
    }
    // Confirma associação no servidor; não usa dados em cache para vinculação.
    const registro = await db().collection('usuarios').doc(zap).get({ source: 'server' });
    if (!registro.exists || registro.data()?.authUid !== atual.uid) {
      throw new Error('A sessão não corresponde ao WhatsApp cadastrado. Não vincule outra conta.');
    }
    return { uid: atual.uid, zap, user: atual };
  }

  async function iniciar() {
    if (busy) return;
    busy = true;
    if (botao) botao.disabled = true;
    pendente = null;
    try {
      if (typeof window.Android?.vincularContaGoogle !== 'function') {
        throw new Error('A vinculação exige a nova versão Android de testes.');
      }
      const sessao = await usuarioValidoParaVincular();
      if (sessao.user.providerData.some(p => p.providerId === 'google.com')) {
        memorizarVinculo(sessao.uid, sessao.zap, sessao.user);
        status('Esta conta já está vinculada ao Google.');
        return;
      }
      pendente = { uid: sessao.uid, zap: sessao.zap, inicio: Date.now() };
      status('Escolha a conta Google que será vinculada ao seu acesso atual.');
      // Só chega à API Android após clique real e checagem da sessão autenticada.
      window.Android.vincularContaGoogle();
      return;
    } catch (e) {
      status(e.message || 'Não foi possível iniciar a vinculação.', true);
    }
    busy = false;
    if (botao) botao.disabled = false;
  }

  window.PEMATO_VINCULO_GOOGLE_V81 = {
    async receberToken(idToken) {
      const tentativa = pendente;
      pendente = null;
      try {
        if (!tentativa || Date.now() - tentativa.inicio > 120000) {
          throw new Error('Solicitação expirada. Toque novamente para vincular.');
        }
        const sessao = await usuarioValidoParaVincular();
        if (tentativa.uid !== sessao.uid || tentativa.zap !== sessao.zap) {
          throw new Error('A conta mudou durante o processo. Vinculação cancelada.');
        }
        const credencial = firebase.auth.GoogleAuthProvider.credential(String(idToken));
        // CRÍTICO: linkWithCredential preserva o UID e os dados existentes.
        // NÃO chamar signInWithCredential; isso poderia gerar outra conta Firebase.
        const resultado = await sessao.user.linkWithCredential(credencial);
        if (resultado.user.uid !== tentativa.uid) {
          throw new Error('Não foi possível confirmar a identidade da conta original.');
        }
        memorizarVinculo(tentativa.uid, tentativa.zap, resultado.user);
        status('Google vinculado! A conta e sua assinatura continuam com o mesmo UID.');
      } catch (e) {
        const code = e?.code || '';
        if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
          status('Este Google já está associado a outra conta. Não mesclamos contas automaticamente; procure o suporte.', true);
        } else if (code === 'auth/requires-recent-login') {
          status('Entre novamente pelo WhatsApp e senha antes de tentar vincular.', true);
        } else {
          status(e.message || 'Falha ao vincular Google. Sua conta original foi preservada.', true);
        }
      } finally {
        busy = false;
        if (botao) botao.disabled = false;
      }
    },
    erro(mensagem) {
      pendente = null;
      busy = false;
      if (botao) botao.disabled = false;
      status(String(mensagem || 'Não foi possível selecionar uma conta Google.'), true);
    }
  };

  function montar() {
    const modulo = document.getElementById('moduloConfiguracoes');
    if (!modulo || document.getElementById('pemato-google-vinculo')) return;
    const sec = document.createElement('section');
    sec.id = 'pemato-google-vinculo';
    sec.style.cssText = 'padding:16px;margin:16px 0;background:#f3faf5;border:1px solid #a7e0be;border-radius:14px;';
    sec.innerHTML = '<strong style="color:#155e44">Conta Google (migração segura)</strong>' +
      '<p style="margin:8px 0;color:#22543d">Entre primeiro na conta antiga. Depois vincule o Google sem trocar seu UID, WhatsApp, assinatura ou histórico.</p>' +
      '<button id="pemato-btn-vincular-google" type="button" style="background:#319767;color:white;padding:12px 16px;border:0;border-radius:9px;font-weight:700">Vincular minha conta Google</button>' +
      '<p id="pemato-google-vinculo-status" role="status" aria-live="polite" style="margin-top:8px"></p>';
    const cabecalho = modulo.querySelector('.module-head');
    if (cabecalho) cabecalho.insertAdjacentElement('afterend', sec);
    else modulo.prepend(sec);
    statusEl = sec.querySelector('#pemato-google-vinculo-status');
    botao = sec.querySelector('#pemato-btn-vincular-google');
    botao.addEventListener('click', iniciar);
    if (firebaseDisponivel()) {
      auth().onAuthStateChanged(u => {
        if (u?.providerData?.some(p => p.providerId === 'google.com')) {
          // Reconstituir o registro local de quem já vinculou na fase 1,
          // após verificar no servidor o UID e WhatsApp correspondentes.
          usuarioValidoParaVincular().then(sessao => {
            if (sessao.uid === u.uid) memorizarVinculo(sessao.uid, sessao.zap, u);
          }).catch(() => {});
        }
        sec.style.display = u ? '' : 'none';
        if (u?.providerData?.some(p => p.providerId === 'google.com')) {
          status('Conta Google já vinculada a este usuário.');
          botao.disabled = true;
        } else if (!busy) {
          status('');
          botao.disabled = false;
        }
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();


/* FASE 2 - botão Entrar com Google para uma identidade já vinculada e
 * confirmada localmente neste dispositivo. Não habilitar publicamente.
 * Evita iniciar signInWithCredential para uma conta Google diferente;
 * somente um backend de migração seguro pode remover esta restrição.
 */
(function () {
  'use strict';
  if (window.PEMATO_LOGIN_GOOGLE_V81) return;
  const CHAVE = 'pemato_google_v81_vinculo_confirmado_teste22';
  let aguardando = false;
  let botao, statusEl;

  function informar(mensagem, erro = false) {
    if (!statusEl) return;
    statusEl.textContent = String(mensagem || '');
    statusEl.style.color = erro ? '#b45309' : '#047857';
  }
  function recuperarVinculo() {
    let valor;
    try { valor = JSON.parse(localStorage.getItem(CHAVE) || 'null'); }
    catch (_) { return null; }
    const valido = valor && typeof valor.uid === 'string' && valor.uid.length > 5 &&
      /^\d{10,13}$/.test(String(valor.zap || '')) &&
      typeof valor.googleSub === 'string' && valor.googleSub.length > 10;
    return valido ? valor : null;
  }
  function extrairSubGoogle(token) {
    // Somente para conferir correspondência antes de tentar autenticar.
    // É o Firebase que verificará a assinatura criptográfica do token.
    const partes = String(token || '').split('.');
    if (partes.length !== 3 || partes[1].length > 10000) throw new Error('Credencial Google inválida.');
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
    return String(payload.sub || '');
  }
  function habilitar(v) {
    aguardando = v;
    if (botao) botao.disabled = v;
  }
  async function iniciar() {
    if (aguardando) return;
    habilitar(true);
    try {
      if (!window.Android || typeof window.Android.entrarContaGoogleV81 !== 'function')
        throw new Error('Atualize o aplicativo de testes pelo Android Studio.');
      if (!window.firebase?.apps?.length) throw new Error('Aguarde o Firebase carregar.');
      if (firebase.auth().currentUser) {
        throw new Error('Você já está conectado. Para testar a entrada, saia normalmente da conta.');
      }
      if (!recuperarVinculo()) {
        throw new Error('Primeiro entre pelo WhatsApp e confirme em Configurações que esta conta Google está vinculada.');
      }
      informar('Selecione a mesma conta Google que você vinculou.');
      window.Android.entrarContaGoogleV81();
    } catch (e) {
      informar(e.message, true);
      habilitar(false);
    }
  }
  window.PEMATO_LOGIN_GOOGLE_V81 = {
    async receberToken(token) {
      try {
        if (!aguardando) throw new Error('Nenhuma solicitação Google está em andamento.');
        const anterior = recuperarVinculo();
        if (!anterior) throw new Error('É necessário vincular a conta novamente pelo WhatsApp.');
        if (extrairSubGoogle(token) !== anterior.googleSub) {
          throw new Error('Você escolheu outro Google. Selecione a conta vinculada ao Pacote É Mato. Nenhuma conta nova foi criada.');
        }
        // Um provedor Google já vinculado à conta antiga conserva o Firebase UID.
        const credential = firebase.auth.GoogleAuthProvider.credential(String(token));
        const auth = firebase.auth();
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        localStorage.setItem('usuario_zap_salvo', anterior.zap);
        const resultado = await auth.signInWithCredential(credential);
        if (resultado.user.uid !== anterior.uid || resultado.additionalUserInfo?.isNewUser) {
          await auth.signOut();
          throw new Error('O Google não corresponde ao UID vinculado. Acesso interrompido. Contate o suporte.');
        }
        // A validação de assinatura continua sendo feita pelo js/app.js.
        informar('Google autenticado. Confirmando sua assinatura…');
      } catch (e) {
        informar(e?.message || 'Falha ao entrar com Google. Use o acesso antigo.', true);
      } finally {
        habilitar(false);
      }
    },
    erro(mensagem) { informar(mensagem || 'Seleção Google cancelada.', true); habilitar(false); }
  };
  function montarBotao() {
    const entrar = document.getElementById('btnEntrarAuth');
    if (!entrar || document.getElementById('pemato-btn-google-login-v81')) return;
    const container = document.createElement('div');
    container.style.cssText = 'margin:12px 0;text-align:center;';
    const b = document.createElement('button');
    b.id = 'pemato-btn-google-login-v81';
    b.type = 'button';
    b.style.cssText = 'width:100%;background:#fff;color:#243a2e;border:1px solid #b6c7bc;border-radius:12px;padding:12px 16px;font-weight:700;';
    b.textContent = 'Continuar com Google (TESTE22)';
    const aviso = document.createElement('div');
    aviso.setAttribute('role', 'status');
    aviso.setAttribute('aria-live', 'polite');
    aviso.style.cssText = 'font-size:.76rem;text-align:left;margin-top:7px;';
    entrar.insertAdjacentElement('afterend', container);
    container.append(b, aviso);
    botao = b;
    statusEl = aviso;
    b.addEventListener('click', iniciar);
    if (!window.Android || typeof window.Android.entrarContaGoogleV81 !== 'function') {
      container.style.display = 'none';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarBotao);
  else montarBotao();
})();
