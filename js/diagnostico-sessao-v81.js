/* Pacote É Mato — diagnóstico somente de leitura, exclusivo do TESTE22.
   Não grava Firestore, não autentica, não muda assinatura nem revela identidades. */
(() => {
  'use strict';
  if (location.hostname !== 'joaovitor250p-cloud.github.io' ||
      !location.pathname.startsWith('/pacote-mato-teste22/')) return;

  const BOOL = v => v === true ? 'sim' : v === false ? 'não' : 'indefinido';
  const yes = v => v ? 'sim' : 'não';
  const findZap = user => {
    if (!user || !user.uid) return '';
    const local = localStorage.getItem('pemato_auth_uid_zap_' + user.uid) || '';
    const fallback = localStorage.getItem('usuario_zap_salvo') || '';
    const valid = s => /^\d{10,13}$/.test(String(s || '').replace(/\D/g, ''));
    return valid(local) ? String(local).replace(/\D/g, '') : valid(fallback) ? String(fallback).replace(/\D/g, '') : '';
  };
  function validade(data) {
    const raw = data.expiraEm;
    let ms = 0, origem = 'ausente';
    if (raw && typeof raw.toMillis === 'function') {
      ms = raw.toMillis(); origem = 'Timestamp';
    } else if (raw && typeof raw === 'object' && Number.isFinite(Number(raw.seconds ?? raw._seconds))) {
      ms = Number(raw.seconds ?? raw._seconds) * 1000; origem = 'Timestamp serializado';
    } else if (raw !== undefined && raw !== null && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        ms = n < 100000000000 ? n * 1000 : n;
        origem = n < 100000000000 ? 'número em segundos' : 'número em milissegundos';
      } else {
        ms = Date.parse(String(raw)) || 0;
        origem = ms ? 'data em texto' : 'formato não reconhecido';
      }
    }
    if (!ms) {
      const dias = Number(data.duracaoDias || 0);
      const inicio = Number(data.ativadoEm || data.criadoEm || 0);
      if (dias > 0 && inicio > 0) { ms = inicio + dias * 86400000; origem = 'calculada pelo início/duração'; }
    }
    const diasRelativos = ms > 0 ? Math.ceil((ms - Date.now()) / 86400000) : null;
    return { origem, situacao: ms > 0 ? (ms > Date.now() ? 'futura' : 'passada') : 'ausente ou inválida',
             dias: diasRelativos === null ? 'não definido' : (diasRelativos > 3650 ? 'mais de dez anos' : diasRelativos < -3650 ? 'mais de dez anos atrás' : String(diasRelativos)) };
  }
  function explicarErro(e) {
    const code = String(e && e.code || 'desconhecido');
    return /^[a-z-]+\/[a-z-]+$/.test(code) ? code : 'desconhecido';
  }
  async function diagnosticar() {
    const linhas = [
      'PACOTE É MATO — TESTE22 — DIAGNÓSTICO DE SESSÃO',
      'Versão: 1 (somente leitura, sem dados pessoais)',
      'Estado do aplicativo: ' + (document.body.dataset.pematoAccessState || 'não informado'),
      'Aviso de renovação visível: ' + yes(!!document.getElementById('avisoRenovacao') && getComputedStyle(document.getElementById('avisoRenovacao')).display !== 'none'),
    ];
    try {
      if (!window.firebase || !firebase.apps || !firebase.apps.length) {
        linhas.push('Firebase inicializado: não');
        return linhas.join('\n');
      }
      const user = firebase.auth().currentUser;
      linhas.push('Firebase inicializado: sim');
      linhas.push('Usuário Firebase restaurado: ' + yes(!!user));
      if (!user) { linhas.push('Resultado: sessão ausente; nenhuma consulta ao Firestore foi feita.'); return linhas.join('\n'); }
      const zap = findZap(user);
      linhas.push('Vínculo local WhatsApp disponível: ' + yes(!!zap));
      if (!zap) { linhas.push('Resultado: não há vínculo local; não foi consultado outro usuário.'); return linhas.join('\n'); }
      let snap;
      try {
        snap = await firebase.firestore().collection('usuarios').doc(zap).get({ source: 'server' });
      } catch (e) {
        linhas.push('Leitura Firestore servidor: FALHOU (' + explicarErro(e) + ')');
        return linhas.join('\n');
      }
      linhas.push('Leitura Firestore servidor: OK');
      linhas.push('Documento encontrado: ' + yes(snap.exists));
      if (!snap.exists) return linhas.join('\n');
      const d = snap.data() || {};
      const val = validade(d);
      const vit = d.vitalicio === true || /vital[ií]cio/i.test(String(d.plano || '')) || Number(d.duracaoDias || 0) >= 100000 ||
        (val.situacao === 'futura' && Number(val.dias) >= 100000);
      const acesso = !d.bloqueado && (vit || (val.situacao === 'futura') || (val.situacao === 'ausente ou inválida' && d.ativo === true));
      const antigoId = localStorage.getItem('app_device_hw_id') || '';
      linhas.push('UID corresponde ao documento: ' + yes(d.authUid === user.uid));
      linhas.push('Ativo no Firestore: ' + BOOL(d.ativo));
      linhas.push('Bloqueado no Firestore: ' + BOOL(d.bloqueado));
      linhas.push('Plano vitalício reconhecido: ' + yes(vit));
      linhas.push('Tipo de expiração: ' + val.origem);
      linhas.push('Expiração: ' + val.situacao);
      linhas.push('Dias relativos de vencimento: ' + val.dias);
      linhas.push('Dispositivo corresponde: ' + (d.deviceId ? (antigoId ? yes(d.deviceId === antigoId) : 'sem ID local') : 'sem vínculo no documento'));
      linhas.push('Acesso pela regra atual do site: ' + (acesso ? 'ATIVO' : 'INATIVO'));
      if (acesso && document.body.dataset.pematoAccessState === 'expired')
        linhas.push('DIVERGÊNCIA: servidor indica acesso ativo, tela indica expirada.');
      return linhas.join('\n');
    } catch (e) {
      linhas.push('Diagnóstico interrompido: ' + explicarErro(e));
      return linhas.join('\n');
    }
  }
  function instalar() {
    if (document.getElementById('pemato-diagnostico-sessao-v81')) return;
    const entrar = document.getElementById('btnEntrarAuth');
    const debug = document.getElementById('pemato-google-diagnostico-btn')?.parentElement;
    const google = document.getElementById('pemato-btn-google-login-v81')?.parentElement;
    const anchor = (debug?.parentElement === entrar?.parentElement ? debug : null)
      || (google?.parentElement === entrar?.parentElement ? google : null)
      || entrar;
    if (!anchor || !anchor.parentNode) return;
    const container = document.createElement('section');
    container.id = 'pemato-diagnostico-sessao-v81';
    container.style.cssText = 'margin:12px 0;padding:10px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;color:#163a29';
    const title = document.createElement('strong'); title.textContent = 'Diagnóstico de sessão — TESTE22';
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Verificar por que a assinatura aparece expirada';
    btn.style.cssText = 'display:block;width:100%;padding:10px;margin:8px 0;background:#166534;color:white;border:0;border-radius:8px';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar resultado';
    copy.style.cssText = 'padding:8px;margin:4px 0;border:1px solid #86efac;border-radius:7px;background:white;color:#166534';
    copy.disabled = true;
    const output = document.createElement('textarea'); output.readOnly = true; output.rows = 12;
    output.setAttribute('aria-label','Resultado do diagnóstico sem dados pessoais');
    output.style.cssText = 'display:block;width:100%;box-sizing:border-box;font-size:12px;margin-top:8px;';
    container.append(title,btn,copy,output);
    anchor.parentNode.insertBefore(container, anchor.nextSibling);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      output.value = 'Verificando (somente leitura)...';
      output.value = await diagnosticar();
      copy.disabled = false;
      btn.disabled = false;
    });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(output.value); copy.textContent = 'Copiado!'; }
      catch (_) { output.focus(); output.select(); copy.textContent = 'Selecione e copie o texto acima'; }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar);
  else instalar();
})();
