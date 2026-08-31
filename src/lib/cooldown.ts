/**
 * Intervalo mínimo entre auditorias do MESMO domínio.
 *
 * A §2.2 proíbe repetir tentativa para provocar bloqueio, e a §12 prevê cache
 * de 24h por domínio. Mas nada no motor impedia rodar a mesma loja oito vezes
 * seguidas — e foi exatamente o que aconteceu na Insider Store, até ela começar
 * a servir desafio da Cloudflare.
 *
 * Regra que não depende de alguém lembrar dela é regra que funciona. O registro
 * fica em disco na Fase 1; na Fase 3 vira o cache do §12, com a mesma semântica.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface LedgerEntry {
  /** Última TENTATIVA, mesmo que tenha morrido cedo. */
  lastAuditedAt: string
  /**
   * Última auditoria que de fato percorreu a jornada. Ausente em registro
   * antigo, e nesse caso o intervalo longo não se aplica — o formato anterior
   * não distinguia os dois casos e queimava 24h por uma falha local.
   */
  lastFullAuditAt?: string
  count: number
  forced: number
}

export type Ledger = Record<string, LedgerEntry>

/**
 * Duas janelas, porque o custo para a loja é diferente.
 *
 * Uma auditoria completa faz ~10 requisições e adiciona um item ao carrinho:
 * repetir isso é o que a §2.2 proíbe, daí 24h. Uma tentativa que morreu cedo
 * custa duas requisições, e barrá-la por 24h trava o desenvolvimento sem
 * proteger ninguém — mas ainda precisa de um piso, senão volta a ser martelo.
 */
export const DEFAULT_COOLDOWN_HOURS = Number(process.env['AUDIT_COOLDOWN_HOURS'] ?? 24)
export const ATTEMPT_COOLDOWN_MINUTES = Number(process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] ?? 5)

function ledgerPath(outDir: string): string {
  return path.join(outDir, '.audit-ledger.json')
}

export async function readLedger(outDir: string): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(ledgerPath(outDir), 'utf8')) as Ledger
  } catch {
    return {}
  }
}

export type AuditStage = 'attempt' | 'full'

export async function recordAudit(
  outDir: string,
  domain: string,
  forced: boolean,
  stage: AuditStage,
): Promise<void> {
  const ledger = await readLedger(outDir)
  const previous = ledger[domain]
  const now = new Date().toISOString()

  const entry: LedgerEntry = {
    lastAuditedAt: now,
    count: (previous?.count ?? 0) + (stage === 'attempt' ? 1 : 0),
    forced: (previous?.forced ?? 0) + (forced && stage === 'attempt' ? 1 : 0),
  }
  const lastFull = stage === 'full' ? now : previous?.lastFullAuditAt
  if (lastFull) entry.lastFullAuditAt = lastFull

  ledger[domain] = entry
  await mkdir(outDir, { recursive: true })
  await writeFile(ledgerPath(outDir), JSON.stringify(ledger, null, 2), 'utf8')
}

export interface CooldownVerdict {
  allowed: boolean
  /** Qual janela barrou: a da auditoria completa, ou o piso entre tentativas. */
  blockedBy: 'full-audit' | 'attempt' | null
  lastAuditedAt: string | null
  nextAllowedAt: string | null
  hoursRemaining: number
}

export function checkCooldown(
  ledger: Ledger,
  domain: string,
  cooldownHours = DEFAULT_COOLDOWN_HOURS,
  now = Date.now(),
  attemptMinutes = ATTEMPT_COOLDOWN_MINUTES,
): CooldownVerdict {
  const free: CooldownVerdict = {
    allowed: true,
    blockedBy: null,
    lastAuditedAt: null,
    nextAllowedAt: null,
    hoursRemaining: 0,
  }

  const entry = ledger[domain]
  if (!entry) return free

  const blocked = (until: number, by: 'full-audit' | 'attempt'): CooldownVerdict => ({
    allowed: false,
    blockedBy: by,
    lastAuditedAt: entry.lastAuditedAt,
    nextAllowedAt: new Date(until).toISOString(),
    hoursRemaining: Math.max(0, Math.round(((until - now) / 3600_000) * 10) / 10),
  })

  // Janela longa: só conta auditoria que percorreu a jornada de verdade.
  const lastFull = entry.lastFullAuditAt ? Date.parse(entry.lastFullAuditAt) : NaN
  if (!Number.isNaN(lastFull)) {
    const until = lastFull + cooldownHours * 3600_000
    if (until > now) return blocked(until, 'full-audit')
  }

  // Piso entre tentativas: impede martelar depois de uma falha.
  const lastAttempt = Date.parse(entry.lastAuditedAt)
  if (!Number.isNaN(lastAttempt)) {
    const until = lastAttempt + attemptMinutes * 60_000
    if (until > now) return blocked(until, 'attempt')
  }

  return { ...free, lastAuditedAt: entry.lastAuditedAt }
}
