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

  /**
   * Corta a execução quando o orçamento acaba, e não só quando alguém lembra
   * de perguntar. `assertAlive` só serve nos pontos onde é chamado; uma etapa
   * que trava entre dois checkpoints passa por cima dela para sempre.
   *
   * O trabalho perdedor da corrida continua rodando em background — quem chama
   * é responsável por fechar o browser no `finally`.
   */
  async race<T>(work: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new AuditError('DEADLINE_EXCEEDED', `Orçamento de ${this.budgetMs}ms estourou em: ${label}`, {
            step: label,
            elapsedMs: this.elapsedMs(),
            budgetMs: this.budgetMs,
          }),
        )
      }, this.remainingMs())
      timer.unref?.()
    })

    try {
      return await Promise.race([work, expiry])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
