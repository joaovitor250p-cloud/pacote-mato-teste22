# PDF e localização dos imóveis

## Exportação

Existe uma única opção: **Baixar PDF da rota**.

O arquivo usa a estrutura do PDF de referência enviado pelo usuário: A4 retrato, margens estreitas, tabela azul com linhas alternadas, colunas `#`, `Address`, `Estimated Arrival Time` e `Notes`. O título e os totais ficam na primeira página; as seguintes repetem apenas o cabeçalho da tabela. O documento mantém o nome Pacote É Mato.

Cada pacote ocupa uma linha. As observações acompanham o endereço. Códigos BR válidos são divididos em `BR + oito dígitos` e `cinco caracteres + ;`, como na referência. Nenhum código é inventado. A paginação continua até a última entrega, sem limite de 22 registros no documento inteiro.

Com endereços curtos, 132 entregas geram seis páginas: 22 registros na primeira e até 25 nas seguintes. Conteúdo maior pode aumentar a altura das linhas e a quantidade de páginas.

A leitura de volta no próprio app foi validada com PDF.js e com Chromium. Shopee e Rota Ninja podem ter regras internas adicionais; o teste nesses aplicativos ainda é necessário. Esta implementação reproduz a estrutura da tabela e não usa o software do Circuit.

## Localização

Sugestões que representam apenas rua, bairro ou cidade não confirmam um imóvel. A confirmação exige coordenadas válidas, número correspondente, semelhança de logradouro e município correspondente quando disponível. Endereços que não forem confirmados permanecem pendentes.

Sugestões antigas sem confirmação do imóvel são revalidadas ao carregar a rota. O cache não pode reintroduzir uma sugestão aproximada como endereço confirmado. Endereços iguais em municípios distintos não compartilham o mesmo agrupamento de marcador.

## Validação

Testes locais sem dependências externas:

```
node tests/pinos-endereco.test.cjs
node tests/pdf-multipaginas.test.cjs
node tests/pdf-rota.test.cjs
node tests/marcadores.test.cjs
node tests/identidade-fluxo.test.cjs
```

Teste de exportação e reimportação com as bibliotecas reais usadas pelo app:

```
PEMATO_JSPDF_PATH=/caminho/jspdf.umd.min.js \
PEMATO_PDFJS_PATH=/caminho/pdf.min.js \
PEMATO_PDFJS_WORKER_PATH=/caminho/pdf.worker.min.js \
node tests/pdf-roundtrip.test.cjs
```

Use jsPDF 2.5.1 e PDF.js 2.16.105. O teste confere 150 códigos, endereços longos e observações com outro endereço, no formato A4 da referência. A quantidade de páginas varia conforme o conteúdo.
