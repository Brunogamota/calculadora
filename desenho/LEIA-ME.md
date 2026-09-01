# Raio-X do Checkout — entrega de desenho

## O que é o desenho final

`Raio-X do Checkout - Desenho.dc.html` é o desenho final. Abre direto no navegador, com duplo clique, e precisa do `support.js` que está do lado dele nesta mesma pasta. Não existe outra versão, outro turno, outro artboard. O que está nesse arquivo é o que vai para produção.

O arquivo não é uma imagem nem uma prancha estática: ele se comporta como o produto. Cola um endereço de loja no campo do herói e a auditoria roda de verdade, com os passos avançando, os achados entrando e o resultado montando no fim. Cada tela abaixo é um estado alcançável dentro dele.

**Landing.** Herói de tela cheia com o campo de endereço, o título com a linha que gira, e abaixo a grade dos sete itens que o robô verifica, os três achados de outras lojas e o bloco da Reborn. Estados do campo: vazio, digitando, endereço inválido, e enviando com o texto se desintegrando.

**Execução.** Aparece logo depois do envio. Contém três estados de imagem que se sucedem sozinhos: primeiro frame ainda não chegou, nos três segundos iniciais; transmissão normal, com o cursor rosa se movendo; e imagem travada, entre treze e dezenove segundos, quando a leitura continua e a imagem não. Entre vinte e dois e vinte e nove segundos aparece a faixa de reconexão, que conta quantos segundos ficaram sem imagem e que o robô continuou trabalhando sem a gente.

**Loja bloqueou o robô.** Digite um endereço que contenha a palavra `bloqueada` e o envio cai nessa tela em vez da execução.

**Conexão caiu.** Digite um endereço que contenha a palavra `queda` e a execução cai nessa tela aos dezesseis segundos.

**Resultado.** Aparece sozinho quando a execução termina. Nota em anel que conta de zero até sessenta e um, primeiro achado aberto com a evidência do carrinho, quatro achados sob tarja, e a captura de dados em quatro passos: nome, WhatsApp, e-mail, faixa de faturamento. Preencher os quatro abre os quatro achados restantes.

**Gravação.** Botão "Ver a gravação" no rodapé do resultado. É a tela de quem recebe o link pelo WhatsApp e não assistiu ao vivo.

## O desenho é a verdade visual do projeto

Este arquivo manda. O trabalho de quem implementa é fazer o React ficar idêntico a ele.

Não invente texto. Toda palavra de interface no desenho foi escrita para ficar como está: os títulos, as descrições dos sete itens, os cinco achados, as frases das telas de erro, os rótulos dos campos. Se uma frase parecer longa demais ou faltando algo, pergunte antes de reescrever.

Não invente elemento. Se um card não tem ícone no desenho, ele não tem ícone. Se uma tela não tem migalha de navegação, ela não tem. Nenhum badge, chip, divisor, sombra, contador ou ilustração entra sem estar aqui.

Não invente cor. As sete abaixo são as únicas. Não existe verde de sucesso, não existe amarelo de alerta, não existe azul de link. Estado positivo é neutro; estado de atenção é escuro; só o problema é rosa.

## Fontes e cores válidas

Fontes:

- **Instrument Sans** em todo o texto de interface: títulos, parágrafos, rótulos, botões.
- **Geist Mono** só no que a máquina produz: endereços, cronômetro, tempos de etapa, a nota, contagens.

Cores, em hex exato:

| uso | hex |
|---|---|
| fundo da página | `#F4F3F1` |
| cartão | `#FFFFFF` |
| borda de um pixel | `#E6E4E0` |
| tinta, texto principal, botão primário, severidade de atenção | `#16151A` |
| texto secundário | `#6E6B75` |
| acento: severidade crítica, ação principal, cursor do robô | `#E8386A` |

O rosa é o único acento e aparece em três lugares: severidade crítica, ação principal e o cursor do robô na tela. Se aparecer em tudo, perde a função.

Onde o rosa precisa de versão suave — fundo de badge, trilho de barra de progresso, aro de foco — use `#E8386A` com opacidade, não um novo hex.

## O `index.css` do front precisa da mesma troca

O front que está em produção usa outra tipografia. Isso é resíduo de uma etapa anterior e vai fazer o implementado sair diferente do desenhado. São três linhas.

Na linha do `@import` de fontes, trocar:

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap');
```

por:

```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=Geist+Mono:wght@400;500;600&display=swap');
```

No bloco `:root`, trocar:

```css
font-family: 'Manrope', sans-serif;
```

por:

```css
font-family: 'Instrument Sans', sans-serif;
```

Na regra da classe utilitária de mono, trocar:

```css
.mono { font-family: 'JetBrains Mono', monospace; }
```

por:

```css
.mono { font-family: 'Geist Mono', monospace; }
```

E nas variáveis do `:root`, alinhar os valores com a tabela acima: `--ground` passa de `#f6f6f4` para `#F4F3F1` e `--line` passa de `#e7e6e3` para `#E6E4E0`.

> **Correção, 1 de setembro.** Este parágrafo dizia que o resto das variáveis já batia. Não batia: `--muted` estava `#6d6b72` e a tabela pede `#6E6B75`. São três variáveis a alinhar, não duas. É a segunda cor mais usada do desenho — 58 ocorrências — então a diferença sairia em quase toda tela sem chamar atenção em nenhuma. O `grep` de verificação também precisa incluir `#6d6b72`.

O resto das variáveis já bate.

Depois dessas trocas, um `grep` por `Manrope`, `JetBrains`, `#f6f6f4`, `#e7e6e3` e `#6d6b72` no `src/` precisa voltar vazio.

## O que mudou desde a última entrega

O desenho deixou de ser um quadro com cinco turnos de artboards empilhados e virou um arquivo único que se comporta como o produto. Todo estado agora é alcançável navegando, não procurando na prancha.

Os tokens foram unificados. A entrega anterior tinha duas tipografias e dois cinzas de fundo convivendo, resíduo de eu ter seguido o `index.css` do front em parte do desenho e o brief na outra parte. Agora existe um conjunto só, o desta tabela.

A grade dos sete itens foi reposicionada com `grid-template-areas` e não sobra mais espaço vazio em nenhuma largura. Ela tem três arranjos: três colunas acima de 900px, duas entre 560 e 900, uma abaixo de 560.

Os badges de severidade viraram pílula preenchida com texto branco. Crítico em `#E8386A`, atenção em `#16151A`. Antes eram retângulos com fundo suave e texto colorido, em mono e caixa alta.

A captura de dados no resultado deixou de ser um campo de e-mail e virou quatro passos, um por vez, com a seta aparecendo quando o campo fica válido e o caminho de volta sempre visível.

A nota ganhou anel radial com trilho segmentado e conta de zero até o valor quando entra na tela.

Entraram três estados que não existiam: reconexão depois de queda, conexão caiu no meio, e a tela de gravação para quem recebe o link.

Saíram do pacote as cópias do seu front que estavam em `uploads/`, o arquivo empacotado de hospedagem e as capturas de verificação. Só desenho e referência.

## Componentes

`COMPONENTES.md` lista os vinte componentes que serviram de base, na ordem em que chegaram, com o comando de instalação quando havia um, onde cada um foi aplicado no desenho, e o que foi trocado antes de entrar. Leia antes de instalar qualquer coisa: a maioria dos efeitos está resolvida em CSS no arquivo de desenho e não precisa de biblioteca.

## Referência

A pasta `referencia/` tem os prints de componentes e acabamento que serviram de base, com nomes descritivos. Eles são referência de acabamento e de mecânica, não de layout: o layout é o que está no arquivo de desenho.

Os quatro prints da Origin que você mandou no começo não entraram no pacote porque o nome original dos arquivos tem acento e o empacotador não aceita. Se precisar deles aqui dentro, me manda de novo e eu incluo.
