/**
 * Página de desafio antibot.
 *
 * Observado na Insider Store depois de várias auditorias seguidas do mesmo IP:
 * a loja passou a servir uma página de 10 KB com `_cf_chl_opt` no lugar da
 * página de produto. Sem reconhecer isso, o motor dizia "formulário de
 * adicionar ao carrinho não encontrado" — culpando a loja por algo que não é
 * defeito dela.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { detectBotChallenge } from '../src/lib/challenge.ts'

const DESAFIO_CLOUDFLARE = `
<html><head><title>Just a moment...</title>
<script>window._cf_chl_opt={cvId:'3',cType:'managed'};</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
</head><body><div id="challenge-running">Verificando…</div></body></html>
`

/** Loja de verdade que usa Cloudflare como CDN, sem desafiar ninguém. */
const LOJA_ATRAS_DE_CLOUDFLARE = `
<html><head><script src="https://cdn.shopify.com/x.js"></script></head>
<body><form action="/cart/add" method="post"><button name="add">Comprar</button></form>
${'<div>conteúdo real da loja</div>'.repeat(4000)}
</body></html>
`

describe('detectBotChallenge', () => {
  test('reconhece o desafio da Cloudflare', () => {
    const c = detectBotChallenge(DESAFIO_CLOUDFLARE, 'https://loja.com.br/products/x')
    assert.equal(c?.vendor, 'Cloudflare')
    assert.ok(c!.signals.some((s) => s.includes('_cf_chl_opt')))
  })

  test('a evidência inclui o tamanho e a URL, para o relatório poder mostrar', () => {
    const c = detectBotChallenge(DESAFIO_CLOUDFLARE, 'https://loja.com.br/products/x')
    assert.ok(c!.signals.some((s) => s.includes('KB')))
    assert.ok(c!.signals.some((s) => s.includes('loja.com.br/products/x')))
  })

  test('loja grande atrás de Cloudflare NÃO é desafio', () => {
    // Marcador de fornecedor sozinho não basta: milhares de lojas usam
    // Cloudflare como CDN. O que caracteriza o desafio é a página pequena.
    assert.equal(detectBotChallenge(LOJA_ATRAS_DE_CLOUDFLARE, 'https://loja.com.br/p'), null)
  })

  test('página normal não vira desafio', () => {
    assert.equal(detectBotChallenge('<html><body>loja</body></html>', 'https://loja.com.br/'), null)
  })

  test('reconhece outros fornecedores', () => {
    assert.equal(detectBotChallenge('<html>datadome captcha</html>', 'https://x.com')?.vendor, 'DataDome')
    assert.equal(detectBotChallenge('<html>px-captcha</html>', 'https://x.com')?.vendor, 'PerimeterX')
  })
})
