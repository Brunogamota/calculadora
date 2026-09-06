# Plano

Este arquivo existe porque a primeira semana do projeto não teve nenhum. Seis
dias, 122 commits, motor e tempo real funcionando — e a sensação de não sair do
lugar, que estava certa: toda medição abria uma investigação, e investigação
sem prazo contra data de lançamento não termina, ela só troca de assunto.

O `destravar` tem regra de parada por defeito. O projeto não tinha nenhuma.
É isso que este arquivo corrige.

---

## A decisão, tomada em 05/09: **B**

**Leitura parcial grátis para qualquer loja. A autorização (meta tag ou DNS)
desbloqueia a jornada completa até a tela de pagamento.** `CAL-39`, fechada.

O que ela trava: a landing tem DUAS promessas, separadas e ambas verdadeiras; a
gratuita nunca promete carrinho nem checkout; o robots vira o gancho de
conversão em vez de limitação escondida; e o verbo "comprar" sai de toda a
copy, porque o robô chega até a tela de pagamento e não compra (§2.1).

### O que NÃO está disponível (e foi o que descartou as opções A e C)

**"Cole qualquer loja e veja a auditoria completa até o pagamento."** Não é
difícil: não existe, por três paredes independentes.

1. **robots.txt** (achado A1). A configuração padrão da Shopify proíbe
   `/cart.js`, `/cart/add.js` e `/checkout`. Respeitar é a §2.3, limite escrito
   pelo dono do projeto. Contornar muda a categoria da ferramenta.
2. **§2.2** — nunca repetir auditoria contra loja de terceiro. Um funil viral,
   onde cada visitante cola a loja do concorrente, já está fora dessas regras
   antes mesmo do robots.
3. **Confiabilidade.** Mesmo só lendo, parte das lojas não termina. O achado A2
   estimou ~25% sem fechar a causa; na medição do A3, 1 de 3 estourou o
   orçamento — e ali a instrumentação enfim nomeou o lugar
   (`page.content` sem timeout), o que é o gatilho do `CAL-13`/`CAL-15`.

Cada dia gasto em melhorar a taxa da Camada 1 é gasto contra a parede 1.

### O que está disponível, e é melhor

**A autorização vira o funil, não o obstáculo.**

- **Grátis, qualquer loja:** leitura parcial — plataforma, home, página de
  produto, tempo de carregamento, e o que mais der para ver sem tocar no
  carrinho. A limitação aparece NA TELA, com o motivo real.
- **Com autorização (meta tag ou DNS, §Fase 3):** a jornada inteira até a tela
  de pagamento. Já funciona: 13,5s na loja própria, medido.

O lead deixa de ser um e-mail num campo e passa a ser um lojista que provou
titularidade e pediu a auditoria do próprio checkout. Para uma empresa de
pagamentos, isso é lead qualificado, não visitante. E o A1 deixa de ser
limitação e vira o gatilho de conversão.

---

## Blocos, com critério de pronto e regra de parada

Cada bloco tem UM critério de pronto, verificável, e um orçamento. Estourou o
orçamento sem fechar: o que faltou vira limitação declarada no produto (regra
da Fase 7 do `destravar`), não item de backlog eterno.

### B1 — Fechar o caminho consentido de ponta a ponta
**Pronto quando:** um lojista que não é o Bruno consegue, sozinho, provar
titularidade e receber o relatório completo até a tela de pagamento.
**Contém:** verificação de titularidade por meta tag ou DNS; o texto da landing
com as duas promessas separadas; o relatório.
**Não contém:** nada sobre a taxa da Camada 1.
**Orçamento:** 3 dias de trabalho. Estourou → lança com autorização manual (o
Bruno cadastra o aceite à mão) e a verificação automática vira B4.

### B2 — A leitura grátis acompanha; a autorização é que promete
**Pronto quando:** a loja que proíbe o checkout no robots recebe leitura parcial
que diz na tela o que foi verificado, o que não foi, e por quê — e o achado,
quando existe, aparece com o mesmo peso de um achado da auditoria completa.
Nunca um relatório que para no meio sem explicar.

**O título deste bloco mudou, e a mudança é o resultado do A3.** Ele se chamava
"a leitura grátis vale sozinha". Não vale, e agora isso está medido em vez de
suposto.

#### O limiar antigo media a coisa errada

Este bloco era dimensionado por `checks.applicable`: "4 ou mais → a leitura já
vale sozinha". A medição do A3 mostrou que `applicable` e quantidade de achados
andam em **sentidos opostos** — o que falta numa loja vira `not_applicable`, não
vira achado. Em loja real:

| loja | `applicable` | achados |
|---|---|---|
| `zerezes.com.br` | 2 | **0** |
| `simpleorganic.com.br` | 4 | **2**, os dois de severidade alta |

O limiar antigo teria lido as duas ao contrário do que interessa: a loja com
achados passava do corte pelo motivo errado, e a sem achados quase passava
também. **Um número não vira agenda sem alguém perguntar o que ele mede**
(Regra 4) — e aqui a pergunta só foi feita depois que o número já governava o
bloco.

#### O teto, e ele é estrutural

Das 13 checagens da §8, só 5 podem ser aplicáveis sem tocar carrinho. Dessas 5,
duas — `NO_COUPON_FIELD` e `NO_TRUST_SIGNAL` — **só conseguem passar**: a
ausência delas exige a tela de pagamento por desenho (`presencaAntecipavel`,
`payment.ts:240-258`). Sobram três que podem falhar, e na prática duas, porque
`HTTPS_ISSUE` não dispara em Shopify real:

- `PAY_VISIBILITY` (`payment.ts:85`) — meios de pagamento ausentes na PDP.
- `INSTALLMENT_UNCLEAR` (`payment.ts:145`) — parcelamento sem valor por parcela
  ou sem juros explícito.

**O teto de achados da Camada 1 é 2.** Nenhuma medição vai passar disso sem
escopo novo. E as duas dependem de vocabulário brasileiro, o que explica o
`1 de 13` da `tracksmith`: loja americana não tem nem uma nem outra.

#### O limiar novo, sobre achados

A pergunta que dimensiona o bloco passa a ser: **de N lojas brasileiras que
terminarem, quantas entregam pelo menos um achado?**

- **2 em 3 ou mais** → a leitura grátis é isca. Vale prometer na landing.
- **cerca de metade** → **é onde estamos.** A leitura acompanha, não promete: a
  landing promete a auditoria completa com autorização, e o grátis é o que
  acontece enquanto o lojista decide.
- **menos de 1 em 3** → a Camada 1 sai do lançamento e a landing pede
  autorização desde o primeiro campo.

Medição de 06/09, em `gru`, modo leitura: de 2 lojas que terminaram, **1
entregou achado** (`simpleorganic`, dois achados de alta). A terceira
(`pantys`) não terminou. Saída bruta no achado A3.

#### O que este bloco NÃO faz, por decisão

**Não construir checagens novas de home + PDP.** Era o ramo "o bloco cresce" do
limiar antigo, é escopo grande, e o A3 mostra que ele compraria pouco: o teto de
achados sobe devagar e o custo é de dias. Se voltar à mesa, volta como bloco
próprio depois do B3, não como crescimento deste.

**Gatilho para reabrir:** uma rodada maior (~10 domínios) mostrando 2 em 3 ou
mais lojas com achado. Aí a leitura grátis vira isca e a landing muda.

A rodada está pronta em `scripts/medir-b2.sh`: 7 domínios novos, um comando, de
dentro da máquina em `gru`. Ela relê os arquivos da rodada de 06/09 em vez de
auditar de novo, imprime o placar e aplica o limiar acima sozinha.

**Orçamento:** 1 dia. É tela e texto, não motor — o motor já entrega o que este
bloco precisa.

### B3 — Lançar
**Pronto quando:** está no ar, com a loja própria mais pelo menos 3 lojas de
terceiro com aceite real.
**Regra:** lança com as limitações conhecidas escritas na tela. Não espera
nenhuma investigação aberta fechar.

### B4 — Só depois de B3
Travamentos do A2, cobertura VTEX/Nuvemshop, mobile, dado agregado. Ordenados
por quantos lojistas reais reclamarem, não por quanto incomodam quem escreve o
código.

---

## Regra de operação, para não repetir a semana

1. **Investigação declara orçamento antes de começar** (ciclos ou horas) e o
   escreve no `ACHADOS.md`. Sem orçamento declarado, não começa.
2. **Estourou o orçamento, a investigação PARA** e a limitação vai para a lista
   de "não cobre" do produto, com o gatilho para reabrir. Interrompida com
   registro é ativo; sem registro é prejuízo.
3. **Nenhuma investigação bloqueia um bloco.** Se a resposta não muda o que a
   tela promete, ela não é caminho crítico — é curiosidade cara.
4. **Número não vira agenda.** "3 de 227" governou dias de trabalho sem
   ninguém ter perguntado o que ele mediria se estivesse alto.
