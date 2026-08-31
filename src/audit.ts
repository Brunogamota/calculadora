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
import { AuditError, toAuditError, type AuditErrorCode } from './lib/errors.ts'
import type {
  AddToCartResult,
  JourneyContext,
  JourneyStep,
  NavigationResult,
  ProductRef,
} from './types.ts'
import type { BrowserSession } from './lib/browser.ts'

export interface AuditOptions extends PrepareOptions {
  outDir?: string
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
  steps: JourneyStep[]
  screenshotsDir: string | null
  robots: {
    ownerVerified: boolean
    blockedPaths: string[]
    overridesUsed: Array<{ path: string; at: string }>
  }
  /** Por que não foi `done`. Lista, porque pode haver mais de um motivo. */
  incompleteBecause: string[]
  errorCode: AuditErrorCode | null
  errorReason: string | null
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
    steps: [],
    screenshotsDir: null,
    robots: { ownerVerified: options.ownerVerified === true, blockedPaths: [], overridesUsed: [] },
    incompleteBecause: [],
    errorCode: null,
    errorReason: null,
    timings: { totalMs: 0, homeLoadMs: null },
  }

  try {
    return await deps.deadline.race(
      runAudit(input, options, deps, slot, outDir, startedAt, base),
      'auditoria',
    )
  } catch (e) {
    if (e instanceof PreflightRejected) {
      return {
        ...base,
        errorCode: e.failure.errorCode,
        errorReason: e.failure.errorReason,
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }
    const err = toAuditError(e)
    return {
      ...base,
      errorCode: err.code,
      errorReason: err.message,
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

  await recorder.capture(prepared.browser.page, 'home')
  recorder.step(
    makeStep({
      id: 'open-home',
      label: 'identificando a loja',
      url: pre.finalUrl,
      startedAt,
      screenshot: null,
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
    return finish(result, recorder.steps, incompleteBecause, startedAt)
  }

  const ctx = makeJourneyContext(prepared, recorder, deps)

  // 1. encontrar produto
  let product: ProductRef
  try {
    product = await journey.findProduct(ctx)
    result.product = product
  } catch (e) {
    return failStep(result, recorder.steps, e, 'find-product', 'encontrando um produto', startedAt)
  }

  // 2. adicionar ao carrinho
  let cart: AddToCartResult
  try {
    cart = await journey.addToCart(ctx, product)
    result.cart = cart
    if (cart.itemCount === null) {
      incompleteBecause.push('carrinho não pôde ser confirmado por /cart.js')
    }
  } catch (e) {
    return failStep(result, recorder.steps, e, 'add-to-cart', 'adicionando ao carrinho', startedAt)
  }

  // 3. checkout — bloco 3b
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
    recorder.step(
      makeStep({
        id: 'reach-checkout',
        label: 'indo para o checkout',
        url: checkoutUrl,
        startedAt: Date.now(),
        screenshot: null,
        outcome: { status: 'skipped', reason: 'etapa de checkout ainda não implementada (bloco 3b)' },
      }),
    )
    incompleteBecause.push('checkout não auditado: etapa ainda não implementada (bloco 3b)')
  }

  return finish(result, recorder.steps, incompleteBecause, startedAt)
}

function makeJourneyContext(
  prepared: Awaited<ReturnType<typeof prepare>>,
  recorder: ReturnType<typeof createRecorder>,
  deps: ReturnType<typeof createDeps>,
): JourneyContext {
  return {
    page: prepared.browser.page,
    baseUrl: prepared.probe.baseUrl,
    fetch: prepared.gatedFetch,
    gate: prepared.gate,
    recorder,
    deadline: deps.deadline,

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
): AuditResult {
  return {
    ...result,
    ok: true,
    status: incompleteBecause.length > 0 ? 'partial' : 'done',
    steps: [...steps],
    incompleteBecause,
    timings: { ...result.timings, totalMs: Date.now() - startedAt },
  }
}

function failStep(
  result: AuditResult,
  steps: ReadonlyArray<JourneyStep>,
  error: unknown,
  id: string,
  label: string,
  startedAt: number,
): AuditResult {
  const err = toAuditError(error)
  const trail = [
    ...steps,
    makeStep({
      id,
      label,
      url: result.url,
      startedAt: Date.now(),
      screenshot: null,
      outcome:
        err.code === 'ROBOTS_DISALLOWED'
          ? { status: 'not_permitted_by_robots', path: String(err.detail['path'] ?? '') }
          : { status: 'failed', code: err.code, reason: err.message },
    }),
  ]
  return {
    ...result,
    ok: true,
    status: 'partial',
    steps: trail,
    incompleteBecause: [`${label}: ${err.message}`],
    errorCode: err.code,
    errorReason: err.message,
    timings: { ...result.timings, totalMs: Date.now() - startedAt },
  }
}
