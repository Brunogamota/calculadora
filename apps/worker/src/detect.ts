/**
 * Bloco 2 encadeado: preflight -> browser -> sonda -> detecção de plataforma.
 *
 * Também monta o "plano de robots": para cada caminho que a jornada vai querer
 * usar, diz se está permitido, se está proibido, ou se vai rodar sob a exceção
 * de titularidade. É o que permite ao relatório dizer `partial` com motivo
 * explícito em vez de acusar a loja de uma falha que ela não tem.
 */

import { createDeps, type PreflightOk } from './preflight.ts'
import { prepare, PreflightRejected } from './session.ts'
import type { launchBrowser } from './lib/browser.ts'
import { adapterFor } from './platforms/index.ts'
import { toAuditError, type AuditErrorCode } from './lib/errors.ts'
import { DEFAULT_OUT_DIR, saveHtml } from './lib/artifacts.ts'
import type { PageGlobals, StepPermission } from './types.ts'

/** Caminhos que a jornada Shopify vai usar. Checados já aqui contra o robots. */
export const JOURNEY_PATHS = [
  '/products.json',
  '/collections/all',
  '/cart',
  '/cart.js',
  '/cart/add.js',
  '/checkout',
] as const

export interface RobotsPlanEntry {
  path: string
  permission: StepPermission['reason']
  allowed: boolean
}

export interface DetectOk {
  ok: true
  preflight: PreflightOk
  platform: {
    id: string
    label: string
    confidence: string
    signals: Array<{ where: string; detail: string; weight: string }>
    notes: string[]
  }
  alternatives: Array<{ id: string; confidence: string; signalCount: number }>
  fellBackToGeneric: boolean
  journeySupported: boolean
  robotsPlan: {
    ownerVerified: boolean
    entries: RobotsPlanEntry[]
    /** Caminhos proibidos que a jornada precisaria — motivo do `partial`. */
    blockedPaths: string[]
  }
  globals: PageGlobals
  /** HTML renderizado salvo em disco. Automático quando cai no genérico (§19). */
  htmlSavedTo: string | null
  blockedRequests: string[]
  homeLoadMs: number
  timings: { totalMs: number }
}

export interface DetectFailed {
  ok: false
  input: string
  errorCode: AuditErrorCode
  errorReason: string
  detail: Record<string, unknown>
  /** Preenchido quando a falha veio depois do preflight ter passado. */
  preflight?: PreflightOk
}

export type DetectResult = DetectOk | DetectFailed

export interface DetectOptions {
  headed?: boolean
  ownerVerified?: boolean
  /** Força salvar o HTML mesmo quando a plataforma foi identificada. */
  saveHtml?: boolean
  outDir?: string
}

interface SessionSlot {
  session: Awaited<ReturnType<typeof launchBrowser>> | null
}

/**
 * §14: o orçamento global precisa CORTAR, não só ser consultado. `assertAlive`
 * só vale nos pontos em que é chamado — uma etapa que trava entre dois
 * checkpoints passaria por cima dele para sempre. Por isso o trabalho inteiro
 * corre contra o deadline, e o browser é fechado no finally aconteça o que
 * acontecer.
 */
export async function detect(input: string, options: DetectOptions = {}): Promise<DetectResult> {
  const deps = createDeps()
  const slot: SessionSlot = { session: null }

  try {
    return await deps.deadline.race(runDetect(input, options, deps, slot), 'detecção de plataforma')
  } catch (e) {
    const err = toAuditError(e)
    return { ok: false, input, errorCode: err.code, errorReason: err.message, detail: err.detail }
  } finally {
    await slot.session?.close()
  }
}

async function runDetect(
  input: string,
  options: DetectOptions,
  deps: ReturnType<typeof createDeps>,
  slot: SessionSlot,
): Promise<DetectResult> {
  const startedAt = Date.now()

  let prepared
  try {
    prepared = await prepare(input, options, deps, (b) => {
      slot.session = b
    })
  } catch (e) {
    if (e instanceof PreflightRejected) {
      return {
        ok: false,
        input,
        errorCode: e.failure.errorCode,
        errorReason: e.failure.errorReason,
        detail: e.failure.detail,
      }
    }
    throw e
  }

  const { preflight: pre, gate, probe, decision, opened, browser } = prepared

  // §19: quando não identificamos a plataforma, o HTML é o que resolve o
  // problema em minutos. Salvar automático nesse caso.
  let htmlSavedTo: string | null = null
  if (decision.fellBackToGeneric || options.saveHtml === true) {
    htmlSavedTo = await saveHtml(
      options.outDir ?? DEFAULT_OUT_DIR,
      new URL(probe.baseUrl).hostname,
      'home',
      opened.html,
    )
  }

  const entries: RobotsPlanEntry[] = JOURNEY_PATHS.map((path) => {
    const permission = gate.check(new URL(path, probe.baseUrl).href)
    return { path, permission: permission.reason, allowed: permission.allowed }
  })

  return {
    ok: true,
    preflight: pre,
    platform: {
      id: decision.evidence.platform,
      label: adapterFor(decision.evidence.platform)?.label ?? decision.evidence.platform,
      confidence: decision.evidence.confidence,
      signals: decision.evidence.signals,
      notes: decision.evidence.notes ?? [],
    },
    alternatives: decision.alternatives.map((a) => ({
      id: a.platform,
      confidence: a.confidence,
      signalCount: a.signals.length,
    })),
    fellBackToGeneric: decision.fellBackToGeneric,
    journeySupported: decision.journeySupported,
    robotsPlan: {
      ownerVerified: gate.ownerVerified,
      entries,
      blockedPaths: entries.filter((e) => !e.allowed).map((e) => e.path),
    },
    globals: probe.globals,
    htmlSavedTo,
    blockedRequests: browser.blockedRequests,
    homeLoadMs: opened.loadMs,
    timings: { totalMs: Date.now() - startedAt },
  }
}
