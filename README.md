# Raio-X do Checkout — motor

Fase 1 do projeto descrito em `raio-x-checkout-projeto-completo.md`, que é a
fonte da verdade e tem precedência sobre este README.

CLI de terminal: recebe uma URL, roda a jornada de compra numa loja Shopify e
imprime JSON tipado, salvando screenshots em disco. Sem UI, sem fila, sem banco.

## Estado

| Bloco | Escopo | Estado |
|---|---|---|
| 1 | Guards, normalização de URL, SSRF, robots.txt, rate limit, blocklist | **pronto** |
| 2 | Detecção de plataforma (§6.2) | a fazer |
| 3 | Jornada Shopify (§6.3–6.6) | a fazer |
| 4 | Checagens (§8) e saída JSON | a fazer |

## Rodando

```bash
npm install
npm run preflight -- loja.com.br --pretty   # bloco 1
npm test                                     # 78 testes, tudo offline
npm run typecheck
```

`npm run audit` só passa a existir a partir do bloco 3.

## Limites (§2)

Estes limites são arquitetura, não aviso legal:

- nunca finalizar pedido nem submeter dado de pagamento
- nunca testar antifraude de terceiros
- robots.txt respeitado e no máximo 1 requisição por segundo por domínio
- User-Agent identificável: `RebornCheckoutAudit/1.0 (+https://rebornpay.io/raio-x)`
- SSRF barrado: IP direto, localhost, faixas privadas, e redirect que caia nelas
- checagem que não pôde ser feita com certeza sai como não aplicável, nunca como suposição

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
test/                 offline, sem rede
```
