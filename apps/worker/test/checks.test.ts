/**
 * §8 — checagens e nota.
 *
 * A regra que este arquivo mais protege: `not_applicable` sai do DENOMINADOR,
 * nunca vira penalidade. Uma loja não pode perder nota porque o robots proibiu
 * o checkout, porque auditamos do país errado, ou porque a §6.7 não existe
 * nesta fase.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks, RULES } from '../src/checks/index.ts'
import { SEVERITY_WEIGHT, type CheckInput } from '../src/checks/types.ts'
import type { PaymentSnapshot } from '../src/types.ts'

const PAGAMENTO_BOM: PaymentSnapshot = {
  methods: [{ label: 'Pix', position: 1, evidence: 'Pix' }],
  pix: { present: true, discountShownHere: true, discountShownEarlier: true },
  installments: { present: true, maxCount: 10, perInstallmentValueShown: true, interestExplicit: true, rawText: '10x de R$ 49,90' },
  couponField: true,
  trustSignals: { present: true, evidence: ['compra segura'] },
  saveCard: true,
  cpfField: true,
  gateway: 'Shopify Payments',
  rawTextSample: '',
}

function entrada(over: Partial<CheckInput> = {}): CheckInput {
  return {
    product: null,
    cart: null,
    checkout: null,
    payment: null,
    steps: [],
    productText: null,
    homeLoadMs: null,
    mobile: null,
    auditedFromBrazil: null,
    robotsBlockedPaths: [],
    blockedBySite: false,
    ...over,
  }
}

const passo = (over: Record<string, unknown> = {}) => ({
  id: 'add-to-cart',
  label: 'adicionando ao carrinho',
  url: 'https://loja.com.br/products/x',
  at: new Date().toISOString(),
  ms: 100,
  screenshot: null,
  httpsOk: true,
  outcome: { status: 'done' as const },
  ...over,
})

const checkout = (over: Record<string, unknown> = {}) => ({
  url: 'https://loja.com.br/checkout',
  reachedPaymentScreen: true,
  forcedLogin: false,
  stepsFromProduct: 2,
  clicksFromProduct: 3,
  loadMs: { home: null, product: null, checkout: 1200 },
  allHttps: true,
  trail: [],
  ...over,
})

describe('nota — normalizada pelas checagens aplicáveis', () => {
  test('auditoria que não mediu nada não tem nota, e não vira 100', () => {
    // Devolver 100 diria "loja impecável" para uma auditoria que não mediu nada.
    const r = runChecks(entrada())
    assert.equal(r.score, null)
    assert.equal(r.applicable, 0)
  })

  test('tudo aplicável e passando dá 100', () => {
    const r = runChecks(
      entrada({
        steps: [passo()],
        checkout: checkout(),
        payment: PAGAMENTO_BOM,
        productText: 'Compre com Pix e 5% de desconto. Cartão de crédito em 10x.',
        auditedFromBrazil: true,
      }),
    )
    assert.equal(r.score, 100)
    assert.equal(r.failed, 0)
  })

  test('a conta é auditável: pesos disparados sobre pesos aplicáveis', () => {
    const r = runChecks(
      entrada({
        steps: [passo({ httpsOk: false })],
        checkout: checkout(),
        payment: PAGAMENTO_BOM,
        productText: 'Compre com Pix e 5% de desconto. Cartão em 10x.',
        auditedFromBrazil: true,
      }),
    )
    assert.equal(r.weightFailed, SEVERITY_WEIGHT.critica)
    assert.equal(r.score, Math.round(100 * (1 - r.weightFailed / r.weightApplicable)))
    assert.ok(r.score! < 100)
  })

  test('checagem não aplicável sai do denominador, não penaliza', () => {
    const comTudo = runChecks(
      entrada({ steps: [passo()], checkout: checkout(), payment: PAGAMENTO_BOM, productText: 'Pix 5% desconto. Cartão 10x.', auditedFromBrazil: true }),
    )
    const semPagamento = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'] }))

    assert.equal(comTudo.score, 100)
    assert.equal(semPagamento.score, 100, 'não medir não pode custar nota')
    assert.ok(semPagamento.weightApplicable < comTudo.weightApplicable)
  })
})

describe('cobertura — nota 100 medindo pouco não pode ler igual a nota 100 medindo tudo', () => {
  // Aconteceu numa auditoria real: a loja proibia /checkout no robots, dez
  // checagens saíram não aplicáveis, e a nota saiu 100. Verdadeira dentro do
  // que foi medido, e quase uma promessa falsa apresentada sozinha.
  test('nota apoiada em pouca coisa vem com ressalva', () => {
    const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'] }))
    assert.equal(r.score, 100)
    assert.ok(r.coverage.ratio < 0.6, `cobertura foi ${r.coverage.ratio}`)
    assert.ok(r.scoreCaveat, 'faltou a ressalva')
    assert.match(r.scoreCaveat!, /não que a loja está impecável/)
  })

  test('nota apoiada em quase tudo não tem ressalva', () => {
    const r = runChecks(
      entrada({
        steps: [passo()],
        checkout: checkout(),
        payment: PAGAMENTO_BOM,
        productText: 'Pix 5% de desconto. Cartão em 10x.',
        auditedFromBrazil: true,
      }),
    )
    assert.ok(r.coverage.ratio >= 0.6, `cobertura foi ${r.coverage.ratio}`)
    assert.equal(r.scoreCaveat, null)
  })

  test('a cobertura é medida em peso, não em contagem', () => {
    // Uma crítica não medida pesa mais que três baixas não medidas.
    const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'] }))
    assert.equal(r.coverage.weightTotal > r.weightApplicable, true)
    assert.equal(r.coverage.checksTotal, r.applicable + r.notApplicable)
  })

  test('sem nota não há ressalva a dar', () => {
    const r = runChecks(entrada())
    assert.equal(r.score, null)
    assert.equal(r.scoreCaveat, null)
  })
})

describe('robots proibindo /checkout não penaliza a loja', () => {
  const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'] }))

  for (const id of ['PIX_DISCOUNT_LATE', 'INSTALLMENT_UNCLEAR', 'NO_SAVED_CARD', 'NO_COUPON_FIELD', 'NO_TRUST_SIGNAL']) {
    test(`${id} sai não aplicável, não como falha`, () => {
      const check = r.results.find((c) => c.id === id)
      assert.equal(check?.status, 'not_applicable')
      assert.match(check?.notApplicableReason ?? '', /robots/)
    })
  }
})

describe('desafio antibot não penaliza a loja', () => {
  test('as checagens da tela de pagamento saem não aplicáveis', () => {
    const r = runChecks(entrada({ steps: [passo()], blockedBySite: true }))
    const pix = r.results.find((c) => c.id === 'PIX_DISCOUNT_LATE')
    assert.equal(pix?.status, 'not_applicable')
    assert.match(pix?.notApplicableReason ?? '', /bloqueou a auditoria/)
  })
})

describe('CHECKOUT_SPEED só julga quando medido do Brasil', () => {
  test('de fora do Brasil, não aplicável mesmo com tempo alto', () => {
    const r = runChecks(entrada({ checkout: checkout({ loadMs: { home: null, product: null, checkout: 9000 } }), auditedFromBrazil: null }))
    const c = r.results.find((x) => x.id === 'CHECKOUT_SPEED')
    assert.equal(c?.status, 'not_applicable')
    assert.match(c?.notApplicableReason ?? '', /IP brasileiro/)
  })

  test('do Brasil, tempo alto é achado', () => {
    const r = runChecks(entrada({ checkout: checkout({ loadMs: { home: null, product: null, checkout: 9000 } }), auditedFromBrazil: true }))
    assert.equal(r.results.find((x) => x.id === 'CHECKOUT_SPEED')?.status, 'fail')
  })
})

describe('BUY_BUTTON_OBSCURED — fora da tabela da §8', () => {
  const overlay = (over: Record<string, unknown> = {}) => ({
    ok: true as boolean | null,
    ms: 100,
    uiPattern: 'drawer' as const,
    cartUrl: 'https://loja.com.br/cart',
    itemCount: 1,
    cartReadNote: null,
    clicks: 1,
    overlay: {
      present: true,
      identity: 'div#modal',
      kind: 'marketing' as const,
      text: 'Assine a newsletter',
      dismissed: false,
      dismissAttempts: ['Escape'],
      clickRequiredForce: true,
      likelyAuditArtifact: false,
      ...over,
    },
  })

  test('está marcada como além da §8, para poder ser vetada', () => {
    assert.equal(RULES.find((r) => r.id === 'BUY_BUTTON_OBSCURED')?.beyondSpec, true)
  })

  test('modal de marketing que não fecha é achado', () => {
    const r = runChecks(entrada({ cart: overlay(), steps: [passo()] }))
    assert.equal(r.results.find((c) => c.id === 'BUY_BUTTON_OBSCURED')?.status, 'fail')
  })

  test('modal de geo visto de fora do Brasil NÃO é achado', () => {
    const r = runChecks(entrada({ cart: overlay({ kind: 'geo-redirect', likelyAuditArtifact: true }), steps: [passo()] }))
    const c = r.results.find((x) => x.id === 'BUY_BUTTON_OBSCURED')
    assert.equal(c?.status, 'not_applicable')
    assert.match(c?.notApplicableReason ?? '', /IP brasileiro/)
  })

  test('overlay que fechou não é achado', () => {
    const r = runChecks(entrada({ cart: overlay({ dismissed: true }), steps: [passo()] }))
    assert.equal(r.results.find((c) => c.id === 'BUY_BUTTON_OBSCURED')?.status, 'pass')
  })
})

describe('achados vêm ordenados por severidade', () => {
  test('crítica antes de alta', () => {
    const r = runChecks(
      entrada({
        steps: [passo({ httpsOk: false })],
        checkout: checkout({ forcedLogin: true }),
        productText: 'nada sobre pagamento aqui',
      }),
    )
    assert.equal(r.findings[0]?.severity, 'critica')
    assert.ok(r.findings.length >= 2)
  })

  test('todo achado carrega evidência e recomendação', () => {
    const r = runChecks(entrada({ steps: [passo({ httpsOk: false })], productText: 'sem pagamento' }))
    for (const f of r.findings) {
      assert.ok(f.evidence.length > 0, `${f.id} sem evidência`)
      assert.ok(f.recommendation.length > 20, `${f.id} sem recomendação`)
    }
  })

  test('toda não aplicável diz o motivo', () => {
    const r = runChecks(entrada())
    for (const c of r.results.filter((x) => x.status === 'not_applicable')) {
      assert.ok((c.notApplicableReason ?? '').length > 10, `${c.id} sem motivo`)
    }
  })
})

describe('cobertura da tabela da §8', () => {
  const DA_SPEC = [
    'HTTPS_ISSUE', 'PAY_VISIBILITY', 'PIX_DISCOUNT_LATE', 'INSTALLMENT_UNCLEAR',
    'STEP_COUNT', 'MOBILE_PARITY', 'FORCED_LOGIN', 'DESCRIPTOR_UNCLEAR',
    'CHECKOUT_SPEED', 'NO_SAVED_CARD', 'NO_COUPON_FIELD', 'NO_TRUST_SIGNAL',
  ]

  test('as 12 checagens da tabela existem', () => {
    for (const id of DA_SPEC) {
      assert.ok(RULES.some((r) => r.id === id), `faltando: ${id}`)
    }
  })

  test('e o que está fora dela está marcado', () => {
    for (const rule of RULES) {
      if (!DA_SPEC.includes(rule.id)) {
        assert.equal(rule.beyondSpec, true, `${rule.id} não está na §8 e não está marcado`)
      }
    }
  })
})
