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
    observations: [],
    homeLoadMs: null,
    mobile: null,
    auditedFromBrazil: null,
    robotsBlockedPaths: [],
    blockedBySite: false,
    /* `consentido` é o padrão daqui porque estes exercícios medem a REGRA, não
       o modo: em leitura metade deles sairia não aplicável pelo modo e o que
       eles protegem deixaria de ser exercitado. O modo tem exercício próprio. */
    modo: 'consentido',
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
    /* A regra que este teste protege é "não medir não pode CUSTAR nota" — e
       ela continua valendo: nada saiu como falha ali. O que mudou é que, com
       cobertura abaixo do piso, não sai nota nenhuma em vez de sair 100.
       Nenhuma checagem foi reprovada, e é isso que se verifica. */
    assert.equal(semPagamento.failed, 0, 'não medir não pode custar nota')
    assert.equal(semPagamento.score, null, 'cobertura abaixo do piso não pontua')
    assert.ok(semPagamento.weightApplicable < comTudo.weightApplicable)
  })
})

describe('cobertura — nota 100 medindo pouco não pode ler igual a nota 100 medindo tudo', () => {
  /* Aconteceu duas vezes numa auditoria real: a loja proibia /checkout no
     robots, quase tudo saiu não aplicável, e a nota saiu 100. Verdadeira
     dentro do que foi medido, e quase uma promessa falsa apresentada sozinha.

     A primeira tentativa foi colar uma ressalva no número. Não bastou: "100"
     é o que o lojista printa e manda para o sócio, e texto pequeno ao lado não
     segura número grande. Agora o piso é sobre o PAR nota-cobertura. */
  test('cobertura abaixo de 40% não produz nota nenhuma', () => {
    const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'] }))
    assert.ok(r.coverage.ratio < 0.4, `cobertura foi ${r.coverage.ratio}`)
    assert.equal(r.score, null, 'com tão pouco medido, qualquer número diz mais do que se sabe')
    assert.ok(r.scoreCaveat, 'sem nota, o motivo é obrigatório')
    assert.match(r.scoreCaveat!, /não sai/)
  })

  test('e no lugar da nota fica o que foi verificado e o que não deu, com motivo', () => {
    // Sem nota o lead não pode ficar sem gancho: a lista é o conteúdo que
    // sobra, e cada não aplicável tem que dizer por quê.
    const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'] }))
    const naoAplicaveis = r.results.filter((c) => c.status === 'not_applicable')
    assert.ok(naoAplicaveis.length > 0)
    for (const c of naoAplicaveis) {
      assert.ok(c.notApplicableReason, `${c.id} sem motivo: a lista fica sem conteúdo`)
    }
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

  test('sem nota, o motivo é obrigatório — silêncio ali é pior que número', () => {
    /* Antes: sem nota, sem ressalva. O campo ficava vazio e ninguém sabia se
       a auditoria falhou, se a loja é perfeita, ou se algo quebrou. Agora a
       ausência de nota é uma afirmação, e afirmação sem motivo não vale. */
    const r = runChecks(entrada())
    assert.equal(r.score, null)
    assert.ok(r.scoreCaveat, 'nota ausente sem explicação deixa o leitor no escuro')
    assert.match(r.scoreCaveat!, /não sai/)
  })
})

describe('produto e carrinho medem o que o checkout mediria', () => {
  const observacao = (source: 'product' | 'cart', over: Partial<PaymentSnapshot> = {}) => ({
    source,
    url: `https://loja.com.br/${source}`,
    loadMs: 800,
    snapshot: { ...PAGAMENTO_BOM, ...over },
  })

  test('INSTALLMENT_UNCLEAR é medida na página do produto, sem checkout', () => {
    const r = runChecks(
      entrada({
        steps: [passo()],
        robotsBlockedPaths: ['/checkout'],
        observations: [
          observacao('product', {
            installments: {
              present: true,
              maxCount: 12,
              perInstallmentValueShown: false,
              interestExplicit: false,
              rawText: 'em até 12x',
            },
          }),
        ],
      }),
    )
    const c = r.results.find((x) => x.id === 'INSTALLMENT_UNCLEAR')
    assert.equal(c?.status, 'fail')
    assert.match(c?.evidence.join(' ') ?? '', /página do produto/)
  })

  test('cupom achado no carrinho já é aprovação, sem precisar do checkout', () => {
    const r = runChecks(
      entrada({
        steps: [passo()],
        robotsBlockedPaths: ['/checkout'],
        observations: [observacao('cart', { couponField: true })],
      }),
    )
    const c = r.results.find((x) => x.id === 'NO_COUPON_FIELD')
    assert.equal(c?.status, 'pass')
    assert.match(c?.evidence.join(' ') ?? '', /página do carrinho/)
  })

  test('cupom ausente no carrinho NÃO acusa a loja: na Shopify ele mora no checkout', () => {
    /* Carrinho visto, checkout não. O que este exercício protege é que a
       ausência no carrinho não vira acusação — a página onde o cupom mora não
       foi vista, e concluir dela seria inventar.
       
       O motivo escrito mudou junto com o modo: antes este caso vinha com
       `/checkout` proibido no robots, combinação que hoje não existe (em
       leitura o carrinho não é aberto; em consentido o portão libera com o
       aceite). O motivo pelo robots tem exercício próprio, em leitura. */
    const r = runChecks(
      entrada({
        steps: [passo()],
        observations: [observacao('cart', { couponField: false })],
      }),
    )
    const c = r.results.find((x) => x.id === 'NO_COUPON_FIELD')
    assert.equal(c?.status, 'not_applicable')
    assert.notEqual(c?.notApplicableReason, null, 'não aplicável sem motivo é buraco no relatório')
    assert.notEqual(c?.coverageFamily, null)
  })

  test('selo de segurança ausente no carrinho também não acusa a loja', () => {
    const r = runChecks(
      entrada({
        steps: [passo()],
        observations: [observacao('cart', { trustSignals: { present: false, evidence: [] } })],
      }),
    )
    assert.equal(r.results.find((x) => x.id === 'NO_TRUST_SIGNAL')?.status, 'not_applicable')
  })

  test('observar produto e carrinho aumenta a cobertura sem chegar ao checkout', () => {
    const semObservar = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'] }))
    const observando = runChecks(
      entrada({
        steps: [passo()],
        robotsBlockedPaths: ['/checkout'],
        observations: [observacao('product'), observacao('cart')],
      }),
    )
    assert.ok(
      observando.coverage.ratio > semObservar.coverage.ratio,
      `cobertura ${semObservar.coverage.ratio} → ${observando.coverage.ratio}`,
    )
  })

  test('o checkout continua tendo prioridade sobre o carrinho', () => {
    const r = runChecks(
      entrada({
        steps: [passo()],
        checkout: checkout(),
        payment: { ...PAGAMENTO_BOM, couponField: false },
        observations: [observacao('cart', { couponField: true })],
      }),
    )
    const c = r.results.find((x) => x.id === 'NO_COUPON_FIELD')
    assert.equal(c?.status, 'fail', 'o carrinho não pode encobrir um checkout medido')
    assert.match(c?.evidence.join(' ') ?? '', /tela de pagamento/)
  })

  test('NO_SAVED_CARD não se apoia em carrinho: salvar cartão não existe antes do checkout', () => {
    const r = runChecks(
      entrada({
        steps: [passo()],
        observations: [observacao('cart'), observacao('product')],
      }),
    )
    assert.equal(r.results.find((x) => x.id === 'NO_SAVED_CARD')?.status, 'not_applicable')
  })
})

describe('robots proibindo /checkout não penaliza a loja', () => {
  /* Em `leitura`, que é o modo onde o robots de fato segura a auditoria. Em
     `consentido` o portão libera com o aceite, e aí o motivo não pode ser o
     robots — é o que o bloco seguinte cobra. */
  const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'], modo: 'leitura' }))

  for (const id of ['PIX_DISCOUNT_LATE', 'INSTALLMENT_UNCLEAR', 'NO_SAVED_CARD', 'NO_COUPON_FIELD', 'NO_TRUST_SIGNAL']) {
    test(`${id} sai não aplicável, não como falha`, () => {
      const check = r.results.find((c) => c.id === id)
      assert.equal(check?.status, 'not_applicable')
      assert.notEqual(check?.notApplicableReason, null)
      assert.notEqual(check?.coverageFamily, null, 'não aplicável sem família não entra no resumo')
    })
  }
})

describe('o motivo aponta para a causa real, não para a que soa plausível', () => {
  test('em leitura, carrinho e checkout faltam POR CAUSA DO MODO, não do robots', () => {
    // Em leitura a requisição nem chega ao portão: nós é que não a fazemos.
    // Dizer "o robots proíbe" devolveria ao lojista a culpa por uma escolha
    // nossa — e ele iria mexer no arquivo errado.
    const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'], modo: 'leitura' }))
    const c = r.results.find((x) => x.id === 'NO_COUPON_FIELD')
    assert.equal(c?.coverageFamily, 'modo-leitura')
    assert.match(c?.notApplicableReason ?? '', /modo leitura/)
  })

  test('em consentido, robots proibido no arquivo não vira motivo de nada', () => {
    /* A lista de caminhos proibidos continua no relatório mesmo em consentido:
       é o registro do que a loja pedia. Mas com o aceite o portão libera, então
       nada foi impedido — e uma checagem que ficou de fora ficou por outra
       razão. */
    const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'], modo: 'consentido' }))
    const c = r.results.find((x) => x.id === 'NO_COUPON_FIELD')
    assert.equal(c?.status, 'not_applicable')
    assert.notEqual(c?.coverageFamily, 'robots', 'culpou o robots num modo em que ele não segura nada')
    assert.doesNotMatch(c?.notApplicableReason ?? '', /robots/)
  })

  test('a loja que bloqueia a auditoria explica antes do robots', () => {
    /* Em consentido, porque em leitura quem explica primeiro é o modo: lá a
       requisição nem sai, então nem o WAF da loja chegou a ser encontrado. A
       ordem dos motivos é a ordem em que as portas se fecham. */
    const r = runChecks(entrada({ steps: [passo()], robotsBlockedPaths: ['/checkout'], blockedBySite: true }))
    assert.equal(r.results.find((x) => x.id === 'NO_SAVED_CARD')?.coverageFamily, 'loja-bloqueou')
  })
})

describe('o resumo de cobertura diz o que foi medido, e por que o resto não foi', () => {
  test('conta as verificadas e as não verificadas', () => {
    const r = runChecks(entrada({ steps: [passo()], modo: 'leitura' }))
    assert.match(r.coverageSummary, new RegExp(`Verificamos ${r.applicable} das ${r.results.length} checagens`))
    assert.match(r.coverageSummary, new RegExp(`${r.notApplicable} não deram para fazer`))
  })

  test('nomeia o motivo que dominou, em português de lojista', () => {
    const r = runChecks(entrada({ steps: [passo()], modo: 'leitura' }))
    // Sem §, sem "not_applicable", sem nome de arquivo: quem lê é o lojista.
    assert.match(r.coverageSummary, /não abriu carrinho nem checkout|não conseguiu chegar/)
    assert.doesNotMatch(r.coverageSummary, /not_applicable|§/)
  })

  test('quando o motivo não é único, o resumo diz de quantas ele dá conta', () => {
    const r = runChecks(entrada({ steps: [passo()], modo: 'leitura' }))
    const familias = new Set(
      r.results.filter((x) => x.status === 'not_applicable').map((x) => x.coverageFamily),
    )
    if (familias.size > 1) {
      assert.match(r.coverageSummary, /Na maior parte delas \(\d+ de \d+\)/)
    } else {
      assert.match(r.coverageSummary, /Em todas elas/)
    }
  })

  test('sem nenhuma checagem de fora, o resumo não inventa motivo', () => {
    const r = runChecks(entrada({ steps: [passo()] }), [
      { id: 'X', title: 'x', severity: 'baixa', evaluate: () => ({ status: 'pass', evidence: ['ok'], notApplicableReason: null, coverageFamily: null, recommendation: '', screenshot: null }) },
    ])
    assert.equal(r.coverageSummary, 'Verificamos as 1 checagens desta auditoria.')
  })
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
    via: 'texto' as const,
    viaDetalhe: 'texto de intenção de compra: "Comprar"',
    viasTentadas: [],
    ondeEntrou: 'carrinho' as const,
    provaDeEntrada: '/cart.js: 0 -> 1 item(ns)',
    lojaSemCarrinho: false,
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

describe('o motivo do não aplicável cita só o que tem a ver com a checagem', () => {
  /* Numa loja que proíbe `/cart.js` e `/checkout` no robots, o NO_TRUST_SIGNAL
     saía dizendo "o robots.txt da loja proíbe /cart.js, /checkout". Sinal de
     confiança não depende de carrinho, e citar `/cart.js` ali faz quem lê
     concluir que dependia. Motivo com informação a mais é motivo errado. */

  /* Em `leitura`: é o modo onde o robots de fato segura a auditoria, e portanto
     o único em que ele pode aparecer como motivo. */
  const comRobots = (blocked: string[]) =>
    runChecks(entrada({ steps: [passo()], robotsBlockedPaths: blocked, modo: 'leitura' }))

  test('checagem que precisava do checkout não cita o bloqueio do carrinho', () => {
    const r = comRobots(['/cart.js', '/checkout'])
    const c = r.results.find((x) => x.id === 'NO_TRUST_SIGNAL')
    assert.equal(c?.status, 'not_applicable')
    assert.doesNotMatch(c?.notApplicableReason ?? '', /cart/, c?.notApplicableReason ?? '')
    assert.match(c?.notApplicableReason ?? '', /checkout/)
  })

  test('bloqueio que não tem a ver com nenhuma fonte não vira motivo de robots', () => {
    // `/admin` é proibido em toda Shopify e não explica checagem nenhuma.
    const c = comRobots(['/admin']).results.find((x) => x.id === 'NO_TRUST_SIGNAL')
    assert.equal(c?.status, 'not_applicable')
    assert.doesNotMatch(c?.notApplicableReason ?? '', /robots/, c?.notApplicableReason ?? '')
  })
})
