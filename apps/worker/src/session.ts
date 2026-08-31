/**
 * Montagem compartilhada por `detect` e `audit`: preflight, robots, portão,
 * browser e sonda. Ficava dentro do detect e passou a viver aqui quando o
 * `audit` precisou exatamente da mesma sequência.
 *
 * Quem chama é responsável por fechar (`close`).
 */

import { preflight, createDeps, type PreflightFailed, type PreflightOk } from './preflight.ts'
import { launchBrowser, openPage, readPageGlobals, type BrowserSession, type OpenResult } from './lib/browser.ts'
import { createSafeFetch, DEFAULT_USER_AGENT, type SafeFetch } from './lib/http.ts'
import { fetchRobots } from './lib/robots.ts'
import { createRobotsGate } from './lib/gate.ts'
import { detectPlatform, type PlatformDecision } from './platforms/index.ts'
import { AuditError } from './lib/errors.ts'
import type { DetectionProbe, RobotsGate } from './types.ts'

export interface PrepareOptions {
  headed?: boolean
  ownerVerified?: boolean
}

export interface PreparedSession {
  deps: ReturnType<typeof createDeps>
  preflight: PreflightOk
  gate: RobotsGate
  gatedFetch: SafeFetch
  browser: BrowserSession
  opened: OpenResult
  probe: DetectionProbe
  decision: PlatformDecision
}

export class PreflightRejected extends Error {
  readonly failure: PreflightFailed
  constructor(failure: PreflightFailed) {
    super(failure.errorReason)
    this.name = 'PreflightRejected'
    this.failure = failure
  }
}

export async function prepare(
  input: string,
  options: PrepareOptions,
  deps: ReturnType<typeof createDeps> = createDeps(),
  onBrowser?: (session: BrowserSession) => void,
): Promise<PreparedSession> {
  const pre = await preflight(input, deps)
  if (!pre.ok) throw new PreflightRejected(pre as PreflightFailed)

  const policy = await fetchRobots(pre.finalUrl, deps.safeFetch)
  const gate = createRobotsGate(policy, { ownerVerified: options.ownerVerified === true })

  // Toda rede a partir daqui passa pelo portão: nada escapa por esquecimento.
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

  const browser = await launchBrowser({
    headed: options.headed !== false,
    userAgent: DEFAULT_USER_AGENT,
    timeoutMs: deps.deadline.clamp(30_000),
  })
  onBrowser?.(browser)

  deps.deadline.assertAlive('abertura da home no browser')
  const opened = await openPage(browser.page, pre.finalUrl, deps.deadline.clamp(30_000))
  const globals = await readPageGlobals(browser.page)

  const probe: DetectionProbe = {
    page: browser.page,
    html: opened.html,
    headers: opened.headers,
    baseUrl: new URL(opened.finalUrl).origin,
    globals,
    fetch: gatedFetch,
    gate,
  }

  return { deps, preflight: pre, gate, gatedFetch, browser, opened, probe, decision: await detectPlatform(probe) }
}
