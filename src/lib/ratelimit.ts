/**
 * §2.3 — no máximo 1 requisição por segundo por domínio.
 *
 * Serializa por host e garante o intervalo mínimo entre INÍCIOS de requisição.
 * Vale para safeFetch e também para navegação do Playwright: quem for bater no
 * host passa por aqui, senão o limite é decorativo.
 */

export class HostRateLimiter {
  readonly #defaultIntervalMs: number
  readonly #chains = new Map<string, Promise<unknown>>()
  readonly #intervals = new Map<string, number>()
  readonly #lastStart = new Map<string, number>()

  constructor(defaultIntervalMs = 1000) {
    this.#defaultIntervalMs = defaultIntervalMs
  }

  /** robots.txt pode pedir mais folga via Crawl-delay; nunca aceitamos menos que o padrão. */
  setMinInterval(host: string, ms: number): void {
    this.#intervals.set(host, Math.max(this.#defaultIntervalMs, ms))
  }

  getMinInterval(host: string): number {
    return this.#intervals.get(host) ?? this.#defaultIntervalMs
  }

  async schedule<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const key = host.toLowerCase()
    const previous = this.#chains.get(key) ?? Promise.resolve()

    const run = previous.then(async () => {
      const interval = this.getMinInterval(key)
      const last = this.#lastStart.get(key)
      if (last !== undefined) {
        const wait = last + interval - Date.now()
        if (wait > 0) await sleep(wait)
      }
      this.#lastStart.set(key, Date.now())
      return fn()
    })

    // A corrente segue mesmo se esta chamada falhar, senão um erro trava o host.
    this.#chains.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
