# Plano

Este arquivo existe porque a primeira semana do projeto não teve nenhum. Seis
dias, 122 commits, motor e tempo real funcionando — e a sensação de não sair do
lugar, que estava certa: toda medição abria uma investigação, e investigação
sem prazo contra data de lançamento não termina, ela só troca de assunto.

O `destravar` tem regra de parada por defeito. O projeto não tinha nenhuma.
É isso que este arquivo corrige.

---

## A decisão que destrava tudo (é do Bruno, não do código)

**A promessa da landing.** Enquanto ela não estiver decidida, metade do
trabalho de engenharia é apostada no escuro — foi o que aconteceu com o número
da Camada 1, perseguido por dias como defeito quando era decisão de produto.

### O que NÃO está disponível

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

### B2 — A Camada 1 honesta
**Pronto quando:** uma loja que proíbe o checkout no robots devolve leitura
parcial com o motivo na tela, e nunca um relatório que para no meio sem
explicar.
**Orçamento:** 2 dias. Estourou → a Camada 1 sai do lançamento e a landing pede
autorização desde o primeiro campo.

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
