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
    if (p?.latitude != null && p?.longitude != null && String(p.latitude).trim() && String(p.longitude).trim() && Number.isFinite(lat) && Number.isFinite(lon)) return `coord:${lat.toFixed(5)}|${lon.toFixed(5)}`;
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
    doc.setProperties({ title: APP_NAME + ' - ' + String(rota.nome || 'Rota'),
      subject: 'Route export: Address, Estimated Arrival Time, Notes',
      author: APP_NAME, creator: APP_NAME });
    // Mesma estrutura tabular da referência: A4, margens estreitas,
    // cabeçalho em inglês, observações no endereço e código na coluna Notes.
    const pageW = 210, pageH = 297, margin = 4.233;
    const cols = { numero: 10.3, endereco: 143, eta: 26.3, notas: pageW - margin * 2 - 179.6 };
    const contentW = pageW - margin * 2;
    const BLUE = [30, 112, 249], STRIPE = [229, 239, 255], BORDER = [89, 145, 255];
    const ordenadas = ordenar(rota), grupos = agruparParadasFisicas(ordenadas);
    const linhas = linhasDaRota(ordenadas, construirEtas(rota, grupos));
    let y = 0;

    function medirLinha(item) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.25);
      const endereco = [item.endereco, item.obs].filter(Boolean).join(', ');
      const enderecoLinhas = doc.splitTextToSize(endereco || '—', cols.endereco - 4.8);
      const codigo = String(item.codigo || '').trim();
      // A referência usa BR + oito dígitos e o restante na linha abaixo.
      // O ponto e vírgula termina o código; nenhum caractere é removido.
      const notas = /^BR\d{12}[A-Z0-9]$/i.test(codigo)
        ? [codigo.slice(0, 10), codigo.slice(10) + ';']
        : codigo ? doc.splitTextToSize(codigo + ';', cols.notas - 4.8) : [];
      const altura = Math.max(11.377, Math.max(enderecoLinhas.length, notas.length, 1) * 3.44 + 3);
      return { enderecoLinhas, notas, altura };
    }

    function cabecalhoTabela() {
      const altura = 11.377;
      doc.setFillColor(...BLUE);
      doc.rect(margin, y, contentW, altura, 'F');
      doc.setFont('helvetica','normal');
      doc.setFontSize(8.25);
      doc.setTextColor(255,255,255);
      doc.text('#', margin + cols.numero / 2, y + 6.8, {align:'center'});
      doc.text('Address', margin + cols.numero + cols.endereco / 2, y + 6.8, {align:'center'});
      const chegada = margin + cols.numero + cols.endereco + cols.eta / 2;
      doc.text('Estimated', chegada, y + 4.95, {align:'center'});
      doc.text('Arrival Time', chegada, y + 8.39, {align:'center'});
      doc.text('Notes', pageW - margin - cols.notas / 2, y + 6.8, {align:'center'});
      grade(y, altura);
      y += altura;
    }

    function grade(topo, altura) {
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(.15);
      doc.rect(margin, topo, contentW, altura);
      let x = margin;
      [cols.numero, cols.endereco, cols.eta].forEach(w => {
        x += w; doc.line(x, topo, x, topo + altura);
      });
    }

    // Título e totais só na primeira página; as seguintes repetem a tabela.
    doc.setFont('helvetica','normal');
    doc.setTextColor(0,0,0);
    doc.setFontSize(15);
    const titulo = dataBr(rota.data).replaceAll('/', '-') + ' ' + String(rota.nome || 'Rota') + ' - ' + APP_NAME;
    const tituloLinhas = doc.splitTextToSize(titulo, contentW);
    doc.text(tituloLinhas, margin, 9.25);
    const totalY = 9.25 + tituloLinhas.length * 6.35 + 3.2;
    doc.setFontSize(12);
    doc.text('Tempo total: ' + formatarTempo(rota.duracaoTotalSegundos) +
      ' Distância total: ' + formatarDistancia(rota.distanciaTotalMetros), margin, totalY);
    y = Math.max(30.4, totalY + 9.5);
    cabecalhoTabela();

    linhas.forEach((item, indice) => {
      const { enderecoLinhas, notas, altura } = medirLinha(item);
      if (y + altura > pageH - .5) {
        doc.addPage(); y = 0; cabecalhoTabela();
      }
      if (indice % 2 === 1) {
        doc.setFillColor(...STRIPE); doc.rect(margin, y, contentW, altura, 'F');
      }
      grade(y, altura);
      doc.setTextColor(0,0,0);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.25);
      const centro = y + altura / 2 + 1;
      doc.text(String(indice + 1), margin + 2.4, centro);
      const enderecoY = y + (altura - (enderecoLinhas.length - 1) * 3.44) / 2 + 1;
      doc.text(enderecoLinhas, margin + cols.numero + 2.4, enderecoY, {lineHeightFactor: 1.182});
      doc.text(String(item.eta || '—'), margin + cols.numero + cols.endereco + 2.4, centro);
      if (notas.length) {
        const notasY = y + (altura - (notas.length - 1) * 3.44) / 2 + 1;
        doc.text(notas, pageW - margin - cols.notas + 2.4, notasY, {lineHeightFactor: 1.182});
      }
      y += altura;
    });
    return salvarDocumento(doc, APP_NAME + ' - ' + limparNome(rota.nome || 'Rota') + '.pdf');
  }

  global.PacoteEMatoPDF = Object.freeze({ exportar });
})(window);
