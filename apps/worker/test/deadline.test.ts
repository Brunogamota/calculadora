import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Deadline } from '../src/lib/deadline.ts'
import { AuditError } from '../src/lib/errors.ts'
import { sleep } from '../src/lib/ratelimit.ts'

describe('Deadline — §14 timeout global', () => {
  test('deixa passar o trabalho que termina a tempo', async () => {
    const d = new Deadline(500)
    assert.equal(await d.race(Promise.resolve('pronto'), 'etapa'), 'pronto')
  })

  test('corta o trabalho que estoura o orçamento', async () => {
    const d = new Deadline(120)
    await assert.rejects(
      d.race(sleep(5000).then(() => 'nunca'), 'jornada'),
      (e: unknown) => e instanceof AuditError && e.code === 'DEADLINE_EXCEEDED',
    )
  })

  test('a mensagem diz em que etapa estourou', async () => {
    const d = new Deadline(80)
    try {
      await d.race(sleep(3000), 'chegando ao checkout')
      assert.fail('deveria ter estourado')
    } catch (e) {
      assert.ok(e instanceof AuditError)
      assert.match(e.message, /chegando ao checkout/)
      assert.equal(e.detail['budgetMs'], 80)
    }
  })

  test('propaga o erro real quando o trabalho falha antes do prazo', async () => {
    const d = new Deadline(5000)
    await assert.rejects(d.race(Promise.reject(new Error('falha da loja')), 'x'), /falha da loja/)
  })

  test('orçamento já estourado corta na hora', async () => {
    const d = new Deadline(1)
    await sleep(20)
    assert.equal(d.expired(), true)
    await assert.rejects(d.race(sleep(1000), 'tarde demais'), /DEADLINE|estourou/)
  })

  test('a mensagem nomeia a ETAPA que estava rodando, não só o rótulo da corrida', async () => {
    /* O defeito que este teste tranca: `detect` corre a cadeia inteira dentro
       de um `race` com um rótulo só, então preflight lento, redirect,
       robots.txt, Chromium, `page.goto`, `page.content` e classificação
       estouravam todos com a MESMA frase. Três lojas reais travaram nos 120s e
       não deu para saber, pela saída, qual das oito etapas travou. */
    const d = new Deadline(80)
    d.marcar('busca do robots.txt')
    d.marcar('page.goto da home')
    try {
      await d.race(sleep(3000), 'detecção de plataforma')
      assert.fail('deveria ter estourado')
    } catch (e) {
      assert.ok(e instanceof AuditError)
      assert.match(e.message, /detecção de plataforma/)
      assert.match(e.message, /parado em: page\.goto da home/)
      assert.equal(e.detail['etapa'], 'page.goto da home')
    }
  })

  test('a trilha diz quanto DUROU cada etapa, que é o que responde onde foi o tempo', async () => {
    const d = new Deadline(5000)
    d.marcar('primeira')
    await sleep(120)
    d.marcar('segunda')
    await sleep(40)
    const trilha = d.trilha()
    assert.match(trilha, /primeira 0\.1s/)
    assert.match(trilha, /segunda 0\.0s/)
    assert.match(trilha, /→/)
  })

  test('sem marco nenhum, a mensagem continua sendo a de antes — nada de sufixo vazio', async () => {
    const d = new Deadline(60)
    await assert.rejects(d.race(sleep(2000), 'jornada'), (e: unknown) => {
      assert.ok(e instanceof AuditError)
      assert.match(e.message, /estourou em: jornada$/)
      return true
    })
  })

  test('assertAlive deixa marco mesmo quando o orçamento ainda está de pé', () => {
    /* Se ele só marcasse ao falhar, a trilha estaria vazia justo na execução
       que interessa: a que chegou longe e morreu no fim. */
    const d = new Deadline(5000)
    d.assertAlive('normalização de URL')
    d.assertAlive('abertura da home')
    assert.deepEqual(
      d.marcos.map((m) => m.etapa),
      ['normalização de URL', 'abertura da home'],
    )
    assert.equal(d.etapaCorrente(), 'abertura da home')
  })

  test('clamp nunca devolve mais do que resta', () => {
    const d = new Deadline(1000)
    assert.ok(d.clamp(30_000) <= 1000)
    assert.ok(d.clamp(500) <= 500)
  })
})
