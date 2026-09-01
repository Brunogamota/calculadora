/**
 * Toda auditoria termina com UM evento terminal.
 *
 * Isto existe por causa de um travamento real. Uma etapa que falhava fora do
 * antibot — a loja recusando conexão no meio da jornada, um seletor que não
 * apareceu — devolvia o resultado e não publicava nada. Ninguém no motor
 * percebia: o CLI imprimia a falha normalmente. Só a tela travava, girando
 * "análise em andamento" indefinidamente numa auditoria que já tinha acabado —
 * medido na loja falsa: fim em 2,1s, WebSocket mudo pelos 75s seguintes.
 *
 * Duas regras, então:
 *  - nenhuma auditoria acaba em silêncio
 *  - e nenhuma acaba com dois motivos, porque o segundo trocaria na tela o
 *    motivo verdadeiro por um genérico
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Reporter } from '../src/stream/reporter.ts'
import { MemoryPublisher } from '../src/stream/publisher.ts'
import type { AuditEvent } from '@raio-x/types'

function montar(): { reporter: Reporter; eventos: AuditEvent[] } {
  const bus = new MemoryPublisher()
  const eventos: AuditEvent[] = []
  bus.subscribe('a1', (e) => eventos.push(e))
  return { reporter: new Reporter(bus, 'a1'), eventos }
}

describe('Reporter — o fim da transmissão', () => {
  test('a rede de segurança fala quando ninguém falou', () => {
    const { reporter, eventos } = montar()
    reporter.start('identify')
    reporter.fail('open-product', 'connect ECONNREFUSED')
    reporter.garantirFim(null, null)
    const fim = eventos.at(-1)
    assert.equal(fim?.type, 'aborted')
  })

  test('a rede de segurança se cala quando o motivo verdadeiro já saiu', () => {
    const { reporter, eventos } = montar()
    reporter.aborted('NETWORK_ERROR', 'connect ECONNREFUSED')
    reporter.garantirFim(null, null)
    const terminais = eventos.filter((e) => e.type === 'aborted' || e.type === 'complete')
    assert.equal(terminais.length, 1)
    assert.equal(terminais[0]?.type === 'aborted' ? terminais[0].code : '', 'NETWORK_ERROR')
  })

  test('o primeiro motivo é o que vale: o segundo aborto não entra', () => {
    const { reporter, eventos } = montar()
    reporter.aborted('BOT_CHALLENGE', 'desafio antibot')
    reporter.aborted('DEADLINE_EXCEEDED', 'orçamento estourou')
    const terminais = eventos.filter((e) => e.type === 'aborted')
    assert.equal(terminais.length, 1)
    assert.equal(terminais[0]?.type === 'aborted' ? terminais[0].code : '', 'BOT_CHALLENGE')
  })

  test('auditoria que terminou não vira abortada depois', () => {
    const { reporter, eventos } = montar()
    reporter.complete(72, null)
    reporter.aborted('DEADLINE_EXCEEDED', 'orçamento estourou')
    reporter.garantirFim(null, null)
    assert.deepEqual(
      eventos.map((e) => e.type),
      ['complete'],
    )
  })

  test('sem fim declarado, `terminou` é falso — é o que a rede consulta', () => {
    const { reporter } = montar()
    reporter.start('identify')
    assert.equal(reporter.terminou, false)
    reporter.complete(null, null)
    assert.equal(reporter.terminou, true)
  })
})
