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
3. **Confiabilidade.** Mesmo só lendo, parte das lojas não termina (achado A2,
   em medição).

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

### B2 — A leitura grátis vale sozinha
**Pronto quando:** uma loja que proíbe o checkout no robots devolve leitura
parcial **com achado que o lojista não sabia** e com o motivo do resto na tela,
nunca um relatório que para no meio sem explicar.

**O escopo mudou depois de medir.** Era "mostrar o motivo com honestidade". Mas
a §8 tem 13 checagens e quase todas precisam do checkout: só `HTTPS_ISSUE`,
`PAY_VISIBILITY` (`payment.ts:85`, precisa só do texto da PDP) e
`INSTALLMENT_UNCLEAR` (`payment.ts:145`) rodam sem carrinho. Na `tracksmith.com`
a medição real devolveu **1 checagem possível, de 13**.

Se o grátis entregar "seu site está em HTTPS", ninguém compartilha e ninguém
autoriza — a isca não pega e o B vira o pior dos dois mundos. Só que a
`tracksmith` é loja americana, sem Pix e sem parcelamento, que é do que dependem
as duas checagens de PDP. **Em loja brasileira o número é provavelmente maior, e
não foi medido.**

**Medir antes de dimensionar:** rodar o modo leitura contra 3 lojas Shopify
brasileiras e contar `checks.applicable`. ~2 min.
- 4 ou mais → 2 dias, a leitura já vale sozinha.
- 2 a 3 → o bloco cresce: checagens novas que rodem só de home + PDP.
- 1 → o B não fecha sem escopo novo grande, e o A volta à mesa.

**Orçamento:** 2 dias enquanto o número não existir. Estourou → a Camada 1 sai
do lançamento e a landing pede autorização desde o primeiro campo.

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
