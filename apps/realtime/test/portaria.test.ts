/**
 * A portaria: quantos ao mesmo tempo, e quantos por endereço.
 *
 * Enquanto o motor rodava na máquina do dono, o `running` do servidor apenas
 * CONTAVA auditorias. Cada POST sobe um Chromium, e cada auditoria custa
 * ~118 MB medidos: numa máquina de 1 GB, a sexta simultânea derruba as cinco
 * que estavam rodando junto — inclusive a de quem estava assistindo a tela ao
 * vivo, que é o produto.
 *
 * O que este arquivo protege não é o limite em si, é a HONESTIDADE da recusa:
 * fila cheia é fato sobre nós, e a mensagem tem que dizer isso e dizer quando
 * voltar. "Erro" seco faria o lead achar que a loja dele quebrou o robô.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { criarPortaria, ipDoPedido } from '../src/portaria.ts'

const AMBIENTE = { RAIO_X_MAX_SIMULTANEAS: '3', RAIO_X_TETO_POR_IP: '2', RAIO_X_JANELA_POR_IP_MINUTOS: '10' }

describe('teto de auditorias ao mesmo tempo', () => {
  test('abaixo do teto entra', () => {
    const p = criarPortaria(AMBIENTE)
    assert.equal(p.recusa('1.1.1.1', 2), null)
  })

  test('no teto recusa, e a recusa diz que a limitação é NOSSA', () => {
    const p = criarPortaria(AMBIENTE)
    const motivo = p.recusa('1.1.1.1', 3)
    assert.ok(motivo, 'entrou com a fila cheia')
    // Nunca pode sobrar para a loja de quem pediu.
    assert.match(motivo, /limitação nossa, não da sua loja/)
    assert.match(motivo, /Tente de novo/)
  })

  test('o teto vale para endereços diferentes: é a máquina que não aguenta', () => {
    const p = criarPortaria(AMBIENTE)
    assert.ok(p.recusa('9.9.9.9', 3), 'IP novo furou o teto de simultâneas')
  })
})

describe('teto por endereço', () => {
  test('dentro da janela, o mesmo IP é segurado depois do limite', () => {
    const p = criarPortaria(AMBIENTE)
    const t0 = 1_000_000
    assert.equal(p.recusa('2.2.2.2', 0, t0), null)
    p.registra('2.2.2.2', t0)
    assert.equal(p.recusa('2.2.2.2', 0, t0 + 1000), null)
    p.registra('2.2.2.2', t0 + 1000)

    const motivo = p.recusa('2.2.2.2', 0, t0 + 2000)
    assert.ok(motivo, 'o terceiro pedido do mesmo IP passou')
    assert.match(motivo, /Espere \d+ minuto/)
  })

  test('o limite de um IP não tranca os outros', () => {
    const p = criarPortaria(AMBIENTE)
    const t0 = 1_000_000
    p.registra('2.2.2.2', t0)
    p.registra('2.2.2.2', t0)
    assert.ok(p.recusa('2.2.2.2', 0, t0))
    assert.equal(p.recusa('3.3.3.3', 0, t0), null, 'um IP cheio trancou a porta para outro')
  })

  test('passada a janela, o mesmo IP entra de novo', () => {
    const p = criarPortaria(AMBIENTE)
    const t0 = 1_000_000
    p.registra('2.2.2.2', t0)
    p.registra('2.2.2.2', t0)
    assert.ok(p.recusa('2.2.2.2', 0, t0 + 60_000))
    assert.equal(p.recusa('2.2.2.2', 0, t0 + 11 * 60_000), null, 'a janela não expirou')
  })
})

describe('de quem é o pedido, atrás do proxy da hospedagem', () => {
  /* Sem isto o limite por IP vira limite GLOBAL: na Fly o `remoteAddress` é
     sempre o proxy dela, igual para todo mundo, e o primeiro visitante
     trancaria a porta para os demais. */
  test('usa o cabeçalho da Fly quando existe', () => {
    assert.equal(ipDoPedido({ 'fly-client-ip': '200.1.2.3', 'x-forwarded-for': '10.0.0.1' }), '200.1.2.3')
  })

  test('cai para o primeiro do x-forwarded-for em outras hospedagens', () => {
    assert.equal(ipDoPedido({ 'x-forwarded-for': '200.4.5.6, 10.0.0.1' }), '200.4.5.6')
  })

  test('sem cabeçalho nenhum, todo mundo cai no mesmo balde — e isso é dito', () => {
    // Melhor um balde só, explícito, do que fingir que sabe de quem é.
    assert.equal(ipDoPedido({}), 'desconhecido')
  })
})
