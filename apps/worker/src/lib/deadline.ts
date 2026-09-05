/**
 * §14 — timeout global de 120s. O deadline é criado uma vez por auditoria e
 * consultado por cada etapa, para que uma etapa lenta não coma o orçamento
 * inteiro em silêncio.
 *
 * A TRILHA existe porque a mensagem sozinha mentia por omissão. `detect`
 * envolve a cadeia inteira num `race` com um rótulo só (`detect.ts:97`), então
 * `estourou em: detecção de plataforma` saía igual para preflight lento,
 * cadeia de redirects, robots.txt, subida do Chromium, `page.goto`,
 * `page.content()`, `page.evaluate` e classificação de plataforma — oito
 * etapas, um nome. Medindo três lojas que estouravam os 120s, não deu para
 * distinguir NENHUMA dessas causas pela saída: o rótulo nomeia a corrida, não
 * o que estava rodando.
 *
 * `marcar` registra o instante em que cada etapa COMEÇA. Quando o orçamento
 * estoura, a mensagem passa a nomear a última etapa iniciada e o `detail`
 * carrega a trilha inteira com o tempo de cada uma — que é o dado que decide
 * entre hipóteses em vez de alimentar mais uma.
 */

import { AuditError } from './errors.ts'

export interface Marco {
  readonly etapa: string
  /** Quantos ms do orçamento já tinham corrido quando esta etapa começou. */
  readonly emMs: number
}

export class Deadline {
  readonly startedAt: number
  readonly budgetMs: number
  readonly #marcos: Marco[] = []

  constructor(budgetMs: number) {
    this.budgetMs = budgetMs
    this.startedAt = Date.now()
  }

  /** Registra que uma etapa COMEÇOU agora. Barato de propósito: só um push. */
  marcar(etapa: string): void {
    this.#marcos.push({ etapa, emMs: this.elapsedMs() })
  }

  get marcos(): readonly Marco[] {
    return this.#marcos
  }

  /** A última etapa que começou — a que estava rodando quando o tempo acabou. */
  etapaCorrente(): string | null {
    return this.#marcos.at(-1)?.etapa ?? null
  }

  /**
   * A trilha com o tempo DE CADA etapa, não o instante em que começou: o que
   * responde "onde foram os 120s" é a duração, e obrigar quem lê a subtrair
   * dois números é como o dado se perde na pressa.
   */
  trilha(): string {
    if (this.#marcos.length === 0) return '(sem marcos)'
    const fim = this.elapsedMs()
    return this.#marcos
      .map((m, i) => {
        const ate = this.#marcos[i + 1]?.emMs ?? fim
        return `${m.etapa} ${((ate - m.emMs) / 1000).toFixed(1)}s`
      })
      .join(' → ')
  }

  /** Acrescenta a etapa real ao rótulo da corrida, que nomeia o trecho inteiro. */
  #ondeParou(label: string): string {
    const etapa = this.etapaCorrente()
    return etapa === null || etapa === label ? label : `${label}, parado em: ${etapa}`
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

  /**
   * Marca a etapa como iniciada E confere o orçamento. As duas coisas juntas
   * porque todo `assertAlive` já nomeia a etapa que vem a seguir: separar em
   * duas chamadas só criaria a chance de alguém lembrar de uma e esquecer da
   * outra, que é como a trilha ficaria com buraco justo onde importa.
   */
  assertAlive(step: string): void {
    this.marcar(step)
    if (this.expired()) {
      throw new AuditError('DEADLINE_EXCEEDED', `Orçamento de ${this.budgetMs}ms estourou em: ${step}`, {
        step,
        elapsedMs: this.elapsedMs(),
        trilha: this.trilha(),
        marcos: [...this.#marcos],
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
          new AuditError('DEADLINE_EXCEEDED', `Orçamento de ${this.budgetMs}ms estourou em: ${this.#ondeParou(label)}`, {
            step: label,
            etapa: this.etapaCorrente(),
            elapsedMs: this.elapsedMs(),
            budgetMs: this.budgetMs,
            trilha: this.trilha(),
            marcos: [...this.#marcos],
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
