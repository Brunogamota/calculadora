/**
 * Diferente de test/platforms.test.ts, estas fixtures são fragmentos REAIS,
 * copiados da saída do `sniff` sobre o HTML renderizado das lojas em
 * 2026-08-31. Elas cobrem o caso que fez a Zee Dog cair no fallback genérico.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectVtexSignals, extractVtexAccount } from '../src/platforms/vtex.ts'
import { detectStorefront } from '../src/platforms/storefront.ts'
import { gradeConfidence } from '../src/platforms/signals.ts'
import type { PageGlobals } from '../src/types.ts'

const NO_GLOBALS: PageGlobals = {
  shopify: { present: false, shop: null, theme: null },
  vtex: { present: false, account: null },
  nuvemshop: { present: false },
  woocommerce: { present: false },
  scriptHosts: [],
}

// Zee Dog: nenhum global de plataforma, e o único rastro de VTEX no HTML inteiro
// é uma imagem de menu no CDN legado.
const ZEEDOG_REAL =
  '<li data-imgsrc="https://zeedog.vteximg.com.br/arquivos/menu-dropdown-zeedog-cachorros-reposicao.png" ' +
  'class="menu-link-dk relative flex flex-c"><link rel="dns-prefetch" href="https://d.lilstts.com/events">' +
  '<link rel="icon" href="https://decoims.com/zeedog/7e3e9578-6458-46b0-a643-8c0dcd8b3145/deco_assets_2225.png">'

// Oscar Calçados: assets no vtexassets com a conta grupooscar, mais secure.vtex.com.
const OSCAR_REAL =
  '<img src="https://grupooscar.vtexassets.com/arquivos/ids/11250061/999999992766024-Image-1.jpg?v=639223228940570000" ' +
  'alt="" width="278"><a href="https://secure.vtex.com/?an=grupooscar">Minha conta</a>' +
  '<img src="https://decoims.com/oscarcalcados/355f1d67-6391-437c-8ef4-49864211bd28/logo.png">'

describe('Zee Dog — a loja que caía no fallback genérico', () => {
  test('vteximg.com.br agora produz sinal de VTEX', () => {
    const signals = collectVtexSignals({ html: ZEEDOG_REAL, headers: {}, globals: NO_GLOBALS })
    assert.ok(signals.length > 0, 'sem sinal, a loja volta a cair no genérico')
    assert.equal(gradeConfidence(signals), 'high')
  })

  test('extrai a conta VTEX do subdomínio', () => {
    assert.equal(extractVtexAccount(ZEEDOG_REAL), 'zeedog')
  })

  test('o sinal cita a conta, não só o domínio', () => {
    const signals = collectVtexSignals({ html: ZEEDOG_REAL, headers: {}, globals: NO_GLOBALS })
    assert.match(signals[0]!.detail, /zeedog/)
  })

  test('reconhece o storefront deco.cx', () => {
    const hint = detectStorefront(ZEEDOG_REAL, NO_GLOBALS)
    assert.equal(hint?.name, 'deco.cx')
  })
})

describe('Oscar Calçados — detectada, agora com evidência melhor', () => {
  test('extrai a conta grupooscar', () => {
    assert.equal(extractVtexAccount(OSCAR_REAL), 'grupooscar')
  })

  test('secure.vtex.com entra como sinal do checkout', () => {
    const signals = collectVtexSignals({ html: OSCAR_REAL, headers: {}, globals: NO_GLOBALS })
    assert.ok(signals.some((s) => s.detail.includes('secure.vtex.com')))
  })

  test('deixa de depender de um sinal só', () => {
    const signals = collectVtexSignals({ html: OSCAR_REAL, headers: {}, globals: NO_GLOBALS })
    assert.ok(signals.length >= 2, `esperava 2+ sinais, veio ${signals.length}`)
  })

  test('também roda deco.cx', () => {
    assert.equal(detectStorefront(OSCAR_REAL, NO_GLOBALS)?.name, 'deco.cx')
  })
})

describe('extractVtexAccount — bordas', () => {
  test('não confunde o domínio da loja com a conta', () => {
    assert.equal(extractVtexAccount('<a href="https://www.zeedog.com.br/x">loja</a>'), null)
  })
  test('devolve null quando não há CDN da VTEX', () => {
    assert.equal(extractVtexAccount('<img src="https://cdn.shopify.com/a.png">'), null)
  })
  test('aceita conta com hífen', () => {
    assert.equal(extractVtexAccount('https://grupo-oscar.vtexassets.com/x.png'), 'grupo-oscar')
  })
})

describe('detectStorefront — não confunde storefront com plataforma', () => {
  test('loja sem storefront headless não gera nota', () => {
    assert.equal(detectStorefront('<html><body>loja comum</body></html>', NO_GLOBALS), null)
  })
  test('pega decoims vindo dos scriptHosts', () => {
    const hint = detectStorefront('<html></html>', { ...NO_GLOBALS, scriptHosts: ['decoims.com'] })
    assert.equal(hint?.name, 'deco.cx')
  })
})
