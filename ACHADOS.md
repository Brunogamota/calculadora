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
