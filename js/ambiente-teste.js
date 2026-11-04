/* Pacote É Mato — configuração EXCLUSIVA da branch secundária.
 * Preencher somente após criar Firebase e Cloudflare de testes independentes.
 * Não inserir chaves privadas, tokens de API ou JSON de service account aqui.
 */
(function configurarAmbienteTeste(global) {
  'use strict';

  // Firebase Web config é pública; obtenha-a do NOVO projeto Firebase de teste.
  const firebaseConfig = {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  };

  // URL do NOVO Worker de testes, nunca do holy-frog principal.
  const workerBaseUrl = '';
  const camposFirebase = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const firebaseValido = camposFirebase.every(chave =>
    typeof firebaseConfig[chave] === 'string' && firebaseConfig[chave].trim().length > 0
  ) && firebaseConfig.projectId !== 'pacote-e-mato'
    && firebaseConfig.authDomain.endsWith('.firebaseapp.com');

  function workerValido(url) {
    try {
      const endereco = new URL(url);
      return endereco.protocol === 'https:'
        && endereco.hostname !== 'holy-frog-272c.joaovitor250p.workers.dev'
        && endereco.hostname.endsWith('.workers.dev');
    } catch (_) { return false; }
  }

  const pronto = firebaseValido && workerValido(workerBaseUrl);
  global.PEMATO_TEST_ENV = Object.freeze({
    mode: 'staging',
    ready: pronto,
    firebaseConfig: pronto ? Object.freeze(firebaseConfig) : null,
    workerBaseUrl: pronto ? workerBaseUrl.replace(/\/+$/, '') : ''
  });

  if (!pronto) {
    const aviso = () => {
      if (!document.body || document.getElementById('pemato-aviso-ambiente-teste')) return;
      const painel = document.createElement('div');
      painel.id = 'pemato-aviso-ambiente-teste';
      painel.setAttribute('role', 'alert');
      painel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#eef7f2;color:#14382e;display:flex;align-items:center;justify-content:center;text-align:center;padding:30px;font-family:Arial,sans-serif;';
      const caixa = document.createElement('div');
      caixa.style.cssText = 'max-width:560px;background:white;border:1px solid #b3dcc7;border-radius:20px;padding:32px;box-shadow:0 12px 45px #144d301b;line-height:1.6';
      const titulo = document.createElement('h1');
      titulo.textContent = 'Pacote É Mato — Ambiente de testes';
      const texto = document.createElement('p');
      texto.textContent = 'Este ambiente está sendo configurado separadamente. O acesso está temporariamente bloqueado para proteger os dados do aplicativo principal.';
      caixa.append(titulo, texto);
      painel.appendChild(caixa);
      document.body.appendChild(painel);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aviso, { once: true });
    else aviso();
  }
})(window);
