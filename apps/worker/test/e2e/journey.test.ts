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
import { validateAuditResult } from '../../src/output/schema.ts'
import type { FakeStoreOptions } from '../fixtures/fake-shopify.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'
process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'

const OUT = 'out/.test'
// Sem `force`: o intervalo é zerado por variável de ambiente, então não há o
// que forçar. Usar --force aqui exigiria declarar titularidade, e isso ligaria
// a exceção de robots — quebrando justamente o cenário que testa robots.
/* `consentido` porque estes exercícios vão até o carrinho, e a loja falsa é
   nossa: o aceite existe de verdade, não é formalidade contornada. O modo é
   declarado aqui uma vez em vez de em cada teste — mas é declarado, porque
   `audit()` recusa sem ele. */
const ACEITE_DE_TESTE = {
  em: '2026-09-01T00:00:00.000Z',
  url: 'http://127.0.0.1',
  texto: 'Loja falsa deste repositório: a auditoria é autorizada por quem a escreveu.',
} as const

const BASE = { headed: false, outDir: OUT, modo: 'consentido' } as const

/** Uma loja, uma auditoria, muitas asserções. */
async function auditFake(
  storeOptions: FakeStoreOptions,
  auditOptions: Record<string, unknown> = {},
): Promise<{ result: AuditResult; store: FakeStore }> {
  const store = await startFakeStore(storeOptions)
  const result = await audit(store.url, {
    ...BASE,
    aceite: { ...ACEITE_DE_TESTE, url: store.url },
    ...auditOptions,
  })
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

/* Este bloco era um só, e testava o mundo em que robots sempre valia. Agora o
   modo governa o portão, então a mesma loja tem DOIS comportamentos corretos, e
   cada um precisa do seu exercício. O que os dois preservam do teste antigo é a
   regra que nunca muda: checagem que não pôde ser feita sai não aplicável com
   motivo, jamais como falha da loja. */

describe('robots proibindo /checkout — modo consentido passa por cima, e registra', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    const run = await auditFake({ blockCheckout: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('o relatório continua dizendo o que o robots proibia', () => {
    // Passar por cima não apaga o pedido da loja do relatório: quem lê precisa
    // saber sob que autorização a etapa rodou.
    assert.deepEqual(result.robots.blockedPaths, ['/checkout'])
    assert.equal(result.robots.ownerVerified, true)
  })

  test('cada override fica registrado com caminho e horário', () => {
    const caminhos = result.robots.overridesUsed.map((o) => o.path)
    assert.ok(caminhos.some((c) => c.startsWith('/checkout')), `nenhum override de checkout em ${JSON.stringify(caminhos)}`)
    for (const o of result.robots.overridesUsed) {
      assert.ok(!Number.isNaN(Date.parse(o.at)), `override sem horário utilizável: ${o.at}`)
    }
  })

  test('perguntar ao portão não conta como override', () => {
    // A lista de proibidos é montada consultando o portão para cada caminho da
    // jornada. Consulta que registrasse override faria o relatório afirmar que
    // passamos por cima de caminho que a auditoria nunca chegou a pedir.
    const daHome = result.robots.overridesUsed.filter((o) => o.path === '/')
    assert.deepEqual(daHome, [], 'override registrado para caminho não proibido')
    assert.ok(
      result.robots.overridesUsed.length <= result.steps.length,
      'mais overrides do que passos executados: alguém está registrando consulta como passagem',
    )
  })

  test('o checkout é alcançado e observado', () => {
    assert.equal(result.cart?.ok, true)
    const fontes = result.observations.map((o) => o.source)
    assert.ok(fontes.includes('checkout'), `checkout não observado; fontes: ${fontes.join(', ')}`)
  })
})

describe('robots proibindo /checkout — modo leitura respeita, e diz por quê', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    const run = await auditFake({ blockCheckout: true }, { modo: 'leitura', aceite: undefined })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('sai partial por desenho, não como erro', () => {
    assert.equal(result.status, 'partial')
    assert.equal(result.errorCode, null, 'leitura incompleta por desenho não é erro')
    assert.equal(result.robots.ownerVerified, false)
    assert.deepEqual(result.robots.overridesUsed, [], 'leitura não passa por cima de robots')
  })

  test('nem o carrinho é tocado — e o robots proibido continua listado', () => {
    assert.equal(result.cart, null)
    assert.deepEqual(result.robots.blockedPaths, ['/checkout'])
    const fontes = result.observations.map((o) => o.source)
    assert.deepEqual([...fontes].sort(), ['product'])
  })

  test('o parcelamento é julgado pela página do produto, sem chegar ao checkout', () => {
    // A loja falsa anuncia "em até 10x de R$ 8,99 sem juros" na página do
    // produto: valor por parcela e juros explícitos. Antes de observar o
    // produto, esta checagem saía não aplicável em toda loja com robots
    // fechado — o caso da maioria das lojas Shopify brasileiras.
    const c = result.checks?.results.find((x) => x.id === 'INSTALLMENT_UNCLEAR')
    assert.equal(c?.status, 'pass', c?.notApplicableReason ?? '')
    assert.match(c?.evidence.join(' ') ?? '', /página do produto/)
  })

  test('cupom e selo não viram falha só porque o checkout não foi visto', () => {
    for (const id of ['NO_COUPON_FIELD', 'NO_TRUST_SIGNAL']) {
      const c = result.checks?.results.find((x) => x.id === id)
      assert.equal(c?.status, 'not_applicable', `${id} acusou a loja sem ver o checkout`)
      // O motivo é o modo, não o robots: quem não abriu o carrinho fomos nós.
      // Dizer "o robots.txt proíbe" aqui culparia a loja pela nossa escolha.
      assert.match(c?.notApplicableReason ?? '', /modo leitura/)
    }
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

describe('§8 — nota e achados sobre a jornada real da loja falsa', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
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
    const run = await auditFake({}, { fillCheckout: true, fromBrazil: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('produz uma nota', () => {
    assert.notEqual(result.checks?.score, null)
    assert.ok(result.checks!.score! >= 0 && result.checks!.score! <= 100)
  })

  test('a conta bate com os pesos', () => {
    const c = result.checks!
    assert.equal(c.score, Math.round(100 * (1 - c.weightFailed / c.weightApplicable)))
  })

  test('MOBILE_PARITY e DESCRIPTOR_UNCLEAR saem não aplicáveis nesta fase', () => {
    for (const id of ['MOBILE_PARITY', 'DESCRIPTOR_UNCLEAR']) {
      const check = result.checks?.results.find((r) => r.id === id)
      assert.equal(check?.status, 'not_applicable', id)
      assert.ok((check?.notApplicableReason ?? '').length > 10, `${id} sem motivo`)
    }
  })

  test('a loja falsa não menciona pagamento no produto: PAY_VISIBILITY falha', () => {
    assert.equal(result.checks?.results.find((r) => r.id === 'PAY_VISIBILITY')?.status, 'fail')
  })

  test('e as checagens da tela de pagamento passam, porque a tela foi lida', () => {
    for (const id of ['INSTALLMENT_UNCLEAR', 'NO_COUPON_FIELD', 'NO_SAVED_CARD', 'NO_TRUST_SIGNAL']) {
      assert.equal(result.checks?.results.find((r) => r.id === id)?.status, 'pass', id)
    }
  })

  test('a saída bate com o esquema Zod declarado (§17: JSON tipado)', () => {
    const validation = validateAuditResult(result)
    assert.equal(validation.valid, true, validation.issues.join(' | '))
  })
})

describe('botão de comprar que não é submit e não diz "adicionar"', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    // Reproduz a Circulei (circulei.co): loja de aluguel em Shopify onde o
    // botão diz "QUERO ALUGAR", não é submit, e a página tem um
    // "FICOU COM DÚVIDA? CLIQUE AQUI E FALE COM A NINA" que começa parecido.
    const run = await auditFake({ buyButton: 'aluguel' })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('encontra o botão pelo texto quando a estrutura não basta', () => {
    assert.equal(result.cart?.ok, true, result.errorReason ?? '')
    assert.equal(result.cart?.itemCount, 1)
  })

  test('e não clica no botão do WhatsApp que começa com "FICOU COM DÚVIDA"', () => {
    // Clicar ali levaria a jornada para uma conversa, e o carrinho ficaria
    // vazio. A prova é dupla: o carrinho confirmou, e nenhuma etapa saiu do
    // domínio da loja.
    assert.equal(result.cart?.itemCount, 1, 'carrinho vazio: clicou no lugar errado')
    for (const passo of result.steps) {
      assert.ok(!passo.url.includes('wa.me'), `a jornada foi parar no WhatsApp: ${passo.url}`)
    }
  })
})

describe('tema sem formulário clássico de /cart/add', { concurrency: false }, () => {
  let result: AuditResult
  let store: FakeStore

  before(async () => {
    /* Reproduz a Carnan (carnan.com.br): a página do produto tem um botão
       "Comprar" bem visível, mas nenhum `form[action*="/cart/add"]` — o item
       vai para o carrinho por fetch.

       A jornada exigia o formulário ANTES de procurar qualquer botão, e
       desistia ali. A busca por texto de intenção de compra na página
       inteira, que acha esse botão em um segundo, já existia logo abaixo e
       nunca era alcançada. O lojista via "Perdemos a conexão com a loja no
       meio do checkout" — uma loja perfeitamente auditável, recusada, e a
       culpa posta nela. */
    const run = await auditFake({ buyButton: 'sem-formulario' })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('o formulário ajuda, mas não é pré-requisito', () => {
    assert.equal(result.cart?.ok, true, result.errorReason ?? '')
    assert.equal(result.cart?.itemCount, 1)
  })

  test('a jornada vai até o fim e produz nota', () => {
    assert.equal(result.errorCode, null, result.errorReason ?? '')
    assert.ok((result.checks?.score ?? 0) > 0, 'nota zerada: a jornada não chegou ao relatório')
  })
})

describe('a cadeia de quatro caminhos até o carrinho', { concurrency: false }, () => {
  /* A regra que estes testes protegem: NENHUM caminho pode depender de como a
     loja escreve o botão, exceto o último.

     A jornada tinha um caminho só — achar um botão e clicar — e cada loja que
     escrevia o rótulo de um jeito novo virava auditoria perdida. O conserto
     era sempre "põe mais um rótulo na lista", e lista de rótulos não fecha:
     loja brasileira escreve "ADICIONE À SACOLA", "Colocar na cestinha", "EU
     QUERO!". Agora o texto é o quarto e último recurso. */

  let padrao: AuditResult
  let semFormulario: AuditResult
  let apiRecusando: AuditResult
  const lojas: FakeStore[] = []

  before(async () => {
    for (const [alvo, opcoes] of [
      ['padrao', {}],
      ['semFormulario', { buyButton: 'sem-formulario' as const }],
      ['apiRecusando', { apiRecusaAdd: true }],
    ] as const) {
      const run = await auditFake(opcoes)
      lojas.push(run.store)
      if (alvo === 'padrao') padrao = run.result
      if (alvo === 'semFormulario') semFormulario = run.result
      if (alvo === 'apiRecusando') apiRecusando = run.result
    }
  })
  after(async () => {
    for (const l of lojas) await l.close()
  })

  test('o caminho principal é a API da plataforma', () => {
    assert.equal(padrao.cart?.via, 'api', padrao.cart?.viasTentadas.join(' | '))
    assert.equal(padrao.cart?.itemCount, 1)
  })

  test('tema sem formulário nenhum entra pela API do mesmo jeito', () => {
    // O tema da Carnan: botão "Comprar" solto, item enviado por JavaScript.
    assert.equal(semFormulario.cart?.via, 'api', semFormulario.cart?.viasTentadas.join(' | '))
    assert.equal(semFormulario.cart?.itemCount, 1)
  })

  test('API fora do ar cai para o caminho seguinte, e o item entra igual', () => {
    assert.notEqual(apiRecusando.cart?.via, 'api')
    assert.ok(apiRecusando.cart?.via, `nenhum caminho funcionou: ${apiRecusando.cart?.viasTentadas.join(' | ')}`)
    assert.equal(apiRecusando.cart?.itemCount, 1)
    assert.match(apiRecusando.cart?.viasTentadas.join(' | ') ?? '', /api: 422/)
  })

  test('a auditoria diz por qual caminho entrou, e o que tentou antes', () => {
    // Sem isto, um relatório com carrinho confirmado não deixa saber se houve
    // clique — e sem clique não há reação de UI para classificar.
    assert.ok((padrao.cart?.viasTentadas.length ?? 0) > 0)
    assert.ok(padrao.cart?.viaDetalhe, 'o caminho tem que trazer a evidência de como resolveu')
  })

  test('sem clique, o padrão de UI sai como desconhecido em vez de chutado', () => {
    assert.equal(padrao.cart?.via, 'api')
    assert.equal(padrao.cart?.uiPattern, 'unknown')
  })
})

describe('loja sem etapa de carrinho', { concurrency: false }, () => {
  /* A regra de sucesso era uma só: /cart.js precisa contar um item a mais.
     Isso reprova a loja em que o botão leva direto para o checkout — o
     carrinho nunca existe, e a jornada dava a compra como falhada procurando
     um sinal que naquela loja jamais apareceria. Carrinho vazio não é o mesmo
     que compra que não começou. */

  let result: AuditResult
  let store: FakeStore

  before(async () => {
    const run = await auditFake({ semCarrinho: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('o item entrar no checkout conta como sucesso', () => {
    assert.equal(result.cart?.ondeEntrou, 'checkout', result.cart?.viasTentadas.join(' | '))
    assert.equal(result.cart?.ok, true)
  })

  test('a prova é o produto NA tela, conferido por título e preço', () => {
    // "aparece um produto" não basta: vitrine de recomendados na lateral do
    // checkout também mostra produto, e não é a compra.
    assert.match(result.cart?.provaDeEntrada ?? '', /Camiseta Básica/)
    assert.match(result.cart?.provaDeEntrada ?? '', /89\.90/)
  })

  test('o passo sai como PULADO pela loja, nunca como falha', () => {
    const passo = result.steps.find((s) => s.id === 'add-to-cart')
    assert.equal(passo?.outcome.status, 'skipped')
    assert.match(
      passo?.outcome.status === 'skipped' ? passo.outcome.reason : '',
      /não tem etapa de carrinho/,
    )
  })

  test('e vira nota sobre a LOJA, não limitação nossa', () => {
    // Jornada mais curta é fato sobre ela, e o lojista precisa saber.
    assert.ok(
      result.storefrontNotes.some((n) => /não tem etapa de carrinho/.test(n)),
      `notas: ${result.storefrontNotes.join(' | ')}`,
    )
    assert.ok(
      !result.incompleteBecause.some((m) => /carrinho/.test(m)),
      `não pode entrar como limitação: ${result.incompleteBecause.join(' | ')}`,
    )
  })

  test('a auditoria chega ao fim e dá nota', () => {
    assert.equal(result.errorCode, null, result.errorReason ?? '')
    assert.ok((result.checks?.score ?? 0) > 0)
  })
})

describe('a evidência do carrinho vai para o disco em todo desfecho', { concurrency: false }, () => {
  /* Esta gravação já existiu e não gravava nada onde importava: a chamada
     estava DENTRO do `try` do addToCart, então a auditoria que falhava — a
     única que alguém realmente precisa investigar depois — era exatamente a
     que não deixava arquivo. E o erro de escrita era engolido por um
     `.catch(() => undefined)`, então "não tem arquivo" e "não consegui
     escrever" eram indistinguíveis.

     Agora a escrita mora no `finally` da auditoria inteira. Estes testes
     existem para que ela não volte para dentro de nenhum `try`. */

  const casos: Array<[string, FakeStoreOptions]> = [
    ['sucesso', {}],
    ['sem etapa de carrinho', { semCarrinho: true }],
    ['API recusando', { apiRecusaAdd: true }],
    ['falha em todos os caminhos', { semCompra: true }],
  ]

  for (const [nome, opcoes] of casos) {
    test(`grava em: ${nome}`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'raiox-'))
      const store = await startFakeStore(opcoes)
      try {
        const r = await audit(store.url, {
          headed: false,
          outDir: dir,
          modo: 'consentido',
          aceite: { ...ACEITE_DE_TESTE, url: store.url },
        })
        const host = new URL(store.url).hostname
        const arquivo = path.join(dir, host, 'carrinho.json')
        const bruto = await readFile(arquivo, 'utf8')
        const dados = JSON.parse(bruto) as Record<string, unknown>

        assert.ok(dados['desfecho'], 'o arquivo tem que dizer em que desfecho parou')
        const vias = (dados['viasTentadas'] as string[] | undefined) ?? []
        assert.ok(vias.length > 0, `sem os caminhos tentados o arquivo não diagnostica nada: ${bruto}`)
        assert.match(vias[0] ?? '', /^api: /, 'o primeiro caminho tentado é a API, com a resposta dela')
        // O que a auditoria devolveu e o que ficou no disco têm que combinar.
        if (r.cart) assert.equal(dados['ondeEntrou'], r.cart.ondeEntrou)
      } finally {
        await store.close()
        await rm(dir, { recursive: true, force: true })
      }
    })
  }
})

describe('jornada que falha ainda entrega o que observou', { concurrency: false }, () => {
  /* Este NÃO é um teste de carrinho. O que ele prova é propriedade do nosso
     código: o dado coletado até o ponto de falha chega ao relatório. Nada aqui
     afirma como uma loja real se comporta.

     O defeito: as observações ficam em `ctx.scratch` durante a jornada e só
     eram recolhidas no caminho de sucesso (audit.ts, `colherObservacoes`). As
     três saídas de falha passavam `result.observations` — campo que nunca
     recebe atribuição em lugar nenhum, e portanto é sempre `[]`. A página de
     produto era observada e jogada fora no mesmo segundo.

     Medido antes da correção: 0 observações, 1 de 13 regras com veredito,
     nota 0. Depois: 1 observação, 3 de 13, nota 50. */

  let result: AuditResult
  let store: FakeStore

  before(async () => {
    /* `semCompra` derruba a jornada DEPOIS da página de produto ter sido
       observada — que é o ponto exato onde havia dado para perder. O cenário
       foi escrito por mim a partir de hipótese, não de loja observada: serve
       para acionar o caminho de falha, e para mais nada. */
    const run = await auditFake({ semCompra: true })
    result = run.result
    store = run.store
  })
  after(async () => store.close())

  test('a auditoria para no carrinho e mesmo assim é parcial, não vazia', () => {
    assert.equal(result.status, 'partial')
    assert.equal(result.errorCode, 'BUY_BUTTON_NOT_FOUND')
  })

  test('a observação da página de produto chega ao resultado', () => {
    assert.ok(
      result.observations.some((o) => o.source === 'product'),
      `observações perdidas: [${result.observations.map((o) => o.source).join(', ')}]`,
    )
  })

  test('e vira veredito de verdade, não uma tela de não aplicável', () => {
    const comVeredito = (result.checks?.results ?? []).filter(
      (c) => c.status === 'pass' || c.status === 'fail',
    )
    assert.ok(
      comVeredito.length > 1,
      `só ${comVeredito.length} regra(s) com veredito: o relatório voltou a sair vazio`,
    )
  })

  test('as regras que dependem do checkout continuam não aplicáveis, com motivo', () => {
    // O oposto do defeito também é defeito: inventar veredito sobre etapa que
    // não aconteceu seria pior do que perder o dado.
    const semCheckout = ['CHECKOUT_SPEED', 'NO_COUPON_FIELD', 'FORCED_LOGIN']
    for (const id of semCheckout) {
      const c = (result.checks?.results ?? []).find((x) => x.id === id)
      assert.equal(c?.status, 'not_applicable', `${id} não pode ter veredito sem checkout`)
      assert.ok(c?.notApplicableReason, `${id} precisa dizer POR QUE não se aplica`)
    }
  })
})

describe('os dois modos, e o que cada um tem permissão de tocar', { concurrency: false }, () => {
  /* O motor atendia dois produtos como se fossem um: a loja de quem pediu a
     auditoria e a loja de terceiro que ninguém consultou. Fazia a mesma coisa
     nos dois casos — inclusive mexer no carrinho de loja alheia.

     Agora o modo é obrigatório e governa duas coisas: se a jornada pode tocar
     carrinho, e se o robots.txt barra. No consentido o aceite do responsável é
     instrução mais específica e mais recente que o arquivo, e vale mais. No
     leitura ninguém autorizou, então o robots vale sempre. */

  const aceiteDe = (url: string) => ({
    em: new Date().toISOString(),
    url,
    texto: 'Sou responsável por esta loja e autorizo a auditoria.',
  })

  test('sem modo declarado, a auditoria não roda', async () => {
    const store = await startFakeStore({})
    try {
      // @ts-expect-error: o compilador já barra; o teste garante que a EXECUÇÃO
      // também barre, para quem chamar de JavaScript ou de JSON pela API.
      const r = await audit(store.url, { headed: false, outDir: OUT })
      assert.equal(r.errorCode, 'MODE_MISSING')
      assert.equal(r.cart, null, 'não pode ter tocado o carrinho')
    } finally {
      await store.close()
    }
  })

  test('consentido sem aceite registrado não roda', async () => {
    const store = await startFakeStore({})
    try {
      const r = await audit(store.url, { headed: false, outDir: OUT, modo: 'consentido' })
      assert.equal(r.errorCode, 'CONSENT_MISSING')
      assert.equal(r.cart, null)
    } finally {
      await store.close()
    }
  })

  test('aceite de outra loja não vale para esta', async () => {
    // Aceite genérico é clique reaproveitado, não autorização.
    const store = await startFakeStore({})
    try {
      const r = await audit(store.url, {
        headed: false,
        outDir: OUT,
        modo: 'consentido',
        aceite: aceiteDe('https://outraloja.com.br'),
      })
      assert.equal(r.errorCode, 'CONSENT_MISSING')
      assert.match(r.errorReason ?? '', /outraloja\.com\.br/)
    } finally {
      await store.close()
    }
  })

  test('leitura com aceite é contradição e não roda', async () => {
    // Ou alguém autorizou, e o modo é consentido, ou não autorizou e o aceite
    // não existe. Aceitar os dois deixaria passar consentido disfarçado.
    const store = await startFakeStore({})
    try {
      const r = await audit(store.url, {
        headed: false,
        outDir: OUT,
        modo: 'leitura',
        aceite: aceiteDe('http://127.0.0.1'),
      })
      assert.equal(r.errorCode, 'CONSENT_MISSING')
    } finally {
      await store.close()
    }
  })

  test('leitura vai até a página do produto e para ali, por desenho', async () => {
    const store = await startFakeStore({})
    try {
      const r = await audit(store.url, { headed: false, outDir: OUT, modo: 'leitura' })
      assert.equal(r.errorCode, null, r.errorReason ?? '')
      assert.equal(r.cart, null, 'leitura não pode ter carrinho')
      assert.equal(r.checkout, null, 'leitura não pode ter checkout')
      assert.ok(
        r.observations.some((o) => o.source === 'product'),
        'e mesmo assim tem que trazer a página de produto observada',
      )
      assert.ok(r.steps.some((s) => s.id === 'observe-product' && s.outcome.status === 'done'))
    } finally {
      await store.close()
    }
  })

  test('leitura nunca libera o robots; consentido libera e registra', async () => {
    const store = await startFakeStore({})
    try {
      const leitura = await audit(store.url, { headed: false, outDir: OUT, modo: 'leitura' })
      assert.equal(leitura.robots.ownerVerified, false)

      const consentido = await audit(store.url, {
        headed: false,
        outDir: OUT,
        modo: 'consentido',
        aceite: aceiteDe(store.url),
        force: true,
      })
      assert.equal(consentido.robots.ownerVerified, true)
      assert.ok(consentido.aceite, 'o aceite tem que viajar no relatório')
      assert.equal(consentido.aceite?.url, store.url)
      assert.ok(consentido.aceite?.texto.length, 'com o texto exato que foi aceito')
    } finally {
      await store.close()
    }
  })
})
