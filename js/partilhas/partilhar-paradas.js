(function moduloPartilharParadas(global) {
  'use strict';
  const COLLECTION = 'partilhasParadas';
  const KEY_PENDING = 'pemato_partilhas_pendentes_v1';
  const EXPIRACAO_DIAS = 7;
  let tipo = 'enviar', rota = null, partilha = null, preview = null;
  let escolhidas = new Set(), scanner = null, unsubscribe = null, ocupado = false, sincronizando = false;
  const $ = id => document.getElementById(id);
  const alertar = mensagem => { global.notificar?.(mensagem); };
  const auth = () => global.firebase?.auth?.().currentUser;
  const banco = () => global.firebase?.firestore?.();
  const escapar = text => String(text ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const idDaRota = r => String(r?.id || '');
  const clone = value => JSON.parse(JSON.stringify(value));
  const titulo = p => String(p?.enderecoOriginal || p?.enderecoFonte || [p?.logradouro,p?.numero].filter(Boolean).join(', ') || 'Endereço não informado');
  const qtd = p => Math.max(Array.isArray(p?.pacotes) ? p.pacotes.length : 0, Math.max(0,Math.round(Number(p?.quantidadePacotes)||0)));
  const concluida = p => ['entregue','concluida','nao_entregue'].includes(String(p?.statusEntrega || ''));
  const paradaId = p => String(p?.id || '');
  const rootUrl = () => global.location.origin + global.location.pathname;
  const urlPartilha = id => rootUrl() + '?partilha=' + encodeURIComponent(id);
  const status = (texto,erro=false) => {
    const node=$('pematoShareStatus');if(node){node.textContent=texto||'';node.dataset.error=erro?'true':'false';}
  };
  function pendentesLidos() {
    try { const obj=JSON.parse(global.localStorage.getItem(KEY_PENDING)||'[]');return Array.isArray(obj)?obj:[]; }
    catch (_) {return [];}
  }
  function pendentesGravar(list) { try {global.localStorage.setItem(KEY_PENDING,JSON.stringify(list.slice(-50)));}catch(_){} }
  function estaLogado() {
    if (!banco() || !auth()) {
      status('Entre na sua conta do Pacote É Mato para enviar ou receber paradas.',true);
      return false;
    }
    return true;
  }
  function fecharEscolhas() {
    ['routingPackagesChooserBackdrop','navPackagesChooserBackdrop'].forEach(id=>{
      const el=$(id);if(el)el.style.display='none';
    });
  }
  function exibir(modalidade) {
    fecharEscolhas();
    tipo=modalidade==='receber'?'receber':'enviar';
    if (!$('pematoShareBackdrop')) construirTela();
    $('pematoShareBackdrop').hidden=false;
    $('pematoShareBackdrop').style.display='flex';
    $('pematoShareSend').hidden=tipo!=='enviar';
    $('pematoShareReceive').hidden=tipo!=='receber';
    $('pematoShareTitle').textContent=tipo==='enviar'?'Partilhar paradas':'Receber paradas';
    $('pematoShareStatus').textContent='';
    $('pematoShareResult').hidden=true;
    $('pematoSharePreview').hidden=true;
    $('pematoShareReceipt').hidden=true;
    $('pematoShareCode').value='';
    $('pematoShareUrl').value='';
    if(tipo==='enviar') prepararEnvio(); else {
      const parametro=new URLSearchParams(global.location.search).get('partilha');
      if (parametro) { $('pematoShareCode').value=urlPartilha(parametro); buscarRecebimento(parametro); }
    }
  }
  function fechar() {
    pararScanner();
    const el=$('pematoShareBackdrop');if(el){el.hidden=true;el.style.display='none';}
  }
  function construirTela() {
    const modal=document.createElement('div');
    modal.id='pematoShareBackdrop';
    modal.className='pemato-share-backdrop';
    modal.hidden=true;
    modal.innerHTML=String.raw`
      <section class="pemato-share-card" role="dialog" aria-modal="true" aria-labelledby="pematoShareTitle">
        <header class="pemato-share-head"><div><small>PACOTE É MATO</small><h2 id="pematoShareTitle">Partilhar paradas</h2></div>
          <button id="pematoShareClose" aria-label="Fechar" type="button">×</button></header>
        <p id="pematoShareStatus" class="pemato-share-status" role="status"></p>
        <div id="pematoShareSend">
          <div id="pematoShareSelect">
            <p>Escolha as paradas pendentes que outro entregador vai receber. Códigos BR iguais continuam em registros separados.</p>
            <div class="pemato-share-toolbar"><button id="pematoShareAll" type="button">Selecionar todas</button>
              <button id="pematoShareNone" type="button">Limpar seleção</button></div>
            <div class="pemato-share-list" id="pematoShareStops"></div>
            <div class="pemato-share-summary" id="pematoShareSummary">0 paradas selecionadas</div>
            <button id="pematoShareContinue" class="pemato-share-primary" type="button">Concluir seleção</button>
          </div>
          <div id="pematoShareOptions" hidden>
            <h3>Depois que o outro entregador receber:</h3>
            <label class="pemato-share-choice"><input type="radio" name="pematoShareHandling" value="manter" checked>
              <span><strong>Manter as paradas na minha rota</strong><small>Nenhuma entrega será retirada.</small></span></label>
            <label class="pemato-share-choice"><input type="radio" name="pematoShareHandling" value="retirar">
              <span><strong>Retirar as paradas partilhadas</strong><small>Só após o destinatário confirmar o recebimento; as demais continuam na rota.</small></span></label>
            <div class="pemato-share-actions"><button id="pematoShareBack" type="button">Voltar</button>
              <button id="pematoShareGenerate" class="pemato-share-primary" type="button">Gerar QR Code e link</button></div>
          </div>
          <div id="pematoShareResult" hidden>
            <p>O destinatário deve entrar na própria conta e ler o QR ou abrir o link. A partilha expira em 7 dias.</p>
            <div class="pemato-share-qr" id="pematoShareQr"></div>
            <label for="pematoShareUrl">Link da partilha</label>
            <input id="pematoShareUrl" class="pemato-share-url" type="text" readonly>
            <div class="pemato-share-actions"><button id="pematoShareCopy" type="button">Copiar link</button>
              <button id="pematoShareDownload" type="button">Baixar QR Code</button>
              <button id="pematoShareSendLink" type="button">Enviar link</button></div>
            <p class="pemato-share-note">Quem tiver o link e uma conta poderá visualizar os endereços. Envie apenas à pessoa responsável.</p>
            <div id="pematoShareReceipt" class="pemato-share-receipt" hidden></div>
          </div>
        </div>
        <div id="pematoShareReceive" hidden>
          <p>Leia o QR Code do outro entregador ou cole o link. Confira os pacotes antes de importar.</p>
          <button id="pematoShareScan" class="pemato-share-primary" type="button">Ler QR Code pela câmera</button>
          <div id="pematoShareQrReader" hidden></div>
          <label for="pematoShareCode">Link ou código da partilha</label>
          <div class="pemato-share-actions"><input id="pematoShareCode" placeholder="Cole o link aqui" type="text">
            <button id="pematoShareFind" type="button">Conferir</button></div>
          <div id="pematoSharePreview" hidden>
            <div id="pematoSharePreviewBody"></div>
            <button id="pematoShareAccept" class="pemato-share-primary" type="button">Confirmar recebimento das paradas</button>
          </div>
        </div>
      </section>`;
    document.body.appendChild(modal);
    const bind=(id,fn)=>$(id)?.addEventListener('click',fn);
    bind('pematoShareClose',fechar);
    modal.addEventListener('click',ev=>{if(ev.target===modal)fechar();});
    bind('pematoShareAll',()=>{escolhidas=new Set(rota?.paradas?.filter(p=>!concluida(p)).map(paradaId)||[]);renderizarEscolhas();});
    bind('pematoShareNone',()=>{escolhidas.clear();renderizarEscolhas();});
    bind('pematoShareContinue',()=>{if(!escolhidas.size){status('Selecione pelo menos uma parada.',true);return;} $('pematoShareSelect').hidden=true;$('pematoShareOptions').hidden=false;status('');});
    bind('pematoShareBack',()=>{$('pematoShareSelect').hidden=false;$('pematoShareOptions').hidden=true;});
    bind('pematoShareGenerate',gerarPartilha);
    bind('pematoShareCopy',()=>copiarLink());
    bind('pematoShareDownload',baixarQRCode);
    bind('pematoShareSendLink',enviarLink);
    bind('pematoShareScan',escanear);
    bind('pematoShareFind',()=>buscarRecebimento($('pematoShareCode').value));
    bind('pematoShareAccept',receberPartilha);
  }
  async function prepararEnvio() {
    if(!estaLogado())return;
    rota=await global.PacoteEMatoRotaStore?.obterRotaAtiva?.();
    escolhidas=new Set();
    $('pematoShareSelect').hidden=false;$('pematoShareOptions').hidden=true;
    if(!rota?.paradas?.length){status('Você ainda não tem paradas em uma rota ativa.',true);$('pematoShareStops').replaceChildren();return;}
    renderizarEscolhas();
  }
  function renderizarEscolhas() {
    const host=$('pematoShareStops');host.replaceChildren();
    const ordem=new Map((rota?.ordem||[]).map((id,i)=>[String(id),i+1]));
    const linhas=(rota?.paradas||[]).filter(p=>!concluida(p));
    linhas.sort((a,b)=>(ordem.get(paradaId(a))||999999)-(ordem.get(paradaId(b))||999999));
    linhas.forEach(p=>{
      const label=document.createElement('label');label.className='pemato-share-stop';
      const input=document.createElement('input');input.type='checkbox';input.checked=escolhidas.has(paradaId(p));
      input.addEventListener('change',()=>{if(input.checked)escolhidas.add(paradaId(p));else escolhidas.delete(paradaId(p));atualizarTotal();});
      const body=document.createElement('span');body.innerHTML=`<strong>Parada ${ordem.get(paradaId(p))||'—'}</strong><small>${escapar(titulo(p))}</small><em>${qtd(p)} pacote(s) · ${escapar((p.pacotes||[]).slice(0,2).join(' · '))}</em>`;
      label.append(input,body);host.append(label);
    });
    atualizarTotal();
  }
  function atualizarTotal() {
    const selecionadas=(rota?.paradas||[]).filter(p=>escolhidas.has(paradaId(p)));
    $('pematoShareSummary').textContent=selecionadas.length+' parada(s) · '+selecionadas.reduce((s,p)=>s+qtd(p),0)+' pacote(s)';
  }
  function limparParadaParaEnvio(p) {
    const cp=clone(p);
    // Dados de autenticação, proprietário e controle interno nunca são partilhados.
    ['usuario','authUid','usuarioId','uid','email','telefoneUsuario','deviceId','token','senha'].forEach(key=>delete cp[key]);
    return cp;
  }
  function configurarUrl(id) {const url=urlPartilha(id);$('pematoShareUrl').value=url;return url;}
  async function gerarPartilha() {
    if(ocupado||!estaLogado()||!rota)return;
    const selected=rota.paradas.filter(p=>escolhidas.has(paradaId(p))&&!concluida(p));
    if(!selected.length){status('Nenhuma parada pendente selecionada.',true);return;}
    if(selected.length>150){status('Divida a seleção em grupos de até 150 paradas.',true);return;}
    const payload=selected.map(limparParadaParaEnvio);
    if(JSON.stringify(payload).length>700000){status('A partilha está muito grande. Selecione menos paradas.',true);return;}
    const remocao=$('pematoShareOptions').querySelector('input[name=pematoShareHandling]:checked')?.value==='retirar';
    ocupado=true; $('pematoShareGenerate').disabled=true;status('Criando partilha segura...');
    try{
      const ref=banco().collection(COLLECTION).doc();
      const now=new Date();
      const data={versao:1,criadorUid:auth().uid,criadorNome:rota.nome||'Rota',
        origemRotaId:idDaRota(rota),origemParadasIds:selected.map(paradaId),modoRemocao:remocao?'retirar':'manter',
        paradasPayload:payload,status:'pendente',
        criadoEm:global.firebase.firestore.FieldValue.serverTimestamp(),
        expiraEm:global.firebase.firestore.Timestamp.fromDate(new Date(now.getTime()+EXPIRACAO_DIAS*86400000))};
      await ref.set(data);
      partilha={id:ref.id,ref,remocao,ids:data.origemParadasIds,origemRotaId:data.origemRotaId};
      const lista=pendentesLidos();
      if(!lista.some(item=>item.id===partilha.id)){lista.push({id:partilha.id,ids:partilha.ids,rotaId:partilha.origemRotaId,remocao,criadoEm:now.getTime()});pendentesGravar(lista);}
      $('pematoShareOptions').hidden=true;$('pematoShareResult').hidden=false;
      const url=configurarUrl(ref.id);
      gerarQR(url);
      observarRecebimento();
      status('Partilha criada. Mostre o QR ou envie o link ao outro entregador.');
    }catch(erro){
      console.error('Pacote É Mato partilhar:',erro);
      status(erro?.code==='permission-denied'?'O Firebase ainda não tem as regras de Partilhar paradas habilitadas. Nenhum dado foi enviado.':'Não foi possível criar a partilha: '+(erro.message||erro),true);
    }finally{ocupado=false;$('pematoShareGenerate').disabled=false;}
  }
  function gerarQR(url) {
    const host=$('pematoShareQr');host.replaceChildren();
    if(typeof global.QRCode!=='function'){host.textContent='QR Code indisponível. Use o botão Copiar link.';return;}
    try{new global.QRCode(host,{text:url,width:220,height:220,colorDark:'#073f2d',colorLight:'#ffffff',
      correctLevel:global.QRCode.CorrectLevel.M});}
    catch(erro){host.textContent='Não foi possível desenhar o QR. Copie o link.';}
  }
  async function copiarLink() {
    const link=$('pematoShareUrl').value;
    try{
      if(global.navigator?.clipboard?.writeText) await global.navigator.clipboard.writeText(link);
      else{$('pematoShareUrl').select();document.execCommand('copy');}
      status('Link copiado.');
    }catch(_){status('Selecione o link e copie manualmente.',true);}
  }
  function baixarQRCode() {
    const host=$('pematoShareQr');const canvas=host.querySelector('canvas'),image=host.querySelector('img');
    const src=canvas?.toDataURL?.('image/png') || image?.src;
    if(!src){status('QR indisponível para baixar. Copie o link.',true);return;}
    const a=document.createElement('a');a.href=src;a.download='Pacote É Mato - QR Partilha '+(partilha?.id?.slice(0,8)||'')+'.png';
    document.body.appendChild(a);a.click();a.remove();status('QR Code pronto para salvar.');
  }
  async function enviarLink() {
    const link=$('pematoShareUrl').value;
    if(global.navigator?.share){
      try{await global.navigator.share({title:'Pacote É Mato · Partilhar paradas',text:'Receba as paradas que compartilhei com você:',url:link});return;}
      catch(e){if(e.name==='AbortError')return;}
    }
    await copiarLink();
    status('Link copiado. Você pode colar no WhatsApp ou em outra conversa.');
  }
  function extrairId(valor) {
    let raw=String(valor||'').trim();
    if(!raw)return '';
    try{const url=new URL(raw,rootUrl());raw=url.searchParams.get('partilha')||raw;}
    catch(_){}
    if(/^[A-Za-z0-9]{18,48}$/.test(raw))return raw;
    return '';
  }
  async function buscarRecebimento(codigo) {
    if(!estaLogado())return;
    const id=extrairId(codigo);
    if(!id){status('Cole um link válido do Pacote É Mato.',true);return;}
    status('Consultando as paradas...');
    try{
      const doc=await banco().collection(COLLECTION).doc(id).get();
      if(!doc.exists)throw Error('Partilha não encontrada ou expirada.');
      const data=doc.data();
      if(data.status!=='pendente')throw Error('Essa partilha já foi recebida.');
      if(data.expiraEm?.toMillis?.()<Date.now())throw Error('Esse link expirou.');
      if(data.criadorUid===auth().uid)throw Error('Abra o link em outra conta para receber.');
      preview={id,data,ref:doc.ref}; pararScanner();
      const paradas=Array.isArray(data.paradasPayload)?data.paradasPayload:[];
      const total=paradas.reduce((s,p)=>s+qtd(p),0);
      const body=$('pematoSharePreviewBody');body.replaceChildren();
      const intro=document.createElement('p');intro.textContent=paradas.length+' paradas e '+total+' pacotes em '+(data.criadorNome||'rota partilhada');body.appendChild(intro);
      const ul=document.createElement('div');ul.className='pemato-share-list';
      paradas.forEach(p=>{const el=document.createElement('div');el.className='pemato-share-stop';el.innerHTML='<span><strong>'+escapar(titulo(p))+'</strong><small>'+qtd(p)+' pacote(s)</small><em>'+escapar((p.pacotes||[]).join(' · ').slice(0,180))+'</em></span>';ul.appendChild(el);});
      body.appendChild(ul);
      $('pematoSharePreview').hidden=false;status('Confira os dados e confirme o recebimento.');
    }catch(e){status(e?.message||'Não foi possível consultar a partilha.',true);$('pematoSharePreview').hidden=true;}
  }
  async function escanear() {
    if(scanner){pararScanner();return;}
    if(typeof global.Html5Qrcode!=='function'){status('Leitor de QR Code indisponível. Cole o link.',true);return;}
    const reader=$('pematoShareQrReader');reader.hidden=false;
    try{
      scanner=new global.Html5Qrcode('pematoShareQrReader');
      await scanner.start({facingMode:'environment'}, {fps:10,qrbox:{width:220,height:220}},
        resultado=>{const id=extrairId(resultado);if(id){$('pematoShareCode').value=resultado;buscarRecebimento(id);}},()=>{});
      $('pematoShareScan').textContent='Parar câmera';
    }catch(e){status('Não foi possível abrir a câmera. Cole o link da partilha.',true);pararScanner();}
  }
  function pararScanner() {
    const atual=scanner;scanner=null;
    if(atual){Promise.resolve(atual.stop?.()).catch(()=>{}).finally(()=>{try{atual.clear?.()}catch(_){}});}
    const reader=$('pematoShareQrReader');if(reader)reader.hidden=true;
    const button=$('pematoShareScan');if(button)button.textContent='Ler QR Code pela câmera';
  }
  function registrosDaRecepcao(paradas,id) {
    return paradas.map((p,i)=>{
      const cp=clone(p);cp.id='partilha-'+id.slice(0,8)+'-'+i+'-'+(global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
      cp.origem='partilha-paradas';cp.partilhaId=id;cp.paradaOriginalId=paradaId(p);
      cp.statusEntrega='pendente';cp.entregueEm=null;cp.naoEntregueEm=null;
      cp.ordemOtimizada=null;cp.criadoEm=Date.now();
      cp.quantidadePacotes=qtd(cp);
      return cp;
    });
  }
  async function receberPartilha() {
    if(ocupado||!preview||!estaLogado())return;
    ocupado=true;$('pematoShareAccept').disabled=true;
    const {id,data,ref}=preview;
    let antes=null,rotaNova=null,salvou=false,confirmou=false;
    try{
      status('Importando paradas...');
      antes=await global.PacoteEMatoRotaStore.obterRotaAtiva();
      const idsExistentes=new Set((antes?.paradas||[]).filter(p=>p.partilhaId===id).map(p=>p.partilhaId));
      if(idsExistentes.size)throw Error('As paradas desta partilha já foram importadas neste aparelho.');
      const novas=registrosDaRecepcao(data.paradasPayload,id);
      rotaNova=antes && !['concluida','arquivada'].includes(antes.status)
        ? clone(antes)
        : global.PacoteEMatoRotaStore.criarRota({nome:'Paradas recebidas',paradas:[],ordem:[]});
      rotaNova.paradas=Array.isArray(rotaNova.paradas)?rotaNova.paradas:[];
      rotaNova.ordem=Array.isArray(rotaNova.ordem)?rotaNova.ordem:[];
      rotaNova.paradas.push(...novas);
      rotaNova.ordem.push(...novas.map(p=>p.id));
      rotaNova.rotaOtimizada=false;rotaNova.precisaRecalculo=true;
      rotaNova.geometria=null;rotaNova.instrucoes=[];rotaNova.pernas=[];
      rotaNova.historicoPartilhas=Array.isArray(rotaNova.historicoPartilhas)?rotaNova.historicoPartilhas:[];
      rotaNova.historicoPartilhas.push({id,tipo:'recebida',em:Date.now(),quantidade:novas.length});
      await global.PacoteEMatoRotaStore.salvarRota(rotaNova,{ativa:true,exigirPersistenciaLocal:true,firestore:false});
      salvou=true;
      // Recebedor confirma somente depois que o armazenamento local devolve sucesso.
      await banco().runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists||snap.data()?.status!=='pendente')throw Error('Outra pessoa já recebeu esta partilha.');
        if(snap.data()?.expiraEm?.toMillis?.()<Date.now())throw Error('A partilha expirou.');
        if(snap.data()?.criadorUid===auth().uid)throw Error('Não é permitido receber sua própria partilha.');
        tx.update(ref,{status:'recebida',recebedorUid:auth().uid,
          recebidoEm:global.firebase.firestore.FieldValue.serverTimestamp()});
      });
      confirmou=true;
      // Recibo confirmado: a cópia LOCAL já existe. O espelhamento remoto
      // é secundário e não pode cancelar um recebimento aceito no servidor.
      try{await global.PacoteEMatoRotaStore.salvarRota(rotaNova,{ativa:true,exigirPersistenciaLocal:true});}
      catch(erroEspelho){console.warn('Partilha recebida; cópia remota pendente',erroEspelho);}
      status('Recebidas '+novas.length+' paradas! Elas já estão na sua rota. Recalcule o trajeto para navegar.');
      $('pematoSharePreview').hidden=true;preview=null;
      global.PacoteEMatoRoteirizacao?.carregarRotaAtiva?.();
      alertar('Paradas recebidas e adicionadas à rota.');
    }catch(e){
      if(!confirmou&&salvou&&antes){
        try{await global.PacoteEMatoRotaStore.salvarRota(antes,{ativa:true,exigirPersistenciaLocal:true});}catch(_){}
      } else if (!confirmou && salvou && !antes) {
        try{await global.PacoteEMatoRotaStore.limparRotaAtiva();}catch(_){}
      }
      status(e?.message||'Não foi possível receber as paradas. Nenhuma remoção foi confirmada.',true);
    }finally{ocupado=false;$('pematoShareAccept').disabled=false;}
  }
  async function retirarRecebidasDoRemetente(meta) {
    const store=global.PacoteEMatoRotaStore;const original=await store?.obterRota?.(meta.rotaId);
    if(!original)throw Error('Rota de origem não está disponível neste aparelho.');
    const ativo=await store.obterRotaAtiva();
    if(ativo?.id!==original.id)throw Error('Abra a rota de origem neste aparelho para concluir a retirada segura.');
    const ids=new Set(meta.ids.map(String));
    const encontradas=(original.paradas||[]).filter(p=>ids.has(paradaId(p)));
    if(encontradas.length!==ids.size)throw Error('Algumas paradas mudaram desde a partilha. Confira a rota antes de remover.');
    if(encontradas.some(concluida))throw Error('Uma parada foi concluída após a partilha; remoção automática suspensa.');
    const novo=clone(original);novo.paradas=novo.paradas.filter(p=>!ids.has(paradaId(p)));
    novo.ordem=(novo.ordem||[]).filter(id=>!ids.has(String(id)));
    novo.rotaOtimizada=false;novo.precisaRecalculo=true;novo.geometria=null;novo.instrucoes=[];novo.pernas=[];
    if(ids.has(String(novo.paradaSelecionadaId||'')))novo.paradaSelecionadaId=novo.ordem[0]||null;
    if(ids.has(String(novo.proximaParadaId||'')))novo.proximaParadaId=novo.ordem[0]||null;
    novo.historicoPartilhas=Array.isArray(novo.historicoPartilhas)?novo.historicoPartilhas:[];
    novo.historicoPartilhas.push({id:meta.id,tipo:'enviada-e-retirada',em:Date.now(),ids:[...ids]});
    await store.salvarRota(novo,{ativa:true,exigirPersistenciaLocal:true});
    return ids.size;
  }
  async function sincronizarRecebidas() {
    if(sincronizando||!auth()||!banco())return;
    sincronizando=true;
    const uid=auth().uid;const lista=pendentesLidos(),manter=[];
    for(const meta of lista){
      try{
        const snap=await banco().collection(COLLECTION).doc(meta.id).get();
        if(!snap.exists){continue;}
        const p=snap.data();
        if(p.criadorUid!==uid){continue;}
        if(p.status!=='recebida'){manter.push(meta);continue;}
        if(meta.remocao){
          try{
            const qtdRemovidas=await retirarRecebidasDoRemetente(meta);
            alertar('Partilha recebida: '+qtdRemovidas+' paradas retiradas da sua rota. Recalcule o trajeto.');
          }catch(e){manter.push(meta);alertar('Partilha recebida, mas as paradas não foram retiradas: '+e.message);continue;}
        }
        if(partilha?.id===meta.id){const el=$('pematoShareReceipt');if(el){el.textContent='Recebimento confirmado pelo outro entregador.'+(meta.remocao?' Paradas retiradas da sua rota.':' Paradas mantidas na sua rota.');el.hidden=false;}}
      }catch(e){manter.push(meta);}
    }
    pendentesGravar(manter);
    sincronizando=false;
  }
  function observarRecebimento(){
    try{unsubscribe?.();}catch(_){}
    if(!partilha?.ref)return;
    unsubscribe=partilha.ref.onSnapshot(snap=>{
      if(snap.exists&&snap.data()?.status==='recebida')sincronizarRecebidas();
    },()=>{});
  }
  function iniciarDaURL() {
    const codigo=new URLSearchParams(global.location.search).get('partilha');
    if(!codigo)return;
    const tentar=()=>{if(auth()){exibir('receber');}else {
      // A página de autenticação preserva a URL; abrir quando o login concluir.
      global.firebase?.auth?.().onAuthStateChanged?.(user=>{if(user)exibir('receber');});
    }};
    if(global.firebase?.apps?.length)tentar();
    else global.setTimeout(tentar,1200);
  }
  function ligar() {
    if(!$('pematoShareBackdrop'))construirTela();
    const ligarBotao=(id,modo)=>$(id)?.addEventListener('click',()=>exibir(modo));
    ligarBotao('routingShareSendBtn','enviar');ligarBotao('routingShareReceiveBtn','receber');
    ligarBotao('navShareSendBtn','enviar');ligarBotao('navShareReceiveBtn','receber');
    iniciarDaURL();
    global.setTimeout(sincronizarRecebidas,1800);
    global.firebase?.auth?.().onAuthStateChanged?.(user=>{if(user)sincronizarRecebidas();});
    global.addEventListener?.('focus',()=>sincronizarRecebidas());
    global.addEventListener?.('pemato:rota:salva',()=>{if(tipo==='enviar'&&$('pematoShareSelect')?.hidden===false&&$('pematoShareBackdrop')?.style.display==='flex'&&!ocupado)prepararEnvio();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ligar,{once:true});
  else ligar();
  global.PacoteEMatoPartilha=Object.freeze({abrir:exibir,fechar,receber:buscarRecebimento,sincronizarRecebidas,
    _teste:Object.freeze({extrairId,registrosDaRecepcao,retirarRecebidasDoRemetente})});
})(window);
