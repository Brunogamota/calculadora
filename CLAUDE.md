# Como trabalhar neste projeto

## Regra 1 — O Linear manda na rota

**Projeto:** [Raio-X do Checkout — lançamento](https://linear.app/calculadoradescore/project/raio-x-do-checkout-lancamento-fe6cbdc5a894) · time `Calculadoradescore` (prefixo `CAL`)

**Antes de começar qualquer coisa,** ler o projeto no Linear e o `PLANO.md`. Não
de memória, não do que ficou da conversa anterior: buscar o estado real. O que
está em andamento é o bloco atual — `CAL-40` (B1), `CAL-41` (B2), `CAL-42` (B3),
`CAL-43` (B4) — e trabalho fora do bloco atual não começa sem dizer isso em voz
alta primeiro.

**Ao terminar qualquer coisa,** atualizar o Linear. Não no fim do dia, não
quando alguém perguntar: na hora. Fechar a issue, escrever o que ficou pronto,
e se o resultado mudou o entendimento, escrever isso também.

**Quando não der,** atualizar do mesmo jeito. "Não deu" é resultado e vai
escrito: o que foi tentado, a evidência, e o gatilho que faria valer a pena
voltar. Issue que morre em silêncio é a mesma coisa que investigação sem
registro — prejuízo, não economia.

Isto vale sem precisar ser pedido de novo. Se uma sessão inteira passar sem
tocar no Linear enquanto trabalho foi feito, a regra foi quebrada.

## Regra 2 — Nenhuma investigação sem orçamento declarado

Antes de investigar, escrever no `ACHADOS.md` quantos ciclos ou quantas horas.
Estourou sem fechar: **para**, e a limitação vai para a lista de "não cobre" do
produto, com o gatilho para reabrir. Não vira item eterno de backlog.

O protocolo completo está na skill `destravar`. O que esta regra acrescenta é
que o orçamento é escrito ANTES, não estimado depois.

## Regra 3 — Nenhuma investigação bloqueia um bloco

Se a resposta não muda o que a tela promete ao lojista, não é caminho crítico —
é curiosidade cara. Foi assim que o número "3 de 227" governou dias de trabalho
sem ninguém ter perguntado o que ele mediria se estivesse alto.

## Regra 4 — Número não vira agenda

Métrica nova exige a pergunta antes da corrida: **o que eu faria diferente se
ela estivesse boa?** Sem resposta, medir é entretenimento.

---

## Limites que não se negociam

Estão na §2 do `raio-x-checkout-projeto-completo.md`, que é a fonte da verdade.
Os que mais aparecem no dia a dia:

- **§2.1** Nunca finalizar pedido. O robô jamais preenche cartão nem clica em
  botão que cria pedido. Está no código, e continua estando.
- **§2.2** Nunca repetir auditoria contra loja de terceiro. Janela de 24h. O
  `--force` existe só para a loja própria (`RAIO_X_LOJA_PROPRIA`).
- **§2.3** robots.txt é respeitado por padrão. A exceção é titularidade
  confirmada, e só. Ver `lib/gate.ts` e o achado A1.
- Toda auditoria com preenchimento de checkout deixa um checkout abandonado no
  admin da loja auditada. Por isso, só na loja própria.
- `.env` tem dado pessoal real e nunca é commitado.

## Onde está o quê

- `PLANO.md` — os blocos, os orçamentos e o que NÃO está disponível
- `ACHADOS.md` — conclusões que custaram medição, com a saída bruta
- `raio-x-checkout-projeto-completo.md` — a fonte da verdade do produto
- `README.md` — estado real de cada bloco do motor

## Branch

Desenvolver e empurrar só em `claude/shopify-checkout-auditor-phase1-j4bftz`.
Não abrir pull request sem pedido explícito.
