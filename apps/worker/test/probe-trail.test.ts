/**
 * O rastro de evidência tem que registrar a tentativa que NÃO confirmou.
 * Silêncio faz parecer que ninguém consultou o endpoint, e "não olhei" lido
 * como "olhei e não achei" é o começo de um resultado inventado.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { vtexAdapter } from '../src/platforms/vtex.ts'
import { shopifyAdapter } from '../src/platforms/shopify.ts'
import { createRobotsGate } from '../src/lib/gate.ts'
import { parseRobots, evaluateRules, type RobotsPolicy } from '../src/lib/robots.ts'
import type { DetectionProbe, PageGlobals } from '../src/types.ts'

const NO_GLOBALS: PageGlobals = {
  shopify: { present: false, shop: null, theme: null },
  vtex: { present: false, account: null },
  nuvemshop: { present: false },
  woocommerce: { present: false },
  scriptHosts: [],
}

function policyFrom(txt: string): RobotsPolicy {
  const parsed = parseRobots(txt, 'reborncheckoutaudit')
  return {
    source: 'fetched',
    status: 200,
    matchedAgent: parsed.matchedAgent,
    crawlDelayMs: parsed.crawlDelayMs,
    reason: 'teste',
    isAllowed: (path: string) => evaluateRules(parsed.rules, path),
  }
}

function fakeProbe(html: string, robotsTxt: string): DetectionProbe {
  return {
    page: null as never,
    html,
    headers: {},
    baseUrl: 'https://loja.com.br',
    globals: NO_GLOBALS,
    gate: createRobotsGate(policyFrom(robotsTxt)),
    fetch: (async () => {
      throw new Error('não deveria ser chamado quando o robots proíbe')
    }) as never,
  }
}

const BLOQUEIA_API = 'User-agent: *\nDisallow: /api\nDisallow: /products.json\n'
const VTEX_HTML = '<img src="https://zeedog.vteximg.com.br/arquivos/x.png">'
const SHOPIFY_HTML = '<script src="https://cdn.shopify.com/a.js"></script> loja.myshopify.com'

describe('rastro do probe quando o robots proíbe', () => {
  test('VTEX registra que o catalog_system não foi consultado', async () => {
    const evidence = await vtexAdapter.detect(fakeProbe(VTEX_HTML, BLOQUEIA_API))
    assert.ok(evidence)
    const trail = evidence.signals.filter((s) => s.where === 'endpoint')
    assert.equal(trail.length, 1, 'a tentativa bloqueada precisa aparecer no rastro')
    assert.match(trail[0]!.detail, /proibido pelo robots/)
    assert.equal(trail[0]!.weight, 'low')
  })

  test('Shopify registra que o /products.json não foi consultado', async () => {
    const evidence = await shopifyAdapter.detect(fakeProbe(SHOPIFY_HTML, BLOQUEIA_API))
    assert.ok(evidence)
    const trail = evidence.signals.filter((s) => s.where === 'endpoint')
    assert.equal(trail.length, 1)
    assert.match(trail[0]!.detail, /proibido pelo robots/)
  })

  test('a tentativa bloqueada não infla a confiança', async () => {
    const evidence = await vtexAdapter.detect(fakeProbe(VTEX_HTML, BLOQUEIA_API))
    // o sinal forte do CDN é que sustenta o high; o low do robots não conta
    assert.equal(evidence?.confidence, 'high')
    assert.ok(evidence.signals.some((s) => s.weight === 'high'))
  })

  test('sinal fraco sozinho não vira plataforma detectada', async () => {
    // HTML sem nenhum sinal de VTEX: só o registro do probe bloqueado não basta
    const evidence = await vtexAdapter.detect(fakeProbe('<html>loja qualquer</html>', BLOQUEIA_API))
    assert.equal(evidence, null)
  })
})
