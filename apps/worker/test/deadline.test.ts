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

  test('clamp nunca devolve mais do que resta', () => {
    const d = new Deadline(1000)
    assert.ok(d.clamp(30_000) <= 1000)
    assert.ok(d.clamp(500) <= 500)
  })
})
