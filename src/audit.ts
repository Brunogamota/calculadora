/**
 * Bloco 3a: auditoria com jornada até o carrinho.
 *
 * O status é `partial` sempre que alguma etapa não rodou, com o motivo dito por
 * extenso (§14). Etapa barrada pelo robots sai como `not_permitted_by_robots` e
 * NÃO conta como falha da loja — é a decisão de produto registrada no README.
 */

import { prepare, PreflightRejected, type PrepareOptions } from './session.ts'
import { createDeps, type PreflightOk } from './preflight.ts'
import { createRecorder, makeStep } from './lib/recorder.ts'
import { DEFAULT_OUT_DIR, saveHtml } from './lib/artifacts.ts'
import { adapterFor } from './platforms/index.ts'
import { describeIdentity, loadDotEnv, loadIdentity, type AuditIdentity } from './lib/identity.ts'
import { checkCooldown, readLedger, recordAudit, DEFAULT_COOLDOWN_HOURS } from './lib/cooldown.ts'
import { runChecks, type ChecksReport } from './checks/index.ts'
import { normalizeUrl } from './lib/guards.ts'
import { vantageContradiction } from './lib/environment.ts'
import { AuditError, toAuditError, type AuditErrorCode } from './lib/errors.ts'
import type {
  AddToCartResult,
  CheckoutContext,
  JourneyContext,
  JourneyStep,
  NavigationResult,
  PaymentSnapshot,
  ProductRef,
} from './types.ts'
import type { BrowserSession } from './lib/browser.ts'

export interface AuditOptions extends PrepareOptions {
  outDir?: string
  /**
   * Preencher contato e entrega para alcançar a tela de meios de pagamento.
   * Exige identidade no .env. Sem isto, a jornada para na primeira tela do
   * checkout e a §6.6 sai quase toda como não aplicável.
   */
  fillCheckout?: boolean
  /**
   * Ignora o intervalo mínimo entre auditorias do mesmo domínio. Use apenas em
   * loja própria: em loja de terceiro, repetir é o que a §2.2 proíbe.
   */
  force?: boolean
  /**
   * Declare true quando a auditoria sai de um IP brasileiro. Muda a leitura de
   * modal de redirecionamento geográfico e a confiança nos tempos medidos.
   */
  fromBrazil?: boolean
}

export interface AuditResult {
  ok: boolean
  /** done só quando a jornada inteira rodou. No bloco 3a nunca é `done`. */
  status: 'done' | 'partial' | 'failed'
  url: string
  finalDomain: string
  platform: string | null
  platformConfidence: string | null
  storefrontNotes: string[]
  product: ProductRef | null
  cart: AddToCartResult | null
  checkout: CheckoutContext | null
  payment: PaymentSnapshot | null
  /** Identidade usada, sempre mascarada. O CPF inteiro nunca sai daqui. */
  identity: Record<string, unknown> | null
  /** §8 — checagens, achados e nota. null quando a auditoria nem começou. */
  checks: ChecksReport | null
  steps: JourneyStep[]
  screenshotsDir: string | null
  robots: {
    ownerVerified: boolean
    blockedPaths: string[]
    overridesUsed: Array<{ path: string; at: string }>
  }
  /** Por que não foi `done`. Lista, porque pode haver mais de um motivo. */
  incompleteBecause: string[]
  /** De onde a auditoria foi feita. Muda o que os números significam. */
  vantage: {
    auditedFromBrazil: boolean | null
    locale: string
    timezone: string
    note: string | null
  }
  errorCode: AuditErrorCode | null
  errorReason: string | null
  /** Contexto da falha: URL no momento, HTML salvo, seletores tentados. */
  errorDetail: Record<string, unknown> | null
  timings: { totalMs: number; homeLoadMs: number | null }
}

const JOURNEY_PATHS = ['/products.json', '/cart', '/cart.js', '/checkout'] as const

export async function audit(input: string, options: AuditOptions = {}): Promise<AuditResult> {
  const startedAt = Date.now()
  const deps = createDeps()
  const outDir = options.outDir ?? DEFAULT_OUT_DIR
  const slot: { browser: BrowserSession | null } = { browser: null }

  const base: AuditResult = {
    ok: false,
    status: 'failed',
    url: input,
    finalDomain: '',
    platform: null,
    platformConfidence: null,
    storefrontNotes: [],
    product: null,
    cart: null,
    checkout: null,
    payment: null,
    identity: null,
    checks: null,
    steps: [],
    screenshotsDir: null,
    robots: { ownerVerified: options.ownerVerified === true, blockedPaths: [], overridesUsed: [] },
    incompleteBecause: [],
    vantage: {
      auditedFromBrazil: options.fromBrazil ?? null,
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      note:
        options.fromBrazil === true
          ? vantageContradiction(options.fromBrazil)
          : 'ponto de observação não declarado como Brasil: tempos de carregamento e ' +
            'meios de pagamento visíveis podem não ser os que um comprador brasileiro vê ' +
            '(use --from-br quando a auditoria sair de IP brasileiro)',
    },
    errorCode: null,
    errorReason: null,
    errorDetail: null,
    timings: { totalMs: 0, homeLoadMs: null },
  }

  try {
    // §2.2 / §12: intervalo mínimo entre auditorias do mesmo domínio, checado
    // ANTES de qualquer requisição sair. A regra que depende de alguém lembrar
    // dela não é regra: foi assim que a Insider Store levou oito rodadas
    // seguidas até começar a desafiar.
    const domain = normalizeUrl(input).hostname
    const verdict = checkCooldown(await readLedger(outDir), domain)
    if (!verdict.allowed && options.force !== true) {
      return {
        ...base,
        finalDomain: domain,
        errorCode: 'COOLDOWN_ACTIVE',
        errorReason:
          verdict.blockedBy === 'full-audit'
            ? `${domain} foi auditado por completo há pouco (${verdict.lastAuditedAt}). ` +
              `Faltam ${verdict.hoursRemaining}h. Repetir contra loja de terceiro é o que ` +
              'a §2.2 proíbe; em loja própria, use --force.'
            : `tentativa recente em ${domain} (${verdict.lastAuditedAt}). ` +
              `Aguarde até ${verdict.nextAllowedAt} ou use --force. ` +
              'Este é o piso entre tentativas, não o intervalo de 24h.',
        errorDetail: { ...verdict, cooldownHours: DEFAULT_COOLDOWN_HOURS },
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }
    // Registra a TENTATIVA aqui; a auditoria completa só é registrada quando a
    // jornada de fato roda. Antes eu registrava tudo antes de começar, e uma
    // falha local (sem DISPLAY, por exemplo) queimava 24h sem ter auditado nada.
    await recordAudit(outDir, domain, options.force === true, 'attempt')

    const result = await deps.deadline.race(
      runAudit(input, options, deps, slot, outDir, startedAt, base),
      'auditoria',
    )

    if (result.cart !== null || result.checkout !== null) {
      await recordAudit(outDir, domain, options.force === true, 'full')
    }
    return result
  } catch (e) {
    if (e instanceof PreflightRejected) {
      return {
        ...base,
        errorCode: e.failure.errorCode,
        errorReason: e.failure.errorReason,
        errorDetail: Object.keys(e.failure.detail).length > 0 ? e.failure.detail : null,
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }
    const err = toAuditError(e)
    return {
      ...base,
      errorCode: err.code,
      errorReason: err.message,
      errorDetail: Object.keys(err.detail).length > 0 ? err.detail : null,
      timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
    }
  } finally {
    await slot.browser?.close()
  }
}

async function runAudit(
  input: string,
  options: AuditOptions,
  deps: ReturnType<typeof createDeps>,
  slot: { browser: BrowserSession | null },
  outDir: string,
  startedAt: number,
  base: AuditResult,
): Promise<AuditResult> {
  const prepared = await prepare(input, options, deps, (b) => {
    slot.browser = b
  })

  const pre: PreflightOk = prepared.preflight
  const hostname = new URL(prepared.probe.baseUrl).hostname
  const recorder = createRecorder({ outDir, hostname })
  const incompleteBecause: string[] = []

  const blockedPaths = JOURNEY_PATHS.filter(
    (p) => !prepared.gate.check(new URL(p, prepared.probe.baseUrl).href).allowed,
  )

  const result: AuditResult = {
    ...base,
    url: pre.finalUrl,
    finalDomain: hostname,
    platform: prepared.decision.evidence.platform,
    platformConfidence: prepared.decision.evidence.confidence,
    storefrontNotes: prepared.decision.evidence.notes ?? [],
    screenshotsDir: recorder.dir,
    robots: {
      ownerVerified: prepared.gate.ownerVerified,
      blockedPaths: [...blockedPaths],
      overridesUsed: [...prepared.gate.overrides],
    },
    timings: { totalMs: 0, homeLoadMs: prepared.opened.loadMs },
  }

  const homeShot = await recorder.capture(prepared.browser.page, 'home')
  recorder.step(
    makeStep({
      id: 'open-home',
      label: 'identificando a loja',
      url: pre.finalUrl,
      startedAt,
      screenshot: homeShot,
      outcome: { status: 'done' },
    }),
  )

  const adapter = adapterFor(prepared.decision.evidence.platform)
  const journey = adapter?.journey

  if (!journey) {
    // Plataforma identificada mas sem jornada nesta fase (§17). Não é falha.
    incompleteBecause.push(
      `jornada não implementada para ${prepared.decision.evidence.platform} nesta fase`,
    )
    // Sem jornada para esta plataforma: o HTML fica salvo para quem for
    // implementar o adapter depois.
    await saveHtml(outDir, hostname, 'home', prepared.opened.html)
    return finish(result, recorder.steps, incompleteBecause, startedAt, {
      productText: null,
      blockedBySite: false,
    })
  }

  let identity: AuditIdentity | null = null
  if (options.fillCheckout === true) {
    loadDotEnv()
    try {
      identity = loadIdentity()
      result.identity = describeIdentity(identity)
    } catch (e) {
      // Sem identidade não se preenche nada — e não se inventa nome nem CPF.
      incompleteBecause.push(
        `preenchimento do checkout desligado: ${e instanceof Error ? e.message : 'identidade ausente'}`,
      )
    }
  }

  const ctx = makeJourneyContext(prepared, recorder, deps, identity, outDir, options.fromBrazil ?? null)

  // 1. encontrar produto
  let product: ProductRef
  const findStartedAt = Date.now()
  try {
    product = await journey.findProduct(ctx)
    result.product = product
  } catch (e) {
    const shot = await recorder.capture(prepared.browser.page, 'falha-find-product')
    return failStep(result, recorder.steps, e, 'find-product', 'encontrando um produto', startedAt, shot, findStartedAt)
  }

  // 2. adicionar ao carrinho
  let cart: AddToCartResult
  const cartStartedAt = Date.now()
  try {
    cart = await journey.addToCart(ctx, product)
    result.cart = cart
    if (cart.ok === null) {
      incompleteBecause.push(
        `carrinho não pôde ser confirmado${cart.cartReadNote ? ` — ${cart.cartReadNote}` : ''}`,
      )
    } else if (cart.ok === false) {
      incompleteBecause.push('carrinho não recebeu o item: /cart.js não registrou nada')
    }
    if (cart.overlay.likelyAuditArtifact) {
      incompleteBecause.push(
        `overlay "${cart.overlay.kind}" atrapalhou a jornada, mas provavelmente só apareceu ` +
          'porque a auditoria não saiu de IP brasileiro. NÃO deve virar achado contra a loja.',
      )
    }
  } catch (e) {
    const shot = await recorder.capture(prepared.browser.page, 'falha-add-to-cart')
    return failStep(result, recorder.steps, e, 'add-to-cart', 'adicionando ao carrinho', startedAt, shot, cartStartedAt)
  }

  // 3. checkout (§6.5) e coleta na tela de pagamento (§6.6)
  const checkoutUrl = new URL('/checkout', prepared.probe.baseUrl).href
  const checkoutPermission = prepared.gate.check(checkoutUrl)

  if (!checkoutPermission.allowed) {
    recorder.step(
      makeStep({
        id: 'reach-checkout',
        label: 'indo para o checkout',
        url: checkoutUrl,
        startedAt: Date.now(),
        screenshot: null,
        outcome: { status: 'not_permitted_by_robots', path: checkoutPermission.path },
      }),
    )
    incompleteBecause.push(
      'checkout não auditado: robots.txt proíbe /checkout e não houve titularidade confirmada',
    )
  } else if (!journey.reachCheckout) {
    incompleteBecause.push('checkout não auditado: jornada sem etapa de checkout')
  } else {
    const checkoutStartedAt = Date.now()
    try {
      const checkout = await journey.reachCheckout(ctx, cart)
      result.checkout = checkout

      if (!checkout.reachedPaymentScreen) {
        incompleteBecause.push(
          identity
            ? 'não chegou à tela de meios de pagamento; HTML do checkout salvo para análise'
            : 'parou na primeira tela do checkout: preenchimento não autorizado (use --fill-checkout)',
        )
      }
      if (checkout.forcedLogin === true) {
        incompleteBecause.push('a loja exige login antes do checkout')
      }

      if (journey.collectPayment && checkout.reachedPaymentScreen) {
        result.payment = await journey.collectPayment(ctx, checkout)
      } else if (!checkout.reachedPaymentScreen) {
        // Não chegamos na tela: a §6.6 inteira fica não aplicável, e é assim
        // que ela tem que sair — nunca preenchida por dedução.
        incompleteBecause.push('dados da tela de pagamento (§6.6) não aplicáveis: tela não alcançada')
      }
    } catch (e) {
      const shot = await recorder.capture(prepared.browser.page, 'falha-checkout')
      return failStep(result, recorder.steps, e, 'reach-checkout', 'indo para o checkout', startedAt, shot, checkoutStartedAt)
    }
  }

  return finish(result, recorder.steps, incompleteBecause, startedAt, {
    productText: (ctx.scratch.get('productText') as string | null) ?? null,
    blockedBySite: false,
  })
}

function makeJourneyContext(
  prepared: Awaited<ReturnType<typeof prepare>>,
  recorder: ReturnType<typeof createRecorder>,
  deps: ReturnType<typeof createDeps>,
  identity: AuditIdentity | null,
  outDir: string,
  auditedFromBrazil: boolean | null,
): JourneyContext {
  return {
    page: prepared.browser.page,
    baseUrl: prepared.probe.baseUrl,
    fetch: prepared.gatedFetch,
    gate: prepared.gate,
    recorder,
    deadline: deps.deadline,
    identity,
    outDir,
    auditedFromBrazil,
    scratch: new Map<string, unknown>(),

    rateLimited<T>(fn: () => Promise<T>): Promise<T> {
      return deps.limiter.schedule(new URL(prepared.probe.baseUrl).hostname, fn)
    },

    async navigate(url: string, timeoutMs = 30_000): Promise<NavigationResult> {
      const permission = prepared.gate.check(url)
      if (!permission.allowed) {
        throw new AuditError('ROBOTS_DISALLOWED', `robots.txt proíbe ${permission.path}`, {
          path: permission.path,
        })
      }
      // Navegação do browser também respeita 1 req/s por domínio (§2.3).
      return deps.limiter.schedule(new URL(url).hostname, async () => {
        const began = Date.now()
        const response = await prepared.browser.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        })
        return {
          url: prepared.browser.page.url(),
          status: response?.status() ?? null,
          loadMs: Date.now() - began,
        }
      })
    },
  }
}

function finish(
  result: AuditResult,
  steps: ReadonlyArray<JourneyStep>,
  incompleteBecause: string[],
  startedAt: number,
  extra: { productText: string | null; blockedBySite: boolean },
): AuditResult {
  const withSteps = { ...result, steps: [...steps] }
  return {
    ...withSteps,
    ok: true,
    status: incompleteBecause.length > 0 ? 'partial' : 'done',
    incompleteBecause,
    checks: runChecks({
      product: withSteps.product,
      cart: withSteps.cart,
      checkout: withSteps.checkout,
      payment: withSteps.payment,
      steps: withSteps.steps,
      productText: extra.productText,
      homeLoadMs: withSteps.timings.homeLoadMs,
      mobile: null,
      auditedFromBrazil: withSteps.vantage.auditedFromBrazil,
      robotsBlockedPaths: withSteps.robots.blockedPaths,
      blockedBySite: extra.blockedBySite,
    }),
    timings: { ...withSteps.timings, totalMs: Date.now() - startedAt },
  }
}

/**
 * Desafio antibot não é defeito da loja nem erro do motor: é a loja exercendo o
 * direito de se proteger. §18 pede partial explicado; §2.2 proíbe testar a
 * proteção de terceiros, então não se contorna, se relata.
 */
function isProtectedSite(code: AuditErrorCode): boolean {
  return code === 'BOT_CHALLENGE' || code === 'HOME_NOT_OK'
}

function failStep(
  result: AuditResult,
  steps: ReadonlyArray<JourneyStep>,
  error: unknown,
  id: string,
  label: string,
  startedAt: number,
  screenshot: string | null,
  // Quando a etapa começou de verdade. Passar Date.now() aqui zerava a duração
  // de toda etapa que falhava, escondendo se ela demorou 12s ou 0s — e essa
  // diferença é o diagnóstico.
  stepStartedAt: number,
): AuditResult {
  const err = toAuditError(error)
  const trail = [
    ...steps,
    makeStep({
      id,
      label,
      url: result.url,
      startedAt: stepStartedAt,
      screenshot,
      outcome:
        err.code === 'ROBOTS_DISALLOWED'
          ? { status: 'not_permitted_by_robots', path: String(err.detail['path'] ?? '') }
          : { status: 'failed', code: err.code, reason: err.message },
    }),
  ]
  const explanation = isProtectedSite(err.code)
    ? `${err.message}. Isto NÃO é achado contra a loja: proteger a vitrine é decisão ` +
      'legítima do lojista, e o comprador dela passa pelo desafio normalmente. A auditoria ' +
      'não tenta contornar (§2.2).'
    : `${label}: ${err.message}`

  return {
    ...result,
    ok: true,
    status: 'partial',
    steps: trail,
    incompleteBecause: [explanation],
    checks: runChecks({
      product: result.product,
      cart: result.cart,
      checkout: result.checkout,
      payment: result.payment,
      steps: trail,
      productText: null,
      homeLoadMs: result.timings.homeLoadMs,
      mobile: null,
      auditedFromBrazil: result.vantage.auditedFromBrazil,
      robotsBlockedPaths: result.robots.blockedPaths,
      blockedBySite: isProtectedSite(err.code),
    }),
    errorCode: err.code,
    errorReason: err.message,
    errorDetail: Object.keys(err.detail).length > 0 ? err.detail : null,
    timings: { ...result.timings, totalMs: Date.now() - startedAt },
  }
}

/**
 * Resumo do que interessa para conferir uma rodada. O JSON completo tem
 * centenas de linhas — colar isso inteiro num chat ou num ticket é ruído.
 */
export function summarize(result: AuditResult): Record<string, unknown> {
  return {
    status: result.status,
    domain: result.finalDomain,
    platform: result.platform,
    confidence: result.platformConfidence,
    product: result.product
      ? {
          title: result.product.title,
          priceCents: result.product.priceCents,
          requiresVariantChoice: result.product.requiresVariantChoice,
        }
      : null,
    cart: result.cart
      ? {
          ok: result.cart.ok,
          itemCount: result.cart.itemCount,
          cartReadNote: result.cart.cartReadNote,
          uiPattern: result.cart.uiPattern,
          clicks: result.cart.clicks,
          ms: result.cart.ms,
          overlay: result.cart.overlay,
        }
      : null,
    checkout: result.checkout
      ? {
          reachedPaymentScreen: result.checkout.reachedPaymentScreen,
          forcedLogin: result.checkout.forcedLogin,
          stepsFromProduct: result.checkout.stepsFromProduct,
        }
      : null,
    payment: result.payment
      ? {
          methods: result.payment.methods.map((m) => m.label),
          pix: result.payment.pix,
          installments: result.payment.installments,
          couponField: result.payment.couponField,
          gateway: result.payment.gateway,
        }
      : null,
    score: result.checks?.score ?? null,
    checks: result.checks
      ? {
          score: result.checks.score,
          ressalva: result.checks.scoreCaveat,
          cobertura: `${Math.round(result.checks.coverage.ratio * 100)}% da §8 em peso`,
          aplicaveis: result.checks.applicable,
          passaram: result.checks.passed,
          falharam: result.checks.failed,
          naoAplicaveis: result.checks.notApplicable,
          achados: result.checks.findings.map((f) => `[${f.severity}] ${f.id}: ${f.evidence[0] ?? ''}`),
          naoAplicavelPorque: result.checks.results
            .filter((r) => r.status === 'not_applicable')
            .map((r) => `${r.id}: ${r.notApplicableReason ?? ''}`),
        }
      : null,
    steps: result.steps.map((s) => ({ id: s.id, ms: s.ms, outcome: s.outcome.status })),
    robots: result.robots,
    vantage: result.vantage,
    incompleteBecause: result.incompleteBecause,
    errorCode: result.errorCode,
    errorReason: result.errorReason,
    errorDetail: result.errorDetail,
    screenshotsDir: result.screenshotsDir,
    timings: result.timings,
  }
}
