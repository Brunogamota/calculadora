/**
 * Portão de robots (§2.3) com a exceção de titularidade.
 *
 * Decisão de produto:
 *  - por padrão, robots é respeitado. Etapa proibida NÃO roda.
 *  - etapa proibida sai como `not_permitted_by_robots`, e as checagens que
 *    dependem dela saem como `not_applicable` — nunca como falha da loja.
 *    A auditoria inteira vira `partial` com o motivo explícito.
 *  - a exceção é titularidade confirmada: o dono pediu a auditoria e provou
 *    que é dono. Aí o checkout é auditado mesmo com robots bloqueando.
 *
 * Na Fase 1 a titularidade é só a flag `--owner-verified`, SEM verificação
 * nenhuma. A prova por meta tag ou DNS entra na Fase 3. Todo override usado
 * fica registrado, para o relatório poder mostrar sob qual autorização a
 * etapa rodou.
 */

import type { RobotsGate, StepPermission } from '../types.ts'
import type { RobotsPolicy } from './robots.ts'

export interface RobotsGateOptions {
  /** Fase 1: declarado pela flag, não verificado. Fase 3: meta tag ou DNS. */
  ownerVerified?: boolean
}

export function createRobotsGate(policy: RobotsPolicy, options: RobotsGateOptions = {}): RobotsGate {
  const ownerVerified = options.ownerVerified === true
  const overrides: Array<{ path: string; at: string }> = []

  function caminhoDe(url: string): string {
    try {
      const parsed = new URL(url)
      return parsed.pathname + parsed.search
    } catch {
      return url
    }
  }

  return {
    ownerVerified,
    overrides,
    /* Consulta pura: não registra override. Ver a nota em RobotsGate. */
    wouldBlock(url: string): string | null {
      const path = caminhoDe(url)
      return policy.isAllowed(path) ? null : path
    },
    check(url: string): StepPermission {
      const path = caminhoDe(url)

      if (policy.isAllowed(path)) {
        return { allowed: true, reason: 'robots-allowed' }
      }
      if (ownerVerified) {
        overrides.push({ path, at: new Date().toISOString() })
        return { allowed: true, reason: 'owner-verified-override', path }
      }
      return { allowed: false, reason: 'robots-disallowed', path }
    },
  }
}
