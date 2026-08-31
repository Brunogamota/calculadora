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
| 3 | Jornada Shopify (§6.3–6.6) | a fazer |
| 4 | Checagens (§8) e saída JSON | a fazer |

## Rodando

```bash
npm install
npm run preflight -- loja.com.br --pretty   # bloco 1
npm run detect    -- loja.com.br --pretty   # bloco 2 (abre o browser)
npm test                                     # 115 testes, tudo offline
npm run smoke                                # valida o browser de verdade
npm run typecheck
```

Em servidor sem tela, prefixe com `xvfb-run -a` — o padrão do projeto é
`headless: false` (§19), e sem display o motor falha com mensagem explicando,
em vez de estourar cru. `--headless` desliga.

`npm run audit` só passa a existir a partir do bloco 3.

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

Nota: `high` com um sinal forte, `medium` com dois médios, `low` no resto. Casos
em que a graduação foi deliberadamente rebaixada:

- `window.LS` (Nuvemshop) vale médio, não forte — `LS` é nome curto demais para
  valer certeza sozinho
- `cdn.shopify.com` vale médio: uma loja de outra plataforma pode carregar um
  botão do Shopify
- o fallback genérico nunca passa de `low` e **nunca** afirma plataforma

Só o Shopify terá jornada (Bloco 3). As demais apenas identificam, conforme
a §17 — `journeySupported` diz qual é o caso.

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
    deadline.ts       orçamento global de 120s (§14)
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
