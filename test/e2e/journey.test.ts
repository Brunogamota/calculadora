/**
 * Jornada ponta a ponta contra a loja falsa.
 *
 * Isto NAO substitui teste contra loja real: a loja falsa responde o que eu
 * espero, e por isso nao prova que uma loja real responde igual. O que prova e
 * que o codigo da jornada funciona quando a loja segue o contrato publico do
 * Shopify -- e e essa a classe de bug que vinha aparecendo uma por vez em
 * producao: corrida de DOM, sessao de carrinho, parsing, overlay.
 *
 * Cada cenario aqui reproduz um bug que aconteceu de verdade. Cada um roda UMA
 * auditoria e faz varias asseroes em cima dela: subir browser custa ~12s.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { audit, type AuditResult } from '../../src/audit.ts'
import { startFakeStore, type FakeStore } from '../fixtures/fake-shopify.ts'
import type { FakeStoreOptions } from '../fixtures/fake-shopify.ts'

process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'

const OUT = 'out/.test'
const BASE = { headed: false, outDir: OUT, force: true } as const

/** Uma loja, uma auditoria, muitas asserções. */
async function auditFake(
  storeOptions: FakeStoreOptions,
  auditOptions: Record<string, unknown> = {},
): Promise<{ result: AuditResult; store: FakeStore }> {
  const store = await startFakeStore(storeOptions)
  const result = await audit(store.url, { ...BASE, ...auditOptions })
  return { result, store }
}

describe('jornada do produto ao carrinho', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    const run = await auditFake({})
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('detecta Shopify', () => {
    assert.equal(result.platform, 'shopify', result.errorReason ?? '')
  })

  test('escolhe o mais barato disponível (§6.3)', () => {
    assert.equal(result.product?.title, 'Camiseta Básica')
    assert.equal(result.product?.priceCents, 8990)
  })

  test('pula o produto esgotado', () => {
    assert.notEqual(result.product?.title, 'Meia Esgotada')
  })

  test('confirma o carrinho por /cart.js usando a sessão do BROWSER', () => {
    // O bug real: /cart.js era lido por node:https, sem os cookies do browser,
    // devolvendo sempre o carrinho de outro visitante -- itemCount 0.
    assert.equal(result.cart?.ok, true, result.cart?.cartReadNote ?? '')
    assert.equal(result.cart?.itemCount, 1)
    assert.equal(result.cart?.cartReadNote, null)
  })

  test('a auditoria completa fica dentro do orçamento da §18', () => {
    assert.ok(result.timings.totalMs < 90_000, `${result.timings.totalMs}ms`)
  })
})

describe('formulário injetado depois do carregamento', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    // Insider Store: encontrava o formulário nas rodadas lentas e não nas
    // rápidas, porque count() lê o DOM daquele instante.
    const run = await auditFake({ formDelayMs: 3000 })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('espera o elemento aparecer em vez de fotografar o DOM', () => {
    assert.equal(result.cart?.ok, true, result.errorReason ?? '')
  })
})

describe('catálogo com produto de R$ 0', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    const run = await auditFake({ includeZeroPriceProduct: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('não escolhe o item de teste', () => {
    assert.notEqual(result.product?.title, 'Teste de valor 0')
    assert.equal(result.product?.priceCents, 8990)
  })
})

describe('loja servindo desafio antibot', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    const run = await auditFake({ botChallenge: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('vira BOT_CHALLENGE, não "formulário não encontrado"', () => {
    assert.equal(result.errorCode, 'BOT_CHALLENGE')
  })

  test('e diz que não é achado contra a loja', () => {
    assert.match(result.incompleteBecause.join(' '), /NÃO é achado contra a loja/)
  })
})

describe('robots proibindo /checkout', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    const run = await auditFake({ blockCheckout: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('sai partial com a etapa marcada, não como erro', () => {
    assert.equal(result.status, 'partial')
    assert.deepEqual(result.robots.blockedPaths, ['/checkout'])
    assert.equal(result.steps.at(-1)?.outcome.status, 'not_permitted_by_robots')
    assert.equal(result.errorCode, null, 'etapa não permitida não é erro')
  })

  test('o carrinho ainda foi auditado', () => {
    assert.equal(result.cart?.ok, true)
  })
})

describe('overlay cobrindo o botão de comprar', { concurrency: false }, () => {
  let geo: AuditResult
  let consent: AuditResult
  let lojaGeo: FakeStore
  let lojaConsent: FakeStore

  before(async () => {
    const a = await auditFake({ overlay: 'geo-redirect' })
    geo = a.result
    lojaGeo = a.store
    const b = await auditFake({ overlay: 'consent' })
    consent = b.result
    lojaConsent = b.store
  })
  after(async () => {
    await lojaGeo.close()
    await lojaConsent.close()
  })

  test('modal de região é marcado como provável artefato da auditoria', () => {
    assert.equal(geo.cart?.overlay.present, true)
    assert.equal(geo.cart?.overlay.kind, 'geo-redirect')
    assert.equal(geo.cart?.overlay.likelyAuditArtifact, true)
  })

  test('banner de cookie é overlay de verdade, não artefato', () => {
    assert.equal(consent.cart?.overlay.kind, 'consent')
    assert.equal(consent.cart?.overlay.likelyAuditArtifact, false)
  })
})

describe('checkout e coleta da §6.6', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    // CPF válido por dígito verificador: senão a trava barra antes de preencher.
    Object.assign(process.env, {
      AUDIT_NAME: 'Teste Auditoria',
      AUDIT_EMAIL: 'auditoria@exemplo.com',
      AUDIT_PHONE: '(11) 90000-0000',
      AUDIT_POSTAL_CODE: '01310-100',
      AUDIT_ADDRESS: 'Avenida Exemplo',
      AUDIT_ADDRESS_NUMBER: '1000',
      AUDIT_CITY: 'São Paulo',
      AUDIT_CPF: '529.982.247-25',
    })
    const run = await auditFake({}, { fillCheckout: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('alcança a tela de meios de pagamento', () => {
    assert.equal(result.checkout?.reachedPaymentScreen, true, result.incompleteBecause.join(' | '))
  })

  test('lê os meios na ordem em que aparecem', () => {
    assert.deepEqual(result.payment?.methods.map((m) => m.label), ['Pix', 'Cartão de crédito', 'Boleto'])
  })

  test('lê parcelas com valor e juros explícitos', () => {
    assert.equal(result.payment?.installments.maxCount, 10)
    assert.equal(result.payment?.installments.perInstallmentValueShown, true)
    assert.equal(result.payment?.installments.interestExplicit, true)
  })

  test('lê cupom, selo de segurança e salvar cartão', () => {
    assert.equal(result.payment?.couponField, true)
    assert.equal(result.payment?.trustSignals.present, true)
    assert.equal(result.payment?.saveCard, true)
  })

  test('compara onde o desconto do Pix aparece: produto vs checkout', () => {
    assert.equal(result.payment?.pix.present, true)
    assert.equal(result.payment?.pix.discountShownHere, true)
    assert.equal(result.payment?.pix.discountShownEarlier, false)
  })

  test('§2.1: o CPF nunca sai inteiro no resultado', () => {
    const json = JSON.stringify(result)
    assert.ok(!json.includes('52998224725'), 'CPF cru vazou')
    assert.ok(!json.includes('529.982.247-25'), 'CPF formatado vazou')
    assert.equal(result.identity?.['cpfMasked'], '529.xxx.xxx-25')
  })

  test('§2.1: não clica no botão "Pagar agora" da tela de pagamento', () => {
    // A loja falsa expõe esse botão. Clicar nele quebraria este teste.
    assert.equal(result.errorCode, null)
    assert.equal(result.checkout?.reachedPaymentScreen, true)
  })
})
