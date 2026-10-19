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

    const blob = doc.output('blob');
    try {
      if (navigator.share && typeof File === 'function') {
        const arquivo = new File([blob], nome, { type: 'application/pdf' });
        if (!navigator.canShare || navigator.canShare({ files: [arquivo] })) {
          await navigator.share({ files: [arquivo], title: nome });
          return { metodo: 'share' };
        }
      }
    } catch (erro) {
      if (erro?.name === 'AbortError') return { metodo: 'cancelado' };
    }

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

  async function exportar(rota) {
    if (!global.jspdf?.jsPDF) throw new Error('Biblioteca de PDF não carregada.');
    if (!rota) throw new Error('Nenhuma rota disponível para exportar.');

    const doc = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageW = 210, pageH = 297, margin = 10;
    const contentW = pageW - margin * 2;
    const cols = { n: 12, endereco: 94, eta: 27, spx: 57 };
    const ordenadas = ordenar(rota);
    const gruposFisicos = agruparParadasFisicas(ordenadas);
    const etas = construirEtas(rota, gruposFisicos);
    let y = 0;
    let pagina = 0;

    function cabecalhoPagina() {
      pagina++;
      y = 0;
      doc.setFillColor(...GREEN_DARK);
      doc.rect(0, 0, pageW, 22, 'F');
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(APP_NAME.toUpperCase(), margin, 9);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(String(rota.nome || 'Rota otimizada'), margin, 15);
      doc.text(`Página ${pagina}`, pageW - margin, 15, { align: 'right' });

      y = 28;
      doc.setTextColor(...TEXT);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`Data: ${dataBr(rota.data)}`, margin, y);
      doc.text(`Distância: ${formatarDistancia(rota.distanciaTotalMetros)}`, margin + 60, y);
      doc.text(`Duração: ${formatarTempo(rota.duracaoTotalSegundos)}`, margin + 125, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(`Sequência exportada conforme a ordem atual da rota${rota.rotaOtimizada ? ' otimizada' : ''}.`, margin, y);
      y += 6;
      cabecalhoTabela();
    }

    function cabecalhoTabela() {
      doc.setFillColor(...GREEN);
      doc.rect(margin, y, contentW, 9, 'F');
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.6);
      let x = margin;
      doc.text('#', x + cols.n/2, y + 5.8, { align: 'center' }); x += cols.n;
      doc.text('ENDEREÇO', x + 2, y + 5.8); x += cols.endereco;
      doc.text('CHEGADA', x + cols.eta/2, y + 5.8, { align: 'center' }); x += cols.eta;
      doc.text('SPX TN', x + 2, y + 5.8);
      y += 9;
    }

    function novaPaginaSePreciso(altura) {
      if (y + altura <= pageH - 12) return;
      doc.addPage();
      cabecalhoPagina();
    }

    function linhaTabela(numero, endereco, eta, spx, nota, indice) {
      doc.setFontSize(7.4);
      const enderecoLinhas = doc.splitTextToSize(String(endereco || ''), cols.endereco - 4);
      const spxLinhas = doc.splitTextToSize(String(spx || ''), cols.spx - 4);
      const notaLinhas = nota ? doc.splitTextToSize(String(nota), cols.endereco - 4) : [];
      const linhas = Math.max(enderecoLinhas.length + notaLinhas.length, spxLinhas.length, 1);
      const h = Math.max(10, 4.1 * linhas + 4);
      novaPaginaSePreciso(h);

      if (indice % 2 === 1) {
        doc.setFillColor(...GREEN_LIGHT);
        doc.rect(margin, y, contentW, h, 'F');
      }
      doc.setDrawColor(...LINE);
      doc.setLineWidth(.25);
      doc.rect(margin, y, contentW, h);
      let x = margin;
      [cols.n, cols.endereco, cols.eta].forEach(w => { x += w; doc.line(x, y, x, y + h); });

      doc.setTextColor(...TEXT);
      doc.setFont('helvetica', 'bold');
      doc.text(String(numero), margin + cols.n/2, y + 6, { align: 'center' });

      x = margin + cols.n;
      doc.setFont('helvetica', 'normal');
      doc.text(enderecoLinhas, x + 2, y + 5.2);
      if (notaLinhas.length) {
        const notaY = y + 5.2 + enderecoLinhas.length * 3.6;
        doc.setTextColor(...MUTED);
        doc.setFontSize(6.7);
        doc.text(notaLinhas, x + 2, notaY);
        doc.setFontSize(7.4);
      }

      x += cols.endereco;
      doc.setTextColor(...TEXT);
      doc.setFont('helvetica', 'normal');
      doc.text(String(eta || '—'), x + cols.eta/2, y + 6, { align: 'center' });

      x += cols.eta;
      doc.setFontSize(6.9);
      doc.text(spxLinhas.length ? spxLinhas : ['—'], x + 2, y + 5.2);
      doc.setFontSize(7.4);
      y += h;
    }

    cabecalhoPagina();
    gruposFisicos.forEach((grupo, index) => {
      const eta = etas.has(grupo.key) ? hora(etas.get(grupo.key)) : '—';
      linhaTabela(index + 1, enderecoCompleto(grupo.parada), eta, grupo.pacotes.join('\n'), observacaoGrupo(grupo), index);
    });

    if (rota.pontoFinal && Number.isFinite(Number(rota.pontoFinal.lat)) && Number.isFinite(Number(rota.pontoFinal.lon))) {
      linhaTabela('F', rota.pontoFinal.descricao || 'Ponto final', etas.has('__FINAL__') ? hora(etas.get('__FINAL__')) : '—', '', 'Destino final após a última entrega (casa/base).', gruposFisicos.length);
    } else if (rota.retornarAoInicio === true && rota.pontoInicial) {
      linhaTabela('F', rota.pontoInicial.descricao || 'Ponto de partida', '—', '', 'Retorno ao ponto de partida após a última entrega.', gruposFisicos.length);
    }

    const totalPacotes = ordenadas.reduce((n,p) => n + (p.pacotes?.length || 0), 0);
    novaPaginaSePreciso(18);
    y += 5;
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(.6);
    doc.line(margin, y, pageW-margin, y);
    y += 5;
    doc.setTextColor(...TEXT);
    doc.setFont('helvetica','bold');
    doc.setFontSize(8);
    doc.text(`${gruposFisicos.length} paradas físicas · ${ordenadas.length} entregas · ${totalPacotes} pacotes`, margin, y);
    doc.setFont('helvetica','normal');
    doc.setTextColor(...MUTED);
    doc.text(`Gerado pelo ${APP_NAME}`, pageW-margin, y, {align:'right'});

    const nomeRota = limparNome(rota.nome || 'Rota');
    return salvarDocumento(doc, `${APP_NAME} - ${nomeRota}.pdf`);
  }

  global.PacoteEMatoPDF = Object.freeze({ exportar });
})(window);
