/**
 * IMPORTANTE, para não se enganar com este arquivo:
 *
 * Estas fixtures NÃO são HTML de loja real. Elas testam a lógica de decisão —
 * dado um sinal, o adapter classifica certo? — e não a suposição de que uma
 * loja real emite aquele sinal.
 *
 * A validação contra loja real é outro teste, que só pode ser feito com rede
 * liberada. Enquanto isso não acontece, o que estes testes provam é que a
 * classificação está correta, não que a detecção acerta na Oscar Calçados.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectShopifySignals, isShopifyProductsJson } from '../src/platforms/shopify.ts'
import { collectVtexSignals, isVtexCatalogResponse } from '../src/platforms/vtex.ts'
import { collectNuvemshopSignals } from '../src/platforms/nuvemshop.ts'
import { collectWooSignals } from '../src/platforms/woocommerce.ts'
import { collectGenericSignals } from '../src/platforms/generic.ts'
import { gradeConfidence } from '../src/platforms/signals.ts'
import type { PageGlobals } from '../src/types.ts'

const EMPTY_GLOBALS: PageGlobals = {
  shopify: { present: false, shop: null, theme: null },
  vtex: { present: false, account: null },
  nuvemshop: { present: false },
  woocommerce: { present: false },
  scriptHosts: [],
}

function probe(over: Partial<{ html: string; headers: Record<string, string>; globals: PageGlobals }> = {}) {
  return {
    html: over.html ?? '<html><body></body></html>',
    headers: over.headers ?? {},
    globals: over.globals ?? EMPTY_GLOBALS,
  }
}

describe('Shopify — sinais da §6.2', () => {
  test('window.Shopify vale sinal forte e leva o shop junto', () => {
    const s = collectShopifySignals(
      probe({ globals: { ...EMPTY_GLOBALS, shopify: { present: true, shop: 'loja.myshopify.com', theme: 'Dawn' } } }),
    )
    assert.equal(s.length, 1)
    assert.equal(s[0]!.weight, 'high')
    assert.match(s[0]!.detail, /loja\.myshopify\.com/)
  })

  test('header x-shopid vale sinal forte', () => {
    const s = collectShopifySignals(probe({ headers: { 'x-shopid': '81234567' } }))
    assert.equal(s[0]!.weight, 'high')
    assert.match(s[0]!.detail, /81234567/)
  })

  test('cdn.shopify.com sozinho é médio, não forte', () => {
    const s = collectShopifySignals(probe({ globals: { ...EMPTY_GLOBALS, scriptHosts: ['cdn.shopify.com'] } }))
    assert.equal(s.length, 1)
    assert.equal(s[0]!.weight, 'medium')
    assert.equal(gradeConfidence(s), 'low')
  })

  test('cdn + myshopify juntos chegam a medium', () => {
    const s = collectShopifySignals(
      probe({ html: '<script src="https://cdn.shopify.com/x.js"></script> loja.myshopify.com' }),
    )
    assert.equal(gradeConfidence(s), 'medium')
  })

  test('página sem nada não gera sinal', () => {
    assert.equal(collectShopifySignals(probe()).length, 0)
  })

  test('não confunde CDN com o global (não duplica o mesmo sinal)', () => {
    const s = collectShopifySignals(
      probe({
        html: '<script src="https://cdn.shopify.com/a.js"></script>',
        globals: { ...EMPTY_GLOBALS, scriptHosts: ['cdn.shopify.com'] },
      }),
    )
    assert.equal(s.filter((x) => x.detail.includes('cdn.shopify.com')).length, 1)
  })
})

describe('Shopify — validação de /products.json', () => {
  test('aceita catálogo com handle e variants', () => {
    const body = JSON.stringify({ products: [{ handle: 'tenis', variants: [{ id: 1 }] }] })
    assert.equal(isShopifyProductsJson(body), true)
  })
  test('aceita loja vazia', () => {
    assert.equal(isShopifyProductsJson('{"products":[]}'), true)
  })
  test('recusa HTML', () => {
    assert.equal(isShopifyProductsJson('<html>404</html>'), false)
  })
  test('recusa JSON de outra forma', () => {
    assert.equal(isShopifyProductsJson('{"items":[]}'), false)
    assert.equal(isShopifyProductsJson('{"products":{}}'), false)
    assert.equal(isShopifyProductsJson('[]'), false)
  })
  test('recusa produto sem os campos que provam o formato', () => {
    assert.equal(isShopifyProductsJson('{"products":[{"nome":"x"}]}'), false)
  })
})

describe('VTEX', () => {
  test('vtexassets.com vale forte', () => {
    const s = collectVtexSignals(probe({ globals: { ...EMPTY_GLOBALS, scriptHosts: ['loja.vtexassets.com'] } }))
    assert.equal(gradeConfidence(s), 'high')
  })
  test('header x-vtex-* vale forte', () => {
    const s = collectVtexSignals(probe({ headers: { 'x-vtex-remote-cache': 'true' } }))
    assert.equal(s[0]!.weight, 'high')
  })
  test('vtexcommercestable no HTML vale forte', () => {
    const s = collectVtexSignals(probe({ html: 'https://loja.vtexcommercestable.com.br/api' }))
    assert.equal(gradeConfidence(s), 'high')
  })
  test('catálogo válido é array com productId', () => {
    assert.equal(isVtexCatalogResponse('[{"productId":"1","productName":"x"}]'), true)
    assert.equal(isVtexCatalogResponse('[]'), true)
    assert.equal(isVtexCatalogResponse('{"products":[]}'), false)
  })
})

describe('Nuvemshop', () => {
  test('window.LS sozinho é MEDIUM — LS é nome genérico demais para valer certeza', () => {
    const s = collectNuvemshopSignals(probe({ globals: { ...EMPTY_GLOBALS, nuvemshop: { present: true } } }))
    assert.equal(s[0]!.weight, 'medium')
    assert.equal(gradeConfidence(s), 'low')
  })
  test('marca no HTML vale forte', () => {
    const s = collectNuvemshopSignals(probe({ html: '<script src="//x.nuvemshop.com.br/a.js">' }))
    assert.equal(gradeConfidence(s), 'high')
  })
  test('tiendanube também conta', () => {
    assert.equal(gradeConfidence(collectNuvemshopSignals(probe({ html: 'cdn.tiendanube.com' }))), 'high')
  })
})

describe('WooCommerce', () => {
  test('caminho do plugin vale forte', () => {
    const s = collectWooSignals(probe({ html: '/wp-content/plugins/woocommerce/assets/css/woocommerce.css' }))
    assert.equal(gradeConfidence(s), 'high')
  })
  test('classe no body vale médio', () => {
    const s = collectWooSignals(probe({ html: '<body class="home woocommerce-page woocommerce">' }))
    assert.equal(s.length, 1)
    assert.equal(s[0]!.weight, 'medium')
  })
  test('a palavra woocommerce solta no texto não vale sinal', () => {
    assert.equal(collectWooSignals(probe({ html: '<p>migramos do woocommerce ano passado</p>' })).length, 0)
  })
})

describe('Fallback genérico', () => {
  test('reconhece link de carrinho', () => {
    const s = collectGenericSignals({ html: '<a href="/carrinho">Carrinho</a>' })
    assert.equal(s.length, 1)
    assert.equal(s[0]!.weight, 'low')
  })
  test('reconhece JSON-LD de produto', () => {
    const s = collectGenericSignals({ html: '<script type="application/ld+json">{"@type":"Product"}</script>' })
    assert.ok(s.some((x) => x.detail.includes('schema.org/Product')))
  })
  test('página institucional não gera indicador', () => {
    assert.equal(collectGenericSignals({ html: '<html><h1>Sobre nós</h1></html>' }).length, 0)
  })
  test('nunca passa de low', () => {
    const s = collectGenericSignals({ html: '<a href="/cart">x</a><meta property="og:type" content="product">' })
    assert.equal(gradeConfidence(s), 'low')
  })
})

describe('gradeConfidence', () => {
  test('um forte basta', () => {
    assert.equal(gradeConfidence([{ where: 'global', detail: 'x', weight: 'high' }]), 'high')
  })
  test('dois médios viram medium', () => {
    assert.equal(
      gradeConfidence([
        { where: 'html', detail: 'a', weight: 'medium' },
        { where: 'html', detail: 'b', weight: 'medium' },
      ]),
      'medium',
    )
  })
  test('um médio fica em low', () => {
    assert.equal(gradeConfidence([{ where: 'html', detail: 'a', weight: 'medium' }]), 'low')
  })
})
