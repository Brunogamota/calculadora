/**
 * Sobe um Chromium assim que o servidor nasce, e fecha.
 *
 * Medido dentro do contêiner da Fly, com `npm run medir`, numa máquina que
 * tinha acabado de reiniciar pelo deploy:
 *
 *   subindo o Chromium... 224 ms (primeira, fria: 16699 ms)
 *
 * 16,7 segundos na primeira, 224 ms na segunda — 74× de diferença, e a maior
 * de todas as linhas daquela medição. No ambiente de desenvolvimento a mesma
 * primeira subida custa ~0,1s, então isto não aparece em teste nenhum aqui: é
 * defeito que só existe na máquina de verdade.
 *
 * O que custa os 16s é LER o binário do navegador do disco da Fly. Por isso
 * fechar o navegador logo depois não desfaz o aquecimento: o que ficou quente
 * é o cache de página do sistema operacional, que sobrevive ao processo que o
 * encheu. Isso não é teoria — é o que a medição acima mostra, porque o
 * primeiro navegador JÁ TINHA SIDO FECHADO quando o segundo subiu em 224 ms.
 *
 * Sem isto, todo deploy reinicia a máquina e a PRIMEIRA auditoria depois dele
 * paga os 16 segundos inteiros antes de a tela ao vivo mostrar qualquer coisa.
 * E a tela ao vivo é o produto: é a única falha que o lead vê inteira.
 */

import { launchBrowser } from '@raio-x/worker/src/lib/browser.ts'
import { DEFAULT_USER_AGENT } from '@raio-x/worker/src/lib/http.ts'

/**
 * Aquecer é para máquina hospedada, e por isso é declarado, não adivinhado.
 *
 * O Dockerfile liga. Aqui e na máquina de quem desenvolve fica desligado, e o
 * motivo não é preferência: a primeira subida local custa ~0,1s, então não há
 * o que aquecer — e um teste que importa o servidor não pode ganhar um
 * Chromium de brinde só por ter feito `import`.
 */
export function deveAquecer(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['RAIO_X_AQUECER'] === '1'
}

interface Fechavel {
  close(): Promise<void>
}

/**
 * Devolve quantos ms levou, ou null se não deu — nunca lança.
 *
 * Nunca lança porque isto é conforto, não requisito: se o Chromium não subir
 * aqui, a auditoria seguinte vai descobrir isso do jeito dela e com a
 * mensagem dela. Derrubar o servidor inteiro por causa do aquecimento seria
 * trocar 16 segundos de espera por um motor que não atende ninguém.
 */
export async function aquecerNavegador(
  subir: () => Promise<Fechavel> = () =>
    launchBrowser({ headed: false, userAgent: DEFAULT_USER_AGENT, timeoutMs: 60_000 }),
): Promise<number | null> {
  const t0 = Date.now()
  try {
    const navegador = await subir()
    await navegador.close()
    return Date.now() - t0
  } catch (erro) {
    /* Em voz alta, e com o motivo: aquecimento que falha em silêncio devolve
       o problema original — 16s de tela parada — sem deixar rastro de por quê. */
    console.error(
      `[raio-x] o aquecimento do navegador não deu: ` +
        `${erro instanceof Error ? erro.message : String(erro)}`,
    )
    return null
  }
}
