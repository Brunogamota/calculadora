/**
 * Intervalo mínimo entre auditorias do mesmo domínio.
 *
 * O caso real: durante a depuração, a Insider Store levou oito auditorias
 * seguidas do mesmo IP em pouco mais de uma hora, até passar a servir desafio
 * da Cloudflare. A §2.2 proíbe repetir tentativa para provocar bloqueio, mas
 * nada no motor impedia — a regra existia só no texto.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { checkCooldown, type Ledger } from '../src/lib/cooldown.ts'

const AGORA = Date.parse('2026-08-31T22:00:00Z')
const h = (n: number) => n * 3600_000

function ledgerCom(iso: string): Ledger {
  return { 'loja.com.br': { lastAuditedAt: iso, count: 1, forced: 0 } }
}

describe('checkCooldown', () => {
  test('domínio nunca auditado passa', () => {
    const v = checkCooldown({}, 'loja.com.br', 24, AGORA)
    assert.equal(v.allowed, true)
    assert.equal(v.lastAuditedAt, null)
  })

  test('auditado há 1h é barrado', () => {
    const v = checkCooldown(ledgerCom(new Date(AGORA - h(1)).toISOString()), 'loja.com.br', 24, AGORA)
    assert.equal(v.allowed, false)
    assert.equal(v.hoursRemaining, 23)
  })

  test('auditado há 25h passa', () => {
    const v = checkCooldown(ledgerCom(new Date(AGORA - h(25)).toISOString()), 'loja.com.br', 24, AGORA)
    assert.equal(v.allowed, true)
    assert.equal(v.hoursRemaining, 0)
  })

  test('exatamente no limite passa', () => {
    const v = checkCooldown(ledgerCom(new Date(AGORA - h(24)).toISOString()), 'loja.com.br', 24, AGORA)
    assert.equal(v.allowed, true)
  })

  test('diz quando a próxima é permitida', () => {
    const v = checkCooldown(ledgerCom(new Date(AGORA - h(2)).toISOString()), 'loja.com.br', 24, AGORA)
    assert.equal(v.nextAllowedAt, new Date(AGORA + h(22)).toISOString())
  })

  test('outro domínio não é afetado', () => {
    const v = checkCooldown(ledgerCom(new Date(AGORA).toISOString()), 'outra.com.br', 24, AGORA)
    assert.equal(v.allowed, true)
  })

  test('registro corrompido não trava a ferramenta', () => {
    const v = checkCooldown({ 'loja.com.br': { lastAuditedAt: 'lixo', count: 1, forced: 0 } }, 'loja.com.br', 24, AGORA)
    assert.equal(v.allowed, true)
  })

  test('as oito rodadas da Insider seriam barradas a partir da segunda', () => {
    // Reprodução do que aconteceu: rodadas em sequência, minutos de intervalo.
    const primeira = new Date(AGORA - h(1)).toISOString()
    for (const minutos of [5, 10, 20, 40, 55]) {
      const v = checkCooldown(ledgerCom(primeira), 'loja.com.br', 24, AGORA - h(1) + minutos * 60_000)
      assert.equal(v.allowed, false, `rodada aos ${minutos}min deveria ser barrada`)
    }
  })
})
