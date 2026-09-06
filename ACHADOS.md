# Achados

Registro de conclusões que custaram medição para chegar. Existe porque o
número que sai de uma medição sobrevive na memória de todo mundo muito depois
da explicação dele — e aí, meses depois, alguém (eu inclusive) volta a tratar
como defeito a resolver algo que já foi investigado e é decisão de produto.

Cada achado traz a saída bruta que o sustenta, a linha de código que o causa,
o que ele **não** é, e o gatilho que faria valer a pena reabrir.

---

## A1 — A Camada 1 não pode chegar ao carrinho na maioria das lojas Shopify, e isso é o robots.txt funcionando

**Data:** 05/09/2026 · **Estado:** fechado, com uma pergunta de produto em aberto

### O que se pensava

Que o `3 de 227` da medição de cobertura era um defeito do motor: lojas que o
robô deveria conseguir auditar e não conseguia, por lentidão, antibot ou bug.
Três rodadas de investigação foram gastas nessa leitura.

### O que a medição mostra

Duas coberturas de 227 domínios (rodada 1 e rodada 2, ~2h cada, um domínio
atrás do outro) e um diagnóstico de espaçamento com 12 domínios da mesma
lista, 2,5 min entre um e outro. Tabulando as 227 linhas da rodada 2 por
motivo de descarte:

```
  121  NETWORK_ERROR (page.goto: Timeout 30000ms exceeded)
   47  robots.txt bloqueia
   21  plataforma não é shopify
   13  HOME_NOT_OK (403/405 — antibot/WAF)
    7  DNS_FAILURE
    5  RATE_LIMITED_BY_SITE (429)
    4  abortou depois de confirmada shopify
    3  REQUEST_TIMEOUT
    3  entrou
```

O `NETWORK_ERROR` domina — e ele é o que some quando se espaça. Os mesmos 12
domínios, primeiro em rajada e depois com 2,5 min de intervalo, do mesmo IP da
Fly, com o mesmo código:

```
# rajada (rodada 2 da cobertura)          # espaçado (2,5 min)
gymshark.com          37.8s NETWORK_ERROR    7.4s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
simpleorganic.com.br  33.3s NETWORK_ERROR   20.1s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
everlane.com          36.2s NETWORK_ERROR   17.3s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
pantys.com.br         37.1s NETWORK_ERROR  123.2s  DEADLINE_EXCEEDED: detecção de plataforma
brooklinen.com        37.4s NETWORK_ERROR  122.8s  DEADLINE_EXCEEDED: detecção de plataforma
tracksmith.com       140.3s entrou          17.0s  ENTROU (identify 9391ms)
steamtoy.com.br       37.8s NETWORK_ERROR    8.0s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
rothys.com            36.6s NETWORK_ERROR   50.8s  robots.txt bloqueia: /cart, /cart.js, /cart/add.js, /checkout
ekomat.com.br         35.0s NETWORK_ERROR   23.4s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
fearofgod.com         37.4s NETWORK_ERROR   12.4s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
noahny.com            35.3s NETWORK_ERROR    9.7s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
colourpop.com         37.1s NETWORK_ERROR  124.0s  DEADLINE_EXCEEDED: detecção de plataforma
```

Duas coisas saem daí, e elas são independentes.

### Conclusão 1 — o ritmo era real, e a medição em rajada mediu a si mesma

8 dos 12 domínios que estouravam os 30s do `page.goto` em rajada carregaram
**limpos em 7 a 50 segundos** quando pedidos um de cada vez. O controle
positivo é o mais claro de todos: `tracksmith.com` passou nas duas condições,
mas levou **140,3s em rajada (identify 75-78s) contra 17,0s espaçado (identify
9,4s)** — mesmo domínio, mesmo código, mesmo IP, oito vezes mais rápido só por
não estar numa fila de 227.

Isso muda a leitura do risco de lançamento, e muda pro lado bom: **ninguém vai
auditar 227 lojas em rajada.** Um lojista pede a própria loja, uma vez. O
`3 de 227` mediu o comportamento do motor sob um ritmo que o produto nunca vai
ter. Não é a taxa de acerto esperada em uso real.

### Conclusão 2 — embaixo do ritmo, o teto é o robots.txt, por desenho

Quando a camada de rede para de falhar, o desfecho que aparece não é
`entrou` — é `robots.txt bloqueia: /cart.js, /cart/add.js, /checkout`. Em 8 de
8 dos domínios que destravaram, sem exceção. É a configuração padrão da
Shopify: ela proíbe exatamente os caminhos de carrinho e checkout de que a
jornada precisa.

E o motor respeita isso porque foi decidido que respeitaria. `lib/gate.ts`
registra a decisão em texto:

> por padrão, robots é respeitado. Etapa proibida NÃO roda. (...) a exceção é
> titularidade confirmada: o dono pediu a auditoria e provou que é dono.

O caminho: `detect.ts:19` lista os `JOURNEY_PATHS` que a jornada precisa,
`detect.ts:146` pergunta ao portão sobre cada um, e `audit.ts:438` decide quem
tem a exceção — `ownerVerified: options.modo === 'consentido'`. A Camada 1
roda em `modo: 'leitura'`, sem autorização de ninguém, logo sem exceção. O
script descarta ainda no `detect` (`medir-cobertura.ts:463`) em vez de gastar
uma auditoria que já se sabe que vai parar.

**Não existe correção para isso, porque não é defeito.** A Camada 1 nunca vai
passar do produto na maior parte das lojas Shopify, e mudar isso significaria
desrespeitar robots.txt — que é a §2.3, o limite que separa auditoria de
ataque. Um `if` aqui não é bug fix, é decisão de produto revertida por
acidente.

A Camada 2 (consentido) atravessa a jornada inteira: `raioxreborn.myshopify.com`,
`1 de 1`, `leu o pagamento · 13.5s`, com o mesmo robots.txt padrão da Shopify
bloqueando os mesmos caminhos. O que muda entre uma e outra é o aceite, e só.

### O que isto NÃO é

- **Não é antibot.** Antibot aparece com nome próprio no relatório
  (`HOME_NOT_OK: 403/405`, 13 casos) e não se confunde com robots.
- **Não é a Fly, nem a máquina.** Memória livre ficou em ~500MB de 962MB do
  primeiro ao último domínio da rodada, e a contagem de Chromium nunca passou
  de 1 — o esgotamento de recurso local foi eliminado com rastro.
- **Não é lista ruim de candidatos.** 21 dos 227 não eram Shopify; o resto era.

### O que continua sem explicação

`pantys.com.br`, `brooklinen.com` e `colourpop.com` estouram os 120s da §14
**na detecção de plataforma** mesmo com 2,5 min de intervalo. 3 de 12 é muito
para ignorar: se isso for a taxa real, ~1 em cada 4 lojas é lenta demais para
ser sequer identificada, e o lojista vê o robô morrer antes de qualquer
resultado. Investigar isso é uma pergunta diferente desta, e ela ainda vale a
pena. O que ela **não** é: causa do `3 de 227`.

### A pergunta de produto que fica aberta

Se a Camada 1 não passa do produto sem autorização, o funil não pode prometer
"cole qualquer loja e veja a auditoria completa". Ou a promessa vira "cole a
sua loja e autorize", ou a Camada 1 vira explicitamente um diagnóstico parcial
— com a limitação dita na tela, no lugar de um relatório que para no meio sem
explicar por quê. Decisão do Bruno; não dá para resolver no código.

### Gatilho para reabrir

- Se a Shopify mudar o robots.txt padrão (hoje: proíbe `/cart.js`,
  `/cart/add.js` e `/checkout`; algumas lojas somam `/cart`).
- Se a verificação de titularidade da Fase 3 (meta tag ou DNS) entrar — aí a
  exceção deixa de ser uma flag e vira algo que o próprio lojista dispara na
  landing, e a Camada 1 passa a ter um caminho legítimo para a jornada inteira.
- Se os 3 travamentos na detecção de plataforma se mostrarem a mesma causa que
  os `NETWORK_ERROR` da rajada.

### Como reproduzir

```
fly ssh console -a raio-x-motor -C "npm run diagnosticar-espacamento"
```

Rodar na máquina de casa não vale: o IP é outro, com reputação outra.

---

## A2 — O erro de orçamento nomeava a corrida, não a etapa (e por isso os 3 travamentos ficaram sem diagnóstico)

**Data:** 05/09/2026 · **Estado:** FECHADO por dissolução do sintoma. Os 3 domínios
não travam. O que existe é falha intermitente, e a resposta é de produto, não de
depuração — ver "Como isto fechou", no fim.

**Orçamento gasto:** 2 ciclos de hipótese (H1 e H2), mais uma medição na Fly.
Dentro do orçamento. Não foi preciso acionar a regra de parada.

### Sintoma

`pantys.com.br`, `brooklinen.com` e `colourpop.com` devolvem
`DEADLINE_EXCEEDED: Orçamento de 120000ms estourou em: detecção de plataforma`
mesmo espaçados 2,5 min. Os outros 8 da mesma amostra se explicaram (A1).

### O que a investigação encontrou primeiro, e não era o esperado

`detect.ts:97` corre a cadeia INTEIRA dentro de um `race` com um rótulo só:

```ts
return await deps.deadline.race(runDetect(input, options, deps, slot), 'detecção de plataforma')
```

Dentro dessa corrida cabem oito etapas — normalização, cadeia de redirects do
preflight, `robots.txt`, subida do Chromium, espera de ritmo, `page.goto`,
`page.content()`, `page.evaluate` dos globais e a classificação de plataforma.
Todas estouravam com a MESMA frase. **A mensagem não diz que a detecção de
plataforma travou; diz que a corrida chamada "detecção de plataforma" acabou.**
Nenhuma das hipóteses abaixo podia ser separada pela saída.

### Dois mecanismos capazes de comer os 120s, os dois confirmados no código

**1. `page.content()` e `page.evaluate` não aceitam timeout.** Conferido nos
tipos do Playwright 1.56.0 instalado (`playwright-core/types/types.d.ts`):
`content(): Promise<string>` e `evaluate<R, Arg>(pageFunction, arg)`, sem
`options`. E `setDefaultTimeout` só muda o padrão de métodos que aceitam a
opção — logo não alcança nenhum dos dois. Numa página que carrega e depois
prende a thread principal, `session.ts` fica preso ali sem limite.

**2. `timeoutMs` do `safeFetch` é POR HOP, não pela cadeia.** Medido, não
deduzido:

```
2 hops x 10000ms  ->  30.0s  ok=true             <- 30s reais sob "timeout de 15s"
6 hops x 15000ms  ->  15.0s  ok=false  REQUEST_TIMEOUT
```

Com `maxRedirects: 5` no laço `hop <= maxRedirects` são até 6 requisições de
15s, mais 1s de rate limit entre elas: **~89s só no preflight**, sem nenhum
passo acusar timeout.

### O que foi feito

Instrumento, não correção. `Deadline` ganhou `marcar(etapa)` e `trilha()`
(`lib/deadline.ts`); `assertAlive` passou a marcar junto; `openPage` recebeu um
`marcar` opcional que separa `page.goto`, espera do `load` e `page.content()`;
`session.ts` marca robots, Chromium, ritmo, globais e classificação. A mensagem
passou a nomear a última etapa iniciada, e o `detail` carrega a trilha com a
duração de cada uma. Verificado contra servidor local:

```
antes:  Orçamento de 20000ms estourou em: detecção de plataforma
depois: Orçamento de 20000ms estourou em: detecção de plataforma, parado em: abertura da home
        trilha: normalização de URL 0.0s → abertura da home 20.0s
```

Nenhum dos dois mecanismos foi corrigido de propósito: corrigir antes de saber
qual dos dois (ou qual terceiro) é o que acontece nessas lojas seria chute com
cara de conserto.

### Por que não foi possível fechar aqui

O egresso desta sessão é bloqueado por política para esses domínios — os cinco,
inclusive o controle que funciona na Fly, devolvem 403 no CONNECT do proxy:

```
$ curl -v https://tracksmith.com/
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
```

E o experimento não vale rodado de outro IP: a reputação em jogo é a do IP de
produção. Logo, a próxima medição tem que sair da Fly.

### O experimento que decide

```
fly deploy
fly ssh console -a raio-x-motor
  # dentro do shell da máquina:
  cd /app && RAIO_X_ESPACAMENTO_N=4 npm run diagnosticar-espacamento
```

O `-C` do `fly ssh console` NÃO passa por um shell: ele executa o argumento
direto, então `VAR=valor comando` é lido como nome de executável e falha com
`executable file not found in $PATH`. Variável de ambiente na frente só
funciona dentro do shell interativo.

A amostra foi reordenada para os três sem explicação mais a `tracksmith` como
controle positivo. Previsões escritas ANTES:

- trilha parando em `abertura da home` → é a cadeia de redirects (mecanismo 2);
  a correção é orçamento de cadeia, não por hop.
- trilha parando em `page.goto da home` → a loja não entrega DOM em 30s do IP
  da Fly; é rede/CDN, e a correção é de política (desistir antes, dizer o quê).
- trilha parando em `leitura do HTML` ou `leitura dos globais` → é o mecanismo
  1, thread do renderer presa; a correção é envolver as duas chamadas sem
  timeout num `race` próprio.
- trilha parando em `classificação de plataforma` → são os fetches dos
  adapters, e aí a suspeita passa a ser o rate limiter por host.
- `tracksmith` falhando → mudou o ambiente, e nada mais da rodada se lê.

### Como isto fechou: o sintoma dissolveu

A rodada com a instrumentação, mesmos 150s de intervalo, mesma máquina da Fly:

```
#1 pantys.com.br      13.3s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
#2 brooklinen.com     22.8s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
#3 colourpop.com      24.5s  robots.txt bloqueia: /cart.js, /cart/add.js, /checkout
#4 tracksmith.com     17.6s  ENTROU · identify 9964ms · 1 checagem(ns) possível(is)

  travou de novo mesmo espaçado: 0 de 4
```

**Os três resolveram limpo, em 13 a 25 segundos.** Os mesmos que tinham estourado
os 120s.

E a instrumentação não chegou a disparar, porque nada travou. Então ela continua
sem uso em campo — o que é o desfecho certo: o instrumento existe para a próxima
vez que acontecer, e não custa nada esperando.

### O que isso prova, e o que derruba

**Derruba a premissa da própria investigação.** "`pantys`, `brooklinen` e
`colourpop` travam" era falso. Não é propriedade desses domínios: eles passam.

**Derruba também a acumulação**, que era a explicação mais natural depois do A1.
Posição de cada um nas duas rodadas espaçadas, mesmo intervalo:

```
rodada 1 (12 domínios)              rodada 2 (4 domínios)
 #1 gymshark        robots           #1 pantys       robots
 #2 simpleorganic   robots           #2 brooklinen   robots
 #3 everlane        robots           #3 colourpop    robots
 #4 pantys          TRAVOU           #4 tracksmith   ENTROU
 #5 brooklinen      TRAVOU
 #6 tracksmith      ENTROU
 #7 steamtoy        robots     <- passou DEPOIS dos dois travamentos
 #8 rothys          robots
 #9 ekomat          robots
 #10 fearofgod      robots
 #11 noahny         robots
 #12 colourpop      TRAVOU     <- e travou DEPOIS de cinco sucessos seguidos
```

Se fosse desgaste ao longo da rodada, #7 a #11 não teriam passado. Não é
progressivo, não é o domínio, não é o intervalo.

**O que sobra é falha intermitente**, a ~25% na rodada de 12 e a 0% na de 4.
Amostra pequena demais para chamar de taxa — e o protocolo é explícito sobre
isto: falha intermitente exige MEDIR a taxa (20, 50, 100 execuções) antes de
investigar causa, senão a próxima execução boa vira "confirmação" de uma
correção que não fez nada. Foi exatamente o risco que a rodada de hoje quase
criou.

### A rota alternativa, que já estava escrita

E aqui a conclusão importante: **não vale caçar essa causa.** O custo é medir
dezenas de execuções contra lojas de terceiro, o que esbarra na §2.2, e o
resultado no melhor caso explica um travamento que o produto pode simplesmente
absorver.

A resposta de produto já existe no backlog do Bruno, escrita antes desta
investigação:

- **`CAL-13`** — execução em background com gravação. "Hoje, o dia que a jornada
  quebrar ao vivo, ela quebra na frente do lead."
- **`CAL-15`** — retry automático antes de entregar. "Se a jornada quebrar em
  background, tenta de novo e só entrega o que fechou."

Falha intermitente de ~25% com retry vira ~6%, e com dois retries ~1,5% — sem
entender a causa. Um travamento que ninguém vê não é o mesmo defeito.

### Gatilho para reabrir

- Se a taxa passar de ~25% numa rodada maior, ou se o retry do `CAL-15` não
  derrubar o número na prática.
- Quando acontecer de novo COM a instrumentação ligada: a trilha vai dizer em
  qual das oito etapas o orçamento foi, e aí a causa custa uma rodada em vez de
  uma investigação.

### O que eu não sei

A taxa real. "3 de 12" e "0 de 4" são a mesma medição ruim vista duas vezes:
amostras pequenas de um fenômeno intermitente. O número honesto só sai de uma
rodada grande, e essa rodada não vale o custo agora (§2.2, e o retry resolve).

E continuam de pé, sem uso, os dois mecanismos verificados no código — o
`page.content()`/`page.evaluate` sem timeout e o `timeoutMs` por hop do
`safeFetch`. Nenhum dos dois foi corrigido, porque nenhum foi demonstrado como
causa de nada. Ficam registrados aqui para a próxima vez.

---

## A3 — Quantas das 13 checagens rodam sem tocar o carrinho, em loja brasileira

**Data:** 06/09/2026 · **Estado:** fechado — estrutura medida local, lojas reais medidas em gru

### Orçamento, declarado antes

**1 ciclo, ~30 min de relógio.** Estourou sem número: para, e o B2 é
dimensionado pelo pior caso (`tracksmith` = 1 de 13), que já manda a Camada 1
sair do lançamento pela regra do `PLANO.md`.

### A pergunta, e por que ela decide algo

O B2 promete leitura parcial grátis que valha sozinha. Na `tracksmith.com` a
medição real deu **1 checagem possível de 13** — mas é loja americana, sem Pix
e sem parcelamento, e são exatamente essas duas que `PAY_VISIBILITY`
(`payment.ts:85`) e `INSTALLMENT_UNCLEAR` (`payment.ts:145`) leem da página de
produto. Em loja brasileira o número deve ser maior, e ninguém mediu.

Resposta da Regra 4 (o que eu faria diferente conforme o resultado), escrita
antes de rodar:

- **4 ou mais** → B2 são 2 dias, a leitura grátis vale sozinha, segue o plano.
- **2 a 3** → o bloco cresce: precisa de checagens novas que rodem só de home
  + PDP, e isso é escopo novo a decidir com o Bruno.
- **1** → o B não fecha sem escopo grande. A Camada 1 sai do lançamento, a
  landing pede autorização desde o primeiro campo, e a opção A volta à mesa.

### Método

`audit(url, { modo: 'leitura' })` contra 3 lojas Shopify brasileiras, uma
execução por domínio (§2.2 protegida por construção: sem repetição na lista, e
sem `force`). Conta `checks.applicable` e registra QUAIS checagens sobrevivem,
não só quantas — o "quais" é o que diz se a leitura grátis tem achado que o
lojista não sabia, ou só "seu site está em HTTPS".

### O que aconteceu: a medição contra loja real não pôde rodar daqui

A sessão remota tem egresso por política. Todo host externo — as lojas e o
próprio `raio-x-motor.fly.dev` — responde 403 no CONNECT:

```
$ curl -sS "$HTTPS_PROXY/__agentproxy/status"
  "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "zerezes.com.br:443"
  ... idem simpleorganic.com.br, pantys.com.br, boldsnacks.com.br, sallve.com.br

$ curl -sS -m 20 https://raio-x-motor.fly.dev/health
curl: (56) CONNECT tunnel failed, response 403
```

Não é contornável e não deve ser contornado. A medição contra loja real
continua pendente, e o comando exato está no fim deste achado.

### O que deu para medir sem rede, e responde mais do que a pergunta original

O motor de verdade (`audit`, `runChecks`, as 13 regras) contra a loja falsa em
`127.0.0.1`. Isso não mede o que as lojas OFERECEM — mede o que o modo leitura
CONSEGUE, que é o teto de tudo que a medição real pode devolver.

**Rodada 1 — a fixture como está (PDP com parcelamento, sem Pix, sem selo, sem cupom):**

```
applicable: 3 de 13
>> HTTPS_ISSUE            fail    (só porque a fixture é http://; loja real passa)
>> PAY_VISIBILITY         fail    nenhum meio de pagamento é mencionado na página do produto
>> INSTALLMENT_UNCLEAR    pass    em até 10x com valor e juros explícitos — "10x de R$ 8.99"
   as outras 10           not_applicable
```

**Rodada 2 — PDP enriquecida para parecer loja brasileira típica** (Pix com
desconto, "compra segura", campo de cupom). Previsão escrita ANTES: sobe para
5, e `PIX_DISCOUNT_LATE` continua fora porque precisa de carrinho ou checkout
para comparar. Confirmada:

```
applicable: 5 de 13
>> HTTPS_ISSUE            fail
>> PAY_VISIBILITY         pass    "10x de R$ 8.99 sem juros Pix — 5% de desconto Compra segura..."
>> INSTALLMENT_UNCLEAR    pass
>> NO_COUPON_FIELD        pass    há campo de cupom na página do produto
>> NO_TRUST_SIGNAL        pass    "Compra segura. Seus dados são protegidos por criptografia."
   PIX_DISCOUNT_LATE      not_applicable   modo leitura: não abre carrinho nem checkout
```

`NO_COUPON_FIELD` e `NO_TRUST_SIGNAL` só entraram por causa da correção do
`CAL-45`: presença se responde de qualquer etapa observada, ausência só da tela
de pagamento.

**Rodada 3 — PDP pobre** (só o preço, sem pagamento e sem parcelamento).
Previsão escrita ANTES: `applicable` **cai** para 2. Confirmada:

```
applicable: 2 de 13
>> HTTPS_ISSUE            fail
>> PAY_VISIBILITY         fail    nenhum meio de pagamento é mencionado na página do produto
   INSTALLMENT_UNCLEAR    not_applicable   nenhuma menção a parcelamento; pode aparecer só depois de escolher cartão
   NO_COUPON_FIELD        not_applicable   modo leitura: não abre carrinho nem checkout
   NO_TRUST_SIGNAL        not_applicable   modo leitura: não abre carrinho nem checkout
```

### O achado: `checks.applicable` era o número errado, e ele decidia o B2

As três rodadas mostram que **`applicable` e "quantidade de achados" andam em
sentidos opostos** no modo leitura:

| PDP | applicable | achados de verdade |
|---|---|---|
| rica (Pix, selo, cupom, parcelamento) | **5** | 0 |
| média (só parcelamento) | 3 | 1 |
| pobre (só preço) | **2** | 1 |

Quanto melhor a loja, MAIOR o `applicable` — e todas passam. Quanto pior a
loja, MENOR o `applicable` — porque o que falta vira `not_applicable`, não vira
achado. O `PLANO.md` mandava dimensionar o B2 por "4 ou mais": uma loja que
tirasse 5 dispararia o "a leitura já vale sozinha" entregando **zero** achado.

O motivo estrutural: das 5 que podem ser aplicáveis sem carrinho, duas —
`NO_COUPON_FIELD` e `NO_TRUST_SIGNAL` — **só conseguem passar**. A ausência
delas exige a tela de pagamento por desenho (`presencaAntecipavel`,
`payment.ts:240-258`). Nunca viram achado no grátis.

**Sobram 3 que podem falhar, e na prática 2:**

| checagem | pode falhar na leitura? |
|---|---|
| `HTTPS_ISSUE` | sim, mas loja Shopify real é HTTPS — não dispara |
| `PAY_VISIBILITY` | **sim** — "nenhum meio de pagamento na página do produto" |
| `INSTALLMENT_UNCLEAR` | **sim** — "parcelamento sem valor por parcela ou sem juros" |

E as duas que sobram são exatamente as que dependem de vocabulário brasileiro
(Pix, "10x sem juros"), o que explica o `1 de 13` da `tracksmith`: loja
americana não tem nem uma nem outra.

### O que isto decide, e o que ainda não decide

**Decide:** o teto de achados da Camada 1 é 2. Nenhuma medição contra loja real
vai passar disso sem escopo novo, então o cenário "4 ou mais → 2 dias, segue o
plano" do `PLANO.md` não existe da forma como estava escrito.

**Não decide:** se lojas brasileiras reais falham essas duas. Se a maioria já
mostra Pix e parcelamento claro na PDP, o grátis entrega "está tudo certo" e a
isca não pega. Se boa parte falha, dois achados bons bastam para uma isca — um
lojista que descobre que a PDP dele não fala em Pix tem motivo para autorizar.

A pergunta virou mais afiada e mais barata: **de 3 lojas brasileiras, quantas
falham `PAY_VISIBILITY` ou `INSTALLMENT_UNCLEAR`?**

### Como rodar a medição que falta

Da máquina em `gru`, que é onde o egresso existe e a origem é brasileira:

```
fly ssh console -a raio-x-motor
cd /app
for d in zerezes.com.br simpleorganic.com.br pantys.com.br; do
  npm run audit -- "https://$d" --summary | tee "/dados/b2-$d.json"
done
```

Uma execução por domínio, sem `--force`: a §2.2 vale inteira contra loja de
terceiro. `--from-br` é dispensável — `FLY_REGION=gru` já declara a origem
desde o `CAL-46`.

### A medição contra loja real, rodada em gru — 06/09

Rodada pelo Bruno de dentro de `raio-x-motor` (`fly ssh console`), modo leitura,
headless (que é o que a produção usa: `server.ts:231` só liga headed com
`AUDIT_HEADED=1`). Uma execução por domínio, sem `--force`.

```
===== zerezes.com.br =====
  status: partial | erro: -
  aplicaveis: 2 | falharam: 0

===== simpleorganic.com.br =====
  status: partial | erro: -
  aplicaveis: 4 | falharam: 2
  ACHADO: [alta] PAY_VISIBILITY: nenhum meio de pagamento é mencionado na página do produto
  ACHADO: [alta] INSTALLMENT_UNCLEAR: na página do produto: parcelamento sem presença ou ausência
                 de juros — "6x R$ 11,50"

===== pantys.com.br =====
  status: failed | erro: DEADLINE_EXCEEDED Orçamento de 120000ms estourou em: auditoria,
                         parado em: leitura do HTML (page.content, sem timeout)
  sem checks
```

**A previsão estrutural bateu.** Os dois achados vieram de `PAY_VISIBILITY` e
`INSTALLMENT_UNCLEAR` — as duas únicas que o modelo dizia poder falhar no modo
leitura. Nenhum achado veio de outra checagem, em nenhuma das duas lojas que
terminaram. E o `INSTALLMENT_UNCLEAR` da simpleorganic é do tipo que o lojista
não sabe: "6x R$ 11,50" sem dizer se tem juros.

**A confirmação do sentido invertido também bateu.** A zerezes, que não tem
achado nenhum, tirou `aplicaveis: 2`; a simpleorganic, com dois achados de
severidade alta, tirou `aplicaveis: 4`. Se o limiar do `PLANO.md` (`4 ou mais →
a leitura já vale sozinha`) tivesse sido aplicado, a loja com achados e a loja
sem achados teriam sido lidas ao contrário do que interessa.

**O placar do que a pergunta de fato mede:** de 2 lojas que terminaram, **1
entregou achado**. A terceira não terminou.

### A terceira loja é o A2 reabrindo, com a instrumentação funcionando

O A2 fechou registrando dois mecanismos suspeitos "de pé, sem uso, nenhum
demonstrado como causa de nada" — um deles o `page.content()` sem timeout. E o
gatilho de reabertura escrito lá era: *"quando acontecer de novo COM a
instrumentação ligada: a trilha vai dizer em qual das oito etapas o orçamento
foi"*.

Foi o que aconteceu. A `pantys.com.br` estourou os 120s e a trilha nomeou o
lugar: **`parado em: leitura do HTML (page.content, sem timeout)`**. Pela
primeira vez o mecanismo deixou de ser hipótese de leitura de código e passou a
ter uma execução real apontando para ele.

Isso não é trabalho do B2 e não foi feito aqui — é o A2/`CAL-13`/`CAL-15`, e
está registrado para quando aquele bloco abrir.

### Orçamento

1 ciclo declarado, 1 consumido. Fechado: a parte estrutural pela medição local,
a parte contra loja real pela rodada em gru.

### O que eu não sei

Duas lojas que terminaram é amostra pequena demais para separar "metade das
lojas tem achado" de "quase toda loja tem achado", e as duas leituras levam a
promessas de landing diferentes. Firmar isso custa uma rodada com ~7 domínios a
mais — um comando, ~20 min de máquina, §2.2 respeitada porque cada domínio roda
uma vez só.
