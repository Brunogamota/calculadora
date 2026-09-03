/**
 * §7.1 — captura de frames por CDP.
 *
 * `Page.startScreencast` em vez de screenshot em laço: o Chrome entrega frame
 * só quando a tela muda, e a diferença de custo é enorme numa jornada de 60s.
 *
 * O `screencastFrameAck` é OBRIGATÓRIO, e o documento avisa: sem ele o Chrome
 * para de enviar depois de alguns frames. O sintoma é traiçoeiro — a captura
 * "funciona", entrega 3 ou 4 frames e emudece, e num teste curto isso passa por
 * bom. Por isso o ack acontece SEMPRE, inclusive quando a publicação falha:
 * frame perdido é aceitável (§7.4), captura morta não.
 */

import type { Page } from 'playwright'
import type { Publisher } from './publisher.ts'

export interface ScreencastOptions {
  /** §7.1: alvo de 5 a 10 fps, qualidade 60. Acima disso o ganho é pequeno. */
  quality?: number
  maxWidth?: number
  maxHeight?: number
  everyNthFrame?: number
  /**
   * Teto de frames publicados por segundo.
   *
   * `everyNthFrame` sozinho NÃO entrega o alvo da §7.1: ele divide a taxa do
   * compositor, então numa página que muda a 60fps ainda saem 30. Medido na
   * loja falsa animada com everyNthFrame=2: 29,7 fps e 2,1 Mbps — por
   * espectador. Limitar por tempo é o que respeita o alvo de 5 a 10.
   */
  maxFps?: number
  /**
   * Silêncio máximo antes de o motor ir BUSCAR a imagem, em ms. 0 desliga.
   *
   * O screencast do Chrome só emite quando a página repinta, e uma auditoria
   * passa boa parte do tempo lendo tela parada. Medido numa auditoria de 77s:
   * o último frame chegou aos 28s, e os 49 restantes ficaram sem uma imagem.
   * O encanamento estava saudável — não havia o que enviar.
   *
   * Passado esse silêncio, o motor tira um print ativo e publica. Custo
   * medido: 34ms de mediana por print, 3,4% de um núcleo a 1/s.
   */
  heartbeatMs?: number
}

export interface ScreencastStats {
  framesReceived: number
  framesPublished: number
  /** Frames que o motor foi buscar porque a página não repintava. */
  framesHeartbeat: number
  /**
   * Frames descartados porque a página ainda era `about:blank`.
   *
   * A captura passou a começar no instante em que o navegador nasce, para o
   * espectador ver a loja carregando. Entre esse instante e a navegação a
   * página é branca, e publicar aquilo trocaria o esqueleto de espera — que é
   * honesto — por um retângulo vazio que parece defeito.
   */
  framesAntesDeNavegar: number
  /** Frames recebidos e ACKADOS, mas não publicados por causa do teto de fps. */
  framesThrottled: number
  framesDropped: number
  bytesTotal: number
  durationMs: number
  fps: number
  /** Erros de ack. Qualquer valor acima de zero explica captura que emudece. */
  ackFailures: number
}

export interface Screencast {
  stop(): Promise<ScreencastStats>
  stats(): ScreencastStats
}

const DEFAULTS: Required<ScreencastOptions> = {
  quality: 60,
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 2,
  maxFps: 8,
  /* 1200ms: abaixo disso o print ativo começa a competir com o screencast em
     página que muda, e acima disso o espectador sente o congelamento. A tela
     acusa "imagem parada" a partir de 4s, então isto fica bem antes. */
  heartbeatMs: 1200,
}

export async function startScreencast(
  page: Page,
  publisher: Publisher,
  auditId: string,
  options: ScreencastOptions = {},
): Promise<Screencast> {
  const settings = { ...DEFAULTS, ...options }
  const startedAt = Date.now()

  let framesReceived = 0
  let framesPublished = 0
  let framesHeartbeat = 0
  let framesAntesDeNavegar = 0
  let framesThrottled = 0
  let framesDropped = 0
  let lastPublishedAt = 0
  const minIntervalMs = settings.maxFps > 0 ? 1000 / settings.maxFps : 0
  let bytesTotal = 0
  let ackFailures = 0
  let stopped = false

  /* `page.url()` é síncrono e lê o que já está em memória. `about:blank` é o
     endereço do navegador recém-aberto, antes de qualquer navegação. */
  const aindaEmBranco = (): boolean => {
    const url = page.url()
    return url === '' || url === 'about:blank'
  }

  const client = await page.context().newCDPSession(page)

  const snapshot = (): ScreencastStats => {
    const durationMs = Date.now() - startedAt
    return {
      framesReceived,
      framesPublished,
      framesHeartbeat,
      framesAntesDeNavegar,
      framesThrottled,
      framesDropped,
      bytesTotal,
      durationMs,
      // fps é o que EFETIVAMENTE vai para o espectador, não o que o Chrome
      // ofereceu: é a taxa publicada que decide a banda e a percepção.
      fps: durationMs === 0 ? 0 : Math.round((framesPublished / (durationMs / 1000)) * 10) / 10,
      ackFailures,
    }
  }

  client.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
    framesReceived++

    const now = Date.now()
    const cedoDemais = minIntervalMs > 0 && now - lastPublishedAt < minIntervalMs

    // Publica primeiro, mas NUNCA deixa a falha impedir o ack.
    try {
      if (stopped) {
        framesDropped++
      } else if (aindaEmBranco()) {
        // Descartado, e ACKADO logo abaixo como qualquer outro: sem o ack o
        // Chrome emudece e a captura inteira morre.
        framesAntesDeNavegar++
      } else if (cedoDemais) {
        // Descartado pelo teto de fps — mas ainda assim ACKADO logo abaixo,
        // senão o Chrome emudece e a captura inteira morre.
        framesThrottled++
      } else {
        bytesTotal += event.data.length
        lastPublishedAt = now
        /* `page.url()` é síncrono e lê o que já está em memória: não custa
           ida ao navegador, e é a única fonte honesta do endereço. */
        publisher.publish(auditId, {
          type: 'frame',
          data: event.data,
          seq: framesPublished + 1,
          url: page.url(),
        })
        framesPublished++
      }
    } catch {
      framesDropped++
    }

    // O ack é o que mantém o fluxo vivo. Falha aqui é registrada, não engolida:
    // captura que emudece sem explicação é o pior modo de falhar.
    void client
      .send('Page.screencastFrameAck', { sessionId: event.sessionId })
      .catch(() => {
        ackFailures++
      })
  })

  /**
   * Vai BUSCAR a imagem quando a página não repinta.
   *
   * Este é o coração da correção: o screencast é reativo, e uma jornada de
   * auditoria é feita de longos trechos em que o robô lê a tela sem mudar
   * nada. Sem isto, a transmissão simplesmente emudece — e emudecer é
   * indistinguível de ter quebrado, para quem está olhando.
   *
   * O print é tolerante a falha de propósito: durante navegação a página pode
   * recusar, e um batimento perdido não pode derrubar a captura nem a
   * auditoria. Perde-se um batimento; o próximo vem.
   */
  let batimento: ReturnType<typeof setInterval> | null = null
  if (settings.heartbeatMs > 0) {
    let ocupado = false
    batimento = setInterval(() => {
      if (stopped || ocupado) return
      if (aindaEmBranco()) return
      if (Date.now() - lastPublishedAt < settings.heartbeatMs) return
      ocupado = true
      void page
        .screenshot({ type: 'jpeg', quality: settings.quality })
        .then((buf) => {
          if (stopped) return
          const data = buf.toString('base64')
          bytesTotal += data.length
          lastPublishedAt = Date.now()
          framesPublished++
          framesHeartbeat++
          publisher.publish(auditId, {
            type: 'frame',
            data,
            seq: framesPublished,
            url: page.url(),
          })
        })
        .catch(() => {
          /* Página navegando, fechada ou ocupada: batimento perdido não é
             falha da auditoria. O próximo tenta de novo. */
        })
        .finally(() => {
          ocupado = false
        })
    }, Math.max(200, Math.floor(settings.heartbeatMs / 2)))
    batimento.unref?.()
  }

  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: settings.quality,
    maxWidth: settings.maxWidth,
    maxHeight: settings.maxHeight,
    everyNthFrame: settings.everyNthFrame,
  })

  return {
    stats: snapshot,
    async stop(): Promise<ScreencastStats> {
      if (stopped) return snapshot()
      stopped = true
      if (batimento !== null) clearInterval(batimento)
      // A página pode já ter fechado; parar é melhor esforço.
      await client.send('Page.stopScreencast').catch(() => undefined)
      await client.detach().catch(() => undefined)
      return snapshot()
    },
  }
}
