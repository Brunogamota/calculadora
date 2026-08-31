/**
 * §14 — timeout global de 120s. O deadline é criado uma vez por auditoria e
 * consultado por cada etapa, para que uma etapa lenta não coma o orçamento
 * inteiro em silêncio.
 */

import { AuditError } from './errors.ts'

export class Deadline {
  readonly startedAt: number
  readonly budgetMs: number

  constructor(budgetMs: number) {
    this.budgetMs = budgetMs
    this.startedAt = Date.now()
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt
  }

  remainingMs(): number {
    return Math.max(0, this.budgetMs - this.elapsedMs())
  }

  expired(): boolean {
    return this.remainingMs() === 0
  }

  assertAlive(step: string): void {
    if (this.expired()) {
      throw new AuditError('DEADLINE_EXCEEDED', `Orçamento de ${this.budgetMs}ms estourou em: ${step}`, {
        step,
        elapsedMs: this.elapsedMs(),
      })
    }
  }

  /** Menor entre o que a etapa pediu e o que ainda resta no orçamento global. */
  clamp(requestedMs: number): number {
    return Math.max(1, Math.min(requestedMs, this.remainingMs()))
  }
}
