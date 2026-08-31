/**
 * Bloco 1 completo, encadeado: é o que roda ANTES de qualquer browser abrir.
 * Se o preflight não passa, a auditoria nem começa.
 */

import { guardUrl, type NormalizedUrl } from './lib/guards.ts'
import { createSafeFetch, DEFAULT_USER_AGENT, type SafeFetch } from './lib/http.ts'
import { HostRateLimiter } from './lib/ratelimit.ts'
import { fetchRobots, type RobotsPolicy } from './lib/robots.ts'
import { loadBlocklist } from './lib/blocklist.ts'
import { Deadline } from './lib/deadline.ts'
import { AuditError, toAuditError, type AuditErrorCode } from './lib/errors.ts'

export interface PreflightOk {
  ok: true
  input: string
  /** URL de entrada normalizada (antes de seguir redirect). */
  normalized: string
  /** URL após seguir os redirects da home, revalidada a cada hop. */
  finalUrl: string
  finalDomain: string
  redirectChain: string[]
  schemeAssumed: boolean
  httpsOnFinal: boolean
  addresses: Array<{ address: string; version: 4 | 6 | null }>
  robots: {
    source: RobotsPolicy['source']
    status: number | null
    matchedAgent: string | null
    crawlDelayMs: number | null
    reason: string
    homeAllowed: boolean
    samplePaths: Record<string, boolean>
  }
  rateLimitMs: number
  userAgent: string
  homeStatus: number
  timings: { totalMs: number }
}

export interface PreflightFailed {
  ok: false
  input: string
  errorCode: AuditErrorCode
  errorReason: string
  detail: Record<string, unknown>
}

export type PreflightResult = PreflightOk | PreflightFailed

/** Caminhos que a jornada vai querer usar — checados já aqui contra o robots. */
const SAMPLE_PATHS = ['/', '/products.json', '/cart', '/cart.js', '/checkout', '/collections/all']

export interface PreflightDeps {
  limiter: HostRateLimiter
  safeFetch: SafeFetch
  deadline: Deadline
}

export function createDeps(budgetMs = Number(process.env['MAX_AUDIT_MS'] ?? 120_000)): PreflightDeps {
  const limiter = new HostRateLimiter(1000)
  return { limiter, safeFetch: createSafeFetch(limiter), deadline: new Deadline(budgetMs) }
}

export async function preflight(input: string, deps: PreflightDeps = createDeps()): Promise<PreflightResult> {
  const startedAt = Date.now()
  const { limiter, safeFetch, deadline } = deps

  try {
    // 1. Normaliza, valida a forma e resolve o host (SSRF, §2.5 / §6.1)
    deadline.assertAlive('normalização de URL')
    const guarded = await guardUrl(input)

    // 2. Blocklist (§6.1)
    const blocklist = await loadBlocklist()
    blocklist.check(guarded.url.hostname)

    // 3. Abre a home seguindo redirects; cada hop revalidado dentro do safeFetch
    deadline.assertAlive('abertura da home')
    const home = await safeFetch(guarded.url.href, { timeoutMs: deadline.clamp(15_000) })

    // §14: loja fora do ar ou atrás de antibot é falha EXPLICADA, nunca
    // "auditoria ok". Sem 2xx aqui não há jornada possível.
    if (home.status < 200 || home.status >= 300) {
      const antibot = [401, 403, 405, 429, 503].includes(home.status)
      throw new AuditError(
        'HOME_NOT_OK',
        antibot
          ? `Home respondeu ${home.status}: provável bloqueio antibot/WAF, não dá para auditar`
          : `Home respondeu ${home.status}, esperado 2xx`,
        { status: home.status, url: home.url, chain: home.chain, likelyAntibot: antibot },
      )
    }

    const finalUrl: NormalizedUrl = (await guardUrl(home.url)).url
    blocklist.check(finalUrl.hostname)

    // 4. robots.txt do domínio FINAL, não do informado (§6.1: revalidar o destino)
    deadline.assertAlive('robots.txt')
    const robots = await fetchRobots(finalUrl.origin, safeFetch)
    if (robots.crawlDelayMs !== null) {
      limiter.setMinInterval(finalUrl.hostname, robots.crawlDelayMs)
    }

    const samplePaths: Record<string, boolean> = {}
    for (const path of SAMPLE_PATHS) samplePaths[path] = robots.isAllowed(path)

    return {
      ok: true,
      input,
      normalized: guarded.url.href,
      finalUrl: finalUrl.href,
      finalDomain: finalUrl.hostname,
      redirectChain: home.chain,
      schemeAssumed: guarded.url.schemeAssumed,
      httpsOnFinal: finalUrl.protocol === 'https:',
      addresses: guarded.host.addresses.map((a) => ({ address: a.address, version: a.version })),
      robots: {
        source: robots.source,
        status: robots.status,
        matchedAgent: robots.matchedAgent,
        crawlDelayMs: robots.crawlDelayMs,
        reason: robots.reason,
        homeAllowed: robots.isAllowed(new URL(finalUrl.href).pathname),
        samplePaths,
      },
      rateLimitMs: limiter.getMinInterval(finalUrl.hostname),
      userAgent: DEFAULT_USER_AGENT,
      homeStatus: home.status,
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
    }
  }
}
