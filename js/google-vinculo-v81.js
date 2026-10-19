/* Pacote É Mato - V81 - FASE 1: vincular Google ao Firebase UID existente.
 * Sem criação de conta, alteração de assinaturas, Firestore writes ou Billing.
 */
(function () {
  'use strict';
  if (window.PEMATO_VINCULO_GOOGLE_V81) return;

  let pendente = null;
  let busy = false;
  let statusEl, botao;

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
