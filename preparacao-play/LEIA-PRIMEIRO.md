# Sobre os arquivos desta branch de TESTES

**Branch proposta para revisão, não implantar nem mesclar ainda.** As alterações web estão em `index.html`, `js/app.js` e `js/assinatura-google-play.js`; os arquivos do servidor estão em `preparacao-play/worker/`. O projeto Android modificado está no ZIP de preparação entregue separadamente e **não** foi enviado para este repositório web. As instruções abaixo descrevem o pacote completo; onde aparecer `worker/`, neste repositório leia `preparacao-play/worker/`. Não ativar `PEMATO_PLAY_CONFIG` nem publicar o Worker enquanto os bloqueios de login/Firebase e a migração de cortesias não forem resolvidos.

---

# Pacote É Mato — implementação de preparação da assinatura Google Play

Data da preparação: 04/11/2026. **NÃO PUBLICAR ESTA VERSÃO AINDA.**

## Regras confirmadas com o proprietário

1. O aplicativo inteiro exige acesso válido, sem funções Premium separadas.
2. Assinatura: **R$ 19,90/mês** (`pacote_emato_premium`, plano `mensal`).
3. Usuários elegíveis recebem **14 dias gratuitos**, através da oferta `teste-gratis-14d` confirmada pela Play Store.
4. Quem cancelar pelo Google Play mantém acesso somente enquanto tiver direito confirmado pela Play.
5. O proprietário pode conceder **cortesias de N dias** manualmente por usuário, sem assinatura.
6. Quando nem a assinatura nem a cortesia estiverem válidas, o aplicativo apresenta a assinatura.
7. A cortesia **não altera** o calendário de cobranças de uma assinatura Google Play existente.

## O que foi preparado em código

### Android Studio (`android/`)

- `GooglePlayAssinatura.kt`: checkout nativo pela Google Play, seleciona a oferta de 14 dias quando elegível; se não disponível, usa o plano mensal base. Confere compras existentes.
- `PlaySubscriptionApi.kt`: envia Firebase ID token e comprovante exclusivamente pelo código nativo, para verificação no Worker. Não guarda credenciais Play no APK.
- `MainActivity.kt`: ponte `Android.iniciarAssinaturaGooglePlay()`; busca a sessão Firebase da página principal, confere o login no Worker, chama a compra e envia o token da compra para verificação.
- `app/build.gradle.kts`: **`PLAY_ASSINATURA_ATIVA=false` e URL vazia nos três builds**. Assim nenhuma cobrança real é ativada por acidente.

### Site de testes (`web/`)

- Tela de assinatura única, com texto R$19,90/mês e 14 dias grátis para elegíveis, sem opções semanais/trimestrais/Pix na tela de acesso.
- `js/assinatura-google-play.js`: consulta `/api/access/status` autenticado e inicia a compra somente via Android nativo.
- `js/app.js`: habilitado somente se `PEMATO_PLAY_CONFIG.enabled=true`, usa o Worker para decidir se assinatura ou cortesia ainda estão válidas; mantém validações de bloqueio de conta/dispositivo.
- Modo Dono preparado para conceder dias pelo UID Firebase e mostrar as cortesias concedidas, quando o novo backend for ativado.
- **A configuração `enabled:false` permanece.** Não existe tela de compra operacional até que o servidor e a Play sejam validados.

### Cloudflare Worker (`worker/`)

- Autentica sessão Firebase via assinatura JWT pública do Google.
- Valida compra pela `purchases.subscriptionsv2.get`, produto, plano e UID ofuscado; associa cada purchaseToken exclusivamente a uma conta.
- Confirma (ACK) compra elegível com a API do Google Play; acesso somente após verificação.
- Mantém estados de assinatura/cancelamento/expiração e cortesia separados no D1.
- Expõe `/api/access/status`, `/api/play/verify`, `/api/admin/grant-days`, `/api/admin/grants`, `/api/admin/revoke-grant` e `/api/play/rtdn`.
- O RTDN só aceita token OIDC válido da conta de serviço Pub/Sub configurada.
- O administrador é autorizado por `ADMIN_FIREBASE_UIDS`, valor que deve ser definido explicitamente no Worker.
- `schema.sql` define as tabelas D1. O **D1 de testes não deve virar D1 de produção**.

## Validação feita

Executado localmente:

```sh
node --test worker/test/*.test.mjs
```

**24 testes passaram**, incluindo acesso por cortesia, login autenticado, conta administrativa, revogação de cortesia, compra, token de outra conta, estados de cancelamento e RTDN.

**Não foi possível compilar o Android.** O ambiente não dispõe da distribuição Gradle 9.6.0 em cache nem permite baixá-la. Além disso, o projeto sanitizado não tem `google-services.json`, Android SDK configurado ou chave privada de assinatura. A compilação e os testes no dispositivo/Play Console continuam obrigatórios.

## Pendências impeditivas de publicação

### 1. Recuperar o login com segurança

As regras Firestore que o proprietário mostrou como ativas em 04/11/2026 citam coleções do **MB Referências** mas não `/usuarios` do Pacote É Mato. O login antigo busca o usuário pelo WhatsApp **antes** da autenticação, gerando erro de leitura. Não restaurar `allow get: if true` como solução permanente, pois expõe o documento inteiro (inclusive um possível campo legado `senha`). É necessário migrar a descoberta da conta para o Worker ou criar login Google seguro, e só então aplicar regras unificadas apropriadas.

### 2. Concluir o login Google para todas as contas

Os arquivos recebidos já contêm vínculo e pré-verificação de login Google, mas ainda há dependência de WhatsApp/senha e de documentos `usuarios/{whatsapp}`. O cadastro de contas novas com Google e a migração de contas existentes devem ser implementados/testados **sem trocar UID nem perder histórico**.

### 3. Migrar cortesias e contas antigas

O Modo Dono atual escreve `expiraEm` e `ativo` diretamente no Firestore. O novo backend de assinatura usa `manual_grants` em D1. Antes da ativação, migrar os acessos ainda válidos de forma auditável, preservando o UID, o vencimento e contas vitalícias legítimas. **Não ativar o bloqueio até conferir os usuários migrados.**

### 4. Configurar Google Play Console e serviços

- Criar/confirmar assinatura `pacote_emato_premium`, plano `mensal` de R$ 19,90 no Brasil e oferta `teste-gratis-14d` de 14 dias para elegíveis. Ativar produto e oferta.
- Conceder ao **serviço de backend** acesso mínimo adequado à Google Play Developer API. Guardar `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` como **secret** do Worker, nunca no site ou no Android.
- Criar D1 separado, aplicar `worker/schema.sql`, configurar `wrangler.example.toml`, `ADMIN_FIREBASE_UIDS`, `FIREBASE_PROJECT_ID`, `PUBSUB_AUDIENCE` e a conta de push autenticado Pub/Sub.
- Configurar RTDN (Pub/Sub) e validar renovação, cancelamento, suspensão, reembolso e vencimento. Testar recursos de reprocessamento/idempotência.
- Confirmar o endereço definitivo do Worker. Só então preencher `PLAY_SUBSCRIPTION_API_URL` e alterar o sinalizador `PLAY_ASSINATURA_ATIVA` do Android para `true` em uma build **de teste interno** e, posteriormente, em release.
- No site, ajustar `window.PEMATO_PLAY_CONFIG` para `enabled:true` e `apiBase` HTTPS **somente depois de o Worker estar funcionando**.
- Descontinuar/ocultar cobranças Pix de conteúdo digital no aplicativo distribuído pela Play, incluindo os endpoints de pagamento antigos expostos na interface, antes da publicação.
- Fazer o teste de compra em uma build distribuída pelo Google Play com o mesmo `applicationId` do app (`com.pacoteemato.app`), contas de teste, pacote assinado e versão em uma faixa de testes.
- Revisar ficha da loja, política de privacidade, declaração de dados e termos da assinatura. Gerar novo **AAB assinado** com a chave já registrada no Play Console.

### 5. Confirmar o código vivo antes de atualizar serviços

Esta preparação foi feita em **cópias dos ZIPs enviados**. O código de Worker recebido em Markdown não comprova ser exatamente o que está publicado em Cloudflare. Foi possível **ler** o repositório de testes `joaovitor250p-cloud/pacote-mato-teste22` e conferir que o `index.html` remoto recebeu alterações depois do ZIP; as mudanças foram preservadas no planejamento. Ao tentar criar uma branch de preparação, a integração GitHub retornou **403: Resource not accessible by integration**. Portanto, **nenhuma branch, commit ou pull request foi criado** e o GitHub permaneceu inalterado. Antes de qualquer deploy, comparar com o código atual no GitHub, Cloudflare e Firebase. Nunca sobrescrever regras ou Workers de produção com arquivos de teste.

## Diferença entre cobrança e cortesia

| Caso | Acesso | Cobrança |
|---|---|---|
| Teste grátis confirmado pela Play | Sim durante período de elegibilidade | Começa após 14 dias se não houver cancelamento |
| Assinatura Google Play ativa | Sim | Cobrança mensal normal |
| Cortesia concedida pelo Modo Dono | Sim até a data cadastrada | Não cria cobrança na Play |
| Cancelou a Play e ainda tem período contratado | Sim até o vencimento | Não há renovação futura |
| Nenhuma autorização válida | Tela de assinatura | Só cobra se usuário confirmar compra pela Play |

**Resumo:** o código de preparação está disponível e os testes do Worker passaram; a publicação com cobrança real continua bloqueada até concluir a migração de login/acessos, configurações das contas e testes na Google Play.
