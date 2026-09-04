/**
 * O aquecimento do navegador.
 *
 * ATENÇÃO ao que este arquivo NÃO faz: ele não prova que o aquecimento economiza
 * tempo. Não prova porque aqui não há tempo para economizar — a subida fria do
 * Chromium custa ~0,1s nesta máquina, contra 16,7s medidos dentro do contêiner
 * da Fly. Uma asserção de tempo aqui passaria sempre e não diria nada sobre o
 * lugar onde o defeito existe.
 *
 * A verificação de verdade é em produção, depois do deploy:
 *
 *   fly ssh console -a raio-x-motor -C "npm run medir"
 *
 * e a linha `subindo o Chromium... N ms (primeira, fria: M ms)` tem que trazer
 * o M na casa das centenas de ms, e não os ~16700 de antes. Se vier 16s de
 * novo, o aquecimento não rodou ou não serve — e aí a hipótese caiu, não o
 * teste.
 *
 * O que dá para provar aqui é o contorno: quem liga, e que uma falha no
 * aquecimento não derruba o servidor junto.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { aquecerNavegador, deveAquecer } from '../src/aquecimento.ts'

describe('quem decide aquecer', () => {
  test('só aquece quando foi declarado', () => {
    assert.equal(deveAquecer({ RAIO_X_AQUECER: '1' }), true)
  })

  test('sem declaração, não aquece', () => {
    // Um teste que faz `import` do servidor não pode ganhar um Chromium de
    // brinde: é lento, e deixa processo solto na suíte de quem nem pediu.
    assert.equal(deveAquecer({}), false)
    assert.equal(deveAquecer({ RAIO_X_AQUECER: '0' }), false)
    assert.equal(deveAquecer({ RAIO_X_AQUECER: 'true' }), false)
  })
})

describe('o que acontece quando o aquecimento não dá', () => {
  test('não lança: o motor atende mesmo sem ter aquecido', async () => {
    /* Isto é o ponto do arquivo inteiro. O aquecimento é conforto; se ele
       derrubasse o processo, a troca teria sido 16 segundos de espera por um
       motor que não atende ninguém. */
    const ms = await aquecerNavegador(async () => {
      throw new Error('o Chromium não subiu')
    })
    assert.equal(ms, null, 'falha no aquecimento devolveu um tempo como se tivesse dado certo')
  })

  test('o motivo da falha aparece, não morre em silêncio', async () => {
    const ditos: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => ditos.push(args.join(' '))
    try {
      await aquecerNavegador(async () => {
        throw new Error('libnss3 faltando')
      })
    } finally {
      console.error = original
    }
    assert.match(
      ditos.join('\n'),
      /libnss3 faltando/,
      'a falha do aquecimento não disse o porquê — o defeito volta a ser 16s de tela parada sem rastro',
    )
  })
})

describe('quando dá certo', () => {
  test('fecha o navegador que abriu, e devolve o tempo', async () => {
    /* Fechar importa: o que fica quente é o cache do sistema, não o processo.
       Um navegador esquecido de pé custaria ~118 MB numa máquina de 1 GB pelo
       resto da vida dela, para nada. */
    let fechou = false
    const ms = await aquecerNavegador(async () => ({
      close: async () => {
        fechou = true
      },
    }))
    assert.ok(fechou, 'o aquecimento deixou o navegador aberto')
    assert.equal(typeof ms, 'number')
  })
})
