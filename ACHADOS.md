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
