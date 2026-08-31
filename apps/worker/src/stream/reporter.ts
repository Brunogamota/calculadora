/**
 * Traduz o andamento da auditoria nos eventos da §7.3.
 *
 * Fica separado do `audit.ts` de propósito: a auditoria não deve saber que
 * existe uma tela do outro lado, e a tela não deve depender da ordem interna
 * das funções do motor. No meio, este tradutor.
 *
 * Os ids dos passos são os da §7.3, que NÃO são os ids internos da trilha —
 * `open-home` vira `identify`, `find-product` vira `open-product`. A tela fala
 * a linguagem do documento; o motor fala a dele.
 */

import type { AuditEvent, Severity, StepId } from '@raio-x/types'
import { STEP_LABELS } from '@raio-x/types'
import type { Publisher } from './publisher.ts'

export class Reporter {
  readonly #publisher: Publisher
  readonly #auditId: string
  readonly #stepDelayMs: number
  /** Achados já anunciados, para não repetir o mesmo na tela. */
  readonly #announced = new Set<string>()

  constructor(publisher: Publisher, auditId: string, stepDelayMs = 0) {
    this.#publisher = publisher
    this.#auditId = auditId
    this.#stepDelayMs = stepDelayMs
  }

  /**
   * §7.5: um leve atraso entre passos. A execução crua é rápida e ilegível —
   * a jornada na loja falsa termina em 6 segundos, com passos piscando.
   *
   * Fica mais lento de propósito, e é isso que a torna assistível. Zero no CLI,
   * onde não há ninguém assistindo.
   */
  async pace(): Promise<void> {
    if (this.#stepDelayMs <= 0) return
    await new Promise((resolve) => setTimeout(resolve, this.#stepDelayMs))
  }

  get auditId(): string {
    return this.#auditId
  }

  #emit(event: AuditEvent): void {
    this.#publisher.publish(this.#auditId, event)
  }

  start(id: StepId): void {
    this.#emit({ type: 'step:start', id, label: STEP_LABELS[id], at: new Date().toISOString() })
  }

  done(id: StepId, detail?: string, screenshot?: string | null): void {
    const event: AuditEvent = { type: 'step:done', id, at: new Date().toISOString() }
    if (detail !== undefined) event.detail = detail
    if (screenshot) event.screenshot = screenshot
    this.#emit(event)
  }

  fail(id: StepId, reason: string): void {
    this.#emit({ type: 'step:fail', id, reason, at: new Date().toISOString() })
  }

  /** Etapa que não rodou e não é falha: robots, fase, plataforma sem jornada. */
  skip(id: StepId, reason: string): void {
    this.#emit({ type: 'step:skip', id, reason, at: new Date().toISOString() })
  }

  /**
   * §7.3: publicar achado DURANTE a execução aumenta muito a retenção — a
   * pessoa vê o problema aparecer, em vez de esperar o relatório.
   */
  finding(code: string, severity: Severity, title: string): void {
    if (this.#announced.has(code)) return
    this.#announced.add(code)
    this.#emit({ type: 'finding', code, severity, title, at: new Date().toISOString() })
  }

  complete(score: number | null, caveat: string | null): void {
    this.#emit({ type: 'complete', auditId: this.#auditId, score, caveat })
  }

  /** Desafio antibot, deadline, intervalo: a tela precisa parar de girar. */
  aborted(code: string, reason: string): void {
    this.#emit({ type: 'aborted', auditId: this.#auditId, code, reason })
  }
}
