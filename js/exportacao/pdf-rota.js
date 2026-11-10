(function iniciarExportacaoPdf(global) {
  'use strict';

  const APP_NAME = 'Pacote É Mato';
  const GREEN = [52, 166, 111];
  const GREEN_DARK = [20, 105, 72];
  const GREEN_LIGHT = [239, 249, 244];
  const TEXT = [20, 28, 24];
  const MUTED = [91, 105, 98];
  const LINE = [211, 225, 218];


  function bytesParaBase64(bytes) {
    let bin = '';
    const passo = 0x8000;
    for (let i = 0; i < bytes.length; i += passo) bin += String.fromCharCode(...bytes.subarray(i, i + passo));
    return btoa(bin);
  }

  async function salvarDocumento(doc, nomeArquivo) {
    const nome = String(nomeArquivo || `${APP_NAME} - Rota.pdf`);
    const android = global.Android;
    if (android && typeof android.salvarPdfBase64 === 'function') {
      const buffer = doc.output('arraybuffer');
      const base64 = bytesParaBase64(new Uint8Array(buffer));
      android.salvarPdfBase64(nome, base64);
      return { metodo: 'android' };
    }

    // Exportação é sempre um DOWNLOAD. Não disparar navigator.share:
    // no Chrome Android ele abre a folha de compartilhamento em vez de salvar.
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = nome;
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { metodo: 'download' };
    } catch (erro) {
      URL.revokeObjectURL(url);
      throw new Error('Não foi possível abrir o salvamento do PDF neste aparelho. Atualize o aplicativo para a versão com exportação nativa.');
    }
  }

  function formatarDistancia(m) {
    const n = Number(m);
    return Number.isFinite(n) ? `${(n / 1000).toFixed(1).replace('.', ',')} km` : '—';
  }

  function formatarTempo(s) {
    const min = Math.max(0, Math.round(Number(s || 0) / 60));
    return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}min` : `${min} min`;
  }

  function dataBr(data) {
    const s = String(data || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || '—');
  }

  function hora(timestamp) {
    const n = Number(timestamp);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return new Date(n).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function limparNome(nome) {
    return String(nome || 'Rota')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim().slice(0, 70) || 'Rota';
  }

  function chaveFisica(p, index) {
    try {
      const chave = global.PacoteEMatoMarcadores?.chaveFisicaMarcador?.(p);
      if (chave) return String(chave);
    } catch (_) {}
    const lat = Number(p?.latitude), lon = Number(p?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return `coord:${lat.toFixed(5)}|${lon.toFixed(5)}`;
    return `id:${String(p?.id || index)}`;
  }

  function ordenar(rota) {
    const byId = new Map((rota.paradas || []).map(p => [String(p.id), p]));
    const lista = [];
    (rota.ordem || []).forEach(id => {
      const p = byId.get(String(id));
      if (p && !lista.includes(p)) lista.push(p);
    });
    (rota.paradas || []).forEach(p => { if (!lista.includes(p)) lista.push(p); });
    return lista;
  }

  function agruparParadasFisicas(ordenadas) {
    const grupos = [];
    const porChave = new Map();
    ordenadas.forEach((p, index) => {
      const key = chaveFisica(p, index);
      let grupo = porChave.get(key);
      if (!grupo) {
        grupo = { key, parada: p, entregas: [], pacotes: [], observacoes: [] };
        porChave.set(key, grupo);
        grupos.push(grupo);
      }
      grupo.entregas.push(p);
      (p?.pacotes || []).forEach(codigo => {
        const c = String(codigo || '').trim();
        if (c && !grupo.pacotes.includes(c)) grupo.pacotes.push(c);
      });
      const obs = observacao(p);
      if (obs && !grupo.observacoes.some(v => v.toLocaleLowerCase('pt-BR') === obs.toLocaleLowerCase('pt-BR'))) grupo.observacoes.push(obs);
    });
    return grupos;
  }

  function construirEtas(rota, grupos) {
    const etas = new Map();
    const pernas = Array.isArray(rota.pernas) ? rota.pernas : [];
    if (!pernas.length) return etas;
    const inicio = Number(rota.iniciadoEm || rota.otimizadoEm || rota.calculadoEm || Date.now());
    let atual = Number.isFinite(inicio) ? inicio : Date.now();
    const tempoParadaMs = Math.max(0, Number(rota.tempoParadaSegundos || 0)) * 1000;
    grupos.forEach((grupo, index) => {
      const leg = pernas[index];
      const segundos = Number(leg?.time ?? leg?.duration ?? leg?.seconds);
      if (!Number.isFinite(segundos) || segundos < 0) return;
      atual += segundos * 1000;
      etas.set(grupo.key, atual);
      atual += tempoParadaMs;
    });
    if (rota.pontoFinal && pernas.length > grupos.length) {
      const leg = pernas[grupos.length];
      const segundos = Number(leg?.time ?? leg?.duration ?? leg?.seconds);
      if (Number.isFinite(segundos) && segundos >= 0) etas.set('__FINAL__', atual + segundos * 1000);
    }
    return etas;
  }

  function enderecoCompleto(p) {
    return String(p?.enderecoOriginal || p?.enderecoFonte || p?.endereco || '').trim() || 'Endereço não informado';
  }

  function observacao(p) {
    const itens = [];
    const add = v => { const t = String(v || '').trim(); if (t && !itens.some(x => x.toLowerCase() === t.toLowerCase())) itens.push(t); };
    add(p?.complemento);
    if (p?.bloco) add(`Bloco ${p.bloco}`);
    if (p?.apartamento) add(`Ap ${p.apartamento}`);
    if (p?.sala) add(`Sala ${p.sala}`);
    if (p?.loja) add(`Loja ${p.loja}`);
    add(p?.observacao);
    return itens.join(' · ');
  }

  function codigos(p) {
    return [...new Set((p?.pacotes || []).map(v => String(v || '').trim()).filter(Boolean))].join('\n');
  }

  function observacaoGrupo(grupo) {
    const partes = [];
    if ((grupo?.entregas || []).length > 1) partes.push(`${grupo.entregas.length} entregas neste endereço`);
    (grupo?.observacoes || []).forEach(v => { if (v && !partes.includes(v)) partes.push(v); });
    return partes.join(' · ');
  }


  // Exportação no estilo da tabela de rota do exemplo enviado: uma linha por
  // pacote registrado (BR duplicado permanece, não representa o mesmo volume).
  function linhasDaRota(ordenadas, etas) {
    const linhas = [];
    (ordenadas || []).forEach(parada => {
      const key = chaveFisica(parada, linhas.length);
      const eta = etas.has(key) ? hora(etas.get(key)) : '—';
      const endereco = enderecoCompleto(parada);
      const obs = observacao(parada);
      const codigosRegistrados = Array.isArray(parada?.pacotes) ? parada.pacotes : [];
      const quantidadeInformada = Math.max(0, Math.round(Number(parada?.quantidadePacotes) || 0));
      const total = Math.max(1, codigosRegistrados.length, quantidadeInformada);
      for (let i = 0; i < total; i++) {
        const raw = codigosRegistrados[i];
        const codigo = (typeof raw === 'string' || typeof raw === 'number')
          ? String(raw).trim()
          : String(raw?.codigoRastreio || raw?.codigoBarras || raw?.codigo || raw?.br || '').trim();
        linhas.push({ parada, endereco, eta, codigo, obs });
      }
    });
    return linhas;
  }

  async function exportar(rota) {
    if (!global.jspdf?.jsPDF) throw new Error('Biblioteca de PDF não carregada.');
    if (!rota) throw new Error('Nenhuma rota disponível para exportar.');

    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    doc.setProperties({
      title: APP_NAME + ' - ' + String(rota.nome || 'Rota'),
      subject: 'Lista de entregas, endereços, previsão de chegada e códigos BR',
      author: APP_NAME,
      creator: APP_NAME,
      keywords: 'Pacote É Mato, rota, pacotes, entregas'
    });
    const pageW = 210, margin = 10, contentW = pageW - margin * 2;
    let pageH = 297;
    // Colunas correspondem à referência do Circuit, adaptadas ao português.
    const cols = { numero: 11, endereco: 90, eta: 30, notas: 59 };
    const ordenadas = ordenar(rota);
    const gruposFisicos = agruparParadasFisicas(ordenadas);
    const etas = construirEtas(rota, gruposFisicos);
    const linhas = linhasDaRota(ordenadas, etas);
    const pontoFinal = rota.pontoFinal && Number.isFinite(Number(rota.pontoFinal.lat)) &&
      Number.isFinite(Number(rota.pontoFinal.lon)) ? rota.pontoFinal
      : rota.retornarAoInicio === true ? rota.pontoInicial : null;

    // Página contínua: mede todas as linhas antes de desenhar, mantendo letras
    // legíveis em rotas com mais de 100 entregas. O PDF limita cada dimensão
    // a 14.400 pontos; rotas excepcionais continuam em outra página.
    function medirLinha(endereco, codigo, obs) {
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.6);
      const enderecoLinhas = doc.splitTextToSize(String(endereco || '—'), cols.endereco - 4);
      const codigoLinhas = doc.splitTextToSize(String(codigo || 'BR não informado'), cols.notas - 4);
      const obsLinhas = obs ? doc.splitTextToSize(String(obs), cols.notas - 4) : [];
      const altura = Math.max(9.2, 3.8 * Math.max(enderecoLinhas.length, codigoLinhas.length + obsLinhas.length, 1) + 3.5);
      return { enderecoLinhas, codigoLinhas, obsLinhas, altura };
    }
    const alturaLinhas = linhas.reduce((total, item) =>
      total + medirLinha(item.endereco, item.codigo, item.obs).altura, 0);
    const alturaFinal = pontoFinal ? medirLinha(pontoFinal.descricao || 'Destino final', '', 'Destino final da rota').altura : 0;
    pageH = Math.min(5080, Math.max(297, Math.ceil(48 + alturaLinhas + alturaFinal + 14)));
    doc.internal.pageSize.setHeight(pageH);
    let y = 0, pagina = 0;

    function cabecalhoTabela() {
      const altura = 9;
      doc.setFillColor(...GREEN_DARK);
      doc.rect(margin, y, contentW, altura, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      let x = margin;
      doc.text('#', x + cols.numero/2, y + 5.7, {align:'center'}); x += cols.numero;
      doc.text('ENDEREÇO', x + 2, y + 5.7); x += cols.endereco;
      doc.text('CHEGADA', x + cols.eta/2, y + 5.7, {align:'center'}); x += cols.eta;
      doc.text('BR / OBSERVAÇÕES', x + 2, y + 5.7);
      y += altura;
    }

    function cabecalhoPagina() {
      pagina++;
      doc.setFillColor(...GREEN_DARK);
      doc.rect(0, 0, pageW, 22, 'F');
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica','bold');
      doc.setFontSize(14);
      doc.text(APP_NAME.toUpperCase(), margin, 10);
      doc.setFontSize(8.4);
      doc.text(String(rota.nome || 'Lista de entregas'), margin, 16);
      doc.setFont('helvetica','normal');
      doc.setFontSize(8);
      doc.text('Página ' + pagina, pageW - margin, 16, { align:'right' });

      y = 28;
      doc.setTextColor(...TEXT);
      doc.setFont('helvetica','bold');
      doc.setFontSize(8.5);
      doc.text('Data: ' + dataBr(rota.data), margin, y);
      doc.text('Tempo total: ' + formatarTempo(rota.duracaoTotalSegundos), margin + 59, y);
      doc.text('Distância: ' + formatarDistancia(rota.distanciaTotalMetros), margin + 127, y);
      y += 6;

      doc.setFont('helvetica','normal');
      doc.setTextColor(...MUTED);
      doc.setFontSize(7.4);
      doc.text(gruposFisicos.length + ' paradas físicas  |  ' + linhas.length + ' entregas listadas', margin, y);
      y += 5;
      cabecalhoTabela();
    }

    function novaPaginaSePreciso(altura) {
      if (y + altura <= pageH - 13) return;
      rodapePagina();
      doc.addPage([pageW, pageH], 'portrait');
      cabecalhoPagina();
    }

    function rodapePagina() {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(.25);
      doc.line(margin, pageH - 11, pageW - margin, pageH - 11);
      doc.setTextColor(...MUTED);
      doc.setFont('helvetica','normal');
      doc.setFontSize(7.3);
      doc.text('Gerado pelo ' + APP_NAME, margin, pageH - 7);
      doc.text('Página ' + pagina, pageW - margin, pageH - 7, {align:'right'});
    }

    function linhaTabela(numero, endereco, eta, codigo, obs, indice) {
      const { enderecoLinhas, codigoLinhas, obsLinhas, altura } = medirLinha(endereco, codigo, obs);
      novaPaginaSePreciso(altura);

      // Tabela gradeada e listras suaves, como o modelo de exportação fornecido.
      if (indice % 2 === 1) {
        doc.setFillColor(...GREEN_LIGHT);
        doc.rect(margin, y, contentW, altura, 'F');
      }
      doc.setDrawColor(...LINE);
      doc.setLineWidth(.20);
      doc.rect(margin, y, contentW, altura);
      let x = margin;
      [cols.numero, cols.endereco, cols.eta].forEach(w => {
        x += w;
        doc.line(x, y, x, y + altura);
      });

      doc.setTextColor(...TEXT);
      doc.setFont('helvetica','bold');
      doc.setFontSize(7.4);
      doc.text(String(numero), margin + cols.numero / 2, y + 5.2, {align:'center'});
      doc.setFont('helvetica','normal');
      doc.text(enderecoLinhas, margin + cols.numero + 2, y + 5.1);
      doc.text(String(eta || '—'), margin + cols.numero + cols.endereco + cols.eta/2, y + 5.2, {align:'center'});
      x = margin + cols.numero + cols.endereco + cols.eta;
      doc.setFont('helvetica','bold');
      doc.setFontSize(7.1);
      doc.text(codigoLinhas, x + 2, y + 5.1);
      if (obsLinhas.length) {
        doc.setFont('helvetica','normal');
        doc.setTextColor(...MUTED);
        doc.setFontSize(6.8);
        doc.text(obsLinhas, x + 2, y + 5.1 + 3.8 * codigoLinhas.length);
      }
      y += altura;
    }

    cabecalhoPagina();
    linhas.forEach((item, i) => {
      linhaTabela(i + 1, item.endereco, item.eta, item.codigo, item.obs, i);
    });

    if (pontoFinal) {
      const fim = etas.has('__FINAL__') ? hora(etas.get('__FINAL__')) : '—';
      linhaTabela('F', pontoFinal.descricao || 'Destino final', fim, '', 'Destino final da rota', linhas.length);
    }

    rodapePagina();
    const nomeRota = limparNome(rota.nome || 'Rota');
    const dataNome = limparNome(String(rota.data || '').replaceAll('/', '-'));
    return salvarDocumento(doc, APP_NAME + ' - ' + nomeRota + (dataNome && dataNome !== 'Rota' ? ' - ' + dataNome : '') + '.pdf');
  }

  global.PacoteEMatoPDF = Object.freeze({ exportar });
})(window);
