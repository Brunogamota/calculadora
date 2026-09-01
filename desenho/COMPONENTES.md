# Componentes que entraram no desenho

Lista de tudo que você mandou, na ordem em que chegou, com o que foi feito de cada um. Serve para o implementador saber quais componentes instalar e o que foi adaptado antes de entrar no desenho.

Regra que valeu para todos: entrou a mecânica, não o acabamento. Cor fora da paleta foi substituída, fonte foi substituída, texto de demonstração foi descartado, e dependência nova só entrou quando não havia caminho em CSS.

---

## 1. Glass checkout card

Recebido como código. `framer-motion`.

Cartão de pagamento em vidro fosco com blur, sombra roxa e três botões de carteira. Não virou interface da Reborn: virou a tela de pagamento da loja auditada, dentro da moldura do navegador do robô. Ali o visual estranho ao nosso é o que prova que aquilo é o site de outra pessoa. Traduzido para português e reais; os dois botões "Pay" ficaram em inglês de propósito e viraram achado.

No arquivo final ele não aparece — a execução mostra o slot de screencast, não uma loja desenhada, por decisão sua. Fica registrado caso volte.

## 2. Sign-up com captura progressiva

Recebido como código. `framer-motion`, `canvas-confetti`, `class-variance-authority`.

Um campo por vez, seta que aparece quando o campo fica válido, caminho de volta sempre visível, indicador de passo. Essa mecânica é a captura de dados do resultado: nome, WhatsApp, e-mail, faixa de faturamento.

Descartado: vidro fosco, blobs de gradiente animados, sombra colorida, título serifado, confete, e o botão de vidro com borda cônica.

## 3. Scroll expansion hero

```
npx shadcn@latest add "https://21st.dev/r/arunachalam/scroll-expansion-hero"
```

Duas tentativas. A primeira virou revelação por seção: cada seção da landing entra a 94% de escala, com canto arredondado e opacidade parcial, e abre até encostar nas bordas. Essa ficou. A segunda transformava o herói num card que cresce com o scroll; você pediu para voltar e ela saiu.

O mecanismo do componente original não entrou: ele sequestra a roda do mouse e força `window.scrollTo(0, 0)`, o que quebra o botão de voltar, o teclado e o gesto de rolar no celular. O efeito no desenho é calculado a partir da posição real de cada seção e escrito direto no elemento, sem redesenhar a página.

## 4. Placeholders and vanish input

```
npx shadcn@latest add "https://21st.dev/r/aghasisahakyan1/animated-search-1"
```

Campo do herói. Placeholder que troca a cada três segundos e texto que se desintegra em partículas ao enviar, desenhado em `<canvas>`. Os placeholders são endereços de loja de verdade, não perguntas soltas, então ensinam o formato esperado.

Adaptado: a seta fica cinza até o endereço ficar válido e vira rosa quando dá para enviar; a validação roda antes da animação, para endereço inválido não desintegrar à toa. `aria-label` no campo e no botão, que o original não tinha na versão de pílula.

## 5. Gooey search bar

Recebido como código. Filtro SVG `feGaussianBlur` + `feColorMatrix` + `feComposite`.

É o formato do campo do herói: pílula escura com o botão circular destacado ao lado, os dois sob o filtro, se esticando quando se aproximam. Os dois corpos precisam ser da mesma cor para a fusão funcionar — por isso a única cor é a seta.

## 6. Button with icon

Recebido como código, mais o `button.tsx` do shadcn.

Nove botões do desenho: pílula com círculo claro à direita que desliza para a esquerda e gira 45 graus no hover. O deslocamento é proporcional ao diâmetro de cada botão, não um valor fixo, senão o círculo é cortado nos botões grandes.

Precisou de duas regras de CSS, porque o movimento do círculo depende do hover do elemento pai e isso não existe em estilo inline.

## 7. Safari frame

Recebido como código. SVG estático da magicui.

Moldura de navegador nas telas de execução: barra branca de 52px, três círculos cinza, ícone de barra lateral, setas de voltar e avançar, endereço em pílula com cadeado, e compartilhar, nova aba e abas à direita.

Adaptado: a pílula de endereço encolhe com `flex` e trunca a URL com reticências em vez de empurrar os ícones para fora. Nas larguras de celular a barra volta ao formato compacto — oito elementos na horizontal em 390px viram ruído.

## 8. Stepper vertical

Recebido como código, duas versões.

Painel de etapas da execução. Círculo de 24px ligado por traço: número em cinza quando está na fila, rosa com anel girando quando está rodando, preto com check e o tempo ao lado quando concluiu. O traço fica preto no trecho percorrido.

Adaptado: o concluído usa o escuro da marca, não o verde da referência. Verde seria uma quarta cor.

## 9. Progress bar

Recebido como código. Radix.

Barra sobre o painel de etapas. Trilho em rosa a 20% e indicador em rosa cheio, com a mesma mecânica do original: largura total com `translateX` negativo, então ele desliza em vez de esticar.

## 10. Progress circle e radial

```
npx shadcn@latest add "https://21st.dev/r/sean0205/progress-1"
```

Geometria do anel da nota: `radius = (size - strokeWidth) / 2`, rotação de -90 graus para começar no topo, `stroke-linecap` arredondado.

## 11. Animated counter

Recebido como código. Digit roll com `useSpring`.

A nota conta de zero até sessenta e um em 1,6 segundos quando o card entra na tela, junto com o preenchimento do anel.

Adaptado: contagem simples em vez de rolagem de dígito, e o valor final fica na marcação. Se a animação não rodar, a nota certa continua na tela em vez de aparecer zero.

## 12. Vo2 Max card

Recebido como código.

De lá veio o trilho segmentado atrás do arco, `stroke-dasharray: 7 11` com ponta arredondada, e o veredito em uma palavra dentro do círculo, abaixo do número.

## 13. Interactive checkout

Recebido como código. `@number-flow/react`.

Carrinho da loja auditada dentro do navegador: lista de produtos à esquerda, painel de carrinho à direita com quantidade, remover, total e botão de finalizar. Rendeu evidência — o carrinho fecha com total e botão de finalizar sem mencionar nenhuma forma de pagamento, que é o achado crítico número um.

Como o item 1, não aparece no arquivo final por causa da decisão de usar slot de screencast.

## 14. Animated loading skeleton

Recebido como código.

Esqueleto de espera do primeiro frame: grade de cards com bloco de imagem e duas linhas pulsando, e a lupa flutuando entre posições da grade num loop de nove segundos com halo pulsante.

Adaptado: halo rosa, não azul, e a grade tem geometria de vitrine de e-commerce — que é o que o robô está carregando naquele momento. Um aviso explícito diz que aquilo não é a loja da pessoa; um esqueleto realista demais viraria mentira.

## 15. Hover play card

Recebido como código.

Tela de gravação: player com overlay de play, badge de estado no canto, controles no rodapé branco do card.

Acrescentado ao original: a linha do tempo indexada. Os sete passos viram marcas cinza e os cinco achados viram alfinetes rosa, cada um levando ao segundo em que o problema apareceu. O vídeo deixa de ser reprodução e vira índice.

## 16. Multi-state badge

Recebido como código. `motion`.

Badges de estado passaram a carregar o ícone do próprio estado: anel girando em "análise em andamento", X em "seguindo sem imagem" e no achado de bloqueio.

Etiquetas de severidade continuam sem ícone. Elas aparecem doze vezes, quase sempre empilhadas, e um ícone em cada uma vira textura. O que distingue estado de severidade é isso: badge de estado se move, etiqueta de severidade não.

## 17. Shining text

Recebido como código. `motion/react`.

Gradiente varrendo o texto da direita para a esquerda em 2,6 segundos, contínuo, com `background-clip: text`. Nos heróis e nos títulos de execução.

Adaptado: a base do gradiente é `#5C5A63`, não o cinza claro do original. Com a base clara o título ficava mais fraco que o próprio parágrafo abaixo dele e reprovava em contraste.

Não colocado no veredito do resultado nem nos rótulos: o efeito lê como "ainda carregando", e numa tela que já entregou a nota isso diria a coisa errada.

## 18. Bento product features

```
npx shadcn@latest add "https://21st.dev/r/kavikatiyar/bento-product-features"
```

Grade dos sete itens que o robô verifica. Fundo escuro, cards claros, raio de 16, título centrado com subtítulo.

Reposicionada com `grid-template-areas` para não sobrar espaço morto:

```
loja      produto   meios
carrinho  checkout  meios
celular   fatura    fatura
```

Nove células, sete cards. Três arranjos: três colunas acima de 900px, duas entre 560 e 900, uma abaixo de 560.

Os spans de duas colunas e duas linhas do original não entraram na primeira tentativa porque, com sete blocos e largura variável, eles só fecham em exatamente três colunas — em duas, o bloco largo é empurrado para baixo e abre um buraco.

## 19. Glowing effect

Recebido como código. `motion/react`.

Borda com brilho seguindo o cursor nos cards da grade. Feito em CSS puro, sem dependência nova: um `@property --rbA` registrado para o ângulo ser interpolável, um `::after` com cônico mascarado por `mask-composite`, e um ouvinte de ponteiro que só escreve duas variáveis.

O gradiente original tem rosa, dourado, verde e azul. Substituído por `#E8386A` em três opacidades mais um cinza translúcido, mantendo só a rotação.

Responde a mouse, dedo e teclado — os cards têm `tabindex` e o anel acende no foco. Com `prefers-reduced-motion` ativo, o `::after` não existe e o ouvinte não é registrado.

## 20. Badge 2

Recebido como código. `radix-ui`, `class-variance-authority`.

Etiquetas de severidade: pílula preenchida, texto branco, peso 600, altura de 24px. Crítico em `#E8386A`, atenção em `#16151A`.

As cinco variantes do original trazem verde, amarelo, violeta e vermelho. Aqui existem duas severidades e nenhuma cor nova.

---

## Dependências

Nada foi instalado. Todo efeito acima está no arquivo de desenho em CSS e JavaScript sem biblioteca. Se o front for implementar com as bibliotecas originais, as que apareceram nos componentes que você mandou são: `framer-motion` ou `motion`, `class-variance-authority`, `radix-ui`, `canvas-confetti`, `@number-flow/react`, `lucide-react`, `tailwind-merge` e `clsx`.

O único caso em que eu recomendaria instalar é o `framer-motion`, se o time já usa. Os outros resolvem em CSS.
