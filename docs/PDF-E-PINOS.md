# PDF e localização dos imóveis

## Exportação

- **Baixar PDF A4**: páginas de 210 × 297 mm, cabeçalho repetido, texto selecionável e uma linha por pacote. É o formato recomendado para compartilhar, imprimir e experimentar a importação em outro sistema.
- **Baixar PDF em página longa**: mantém todas as entregas em rolagem contínua, até o limite de dimensão do formato PDF. Quando esse limite é excedido, continua em outra página sem cortar entregas.
- Os códigos BR permanecem como texto completo na coluna própria; não são imagens.
- Um leitor de documentos PDF e um importador de rotas têm funções diferentes. Shopee e Rota Ninja podem exigir formatos específicos; a importação nesses aplicativos não foi validada.
- Pacotes sem código não recebem BR inventado. A bipagem depende de códigos existentes e válidos.

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

Use jsPDF 2.5.1 e PDF.js 2.16.105. O teste confere 150 códigos, endereços longos e observações com outro endereço, nos formatos A4 e longo. A quantidade de páginas varia conforme o conteúdo.
