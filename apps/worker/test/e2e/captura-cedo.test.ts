/**
 * A captura começa quando o navegador NASCE, não quando o `prepare` acaba.
 *
 * Na allbirds o `identify` levou 4,5s e a tela ficou no esqueleto o tempo
 * todo: o `startScreencast` só rodava depois do `await prepare(...)`, que
 * inclui carregar a home e detectar a plataforma.
 *
 * Este teste mede a coisa que foi corrigida — o INSTANTE em que a página fica
 * disponível para filmar, contra o instante em que o `prepare` devolve. Uma
 * tentativa anterior media outra coisa: quando o primeiro FRAME chegava. Isso
 * depende de a loja pintar, o que varia com a máquina, a versão do Chromium e
 * a loja — a mesma asserção dava 1470ms de folga aqui e 16ms de atraso no Mac
 * do Bruno, com o código idêntico. Assertiva que depende de pintura não é
 * assertiva, é sorte.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { prepare } from '../../src/session.ts'
import { startFakeStore } from '../fixtures/fake-shopify.ts'

/* A home manda o conteúdo visível na hora e só fecha a conexão depois disto.
   É a janela em que a transmissão precisa já estar de pé — e é o que toda
   loja real tem, porque nenhuma entrega a página inteira num pacote só. */
const ESPERA_DA_HOME_MS = 1200

describe('captura começa antes de o prepare terminar', { concurrency: false }, () => {
  test('o navegador é entregue durante a carga da home, não depois dela', async () => {
    process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
    process.env['RAIO_X_SEGREDO_TITULARIDADE'] ??= 'segredo-de-teste-com-tamanho-suficiente'
    const loja = await startFakeStore({ homeStreamDelayMs: ESPERA_DA_HOME_MS })
    try {
      let nasceuEm: number | null = null
      let paginaUsavel = false

      const inicio = Date.now()
      const preparado = await prepare(loja.url, { headed: false }, undefined, (b) => {
        nasceuEm = Date.now() - inicio
        // Não basta receber a sessão: a página precisa dar para filmar.
        paginaUsavel = typeof b.page.url === 'function'
      })
      const terminouEm = Date.now() - inicio
      await preparado.browser.close()

      assert.notEqual(nasceuEm, null, 'o `prepare` nunca entregou o navegador')
      assert.ok(paginaUsavel, 'o navegador chegou sem página utilizável')

      const folga = terminouEm - (nasceuEm as unknown as number)
      /* O piso é metade da espera da home. Não é o número exato de propósito:
         o que se afirma é que a captura ganha a JANELA DA CARGA inteira, e um
         piso colado no valor exato quebraria por variação de máquina — que é
         exatamente o defeito que este arquivo substitui. */
      assert.ok(
        folga > ESPERA_DA_HOME_MS / 2,
        `o navegador só ficou disponível ${folga}ms antes do fim do prepare; ` +
          `esperado mais de ${ESPERA_DA_HOME_MS / 2}ms, que é a janela da carga da home`,
      )
    } finally {
      await loja.close()
    }
  })
})
