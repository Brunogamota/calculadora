/**
 * §6.1 "checar blocklist" e §2.6. Na Fase 1 é um arquivo de texto — sem banco.
 * A Fase 4 troca a fonte por Postgres (§11) mantendo esta interface.
 */

import { readFile } from 'node:fs/promises'
import { AuditError } from './errors.ts'

export interface Blocklist {
  entries: Map<string, string>
  check(hostname: string): void
}

export async function loadBlocklist(path = 'blocklist.txt'): Promise<Blocklist> {
  const entries = new Map<string, string>()
  try {
    const text = await readFile(path, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.split('#')[0]?.trim() ?? ''
      if (!line) continue
      const [domain, ...rest] = line.split(/\s+/)
      if (!domain) continue
      entries.set(domain.toLowerCase().replace(/^\./, ''), rest.join(' ') || 'opt-out')
    }
  } catch {
    // Sem arquivo = sem bloqueio. Não é erro.
  }

  return {
    entries,
    check(hostname: string): void {
      const host = hostname.toLowerCase()
      for (const [domain, reason] of entries) {
        if (host === domain || host.endsWith(`.${domain}`)) {
          throw new AuditError('BLOCKLISTED', `${host} está na blocklist (${reason})`, { host, domain, reason })
        }
      }
    },
  }
}
