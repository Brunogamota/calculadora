/**
 * Bloco 2 encadeado: preflight -> browser -> sonda -> detecção de plataforma.
 *
 * Também monta o "plano de robots": para cada caminho que a jornada vai querer
 * usar, diz se está permitido, se está proibido, ou se vai rodar sob a exceção
 * de titularidade. É o que permite ao relatório dizer `partial` com motivo
 * explícito em vez de acusar a loja de uma falha que ela não tem.
 */

import { preflight, createDeps, type PreflightFailed, type PreflightOk } from './preflight.ts'
import { launchBrowser, openPage, readPageGlobals } from './lib/browser.ts'
import { createSafeFetch, DEFAULT_USER_AGENT, type SafeFetch } from './lib/http.ts'
import { fetchRobots } from './lib/robots.ts'
import { createRobotsGate } from './lib/gate.ts'
import { adapterFor, detectPlatform, type PlatformDecision } from './platforms/index.ts'
import { AuditError, toAuditError, type AuditErrorCode } from './lib/errors.ts'
import type { DetectionProbe, PageGlobals, StepPermission } from './types.ts'

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

  const pre = await preflight(input, deps)
  if (!pre.ok) {
    const failed = pre as PreflightFailed
    return {
      ok: false,
      input,
      errorCode: failed.errorCode,
      errorReason: failed.errorReason,
      detail: failed.detail,
    }
  }

  try {
    const policy = await fetchRobots(pre.finalUrl, deps.safeFetch)
    const gate = createRobotsGate(policy, { ownerVerified: options.ownerVerified === true })

    // Rede a partir dos adapters passa pelo portão: nada escapa por esquecimento.
    const gatedFetch: SafeFetch = async (url, opts) => {
      const permission = gate.check(url)
      if (!permission.allowed) {
        throw new AuditError('ROBOTS_DISALLOWED', `robots.txt proíbe ${permission.path}`, {
          path: permission.path,
        })
      }
      return createSafeFetch(deps.limiter)(url, opts)
    }

    const homePermission = gate.check(pre.finalUrl)
    if (!homePermission.allowed) {
      throw new AuditError('ROBOTS_DISALLOWED', `robots.txt proíbe a própria home (${homePermission.path})`, {
        path: homePermission.path,
      })
    }

    const session = await launchBrowser({
      headed: options.headed !== false,
      userAgent: DEFAULT_USER_AGENT,
      timeoutMs: deps.deadline.clamp(30_000),
    })
    slot.session = session

    deps.deadline.assertAlive('abertura da home no browser')
    const opened = await openPage(session.page, pre.finalUrl, deps.deadline.clamp(30_000))
    const globals = await readPageGlobals(session.page)

    const probe: DetectionProbe = {
      page: session.page,
      html: opened.html,
      headers: opened.headers,
      baseUrl: new URL(opened.finalUrl).origin,
      globals,
      fetch: gatedFetch,
      gate,
    }

    const decision: PlatformDecision = await detectPlatform(probe)

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
      globals,
      blockedRequests: session.blockedRequests,
      homeLoadMs: opened.loadMs,
      timings: { totalMs: Date.now() - startedAt },
    }
  } catch (e) {
    const err = toAuditError(e)
    return {
      ok: false,
      input,
      errorCode: err.code,
      errorReason: err.message,
      detail: err.detail,
      preflight: pre,
    }
  }
}
