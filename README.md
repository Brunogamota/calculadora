# Raio-X do Checkout — motor

Fase 1 do projeto descrito em `raio-x-checkout-projeto-completo.md`, que é a
fonte da verdade e tem precedência sobre este README.

CLI de terminal: recebe uma URL, roda a jornada de compra numa loja Shopify e
imprime JSON tipado, salvando screenshots em disco. Sem UI, sem fila, sem banco.

## Estado

| Bloco | Escopo | Estado |
|---|---|---|
| 1 | Guards, normalização de URL, SSRF, robots.txt, rate limit, blocklist | **pronto** |
| 2 | Detecção de plataforma (§6.2) + portão de robots | **pronto** |
| 3a | Jornada Shopify: produto -> carrinho (§6.3, §6.4) | **pronto** |
| 3b | Jornada Shopify: carrinho -> tela de pagamento (§6.5, §6.6) | bloqueado por decisão de produto |
| 4 | Checagens (§8) e saída JSON | a fazer |

## Rodando

```bash
npm install
npm run preflight -- <url-da-loja> --pretty   # bloco 1
npm run detect    -- <url-da-loja> --pretty   # bloco 2 (abre o browser)
npm run audit     -- <url-da-loja> --pretty   # bloco 3a (jornada + screenshots)
npm test                                     # 115 testes, tudo offline
npm run smoke                                # valida o browser de verdade
npm run typecheck
```

Na primeira vez:

```bash
npx playwright install chromium            # baixa o browser
sudo npx playwright install-deps chromium  # bibliotecas do sistema (Linux)
```

Sem o segundo comando o launch falha com `BROWSER_LAUNCH_FAILED` dizendo qual
dos dois rodar.

Em servidor ou devcontainer sem tela, prefixe com `xvfb-run -a` (instale com
`apt-get install -y xvfb`) ou passe `--headless`. O padrão do projeto é
`headless: false` (§19), então sem display o motor **falha com a mensagem
explicando** em vez de cair para headless em silêncio — ver a tela é o que
permite depurar loja real.

Screenshots vão para `out/<domínio>/`.

## Limites (§2)

Estes limites são arquitetura, não aviso legal:

- nunca finalizar pedido nem submeter dado de pagamento
- nunca testar antifraude de terceiros
- robots.txt respeitado e no máximo 1 requisição por segundo por domínio
- User-Agent identificável: `RebornCheckoutAudit/1.0 (+https://rebornpay.io/raio-x)`
- SSRF barrado: IP direto, localhost, faixas privadas, e redirect que caia nelas
- checagem que não pôde ser feita com certeza sai como não aplicável, nunca como suposição

## robots.txt e a exceção por titularidade

Por padrão robots é respeitado. Quando ele proíbe um caminho que a jornada
precisaria — `/checkout` e `/cart` costumam estar proibidos —, a auditoria roda
até onde é permitido e:

- a etapa sai como `not_permitted_by_robots`
- as checagens que dependem dela saem como **não aplicáveis**, nunca como falha
  da loja
- o relatório fica `partial`, com o motivo explícito

A exceção é titularidade confirmada: quando o dono pede a auditoria da própria
loja e comprova que é dono, o checkout é auditado mesmo com robots bloqueando.

Na Fase 1 isso é só a flag `--owner-verified`, **sem verificação nenhuma** — a
titularidade é declarada, não provada. A prova por meta tag ou DNS entra na
Fase 3. Todo override usado fica registrado com caminho e horário, para o
relatório mostrar sob qual autorização a etapa rodou.

## Bloco 2 — detecção de plataforma

Ordem da §6.2: Shopify, VTEX, Nuvemshop, WooCommerce, fallback genérico. Quando
mais de uma casa, vence a primeira da ordem e as outras vão para `alternatives`
— o empate fica visível em vez de sumir.

Cada sinal entra no resultado com origem e peso, então dá para ver **em que** a
detecção se baseou:

```json
"signals": [
  { "where": "global",   "detail": "window.Shopify presente (shop: x.myshopify.com)", "weight": "high" },
  { "where": "header",   "detail": "header x-shopid: 81234567",                       "weight": "high" },
  { "where": "endpoint", "detail": "/products.json respondeu 200 com catálogo válido","weight": "high" }
]
```

Além dos sinais, a evidência pode trazer `notes`: observações que **não** provam
plataforma mas mudam a jornada. Uma loja VTEX com storefront headless deco.cx
tem checkout de VTEX e DOM que não é o de VTEX — quem audita precisa saber das
duas coisas, e elas não podem morar no mesmo campo.

Nota: `high` com um sinal forte, `medium` com dois médios, `low` no resto. Casos
em que a graduação foi deliberadamente rebaixada:

- `window.LS` (Nuvemshop) vale médio, não forte — `LS` é nome curto demais para
  valer certeza sozinho
- `cdn.shopify.com` vale médio: uma loja de outra plataforma pode carregar um
  botão do Shopify
- o fallback genérico nunca passa de `low` e **nunca** afirma plataforma

### Quando a loja não é identificada

O HTML renderizado é salvo automaticamente em `out/` sempre que a detecção cai
no fallback genérico (§19: "salve o HTML das lojas que falharem"). O caminho sai
no campo `htmlSavedTo`. Para extrair evidência dele sem ler tudo:

```bash
npm run sniff -- out/www.loja.com.br-home.html
```

Imprime hosts citados, globais definidos em script inline, meta generator e
contagem de tokens de plataforma. É o insumo para criar um sinal novo **com base
no HTML real**, em vez de adivinhar um seletor.

Tentativa de endpoint que não confirma também vira sinal (`weight: low`), para
o rastro mostrar o que foi testado em vez de o silêncio parecer que ninguém
olhou.

Só o Shopify terá jornada (Bloco 3). As demais apenas identificam, conforme
a §17 — `journeySupported` diz qual é o caso.

## Bloco 3a — jornada até o carrinho

`audit` encontra um produto, adiciona ao carrinho e para. Screenshot em cada
etapa, trilha com URL, timestamp e desfecho.

O que é **contrato público do Shopify**, e por isso não é chute:

| Rota | Uso |
|---|---|
| `/products.json` | catálogo, para escolher o produto |
| `/cart.js` | confirmar o carrinho por API (§6.4) |
| `/products/:handle?variant=:id` | pré-seleciona a variação sem clicar em seletor de tema |

Esse último resolve o problema mais chato da jornada: escolher variação sem
depender do DOM do tema. O Shopify aceita a variação na query string, então a
jornada não precisa adivinhar como o tema desenhou o seletor de tamanho.

**O único ponto que depende de DOM é o botão de comprar**, e ele mora em
`src/platforms/shopify.selectors.ts` com a origem de cada seletor declarada:

- `platform-contract` — vale em qualquer tema (`form[action*="/cart/add"]` é a
  rota do Shopify)
- `aria` — padrão do HTML, não específico de loja
- `theme-convention` — convenção dos temas oficiais, **pode falhar** em tema
  customizado

Nenhum casou? A etapa falha dizendo quais foram tentados. Sem fallback
silencioso, que é como seletor errado passa despercebido.

### Escolha do produto (§6.3)

Disponível, sem variação obrigatória, e o mais barato dentro disso. Vale-presente
é pulado de propósito: não tem frete e distorce a jornada de checkout. Preço que
não dá para ler vira `null` e vai para o fim da fila, nunca para zero.

### Overlay cobrindo o botão de comprar

Modal de região, banner de cookie e popup de newsletter cobrem o botão de
comprar e o comprador não consegue clicar. Isso **não é obstáculo técnico, é
achado** — e vai para o resultado como tal:

```json
"overlay": {
  "present": true,
  "identity": "div#cozyCRModal.CozyContainerClassCR",
  "dismissed": false,
  "dismissAttempts": ["Escape", "aria-close-en"],
  "clickRequiredForce": true
}
```

Quem está cobrindo o botão é descoberto por `elementFromPoint` no centro dele —
medida real do que o dedo do comprador acertaria, não palpite sobre classe de
tema. A dispensa tenta Esc e depois rótulo acessível de fechar. Se o overlay
resistir, o clique acontece à força para registrar o carrinho, mas
`clickRequiredForce` marca que **um comprador não teria conseguido**.

### Drawer, modal ou redirect

Decidido por **medida**, não por classe de tema: um drawer ocupa a altura toda,
é estreito e fica colado numa borda. Quando a medida não decide, sai `unknown`.

## Bloco 1 — o que o preflight faz

Roda inteiro antes de qualquer browser abrir. Se não passa, a auditoria não começa.

1. **Normaliza** a URL: aceita com ou sem protocolo, com ou sem `www`, tira
   fragmento e ponto final do hostname.
2. **Valida a forma**: rejeita esquema não-http, credencial embutida, porta fora
   de 80/443, IP literal (inclusive nas formas decimal, octal, hex e IPv6), hostname
   reservado (`localhost`, `.internal`, `.local`, `.onion`…) e rótulo único.
3. **Resolve o host** e exige que *todo* endereço retornado seja unicast público.
4. **Checa a blocklist** (`blocklist.txt`), antes e depois dos redirects.
5. **Abre a home** seguindo até 5 redirects, revalidando cada hop com as mesmas
   regras. Home sem 2xx vira falha explicada, nunca "auditoria ok".
6. **Lê o robots.txt** do domínio final e aplica `Crawl-delay` ao rate limit.

### Duas decisões que valem registrar

**A checagem de SSRF acontece duas vezes, e a segunda é a que importa.** Validar o
IP antes de conectar não fecha DNS rebinding: o DNS pode responder um endereço
público na checagem e um privado no connect. Por isso o `safeFetch` é escrito sobre
`node:https` em vez de `fetch` — só assim dá para passar um `lookup` que reprova o
endereço no momento exato da conexão.

**O orçamento global corta, não só avisa.** `assertAlive` só vale nos pontos em
que é chamado — uma etapa que trava entre dois checkpoints passaria por cima
dele para sempre. Por isso a execução inteira corre contra o deadline
(`MAX_AUDIT_MS`, padrão 120s) e o browser é fechado aconteça o que acontecer.
Execução travada termina em `DEADLINE_EXCEEDED`, nunca pendurada.

**robots.txt indisponível falha fechado.** 4xx libera tudo (RFC 9309), mas 5xx e
erro de rede proíbem a coleta. Na dúvida, não se bate na loja.

## Estrutura

```
src/
  cli.ts              entrypoint
  preflight.ts        bloco 1 encadeado
  lib/
    guards.ts         normalização + SSRF (§6.1, §2.5)
    ipranges.ts       classificação de faixas IPv4/IPv6
    http.ts           safeFetch: UA, rate limit, redirect revalidado, guard no connect
    robots.ts         parser e política (§2.3)
    ratelimit.ts      1 req/s por domínio
    blocklist.ts      §2.6
    deadline.ts       orçamento global de 120s, que CORTA (§14)
    errors.ts         códigos estáveis -> errorReason
    gate.ts           portão de robots + exceção por titularidade
    browser.ts        Playwright: launch, guard de route, captura da sonda
  detect.ts           bloco 2 encadeado
  types.ts            PlatformAdapter e tipos da jornada (Fase 3: /packages/types)
  platforms/
    index.ts          registry na ordem da §6.2
    signals.ts        extração de sinais (puro, testável)
    shopify.ts vtex.ts nuvemshop.ts woocommerce.ts generic.ts
scripts/
  smoke-browser.ts    valida browser, globais e guard de route
test/                 offline, sem rede
```

### O que os testes provam, e o que não provam

Os 115 testes são todos offline. Eles provam que a **lógica de decisão** está
correta: dado um sinal, o adapter classifica certo. Eles **não** provam que uma
loja real emite aquele sinal — isso só se valida com rede liberada, contra loja
de verdade. As fixtures de `test/platforms.test.ts` são formas de sinal, não
HTML de loja capturado.
