/**
 * Bloco 3a: auditoria com jornada até o carrinho.
 *
 * O status é `partial` sempre que alguma etapa não rodou, com o motivo dito por
 * extenso (§14). Etapa barrada pelo robots sai como `not_permitted_by_robots` e
 * NÃO conta como falha da loja — é a decisão de produto registrada no README.
 */

import { prepare, PreflightRejected, type PrepareOptions } from './session.ts'
import { createDeps, type PreflightOk } from './preflight.ts'
import { createRecorder, makeStep } from './lib/recorder.ts'
import { DEFAULT_OUT_DIR, saveHtml, saveJson } from './lib/artifacts.ts'
import { adapterFor } from './platforms/index.ts'
import { describeIdentity, loadDotEnv, loadIdentity, type AuditIdentity } from './lib/identity.ts'
import { checkCooldown, readLedger, recordAudit, cooldownHours } from './lib/cooldown.ts'
import { runChecks, type ChecksReport } from './checks/index.ts'
import type { Coverage } from '@raio-x/types'
import { observacaoDoCheckout } from './checks/types.ts'
import { NullPublisher, type Publisher } from './stream/publisher.ts'
import { Reporter } from './stream/reporter.ts'
import { startScreencast, type Screencast } from './stream/screencast.ts'
import { normalizeUrl } from './lib/guards.ts'
import { vantageContradiction } from './lib/environment.ts'
import { AuditError, toAuditError, type AuditErrorCode } from './lib/errors.ts'
import type {
  Aceite,
  AddToCartResult,
  CheckoutContext,
  JourneyContext,
  JourneyStep,
  ModoAuditoria,
  NavigationResult,
  PageObservation,
  PaymentSnapshot,
  ProductRef,
  RobotsGate,
} from './types.ts'
import type { BrowserSession } from './lib/browser.ts'
import { idleCursor } from './journey/cursor.ts'

export interface AuditOptions extends PrepareOptions {
  /**
   * OBRIGATÓRIO. Sem modo declarado a auditoria não roda.
   *
   * Não tem padrão de propósito. Um padrão aqui seria decidir por omissão a
   * pergunta mais importante que este motor faz — se alguém autorizou ou não —
   * e quem esquecesse de passar ficaria com a resposta mais permissiva sem
   * nunca ter escolhido.
   */
  modo: ModoAuditoria
  /**
   * O aceite do responsável, registrado ANTES da execução. Exigido no modo
   * consentido; recusado no modo leitura, onde ninguém autorizou nada.
   */
  aceite?: Aceite
  outDir?: string
  /**
   * Preencher contato e entrega para alcançar a tela de meios de pagamento.
   * Exige identidade no .env. Sem isto, a jornada para na primeira tela do
   * checkout e a §6.6 sai quase toda como não aplicável.
   */
  fillCheckout?: boolean
  /** Para onde transmitir o andamento. Padrão: não transmite (CLI da Fase 1). */
  publisher?: Publisher
  /** Sala da transmissão (§7.4). Gerado quando não informado. */
  auditId?: string
  /** Transmitir frames (§7.1). Padrão: só quando há publisher. */
  screencast?: boolean
  /** §7.5: atraso entre passos, para a execução ficar assistível. */
  stepDelayMs?: number
  /**
   * Ignora o intervalo mínimo entre auditorias do mesmo domínio. Use apenas em
   * loja própria: em loja de terceiro, repetir é o que a §2.2 proíbe.
   */
  force?: boolean
  /**
   * Declare true quando a auditoria sai de um IP brasileiro. Muda a leitura de
   * modal de redirecionamento geográfico e a confiança nos tempos medidos.
   */
  fromBrazil?: boolean
}

export interface AuditResult {
  ok: boolean
  /** done só quando a jornada inteira rodou. No bloco 3a nunca é `done`. */
  status: 'done' | 'partial' | 'failed'
  url: string
  finalDomain: string
  platform: string | null
  platformConfidence: string | null
  storefrontNotes: string[]
  product: ProductRef | null
  cart: AddToCartResult | null
  checkout: CheckoutContext | null
  payment: PaymentSnapshot | null
  /** Identidade usada, sempre mascarada. O CPF inteiro nunca sai daqui. */
  identity: Record<string, unknown> | null
  /** §8 — checagens, achados e nota. null quando a auditoria nem começou. */
  checks: ChecksReport | null
  /** Páginas observadas (§6.6 vista de produto, carrinho e checkout). */
  observations: PageObservation[]
  steps: JourneyStep[]
  screenshotsDir: string | null
  robots: {
    ownerVerified: boolean
    blockedPaths: string[]
    overridesUsed: Array<{ path: string; at: string }>
  }
  /** Por que não foi `done`. Lista, porque pode haver mais de um motivo. */
  incompleteBecause: string[]
  /** De onde a auditoria foi feita. Muda o que os números significam. */
  vantage: {
    auditedFromBrazil: boolean | null
    locale: string
    timezone: string
    note: string | null
  }
  /** Sob que autorização esta auditoria rodou. Vai no relatório e no log. */
  modo: ModoAuditoria
  /** O aceite que autorizou, quando houve. Null no modo leitura. */
  aceite: Aceite | null
  errorCode: AuditErrorCode | null
  errorReason: string | null
  /** Contexto da falha: URL no momento, HTML salvo, seletores tentados. */
  errorDetail: Record<string, unknown> | null
  timings: { totalMs: number; homeLoadMs: number | null }
}

const JOURNEY_PATHS = ['/products.json', '/cart', '/cart.js', '/checkout'] as const

/**
 * O aceite precisa existir, ser do endereço auditado, e ter texto.
 *
 * Devolve o motivo da recusa, ou null quando está de pé. Um aceite genérico —
 * sem URL, ou com a URL de outra loja — não é aceite: é um clique reaproveitado.
 */
function aceiteInvalido(aceite: Aceite | undefined, alvo: string): string | null {
  if (!aceite) {
    return 'modo consentido exige o aceite do responsável registrado antes da execução'
  }
  if (!aceite.texto || aceite.texto.trim().length === 0) {
    return 'o aceite precisa trazer o texto exato que o responsável leu'
  }
  if (!Date.parse(aceite.em)) return 'o aceite precisa trazer quando foi dado, em ISO 8601'
  try {
    if (normalizeUrl(aceite.url).hostname !== normalizeUrl(alvo).hostname) {
      return `o aceite é para ${normalizeUrl(aceite.url).hostname}, e a auditoria é de ${normalizeUrl(alvo).hostname}`
    }
  } catch {
    return 'o endereço do aceite não é uma URL utilizável'
  }
  return null
}

export async function audit(input: string, options: AuditOptions): Promise<AuditResult> {
  const startedAt = Date.now()
  const deps = createDeps()
  const outDir = options.outDir ?? DEFAULT_OUT_DIR
  /* `evidencia` mora no slot, e não numa variável local do `runAudit`, porque
     o `finally` que a grava vive AQUI. Uma auditoria que estoura o prazo ou
     lança no meio da jornada é justamente a que mais precisa deixar rastro. */
  const slot: {
    browser: BrowserSession | null
    cast: Screencast | null
    evidencia: Record<string, unknown> | null
    hostname: string | null
  } = { browser: null, cast: null, evidencia: null, hostname: null }
  const reporter = new Reporter(
    options.publisher ?? new NullPublisher(),
    options.auditId ?? `audit_${Math.random().toString(36).slice(2, 10)}`,
    options.stepDelayMs ?? 0,
  )

  const base: AuditResult = {
    ok: false,
    status: 'failed',
    url: input,
    finalDomain: '',
    platform: null,
    platformConfidence: null,
    storefrontNotes: [],
    product: null,
    cart: null,
    checkout: null,
    payment: null,
    identity: null,
    checks: null,
    observations: [],
    steps: [],
    screenshotsDir: null,
    /* Quem manda no portão é o MODO, não uma flag à parte. `consentido`
       significa que o responsável autorizou, e é essa autorização — mais
       específica e mais recente que o robots.txt — que libera o caminho.
       `leitura` nunca libera: ninguém autorizou nada ali. */
    robots: { ownerVerified: options.modo === 'consentido', blockedPaths: [], overridesUsed: [] },
    incompleteBecause: [],
    vantage: {
      auditedFromBrazil: options.fromBrazil ?? null,
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      note:
        options.fromBrazil === true
          ? vantageContradiction(options.fromBrazil)
          : 'ponto de observação não declarado como Brasil: tempos de carregamento e ' +
            'meios de pagamento visíveis podem não ser os que um comprador brasileiro vê ' +
            '(use --from-br quando a auditoria sair de IP brasileiro)',
    },
    modo: options.modo,
    aceite: options.aceite ?? null,
    errorCode: null,
    errorReason: null,
    errorDetail: null,
    timings: { totalMs: 0, homeLoadMs: null },
  }

  try {
    /* O modo é a primeira coisa verificada, antes de qualquer requisição — e
       antes até do intervalo entre auditorias. Ele decide se esta execução tem
       permissão para existir; tudo o mais vem depois disso. */
    if (options.modo !== 'consentido' && options.modo !== 'leitura') {
      return {
        ...base,
        errorCode: 'MODE_MISSING',
        errorReason:
          'a auditoria precisa declarar o modo: "consentido" (o responsável pela loja ' +
          'autorizou) ou "leitura" (loja de terceiro, sem tocar carrinho nem checkout). ' +
          'Não existe padrão: decidir isso por omissão seria responder por engano a ' +
          'pergunta mais importante deste motor.',
        errorDetail: { recebido: String(options.modo) },
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }

    if (options.modo === 'consentido') {
      const recusa = aceiteInvalido(options.aceite, input)
      if (recusa !== null) {
        return {
          ...base,
          errorCode: 'CONSENT_MISSING',
          errorReason: recusa,
          errorDetail: { modo: options.modo },
          timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
        }
      }
    } else if (options.aceite) {
      /* Aceite em modo leitura é contradição: ou alguém autorizou, e então o
         modo é consentido, ou não autorizou, e o aceite não existe. Aceitar os
         dois deixaria passar um consentido disfarçado de leitura. */
      return {
        ...base,
        errorCode: 'CONSENT_MISSING',
        errorReason:
          'modo leitura não aceita registro de aceite: se o responsável autorizou, ' +
          'o modo é consentido.',
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }

    // §2.2 / §12: intervalo mínimo entre auditorias do mesmo domínio, checado
    // ANTES de qualquer requisição sair. A regra que depende de alguém lembrar
    // dela não é regra: foi assim que a Insider Store levou oito rodadas
    // seguidas até começar a desafiar.
    const domain = normalizeUrl(input).hostname
    slot.hostname = domain
    /* Já nasce preenchida. Cada etapa que avança sobrescreve; o que sobrar diz
       até onde a auditoria chegou. Assim o arquivo existe também quando a
       jornada morre antes do carrinho — antibot na home, prazo estourado,
       navegador que não subiu — e "não tem arquivo" volta a significar só uma
       coisa: a auditoria nem começou. */
    slot.evidencia = { desfecho: 'a auditoria não chegou na etapa do carrinho' }

    // --force existe para loja PRÓPRIA. Sozinho ele vira atalho de conveniência,
    // e foi assim que uma segunda rodada minutos depois da primeira provocou
    // desafio antibot numa loja de terceiro -- exatamente o que a §2.2 proíbe.
    // Exigir a declaração de titularidade junto torna a intenção explícita.
    if (options.force === true && options.modo !== 'consentido') {
      reporter.aborted('FORCE_WITHOUT_OWNERSHIP', '--force exige --owner-verified')
      return {
        ...base,
        finalDomain: domain,
        errorCode: 'FORCE_WITHOUT_OWNERSHIP',
        errorReason:
          '--force ignora o intervalo entre auditorias e só faz sentido em loja própria. ' +
          'Use junto com --owner-verified para declarar que a loja é sua. Em loja de terceiro, ' +
          'repetir é o que a §2.2 proíbe — e provoca bloqueio.',
        errorDetail: { domain, flags: ['--force'] },
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }

    const verdict = checkCooldown(await readLedger(outDir), domain)
    if (!verdict.allowed && options.force !== true) {
      reporter.aborted('COOLDOWN_ACTIVE', `${domain} auditado recentemente`)
      return {
        ...base,
        finalDomain: domain,
        errorCode: 'COOLDOWN_ACTIVE',
        errorReason:
          verdict.blockedBy === 'full-audit'
            ? `${domain} foi auditado por completo há pouco (${verdict.lastAuditedAt}). ` +
              `Faltam ${verdict.hoursRemaining}h. Repetir contra loja de terceiro é o que ` +
              'a §2.2 proíbe; em loja própria, use --force.'
            : `tentativa recente em ${domain} (${verdict.lastAuditedAt}). ` +
              `Aguarde até ${verdict.nextAllowedAt} ou use --force. ` +
              'Este é o piso entre tentativas, não o intervalo de 24h.',
        errorDetail: { ...verdict, cooldownHours: cooldownHours() },
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }
    // Registra a TENTATIVA aqui; a auditoria completa só é registrada quando a
    // jornada de fato roda. Antes eu registrava tudo antes de começar, e uma
    // falha local (sem DISPLAY, por exemplo) queimava 24h sem ter auditado nada.
    await recordAudit(outDir, domain, options.force === true, 'attempt')

    const result = await deps.deadline.race(
      runAudit(input, options, deps, slot, outDir, startedAt, base, reporter),
      'auditoria',
    )

    if (result.cart !== null || result.checkout !== null) {
      await recordAudit(outDir, domain, options.force === true, 'full')
    }
    return result
  } catch (e) {
    if (e instanceof PreflightRejected) {
      reporter.aborted(e.failure.errorCode, e.failure.errorReason)
      return {
        ...base,
        errorCode: e.failure.errorCode,
        errorReason: e.failure.errorReason,
        errorDetail: Object.keys(e.failure.detail).length > 0 ? e.failure.detail : null,
        timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
      }
    }
    const err = toAuditError(e)
    reporter.aborted(err.code, err.message)
    return {
      ...base,
      errorCode: err.code,
      errorReason: err.message,
      errorDetail: Object.keys(err.detail).length > 0 ? err.detail : null,
      timings: { totalMs: Date.now() - startedAt, homeLoadMs: null },
    }
  } finally {
    /* O screencast para ANTES do browser fechar: parar depois lança contra uma
       sessão CDP já morta, e o erro esconderia o resultado da auditoria.
       
       E as estatísticas da captura SAEM no log. Elas já eram calculadas e eram
       descartadas aqui — então, quando a tela ao vivo ficava congelada, não
       existia registro nenhum de quantos frames o Chrome ofereceu, quantos
       foram publicados, quantos o teto de fps comeu, e se algum ack falhou.
       Sem isso, "a tela não funciona" não tinha como virar diagnóstico. */
    const capturaStats = await slot.cast?.stop().catch(() => undefined)
    if (capturaStats) {
      const s = capturaStats
      console.error(
        `[raio-x] captura: ${s.framesPublished} publicados de ${s.framesReceived} recebidos ` +
          `em ${(s.durationMs / 1000).toFixed(1)}s (${s.fps} fps) · ` +
          `${s.framesThrottled} cortados pelo teto de fps · ${s.framesDropped} tardios · ` +
          `${s.ackFailures} falhas de ack · ${Math.round(s.bytesTotal / 1024)} KB`,
      )
    }
    await slot.browser?.close()

    /* A evidência da compra vai para o disco AQUI, e não lá dentro: este
       `finally` roda em todo desfecho — jornada concluída, etapa pulada pela
       loja, API recusando, exceção, prazo estourado.
       
       E sem `.catch(() => undefined)`: a versão anterior engolia o erro de
       escrita em silêncio, então "o arquivo não existe" e "não consegui
       escrever o arquivo" eram indistinguíveis. Falha de escrita não pode
       derrubar a auditoria, mas tem que aparecer. */
    if (slot.evidencia && slot.hostname) {
      try {
        await saveJson(outDir, slot.hostname, 'carrinho', {
          quando: new Date().toISOString(),
          url: input,
          ...slot.evidencia,
        })
      } catch (erro) {
        console.error(
          `[raio-x] não consegui gravar a evidência do carrinho em ${outDir}: ` +
            `${erro instanceof Error ? erro.message : String(erro)}`,
        )
      }
    }
    // Nenhuma auditoria acaba em silêncio. Cada caminho de saída já diz o seu
    // motivo; isto pega o caminho que alguém esquecer de cobrir amanhã, porque
    // o custo do esquecimento é uma tela girando para sempre.
    reporter.garantirFim(null, null)
  }
}

async function runAudit(
  input: string,
  options: AuditOptions,
  deps: ReturnType<typeof createDeps>,
  slot: {
    browser: BrowserSession | null
    cast: Screencast | null
    evidencia: Record<string, unknown> | null
    hostname: string | null
  },
  outDir: string,
  startedAt: number,
  base: AuditResult,
  reporter: Reporter,
): Promise<AuditResult> {
  reporter.start('identify')
  /* O `ownerVerified` que chega no portão sai do MODO, e não de uma opção
     separada que alguém pudesse passar sozinha. Duas fontes para a mesma
     decisão é como se abre a porta sem querer. */
  const prepared = await prepare(
    input,
    { ...options, ownerVerified: options.modo === 'consentido' },
    deps,
    (b) => {
      slot.browser = b
    },
  )

  // §7.1: a transmissão começa assim que há página, para o espectador ver a
  // loja abrindo — e não uma tela preta até o primeiro passo terminar.
  const querTransmitir = options.screencast ?? options.publisher !== undefined
  if (querTransmitir && options.publisher) {
    slot.cast = await startScreencast(prepared.browser.page, options.publisher, reporter.auditId).catch(
      () => null,
    )
  }

  const pre: PreflightOk = prepared.preflight
  const hostname = new URL(prepared.probe.baseUrl).hostname
  const recorder = createRecorder({ outDir, hostname })
  const incompleteBecause: string[] = []

  /* O que o robots proíbe, nos DOIS modos. Em consentido a auditoria passa
     assim mesmo, mas o relatório continua dizendo o que o arquivo pedia — e o
     que passou por cima aparece em `overridesUsed`, com horário. Perguntar
     aqui não consome a exceção: por isso `wouldBlock` e não `check`. */
  const blockedPaths = JOURNEY_PATHS.map((p) =>
    prepared.gate.wouldBlock(new URL(p, prepared.probe.baseUrl).href),
  ).filter((p): p is string => p !== null)

  const result: AuditResult = {
    ...base,
    url: pre.finalUrl,
    finalDomain: hostname,
    platform: prepared.decision.evidence.platform,
    platformConfidence: prepared.decision.evidence.confidence,
    storefrontNotes: prepared.decision.evidence.notes ?? [],
    screenshotsDir: recorder.dir,
    robots: {
      ownerVerified: prepared.gate.ownerVerified,
      blockedPaths: [...blockedPaths],
      overridesUsed: [...prepared.gate.overrides],
    },
    timings: { totalMs: 0, homeLoadMs: prepared.opened.loadMs },
  }

  reporter.done(
    'identify',
    `${prepared.decision.evidence.platform} (${prepared.decision.evidence.confidence})`,
  )
  await reporter.pace()
  const homeShot = await recorder.capture(prepared.browser.page, 'home')
  recorder.step(
    makeStep({
      id: 'open-home',
      label: 'identificando a loja',
      url: pre.finalUrl,
      startedAt,
      screenshot: homeShot,
      outcome: { status: 'done' },
    }),
  )

  const adapter = adapterFor(prepared.decision.evidence.platform)
  const journey = adapter?.journey

  if (!journey) {
    // Plataforma identificada mas sem jornada nesta fase (§17). Não é falha.
    incompleteBecause.push(
      `jornada não implementada para ${prepared.decision.evidence.platform} nesta fase`,
    )
    for (const id of ['open-product', 'add-to-cart', 'reach-checkout', 'read-payment', 'mobile'] as const) {
      reporter.skip(id, `jornada de ${prepared.decision.evidence.platform} é de outra fase`)
    }
    // Sem jornada para esta plataforma: o HTML fica salvo para quem for
    // implementar o adapter depois.
    await saveHtml(outDir, hostname, 'home', prepared.opened.html)

    reporter.start('report')
    const semJornada = finish(result, recorder.steps, incompleteBecause, startedAt, {
      productText: null,
      blockedBySite: false,
      observations: [],
      gate: prepared.gate,
    })
    for (const achado of semJornada.checks?.findings ?? []) {
      reporter.finding(achado.id, achado.severity, achado.title)
      await reporter.pace()
    }
    reporter.done('report', `${semJornada.checks?.findings.length ?? 0} achado(s)`)
    /* ESTE `complete` faltava, e o buraco aparecia na tela do jeito mais
       confuso possível: a auditoria voltava sem dizer nada, a rede de
       segurança do `finally` disparava AUDIT_ENDED_SILENTLY, e o lojista lia
       "a auditoria terminou sem dizer por quê" — culpa nossa, dizia a tela,
       com razão. Encontrado numa loja VTEX real.
       
       E é `complete`, não `aborted`: a loja não falhou em nada. Quem não
       cobre a plataforma dela ainda somos nós, e isso é relatório parcial com
       motivo, não erro. */
    reporter.complete(
      semJornada.checks?.score ?? null,
      semJornada.checks?.scoreCaveat ?? null,
      paraCobertura(semJornada.checks),
    )
    return semJornada
  }

  let identity: AuditIdentity | null = null
  if (options.fillCheckout === true) {
    loadDotEnv()
    try {
      identity = loadIdentity()
      result.identity = describeIdentity(identity)
    } catch (e) {
      // Sem identidade não se preenche nada — e não se inventa nome nem CPF.
      incompleteBecause.push(
        `preenchimento do checkout desligado: ${e instanceof Error ? e.message : 'identidade ausente'}`,
      )
    }
  }

  const ctx = makeJourneyContext(prepared, recorder, deps, identity, outDir, options.fromBrazil ?? null)

  // 1. encontrar produto
  let product: ProductRef
  const findStartedAt = Date.now()
  reporter.start('open-product')
  try {
    product = await journey.findProduct(ctx)
    result.product = product
    reporter.done('open-product', product.title)
    await reporter.pace()
  } catch (e) {
    const shot = await recorder.capture(prepared.browser.page, 'falha-find-product')
    const err = toAuditError(e)
    reporter.fail('open-product', err.message)
    reporter.aborted(err.code, err.message)
    return failStep(ctx, result, recorder.steps, e, 'find-product', 'encontrando um produto', startedAt, shot, findStartedAt)
  }

  /* MODO LEITURA: para aqui, e para por desenho.
     
     Abre a página do produto, observa o que ela mostra, e encerra. Nunca toca
     carrinho nem checkout, porque ninguém autorizou. O relatório sai parcial —
     e parcial aqui não é falha, é o formato correto para uma loja de terceiro.
     
     Repare que o código do carrinho não é PULADO com um `if` no meio: ele nem
     é alcançado. `observeProduct` existe separado justamente para isto — para
     que o caminho de leitura não passe por dentro do código que compra. */
  if (options.modo === 'leitura') {
    const produtoStartedAt = Date.now()
    try {
      const { screenshot } = await journey.observeProduct(ctx, product)
      recorder.step(
        makeStep({
          id: 'observe-product',
          label: 'lendo a página do produto',
          url: product.url,
          startedAt: produtoStartedAt,
          screenshot,
          outcome: { status: 'done' },
        }),
      )
    } catch (e) {
      const shot = await recorder.capture(prepared.browser.page, 'falha-observe-product')
      const err = toAuditError(e)
      reporter.fail('open-product', err.message)
      reporter.aborted(err.code, err.message)
      return failStep(ctx, result, recorder.steps, e, 'observe-product', 'lendo a página do produto', startedAt, shot, produtoStartedAt)
    }

    for (const passo of ['add-to-cart', 'reach-checkout', 'read-payment', 'mobile'] as const) {
      reporter.skip(passo, 'modo leitura: a auditoria não toca carrinho nem checkout')
    }
    reporter.start('report')

    /* Parcial POR DESENHO, e o relatório precisa dizer isso.
       
       Sem esta linha a leitura saía `done`: uma auditoria que não abriu
       carrinho nem checkout se anunciava completa. O modo é uma escolha
       legítima, mas o que ele deixa de ver não pode virar silêncio. */
    incompleteBecause.push(
      'modo leitura: a auditoria leu a página do produto e não abriu carrinho nem checkout, ' +
        'porque ninguém pela loja autorizou. Para a jornada completa, o responsável precisa aceitar.',
    )

    const finalLeitura = finish(result, recorder.steps, incompleteBecause, startedAt, {
      productText: (ctx.scratch.get('productText') as string | null) ?? null,
      blockedBySite: false,
      observations: colherObservacoes(ctx, result),
      gate: prepared.gate,
    })
    for (const achado of finalLeitura.checks?.findings ?? []) {
      reporter.finding(achado.id, achado.severity, achado.title)
      await reporter.pace()
    }
    reporter.done('report', `${finalLeitura.checks?.findings.length ?? 0} achado(s)`)
    reporter.complete(
      finalLeitura.checks?.score ?? null,
      finalLeitura.checks?.scoreCaveat ?? null,
      paraCobertura(finalLeitura.checks),
    )
    return finalLeitura
  }

  // 2. adicionar ao carrinho
  let cart: AddToCartResult
  const cartStartedAt = Date.now()
  reporter.start('add-to-cart')
  try {
    cart = await journey.addToCart(ctx, product)
    result.cart = cart
    reporter.done(
      'add-to-cart',
      cart.itemCount === null ? 'clique feito, confirmação indisponível' : `${cart.itemCount} item no carrinho`,
      cart.overlay.present ? null : null,
    )
    // §7.3: achado durante a execução, não só no fim.
    if (cart.overlay.present && !cart.overlay.dismissed && !cart.overlay.likelyAuditArtifact) {
      reporter.finding('BUY_BUTTON_OBSCURED', 'alta', 'Botão de comprar coberto por sobreposição')
    }
    await reporter.pace()
    /* Só ANOTA. Quem grava é o `finally` lá em cima, porque esta linha estava
       dentro do `try` do addToCart: quando a jornada lançava — que é o caso
       que mais precisa de evidência — ela nunca chegava a rodar, e o
       carrinho.json não existia justamente na auditoria que falhou. */
    slot.evidencia = {
      desfecho: 'jornada concluiu a etapa do carrinho',
      via: cart.via,
      viaDetalhe: cart.viaDetalhe,
      viasTentadas: cart.viasTentadas,
      ondeEntrou: cart.ondeEntrou,
      provaDeEntrada: cart.provaDeEntrada,
      lojaSemCarrinho: cart.lojaSemCarrinho,
      itemCount: cart.itemCount,
      cartReadNote: cart.cartReadNote,
      cartUrl: cart.cartUrl,
      uiPattern: cart.uiPattern,
      cliques: cart.clicks,
      overlay: cart.overlay,
    }

    if (cart.lojaSemCarrinho) {
      /* Fato sobre a LOJA, não limitação nossa — por isso vai em observações e
         não em `incompleteBecause`. Jornada sem etapa de carrinho é um toque a
         menos até pagar, e o lojista precisa saber que a dele é assim. */
      result.storefrontNotes.push(
        `esta loja não tem etapa de carrinho: o item foi direto para ` +
          `${cart.ondeEntrou === 'checkout' ? 'a tela de checkout' : 'o resumo do pedido'}. ` +
          `Jornada mais curta, um toque a menos até pagar. Prova: ${cart.provaDeEntrada}`,
      )
    } else if (cart.ok === null) {
      incompleteBecause.push(
        `carrinho não pôde ser confirmado${cart.cartReadNote ? ` — ${cart.cartReadNote}` : ''}`,
      )
    } else if (cart.ok === false) {
      incompleteBecause.push(
        'o item não apareceu no carrinho, nem na tela de checkout, nem em resumo de pedido',
      )
    }
    if (cart.overlay.likelyAuditArtifact) {
      incompleteBecause.push(
        `overlay "${cart.overlay.kind}" atrapalhou a jornada, mas provavelmente só apareceu ` +
          'porque a auditoria não saiu de IP brasileiro. NÃO deve virar achado contra a loja.',
      )
    }
  } catch (e) {
    const shot = await recorder.capture(prepared.browser.page, 'falha-add-to-cart')
    const err = toAuditError(e)
    /* A jornada não conseguiu comprar, e é ESTA a auditoria cuja evidência mais
       importa. O que o erro carrega — os quatro caminhos tentados, com o que
       cada um respondeu — é o diagnóstico inteiro. */
    slot.evidencia = {
      desfecho: 'a jornada não conseguiu colocar o item na compra',
      erro: err.code,
      motivo: err.message,
      viasTentadas: (err.detail['tentativas'] as string[] | undefined) ?? [],
      // `tentativas` sai do espalhamento: já foi lido acima com o nome que o
      // resto do arquivo usa, e repetir a mesma lista duas vezes no JSON só
      // faz quem lê procurar a diferença entre elas.
      ...Object.fromEntries(Object.entries(err.detail).filter(([k]) => k !== 'tentativas')),
    }
    reporter.fail('add-to-cart', err.message)
    reporter.aborted(err.code, err.message)
    return failStep(ctx, result, recorder.steps, e, 'add-to-cart', 'adicionando ao carrinho', startedAt, shot, cartStartedAt)
  }

  // 3. checkout (§6.5) e coleta na tela de pagamento (§6.6)
  const checkoutUrl = new URL('/checkout', prepared.probe.baseUrl).href
  const checkoutPermission = prepared.gate.check(checkoutUrl)

  if (!checkoutPermission.allowed) {
    recorder.step(
      makeStep({
        id: 'reach-checkout',
        label: 'indo para o checkout',
        url: checkoutUrl,
        startedAt: Date.now(),
        screenshot: null,
        outcome: { status: 'not_permitted_by_robots', path: checkoutPermission.path },
      }),
    )
    incompleteBecause.push(
      'checkout não auditado: robots.txt proíbe /checkout e não houve titularidade confirmada',
    )
    reporter.skip('reach-checkout', 'robots.txt proíbe /checkout')
    reporter.skip('read-payment', 'a tela de pagamento não foi alcançada')
  } else if (!journey.reachCheckout) {
    incompleteBecause.push('checkout não auditado: jornada sem etapa de checkout')
    reporter.skip('reach-checkout', 'jornada sem etapa de checkout')
    reporter.skip('read-payment', 'a tela de pagamento não foi alcançada')
  } else {
    const checkoutStartedAt = Date.now()
    reporter.start('reach-checkout')
    try {
      const checkout = await journey.reachCheckout(ctx, cart)
      result.checkout = checkout
      reporter.done('reach-checkout', `${checkout.stepsFromProduct} passo(s) do produto`)
      await reporter.pace()

      if (!checkout.reachedPaymentScreen) {
        incompleteBecause.push(
          identity
            ? 'não chegou à tela de meios de pagamento; HTML do checkout salvo para análise'
            : 'parou na primeira tela do checkout: preenchimento não autorizado (use --fill-checkout)',
        )
      }
      if (checkout.forcedLogin === true) {
        incompleteBecause.push('a loja exige login antes do checkout')
      }

      if (journey.collectPayment && checkout.reachedPaymentScreen) {
        reporter.start('read-payment')
        result.payment = await journey.collectPayment(ctx, checkout)
        reporter.done('read-payment', `${result.payment.methods.length} meio(s) visíveis`)
        await reporter.pace()
      } else if (!checkout.reachedPaymentScreen) {
        reporter.skip('read-payment', 'a tela de meios de pagamento não foi alcançada')
        // Não chegamos na tela: a §6.6 inteira fica não aplicável, e é assim
        // que ela tem que sair — nunca preenchida por dedução.
        incompleteBecause.push('dados da tela de pagamento (§6.6) não aplicáveis: tela não alcançada')
      }
    } catch (e) {
      const shot = await recorder.capture(prepared.browser.page, 'falha-checkout')
      const err = toAuditError(e)
      reporter.fail('reach-checkout', err.message)
      reporter.aborted(err.code, err.message)
      return failStep(ctx, result, recorder.steps, e, 'reach-checkout', 'indo para o checkout', startedAt, shot, checkoutStartedAt)
    }
  }

  reporter.skip('mobile', 'a jornada em mobile (§6.7) não roda nesta fase')
  await reporter.pace()
  reporter.start('report')

  const final = finish(result, recorder.steps, incompleteBecause, startedAt, {
    productText: (ctx.scratch.get('productText') as string | null) ?? null,
    blockedBySite: false,
    observations: colherObservacoes(ctx, result),
    gate: prepared.gate,
  })

  // Achados que só existem depois das checagens (§7.3: durante, não só no fim).
  for (const achado of final.checks?.findings ?? []) {
    reporter.finding(achado.id, achado.severity, achado.title)
    await reporter.pace()
  }
  reporter.done('report', `${final.checks?.findings.length ?? 0} achado(s)`)
  reporter.complete(
    final.checks?.score ?? null,
    final.checks?.scoreCaveat ?? null,
    paraCobertura(final.checks),
  )
  return final
}

function makeJourneyContext(
  prepared: Awaited<ReturnType<typeof prepare>>,
  recorder: ReturnType<typeof createRecorder>,
  deps: ReturnType<typeof createDeps>,
  identity: AuditIdentity | null,
  outDir: string,
  auditedFromBrazil: boolean | null,
): JourneyContext {
  return {
    page: prepared.browser.page,
    baseUrl: prepared.probe.baseUrl,
    fetch: prepared.gatedFetch,
    gate: prepared.gate,
    recorder,
    deadline: deps.deadline,
    identity,
    outDir,
    auditedFromBrazil,
    scratch: new Map<string, unknown>(),

    rateLimited<T>(fn: () => Promise<T>): Promise<T> {
      return deps.limiter.schedule(new URL(prepared.probe.baseUrl).hostname, fn)
    },

    async navigate(url: string, timeoutMs = 30_000): Promise<NavigationResult> {
      const permission = prepared.gate.check(url)
      if (!permission.allowed) {
        throw new AuditError('ROBOTS_DISALLOWED', `robots.txt proíbe ${permission.path}`, {
          path: permission.path,
        })
      }
      // Navegação do browser também respeita 1 req/s por domínio (§2.3).
      return deps.limiter.schedule(new URL(url).hostname, async () => {
        const began = Date.now()
        const response = await prepared.browser.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        })
        /* §7.2: um passeio curto depois de carregar. Sem isto a pagina fica
           parada, o Chrome nao repinta e o screencast emudece — que e por que
           a transmissao aparecia como uma imagem so. O passeio da o que
           mandar, e some assim que a jornada volta a agir.

           Eram 900ms, e como isto roda depois de CADA navegacao (home,
           produto, carrinho, checkout) custava 3,6s de uma auditoria de 15s —
           quase um quarto do tempo, gasto em enfeite. A 400ms o screencast
           continua tendo o que mandar: o trajeto ate cada botao, que e o
           movimento que importa, e feito pelo moveCursorToElement. */
        await idleCursor(prepared.browser.page, 400).catch(() => undefined)
        return {
          url: prepared.browser.page.url(),
          status: response?.status() ?? null,
          loadMs: Date.now() - began,
        }
      })
    },
  }
}

/**
 * O relatório de checagens no formato que a tela fala.
 *
 * Tradução, não decisão: quem decide o que foi medido é o motor, e a tela só
 * mostra. Antes disso a tela decidia sozinha o que dizer — e dizia a manchete
 * do desenho.
 */
function paraCobertura(checks: ChecksReport | null | undefined): Coverage | undefined {
  if (!checks) return undefined
  return {
    checked: checks.applicable,
    unchecked: checks.notApplicable,
    summary: checks.coverageSummary,
    rules: checks.results.map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      reason: r.notApplicableReason,
      evidence: r.evidence,
      recommendation: r.recommendation,
    })),
  }
}

function finish(
  result: AuditResult,
  steps: ReadonlyArray<JourneyStep>,
  incompleteBecause: string[],
  startedAt: number,
  extra: {
    productText: string | null
    blockedBySite: boolean
    observations: PageObservation[]
    /* O portão VIVO, não a cópia do começo.
       
       `robots.overridesUsed` era congelado quando o resultado nascia, antes de
       a jornada rodar — então ele nunca continha um único override de verdade.
       Parecia preenchido só porque a lista de caminhos proibidos era montada
       consultando o portão com `check`, e a consulta registrava override. Ou
       seja: o relatório mostrava as perguntas e escondia as passagens. */
    gate: RobotsGate
  },
): AuditResult {
  const withSteps = {
    ...result,
    steps: [...steps],
    observations: extra.observations,
    robots: { ...result.robots, overridesUsed: [...extra.gate.overrides] },
  }
  return {
    ...withSteps,
    ok: true,
    status: incompleteBecause.length > 0 ? 'partial' : 'done',
    incompleteBecause,
    checks: runChecks({
      product: withSteps.product,
      cart: withSteps.cart,
      checkout: withSteps.checkout,
      payment: withSteps.payment,
      steps: withSteps.steps,
      productText: extra.productText,
      observations: extra.observations,
      homeLoadMs: withSteps.timings.homeLoadMs,
      mobile: null,
      auditedFromBrazil: withSteps.vantage.auditedFromBrazil,
      robotsBlockedPaths: withSteps.robots.blockedPaths,
      blockedBySite: extra.blockedBySite,
      modo: withSteps.modo,
    }),
    timings: { ...withSteps.timings, totalMs: Date.now() - startedAt },
  }
}

/**
 * Desafio antibot não é defeito da loja nem erro do motor: é a loja exercendo o
 * direito de se proteger. §18 pede partial explicado; §2.2 proíbe testar a
 * proteção de terceiros, então não se contorna, se relata.
 */
function isProtectedSite(code: AuditErrorCode): boolean {
  return code === 'BOT_CHALLENGE' || code === 'HOME_NOT_OK'
}

/**
 * A jornada parou antes do fim. O relatório sai mesmo assim, com TUDO que deu
 * tempo de observar até ali.
 *
 * Antes ele saía vazio. As observações ficam em `ctx.scratch` durante a
 * jornada, e só eram recolhidas no caminho de sucesso — as três saídas de
 * falha passavam `result.observations`, que nunca recebe atribuição em lugar
 * nenhum e portanto é sempre `[]`. Medido na loja falsa: carrinho fechando dá
 * 10 de 13 regras com veredito; carrinho falhando dava 1 de 13, com o dado da
 * página de produto coletado e jogado fora no mesmo segundo.
 *
 * Por isso o `ctx` entra aqui: quem falha precisa alcançar o que foi colhido,
 * e o colhedor mora nele.
 */
function failStep(
  ctx: JourneyContext,
  result: AuditResult,
  steps: ReadonlyArray<JourneyStep>,
  error: unknown,
  id: string,
  label: string,
  startedAt: number,
  screenshot: string | null,
  // Quando a etapa começou de verdade. Passar Date.now() aqui zerava a duração
  // de toda etapa que falhava, escondendo se ela demorou 12s ou 0s — e essa
  // diferença é o diagnóstico.
  stepStartedAt: number,
): AuditResult {
  const err = toAuditError(error)
  const trail = [
    ...steps,
    makeStep({
      id,
      label,
      url: result.url,
      startedAt: stepStartedAt,
      screenshot,
      outcome:
        err.code === 'ROBOTS_DISALLOWED'
          ? { status: 'not_permitted_by_robots', path: String(err.detail['path'] ?? '') }
          : { status: 'failed', code: err.code, reason: err.message },
    }),
  ]
  const explanation = isProtectedSite(err.code)
    ? `${err.message}. Isto NÃO é achado contra a loja: proteger a vitrine é decisão ` +
      'legítima do lojista, e o comprador dela passa pelo desafio normalmente. A auditoria ' +
      'não tenta contornar (§2.2).'
    : `${label}: ${err.message}`

  const observacoes = colherObservacoes(ctx, result)

  return {
    ...result,
    ok: true,
    status: 'partial',
    steps: trail,
    observations: observacoes,
    // Mesmo motivo do `finish`: os overrides de verdade só existem no portão.
    robots: { ...result.robots, overridesUsed: [...ctx.gate.overrides] },
    incompleteBecause: [explanation],
    checks: runChecks({
      product: result.product,
      cart: result.cart,
      checkout: result.checkout,
      payment: result.payment,
      steps: trail,
      productText: (ctx.scratch.get('productText') as string | null) ?? null,
      observations: observacoes,
      homeLoadMs: result.timings.homeLoadMs,
      mobile: null,
      auditedFromBrazil: result.vantage.auditedFromBrazil,
      robotsBlockedPaths: result.robots.blockedPaths,
      blockedBySite: isProtectedSite(err.code),
      modo: result.modo,
    }),
    errorCode: err.code,
    errorReason: err.message,
    errorDetail: Object.keys(err.detail).length > 0 ? err.detail : null,
    timings: { ...result.timings, totalMs: Date.now() - startedAt },
  }
}

/**
 * Resumo do que interessa para conferir uma rodada. O JSON completo tem
 * centenas de linhas — colar isso inteiro num chat ou num ticket é ruído.
 */
export function summarize(result: AuditResult): Record<string, unknown> {
  return {
    status: result.status,
    domain: result.finalDomain,
    platform: result.platform,
    confidence: result.platformConfidence,
    product: result.product
      ? {
          title: result.product.title,
          priceCents: result.product.priceCents,
          requiresVariantChoice: result.product.requiresVariantChoice,
        }
      : null,
    cart: result.cart
      ? {
          ok: result.cart.ok,
          itemCount: result.cart.itemCount,
          cartReadNote: result.cart.cartReadNote,
          uiPattern: result.cart.uiPattern,
          clicks: result.cart.clicks,
          ms: result.cart.ms,
          overlay: result.cart.overlay,
        }
      : null,
    checkout: result.checkout
      ? {
          reachedPaymentScreen: result.checkout.reachedPaymentScreen,
          forcedLogin: result.checkout.forcedLogin,
          stepsFromProduct: result.checkout.stepsFromProduct,
        }
      : null,
    payment: result.payment
      ? {
          methods: result.payment.methods.map((m) => m.label),
          pix: result.payment.pix,
          installments: result.payment.installments,
          couponField: result.payment.couponField,
          gateway: result.payment.gateway,
        }
      : null,
    score: result.checks?.score ?? null,
    checks: result.checks
      ? {
          score: result.checks.score,
          ressalva: result.checks.scoreCaveat,
          cobertura: `${Math.round(result.checks.coverage.ratio * 100)}% da §8 em peso`,
          aplicaveis: result.checks.applicable,
          passaram: result.checks.passed,
          falharam: result.checks.failed,
          naoAplicaveis: result.checks.notApplicable,
          achados: result.checks.findings.map((f) => `[${f.severity}] ${f.id}: ${f.evidence[0] ?? ''}`),
          naoAplicavelPorque: result.checks.results
            .filter((r) => r.status === 'not_applicable')
            .map((r) => `${r.id}: ${r.notApplicableReason ?? ''}`),
        }
      : null,
    steps: result.steps.map((s) => ({ id: s.id, ms: s.ms, outcome: s.outcome.status })),
    robots: result.robots,
    vantage: result.vantage,
    incompleteBecause: result.incompleteBecause,
    errorCode: result.errorCode,
    errorReason: result.errorReason,
    errorDetail: result.errorDetail,
    screenshotsDir: result.screenshotsDir,
    timings: result.timings,
  }
}

/**
 * Junta o que a jornada observou. A tela de pagamento entra como observação
 * também, para todas as checagens usarem o mesmo mecanismo de escolha de fonte.
 */
function colherObservacoes(ctx: JourneyContext, result: AuditResult): PageObservation[] {
  const observacoes: PageObservation[] = []

  for (const chave of ['observation:product', 'observation:cart'] as const) {
    const observada = ctx.scratch.get(chave) as PageObservation | undefined
    if (observada) observacoes.push(observada)
  }

  const checkout = observacaoDoCheckout(result.payment, result.checkout)
  if (checkout) observacoes.push(checkout)
  return observacoes
}
