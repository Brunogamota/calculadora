/**
 * Barramento de eventos da auditoria (§7.4).
 *
 * A §3 e a §7.4 dizem: worker publica no Redis, servidor WebSocket assina,
 * front recebe. Esta interface é exatamente esse contrato — e a implementação
 * em memória permite construir e testar a tela ao vivo inteira sem depender de
 * Docker. Trocar por Redis é escrever outra classe com estes três métodos.
 *
 * O `NullPublisher` é o padrão: o CLI da Fase 1 não transmite nada, e não deve
 * pagar por isso.
 */

import type { AuditEvent, LiveState, StepAchievement, StepId } from '@raio-x/types'
import { STEP_LABELS } from '@raio-x/types'

export interface Publisher {
  publish(auditId: string, event: AuditEvent): void
  subscribe(auditId: string, listener: (event: AuditEvent) => void): () => void
  /** Estado atual dos passos, para quem reconecta (§7.4). */
  stateOf(auditId: string): LiveState | null
}

/**
 * Não transmite nada. Padrão do CLI, e o que mantém a Fase 1 sem custo.
 *
 * Declara os parâmetros mesmo sem usá-los: sem eles, quem tem uma variável
 * tipada como NullPublisher não consegue chamar `publish(id, evento)` — a
 * assinatura da classe venceria a da interface.
 */
export class NullPublisher implements Publisher {
  publish(_auditId: string, _event: AuditEvent): void {}
  subscribe(_auditId: string, _listener: (event: AuditEvent) => void): () => void {
    return () => {}
  }
  stateOf(_auditId: string): null {
    return null
  }
}

type StepStatus = LiveState['steps'][number]['status']

/**
 * Publisher em memória que também MANTÉM o estado dos passos.
 *
 * Manter estado é requisito da §7.4: quem reconecta recebe os passos atuais,
 * mas não o histórico de frames. Por isso frame não entra no estado — só é
 * repassado a quem está ouvindo naquele instante.
 */
export class MemoryPublisher implements Publisher {
  readonly #listeners = new Map<string, Set<(event: AuditEvent) => void>>()
  readonly #states = new Map<string, LiveState>()

  publish(auditId: string, event: AuditEvent): void {
    this.#applyToState(auditId, event)
    for (const listener of this.#listeners.get(auditId) ?? []) {
      // Um ouvinte que explode não pode derrubar a auditoria nem os outros.
      try {
        listener(event)
      } catch {
        /* ignora */
      }
    }
  }

  subscribe(auditId: string, listener: (event: AuditEvent) => void): () => void {
    const set = this.#listeners.get(auditId) ?? new Set()
    set.add(listener)
    this.#listeners.set(auditId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.#listeners.delete(auditId)
    }
  }

  stateOf(auditId: string): LiveState | null {
    return this.#states.get(auditId) ?? null
  }

  #stateFor(auditId: string): LiveState {
    const existing = this.#states.get(auditId)
    if (existing) return existing
    const fresh: LiveState = {
      auditId,
      steps: [],
      findings: [],
      finished: false,
      score: null,
      caveat: null,
    }
    this.#states.set(auditId, fresh)
    return fresh
  }

  #setStep(
    auditId: string,
    id: StepId,
    status: StepStatus,
    detail: string | undefined,
    at: string,
    outcome?: StepAchievement,
  ): void {
    const state = this.#stateFor(auditId)
    const existing = state.steps.find((s) => s.id === id)
    if (existing) {
      existing.status = status
      if (detail !== undefined) existing.detail = detail
      if (outcome !== undefined) existing.outcome = outcome
      if (status !== 'running') existing.finishedAt = at
      return
    }
    const step: LiveState['steps'][number] = { id, label: STEP_LABELS[id], status }
    if (detail !== undefined) step.detail = detail
    if (outcome !== undefined) step.outcome = outcome
    if (status === 'running') step.startedAt = at
    else step.finishedAt = at
    state.steps.push(step)
  }

  #applyToState(auditId: string, event: AuditEvent): void {
    switch (event.type) {
      case 'step:start':
        this.#setStep(auditId, event.id, 'running', undefined, event.at)
        break
      case 'step:done':
        this.#setStep(auditId, event.id, 'done', event.detail, event.at, event.outcome)
        break
      case 'step:fail':
        this.#setStep(auditId, event.id, 'failed', event.reason, event.at)
        break
      case 'step:skip':
        this.#setStep(auditId, event.id, 'skipped', event.reason, event.at)
        break
      case 'finding':
        this.#stateFor(auditId).findings.push({
          code: event.code,
          severity: event.severity,
          title: event.title,
        })
        break
      case 'complete': {
        const state = this.#stateFor(auditId)
        state.finished = true
        state.score = event.score
        state.caveat = event.caveat
        if (event.coverage) state.coverage = event.coverage
        break
      }
      case 'aborted':
        this.#stateFor(auditId).finished = true
        break
      case 'frame':
        // Frame perdido é frame perdido (§7.4): não entra no estado.
        break
    }
  }
}
