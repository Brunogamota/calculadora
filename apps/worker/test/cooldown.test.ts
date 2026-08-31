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
import { checkCooldown, cooldownHours, attemptCooldownMinutes, type Ledger } from '../src/lib/cooldown.ts'

const AGORA = Date.parse('2026-08-31T22:00:00Z')
const h = (n: number) => n * 3600_000

/** Auditoria completa: percorreu a jornada. */
function ledgerCom(iso: string): Ledger {
  return { 'loja.com.br': { lastAuditedAt: iso, lastFullAuditAt: iso, count: 1, forced: 0 } }
}

/** Só tentativa: morreu antes da jornada. */
function ledgerTentativa(iso: string): Ledger {
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

  test('diz qual janela barrou', () => {
    assert.equal(checkCooldown(ledgerCom(new Date(AGORA - h(2)).toISOString()), 'loja.com.br', 24, AGORA).blockedBy, 'full-audit')
  })

  test('tentativa que morreu cedo NÃO queima as 24h', () => {
    // O caso real: a rodada falhou com NO_DISPLAY, sem auditar nada, e mesmo
    // assim travava o domínio por um dia inteiro.
    const dezMinAtras = new Date(AGORA - 10 * 60_000).toISOString()
    const v = checkCooldown(ledgerTentativa(dezMinAtras), 'loja.com.br', 24, AGORA)
    assert.equal(v.allowed, true, 'tentativa antiga não deve barrar')
  })

  test('mas tentativa recente ainda é barrada pelo piso', () => {
    const umMinAtras = new Date(AGORA - 60_000).toISOString()
    const v = checkCooldown(ledgerTentativa(umMinAtras), 'loja.com.br', 24, AGORA)
    assert.equal(v.allowed, false)
    assert.equal(v.blockedBy, 'attempt')
  })

  test('registro no formato antigo não queima 24h por engano', () => {
    // Formato anterior não distinguia tentativa de auditoria completa.
    const antigo: Ledger = { 'loja.com.br': { lastAuditedAt: new Date(AGORA - h(1)).toISOString(), count: 1, forced: 0 } }
    assert.equal(checkCooldown(antigo, 'loja.com.br', 24, AGORA).allowed, true)
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

describe('--force exige declaração de titularidade', () => {
  // Aconteceu de verdade: --force sugerido para depurar, segunda rodada minutos
  // depois da primeira, e a loja respondeu com desafio da Cloudflare. O IP era
  // residencial brasileiro — o gatilho foi a repetição, não a origem.
  test('o código de erro existe e explica o motivo', async () => {
    const { AuditError } = await import('../src/lib/errors.ts')
    const err = new AuditError('FORCE_WITHOUT_OWNERSHIP', 'x', {})
    assert.equal(err.code, 'FORCE_WITHOUT_OWNERSHIP')
  })
})

describe('configuração lida a cada chamada, não no import', () => {
  // Como constante de módulo, a variável definida depois do import não tinha
  // efeito — e o sintoma era silencioso: parecia configurado e não estava.
  test('a variável definida em tempo de execução vale', () => {
    delete process.env['AUDIT_COOLDOWN_HOURS']
    assert.equal(cooldownHours(), 24)
    process.env['AUDIT_COOLDOWN_HOURS'] = '0'
    assert.equal(cooldownHours(), 0)
    delete process.env['AUDIT_COOLDOWN_HOURS']
    assert.equal(cooldownHours(), 24)
  })

  test('valor inválido cai no padrão em vez de virar NaN', () => {
    process.env['AUDIT_COOLDOWN_HOURS'] = 'muito'
    assert.equal(cooldownHours(), 24)
    process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '-3'
    assert.equal(attemptCooldownMinutes(), 5)
    delete process.env['AUDIT_COOLDOWN_HOURS']
    delete process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES']
  })

  test('zero é valor válido, não ausência', () => {
    process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'
    assert.equal(attemptCooldownMinutes(), 0)
    delete process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES']
  })
})
