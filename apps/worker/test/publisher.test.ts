/**
 * Barramento de eventos (§7.4).
 *
 * Duas regras que este arquivo protege:
 *  - quem reconecta recebe o estado dos PASSOS, nunca o histórico de frames
 *  - `step:skip` existe para etapa que não rodou e não é falha; forçá-la em
 *    `fail` mostraria um X vermelho para a loja que só respeitou o robots
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryPublisher, NullPublisher } from '../src/stream/publisher.ts'
import type { AuditEvent } from '@raio-x/types'
import { STEP_LABELS, isAuditEvent } from '@raio-x/types'

const agora = () => new Date().toISOString()

describe('MemoryPublisher — entrega', () => {
  test('entrega a quem assinou a mesma auditoria', () => {
    const bus = new MemoryPublisher()
    const recebidos: AuditEvent[] = []
    bus.subscribe('a1', (e) => recebidos.push(e))
    bus.publish('a1', { type: 'step:start', id: 'identify', label: 'x', at: agora() })
    assert.equal(recebidos.length, 1)
  })

  test('não vaza entre auditorias diferentes', () => {
    const bus = new MemoryPublisher()
    const recebidos: AuditEvent[] = []
    bus.subscribe('a1', (e) => recebidos.push(e))
    bus.publish('a2', { type: 'step:start', id: 'identify', label: 'x', at: agora() })
    assert.equal(recebidos.length, 0)
  })

  test('cancelar a assinatura para de entregar', () => {
    const bus = new MemoryPublisher()
    const recebidos: AuditEvent[] = []
    const cancelar = bus.subscribe('a1', (e) => recebidos.push(e))
    bus.publish('a1', { type: 'step:start', id: 'identify', label: 'x', at: agora() })
    cancelar()
    bus.publish('a1', { type: 'step:done', id: 'identify', at: agora() })
    assert.equal(recebidos.length, 1)
  })

  test('ouvinte que explode não derruba a auditoria nem os outros', () => {
    const bus = new MemoryPublisher()
    const bons: AuditEvent[] = []
    bus.subscribe('a1', () => {
      throw new Error('ouvinte quebrado')
    })
    bus.subscribe('a1', (e) => bons.push(e))
    bus.publish('a1', { type: 'step:start', id: 'identify', label: 'x', at: agora() })
    assert.equal(bons.length, 1)
  })
})

describe('MemoryPublisher — estado para quem reconecta (§7.4)', () => {
  test('acumula os passos com rótulo e situação', () => {
    const bus = new MemoryPublisher()
    const comeco = '2026-09-01T12:00:00.000Z'
    const fim = '2026-09-01T12:00:07.500Z'
    bus.publish('a1', { type: 'step:start', id: 'identify', label: 'x', at: comeco })
    bus.publish('a1', { type: 'step:done', id: 'identify', detail: 'Shopify', at: fim })
    bus.publish('a1', { type: 'step:start', id: 'add-to-cart', label: 'y', at: fim })

    const estado = bus.stateOf('a1')!
    assert.equal(estado.steps.length, 2)
    assert.deepEqual(estado.steps[0], {
      id: 'identify',
      label: STEP_LABELS.identify,
      status: 'done',
      detail: 'Shopify',
      startedAt: comeco,
      finishedAt: fim,
    })
    assert.equal(estado.steps[1]?.status, 'running')
  })

  /* Os horários estão no estado, e não só nos eventos, porque quem reconecta
     recebe o estado. Sem eles a tela teria que inventar a duração das etapas
     que já passaram — e ela inventava: mostrava os segundos do desenho, então
     uma etapa que levou 90s aparecia como "4.1s". */
  test('o estado carrega quanto cada etapa levou, para quem chegou depois', () => {
    const bus = new MemoryPublisher()
    bus.publish('a1', { type: 'step:start', id: 'identify', label: 'x', at: '2026-09-01T12:00:00.000Z' })
    bus.publish('a1', { type: 'step:done', id: 'identify', at: '2026-09-01T12:00:01.000Z' })
    bus.publish('a1', { type: 'step:start', id: 'add-to-cart', label: 'y', at: '2026-09-01T12:00:01.000Z' })
    bus.publish('a1', { type: 'step:fail', id: 'add-to-cart', reason: 'x', at: '2026-09-01T12:01:31.000Z' })

    const passos = bus.stateOf('a1')!.steps
    const duracao = (i: number): number =>
      (Date.parse(passos[i]!.finishedAt!) - Date.parse(passos[i]!.startedAt!)) / 1000
    assert.equal(duracao(0), 1)
    assert.equal(duracao(1), 90)
  })

  /* Etapa pulada nunca começa: o motor emite `step:skip` sem `step:start`.
     Sem começo não existe duração, e é isso que a tela precisa ver — melhor
     campo ausente do que duração fabricada. */
  test('etapa pulada tem fim e não tem começo', () => {
    const bus = new MemoryPublisher()
    bus.publish('a1', { type: 'step:skip', id: 'mobile', reason: 'fora desta fase', at: agora() })
    const passo = bus.stateOf('a1')!.steps[0]!
    assert.equal(passo.status, 'skipped')
    assert.equal(passo.startedAt, undefined)
    assert.ok(passo.finishedAt)
  })

  test('frame NÃO entra no estado: frame perdido é frame perdido', () => {
    const bus = new MemoryPublisher()
    for (let i = 0; i < 50; i++) bus.publish('a1', { type: 'frame', data: 'xxxx', seq: i })
    const estado = bus.stateOf('a1')
    assert.equal(estado, null, 'frame sozinho não deve nem criar estado')
  })

  test('step:skip vira skipped, não failed', () => {
    // Robots proibindo /checkout não pode virar X vermelho na tela.
    const bus = new MemoryPublisher()
    bus.publish('a1', {
      type: 'step:skip',
      id: 'reach-checkout',
      reason: 'robots.txt proíbe /checkout',
      at: agora(),
    })
    const passo = bus.stateOf('a1')!.steps[0]!
    assert.equal(passo.status, 'skipped')
    assert.match(passo.detail ?? '', /robots/)
  })

  test('achados aparecem durante a execução, não só no fim', () => {
    const bus = new MemoryPublisher()
    bus.publish('a1', { type: 'finding', code: 'HTTPS_ISSUE', severity: 'critica', title: 'x', at: agora() })
    assert.equal(bus.stateOf('a1')!.findings.length, 1)
  })

  test('complete traz nota E ressalva juntas', () => {
    // O número nunca chega na tela sozinho.
    const bus = new MemoryPublisher()
    const em = new Date().toISOString()
    bus.publish('a1', { type: 'complete', auditId: 'a1', at: em, score: 100, caveat: 'cobre 27% da §8' })
    const estado = bus.stateOf('a1')!
    assert.equal(estado.finished, true)
    /* A data vem do MOTOR e fica no estado: a tela trazia "1 de setembro"
       cravado, a mesma em toda loja e todo dia. */
    assert.equal(estado.finishedAt, em)
    assert.equal(estado.score, 100)
    assert.match(estado.caveat ?? '', /27%/)
  })

  test('aborted encerra sem nota', () => {
    const bus = new MemoryPublisher()
    bus.publish('a1', { type: 'aborted', auditId: 'a1', code: 'BOT_CHALLENGE', reason: 'x' })
    const estado = bus.stateOf('a1')!
    assert.equal(estado.finished, true)
    assert.equal(estado.score, null)
  })

  test('auditoria desconhecida não tem estado', () => {
    assert.equal(new MemoryPublisher().stateOf('nunca-vista'), null)
  })
})

describe('NullPublisher — o padrão do CLI não paga por transmissão', () => {
  test('publica no vazio sem erro', () => {
    const bus = new NullPublisher()
    bus.publish('a1', { type: 'frame', data: 'x', seq: 1 })
    assert.equal(bus.stateOf('a1'), null)
  })
  test('cancelar assinatura é seguro', () => {
    assert.doesNotThrow(() => new NullPublisher().subscribe('a1', () => {})())
  })
})

describe('isAuditEvent — o que chega pelo fio é dado, não confiança', () => {
  test('aceita os tipos do contrato', () => {
    assert.equal(isAuditEvent({ type: 'frame', data: 'x', seq: 0 }), true)
    assert.equal(isAuditEvent({ type: 'step:skip', id: 'mobile', reason: 'x', at: agora() }), true)
  })
  test('recusa o resto', () => {
    for (const lixo of [null, undefined, 'frame', 42, {}, { type: 'inventado' }]) {
      assert.equal(isAuditEvent(lixo), false, String(lixo))
    }
  })
})
