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
  lastAuditedAt: string
  count: number
  forced: number
}

export type Ledger = Record<string, LedgerEntry>

export const DEFAULT_COOLDOWN_HOURS = Number(process.env['AUDIT_COOLDOWN_HOURS'] ?? 24)

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

export async function recordAudit(outDir: string, domain: string, forced: boolean): Promise<void> {
  const ledger = await readLedger(outDir)
  const previous = ledger[domain]
  ledger[domain] = {
    lastAuditedAt: new Date().toISOString(),
    count: (previous?.count ?? 0) + 1,
    forced: (previous?.forced ?? 0) + (forced ? 1 : 0),
  }
  await mkdir(outDir, { recursive: true })
  await writeFile(ledgerPath(outDir), JSON.stringify(ledger, null, 2), 'utf8')
}

export interface CooldownVerdict {
  allowed: boolean
  lastAuditedAt: string | null
  nextAllowedAt: string | null
  hoursRemaining: number
}

export function checkCooldown(
  ledger: Ledger,
  domain: string,
  cooldownHours = DEFAULT_COOLDOWN_HOURS,
  now = Date.now(),
): CooldownVerdict {
  const entry = ledger[domain]
  if (!entry) {
    return { allowed: true, lastAuditedAt: null, nextAllowedAt: null, hoursRemaining: 0 }
  }

  const last = Date.parse(entry.lastAuditedAt)
  if (Number.isNaN(last)) {
    return { allowed: true, lastAuditedAt: entry.lastAuditedAt, nextAllowedAt: null, hoursRemaining: 0 }
  }

  const nextAllowed = last + cooldownHours * 3600_000
  const remainingMs = nextAllowed - now
  return {
    allowed: remainingMs <= 0,
    lastAuditedAt: entry.lastAuditedAt,
    nextAllowedAt: new Date(nextAllowed).toISOString(),
    hoursRemaining: Math.max(0, Math.round((remainingMs / 3600_000) * 10) / 10),
  }
}
