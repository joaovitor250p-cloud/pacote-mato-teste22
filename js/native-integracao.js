(function integrarAndroidNativo(global) {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024;
  let transferencia = null;
  let documentoPendente = null;
  let importacaoEmCurso = false;
  let pedidoNativoEmCurso = false;
  let voltarRotaPendente = false;
  let ultimaNotificacao = '';
  let atualizando = false;

  function acessoAutorizado() {
    return global.document?.body?.dataset?.pematoAccessState === 'active';
  }
  function avisar(texto) {
    if (typeof global.notificar === 'function') global.notificar(texto);
    else console.warn(texto);
  }
  function iniciar(token, nome, tamanhoBase64) {
    const extensao = String(nome || '').split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv', 'pdf'].includes(extensao)) return false;
    if (Number(tamanhoBase64) > MAX_BYTES * 1.35 + 10) return false;
    // Não duplica a mesma transmissão quando o login muda de tela.
    if (documentoPendente?.token === String(token)) return true;
    transferencia = { token: String(token), nome: String(nome).slice(0, 150), partes: [], tamanho: 0 };
    return true;
  }
  function bloco(token, dados) {
    if (!transferencia || transferencia.token !== String(token) || typeof dados !== 'string') return false;
    transferencia.tamanho += dados.length;
    if (transferencia.tamanho > MAX_BYTES * 1.35 + 10) { transferencia = null; return false; }
    transferencia.partes.push(dados);
    return true;
  }
  function finalizar(token) {
    if (!transferencia || transferencia.token !== String(token)) return false;
    const { nome, partes } = transferencia;
    transferencia = null;
    try {
      const bruto = global.atob(partes.join(''));
      if (bruto.length > MAX_BYTES) throw new Error('Arquivo muito grande.');
      const bytes = new Uint8Array(bruto.length);
      for (let i = 0; i < bruto.length; ++i) bytes[i] = bruto.charCodeAt(i);
      const ext = nome.split('.').pop().toLowerCase();
      const tipo = ext === 'pdf' ? 'application/pdf' : ext === 'csv' ? 'text/csv' :
        ext === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      documentoPendente = { token: String(token), file: new File([bytes], nome, { type: tipo }) };
      pedidoNativoEmCurso = false;
      consumirPendencias();
      return true;
    } catch (erro) {
      avisar('Não foi possível abrir o arquivo enviado: ' + String(erro?.message || erro));
      return false;
    }
  }
  function abrirRotaPendente() {
    voltarRotaPendente = true;
    consumirPendencias();
    return true;
  }
  function solicitarArquivoAoAndroid() {
    if (documentoPendente || transferencia || pedidoNativoEmCurso || !acessoAutorizado()) return;
    if (typeof global.Android?.solicitarArquivoCompartilhado !== 'function') return;
    pedidoNativoEmCurso = true;
    try { global.Android.solicitarArquivoCompartilhado(); }
    catch (_) { pedidoNativoEmCurso = false; }
    // Solicitação é só um gatilho; se não houver anexo, não mantém bloqueio.
    global.setTimeout?.(() => { pedidoNativoEmCurso = false; }, 3500);
  }

  async function consumirPendencias() {
    if (!acessoAutorizado()) return; // Login e licença continuam obrigatórios.
    if (documentoPendente && !importacaoEmCurso) {
      // O arquivo fica retido no Android até a interface aceitar ou cancelar
      // a importação; uma recarga do WebView não o perde.
      const { file, token } = documentoPendente;
      importacaoEmCurso = true;
      try {
        const shell = global.PacoteEMatoAppShell;
        if (typeof shell?.abrirModulo !== 'function') throw new Error('Interface ainda está carregando.');
        if (/\.pdf$/i.test(file.name)) {
          await shell.abrirModulo('bipagem');
          const campo = document.getElementById('pdfInput');
          if (!campo) throw new Error('Leitor PDF ainda não está disponível.');
          const dt = new DataTransfer(); dt.items.add(file);
          campo.files = dt.files;
          campo.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          await shell.abrirModulo('roteirizacao');
          if (typeof global.PacoteEMatoRoteirizacao?.importarArquivoExterno !== 'function')
            throw new Error('Importador de planilhas ainda não está disponível.');
          // Mantém o mesmo mapeamento, confirmação e otimizador da importação manual.
          const importado = await global.PacoteEMatoRoteirizacao.importarArquivoExterno(file);
          if (importado === false) {
            // Cancelamento ou erro explicitamente tratado pelo importador.
            // Libera o anexo para não insistir sem consentimento.
            documentoPendente = null;
            global.Android?.confirmarArquivoCompartilhado?.(token);
            return;
          }
        }
        documentoPendente = null;
        global.Android?.confirmarArquivoCompartilhado?.(token);
      } catch (erro) {
        console.warn('Pacote É Mato: importação externa aguardando interface:', erro?.message || erro);
        // Não descarta a planilha nem confirma recebimento ao Android.
        avisar('Não foi possível importar ainda: ' + String(erro?.message || erro));
      } finally { importacaoEmCurso = false; }
    } else if (!documentoPendente && !transferencia) {
      solicitarArquivoAoAndroid();
    }
    if (voltarRotaPendente) {
      voltarRotaPendente = false;
      await global.PacoteEMatoAppShell?.abrirModulo?.('roteirizacao');
    }
  }

  function rotaNaoConcluida(rota) {
    if (!rota || ['concluida', 'arquivada'].includes(String(rota.status || ''))) return 0;
    const paradas = Array.isArray(rota.paradas) ? rota.paradas : [];
    if (!paradas.length) return 0;
    // Avisa apenas rotas iniciadas/otimizadas, não planilhas vazias em edição.
    if (!['ativa', 'aguardando_finalizacao'].includes(String(rota.status || '')) && rota.rotaOtimizada !== true) return 0;
    return paradas.filter(p => !['entregue', 'concluida', 'nao_entregue'].includes(String(p.statusEntrega || ''))).length;
  }
  async function sincronizarRota() {
    if (atualizando) return;
    atualizando = true;
    try {
      if (typeof global.Android?.atualizarRotaPendente !== 'function') return;
      if (!acessoAutorizado()) {
        global.Android.atualizarRotaPendente(false, '', 0);
        ultimaNotificacao = '';
        return;
      }
      const rota = await global.PacoteEMatoRotaStore?.obterRotaAtiva?.();
      let pendentes = rotaNaoConcluida(rota);
      let nome = pendentes ? String(rota?.nome || 'Rota de entregas') : '';
      if (!pendentes && (!rota || !Array.isArray(rota.paradas) || !rota.paradas.length)) {
        try {
          const legado = JSON.parse(localStorage.getItem('rota_ativa_completa') || 'null');
          const dono = String(legado?.usuarioZap || '');
          const atual = String(localStorage.getItem('usuario_zap_salvo') || '');
          if (legado && dono && dono === atual && !legado.resumoFinalJaExibido) {
            const total = Array.isArray(legado.todosPacotes) ? legado.todosPacotes.length : 0;
            const feitos = Array.isArray(legado.pacotesBipados) ? legado.pacotesBipados.length : 0;
            if (total > feitos) { pendentes = total - feitos; nome = String(legado.nomeArquivo || 'Rota de entregas'); }
          }
        } catch (_) {}
      }
      const assinatura = `${nome}|${pendentes}`;
      if (assinatura !== ultimaNotificacao) {
        global.Android.atualizarRotaPendente(pendentes > 0, nome, pendentes);
        ultimaNotificacao = assinatura;
      }
    } catch (erro) { console.warn('Lembrete de rota indisponível:', erro?.message || erro); }
    finally { atualizando = false; }
  }

  global.PacoteEMatoEntradaAndroid = Object.freeze({ iniciar, bloco, finalizar, abrirRotaPendente });
  global.addEventListener('pemato:acesso:estado', () => { consumirPendencias(); sincronizarRota(); });
  global.addEventListener('pemato:rota:salva', sincronizarRota);
  global.addEventListener('pemato:rota:ativa-limpa', sincronizarRota);
  global.addEventListener('pemato:resume', sincronizarRota);
  global.addEventListener('focus', () => { consumirPendencias(); sincronizarRota(); });
  global.document?.addEventListener('visibilitychange', () => { if (!global.document.hidden) { consumirPendencias(); sincronizarRota(); } });
  // Suporta também PDF antigo sem substituir a bipagem: alterações em rota_ativa_completa.
  global.setInterval?.(sincronizarRota, 30000);
  global.setInterval?.(() => { if (documentoPendente && acessoAutorizado() && !importacaoEmCurso) consumirPendencias(); }, 3000);
  global.setTimeout?.(() => { consumirPendencias(); sincronizarRota(); }, 1300);
})(window);
