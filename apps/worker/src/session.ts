/**
 * Montagem compartilhada por `detect` e `audit`: preflight, robots, portão,
 * browser e sonda. Ficava dentro do detect e passou a viver aqui quando o
 * `audit` precisou exatamente da mesma sequência.
 *
 * Quem chama é responsável por fechar (`close`).
 */

import { preflight, createDeps, type PreflightFailed, type PreflightOk } from './preflight.ts'
import { launchBrowser, openPage, readPageGlobals, type BrowserSession, type OpenResult } from './lib/browser.ts'
import { createSafeFetch, DEFAULT_USER_AGENT, type SafeFetch } from './lib/http.ts'
import { fetchRobots } from './lib/robots.ts'
import { createRobotsGate } from './lib/gate.ts'
import { detectPlatform, type PlatformDecision } from './platforms/index.ts'
import { AuditError } from './lib/errors.ts'
import type { DetectionProbe, RobotsGate } from './types.ts'

export interface PrepareOptions {
  headed?: boolean
  ownerVerified?: boolean
}

export interface PreparedSession {
  deps: ReturnType<typeof createDeps>
  preflight: PreflightOk
  gate: RobotsGate
  gatedFetch: SafeFetch
  browser: BrowserSession
  opened: OpenResult
  probe: DetectionProbe
  decision: PlatformDecision
}

export class PreflightRejected extends Error {
  readonly failure: PreflightFailed
  constructor(failure: PreflightFailed) {
    super(failure.errorReason)
    this.name = 'PreflightRejected'
    this.failure = failure
  }
}

export async function prepare(
  input: string,
  options: PrepareOptions,
  deps: ReturnType<typeof createDeps> = createDeps(),
  onBrowser?: (session: BrowserSession) => void,
): Promise<PreparedSession> {
  /**
   * O navegador sobe EM PARALELO com o preflight e o robots.
   *
   * Medido: `launchBrowser` leva ~1s e é praticamente constante, e essa espera
   * acontecia depois de toda a rede, em fila. Subindo junto, ela some por
   * baixo do DNS, do TLS e da busca do robots.txt.
   *
   * Subir não é navegar: este navegador não abre endereço nenhum antes de o
   * preflight e o portão liberarem. O que se ganha é só o tempo de ligar o
   * Chromium, que não depende de saber para onde ele vai.
   */
  const subindo = launchBrowser({
    headed: options.headed !== false,
    userAgent: DEFAULT_USER_AGENT,
    timeoutMs: deps.deadline.clamp(30_000),
  })
  /* Marca a promessa como tratada AGORA. Sem isto, um Chromium que falha ao
     subir enquanto o preflight ainda roda vira rejeição não tratada e derruba
     o processo — e o `await` lá embaixo continua lançando normalmente. */
  subindo.catch(() => undefined)

  /* Recusa depois de já ter subido o navegador deixaria um Chromium órfão por
     auditoria recusada. Toda saída daqui até o `await` passa por este fechamento. */
  const descartarNavegador = async (): Promise<void> => {
    await subindo.then((b) => b.close()).catch(() => undefined)
  }

  const pre = await preflight(input, deps).catch(async (e: unknown) => {
    await descartarNavegador()
    throw e
  })
  if (!pre.ok) {
    await descartarNavegador()
    throw new PreflightRejected(pre as PreflightFailed)
  }

  const policy = await fetchRobots(pre.finalUrl, deps.safeFetch).catch(async (e: unknown) => {
    await descartarNavegador()
    throw e
  })
  const gate = createRobotsGate(policy, { ownerVerified: options.ownerVerified === true })

  // Toda rede a partir daqui passa pelo portão: nada escapa por esquecimento.
  const gatedFetch: SafeFetch = async (url, opts) => {
    const permission = gate.check(url)
    if (!permission.allowed) {
      throw new AuditError('ROBOTS_DISALLOWED', `robots.txt proíbe ${permission.path}`, {
        path: permission.path,
      })
    }
    return createSafeFetch(deps.limiter)(url, opts)
  }

  const homePermission = gate.check(pre.finalUrl)
  if (!homePermission.allowed) {
    await descartarNavegador()
    throw new AuditError('ROBOTS_DISALLOWED', `robots.txt proíbe a própria home (${homePermission.path})`, {
      path: homePermission.path,
    })
  }

  const browser = await subindo
  /* Aqui a página EXISTE, e é daqui que a transmissão começa — não do fim
     desta função. Antes o `startScreencast` só rodava depois do `prepare`
     inteiro, então o espectador ficava sem imagem durante a carga da home,
     que é justamente a parte interessante de assistir. */
  onBrowser?.(browser)

  deps.deadline.assertAlive('abertura da home no browser')
  const opened = await openPage(browser.page, pre.finalUrl, deps.deadline.clamp(30_000))
  const globals = await readPageGlobals(browser.page)

  const probe: DetectionProbe = {
    page: browser.page,
    html: opened.html,
    headers: opened.headers,
    baseUrl: new URL(opened.finalUrl).origin,
    globals,
    fetch: gatedFetch,
    gate,
  }

  return { deps, preflight: pre, gate, gatedFetch, browser, opened, probe, decision: await detectPlatform(probe) }
}
