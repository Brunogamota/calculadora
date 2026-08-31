/**
 * §2.3 — respeitar robots.txt.
 *
 * Semântica seguida (RFC 9309 + prática dos crawlers grandes):
 *  - grupos de User-agent consecutivos compartilham as mesmas regras
 *  - vale o grupo mais específico que casa com nosso token; senão o grupo `*`
 *  - entre Allow e Disallow, ganha o padrão de match MAIS LONGO; empate, Allow ganha
 *  - `Disallow:` vazio libera tudo
 *  - `*` e `$` são suportados no caminho
 *
 * Indisponibilidade: 4xx libera tudo (RFC 9309), 5xx e erro de rede proíbem tudo.
 * O 5xx falha fechado de propósito — na dúvida a gente não bate na loja.
 */

import { AuditError, toAuditError } from './errors.ts'
import type { SafeFetch } from './http.ts'
import { DEFAULT_USER_AGENT } from './http.ts'

/** Token do nosso UA, o que vai casar com `User-agent:` no arquivo. */
export const AUDIT_UA_TOKEN = (DEFAULT_USER_AGENT.split('/')[0] ?? 'RebornCheckoutAudit').toLowerCase()

interface Rule {
  allow: boolean
  pattern: string
}

interface Group {
  agents: string[]
  rules: Rule[]
  crawlDelayMs: number | null
}

export interface RobotsPolicy {
  /** 'fetched' | 'absent' (4xx) | 'unavailable' (5xx/rede) */
  source: 'fetched' | 'absent' | 'unavailable'
  status: number | null
  /** Grupo que se aplica a nós: nosso token, `*`, ou nenhum. */
  matchedAgent: string | null
  crawlDelayMs: number | null
  reason: string
  isAllowed(path: string): boolean
}

export function parseRobots(text: string, uaToken: string): {
  matchedAgent: string | null
  rules: Rule[]
  crawlDelayMs: number | null
} {
  const groups: Group[] = []
  let current: Group | null = null
  let lastLineWasAgent = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? ''
    if (!line) continue

    const sep = line.indexOf(':')
    if (sep === -1) continue
    const field = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelayMs: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastLineWasAgent = true
      continue
    }

    lastLineWasAgent = false
    if (!current) continue

    if (field === 'disallow') {
      // "Disallow:" vazio = libera tudo; não vira regra.
      if (value !== '') current.rules.push({ allow: false, pattern: value })
    } else if (field === 'allow') {
      if (value !== '') current.rules.push({ allow: true, pattern: value })
    } else if (field === 'crawl-delay') {
      const seconds = Number(value.replace(',', '.'))
      if (Number.isFinite(seconds) && seconds > 0) current.crawlDelayMs = Math.round(seconds * 1000)
    }
  }

  // Grupo específico ganha do curinga.
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && uaToken.includes(a)))
  const wildcard = groups.find((g) => g.agents.includes('*'))
  const chosen = specific ?? wildcard

  if (!chosen) return { matchedAgent: null, rules: [], crawlDelayMs: null }
  return {
    matchedAgent: specific ? (specific.agents.find((a) => a !== '*') ?? '*') : '*',
    rules: chosen.rules,
    crawlDelayMs: chosen.crawlDelayMs,
  }
}

/** Converte padrão robots (`*`, `$`) em RegExp ancorada no início do caminho. */
function patternToRegExp(pattern: string): RegExp {
  let body = ''
  let anchorEnd = false
  const chars = pattern.endsWith('$') ? pattern.slice(0, -1) : pattern
  if (pattern.endsWith('$')) anchorEnd = true

  for (const ch of chars) {
    if (ch === '*') body += '.*'
    else body += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${body}${anchorEnd ? '$' : ''}`)
}

/** Comprimento do padrão decide o vencedor; empate vai para Allow. */
export function evaluateRules(rules: Rule[], path: string): boolean {
  let best: { allow: boolean; length: number } | null = null

  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue
    const length = rule.pattern.length
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length }
    }
  }
  return best ? best.allow : true
}

export async function fetchRobots(origin: string, safeFetch: SafeFetch): Promise<RobotsPolicy> {
  const url = new URL('/robots.txt', origin).href
  const allowAll = (source: RobotsPolicy['source'], status: number | null, reason: string): RobotsPolicy => ({
    source,
    status,
    matchedAgent: null,
    crawlDelayMs: null,
    reason,
    isAllowed: () => true,
  })

  let response
  try {
    response = await safeFetch(url, { timeoutMs: 10_000, maxBytes: 512 * 1024, skipRateLimit: true })
  } catch (e) {
    const err = toAuditError(e)
    // Guard de SSRF não vira "site sem robots" — é erro de verdade, propaga.
    if (err.code === 'PRIVATE_ADDRESS' || err.code === 'IP_LITERAL' || err.code === 'BLOCKED_HOSTNAME') {
      throw err
    }
    return {
      source: 'unavailable',
      status: null,
      matchedAgent: null,
      crawlDelayMs: null,
      reason: `robots.txt inacessível (${err.code}: ${err.message})`,
      isAllowed: () => false,
    }
  }

  if (response.status >= 500) {
    return {
      source: 'unavailable',
      status: response.status,
      matchedAgent: null,
      crawlDelayMs: null,
      reason: `robots.txt respondeu ${response.status}; por RFC 9309 isso proíbe a coleta`,
      isAllowed: () => false,
    }
  }
  if (response.status >= 400) {
    return allowAll('absent', response.status, `robots.txt respondeu ${response.status}: sem restrição`)
  }
  if (response.status < 200 || response.status >= 300) {
    return allowAll('absent', response.status, `robots.txt respondeu ${response.status}: tratado como ausente`)
  }

  const parsed = parseRobots(response.body, AUDIT_UA_TOKEN)
  const rules = parsed.rules
  return {
    source: 'fetched',
    status: response.status,
    matchedAgent: parsed.matchedAgent,
    crawlDelayMs: parsed.crawlDelayMs,
    reason: parsed.matchedAgent
      ? `grupo "${parsed.matchedAgent}" com ${rules.length} regra(s)`
      : 'robots.txt sem grupo aplicável',
    isAllowed: (path: string) => evaluateRules(rules, path),
  }
}

/** Lança se o caminho estiver proibido — usar antes de CADA navegação. */
export function assertRobotsAllows(policy: RobotsPolicy, url: string): void {
  const path = new URL(url).pathname + new URL(url).search
  if (!policy.isAllowed(path)) {
    throw new AuditError('ROBOTS_DISALLOWED', `robots.txt proíbe ${path}`, {
      path,
      matchedAgent: policy.matchedAgent,
      reason: policy.reason,
    })
  }
}
