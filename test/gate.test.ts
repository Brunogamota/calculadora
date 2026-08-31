import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRobotsGate } from '../src/lib/gate.ts'
import { parseRobots, evaluateRules } from '../src/lib/robots.ts'
import type { RobotsPolicy } from '../src/lib/robots.ts'

/** Política a partir de um robots.txt de texto, como o motor monta em produção. */
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

// Formato observado nas lojas testadas: /checkout e /cart proibidos, produto liberado.
const LOJA_COM_CHECKOUT_BLOQUEADO = `
User-agent: *
Disallow: /checkout
Disallow: /cart
Disallow: /*/checkouts/
`

describe('RobotsGate — padrão respeita robots', () => {
  const gate = createRobotsGate(policyFrom(LOJA_COM_CHECKOUT_BLOQUEADO))

  test('libera home e página de produto', () => {
    assert.equal(gate.check('https://loja.com.br/').allowed, true)
    assert.equal(gate.check('https://loja.com.br/products/tenis').allowed, true)
  })

  test('bloqueia /checkout e informa o caminho', () => {
    const r = gate.check('https://loja.com.br/checkout')
    assert.equal(r.allowed, false)
    assert.equal(r.reason, 'robots-disallowed')
    assert.equal(r.allowed === false ? r.path : null, '/checkout')
  })

  test('bloqueia /cart', () => {
    assert.equal(gate.check('https://loja.com.br/cart').allowed, false)
  })

  test('não registra override quando não há titularidade', () => {
    assert.equal(gate.ownerVerified, false)
    assert.equal(gate.overrides.length, 0)
  })

  test('considera a query string no caminho avaliado', () => {
    const g = createRobotsGate(policyFrom('User-agent: *\nDisallow: /*?step=payment\n'))
    assert.equal(g.check('https://loja.com.br/x?step=payment').allowed, false)
    assert.equal(g.check('https://loja.com.br/x').allowed, true)
  })
})

describe('RobotsGate — exceção por titularidade', () => {
  test('com --owner-verified o checkout roda mesmo bloqueado', () => {
    const gate = createRobotsGate(policyFrom(LOJA_COM_CHECKOUT_BLOQUEADO), { ownerVerified: true })
    const r = gate.check('https://loja.com.br/checkout')
    assert.equal(r.allowed, true)
    assert.equal(r.reason, 'owner-verified-override')
  })

  test('cada override fica registrado com caminho e horário', () => {
    const gate = createRobotsGate(policyFrom(LOJA_COM_CHECKOUT_BLOQUEADO), { ownerVerified: true })
    gate.check('https://loja.com.br/checkout')
    gate.check('https://loja.com.br/cart')
    assert.equal(gate.overrides.length, 2)
    assert.deepEqual(gate.overrides.map((o) => o.path), ['/checkout', '/cart'])
    assert.ok(!Number.isNaN(Date.parse(gate.overrides[0]!.at)))
  })

  test('caminho permitido não vira override', () => {
    const gate = createRobotsGate(policyFrom(LOJA_COM_CHECKOUT_BLOQUEADO), { ownerVerified: true })
    const r = gate.check('https://loja.com.br/products/x')
    assert.equal(r.reason, 'robots-allowed')
    assert.equal(gate.overrides.length, 0)
  })

  test('loja sem restrição não precisa de override nem com a flag', () => {
    const gate = createRobotsGate(policyFrom('User-agent: *\nDisallow:\n'), { ownerVerified: true })
    assert.equal(gate.check('https://loja.com.br/checkout').reason, 'robots-allowed')
    assert.equal(gate.overrides.length, 0)
  })
})
