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
import { checkCooldown, cooldownHours, attemptCooldownMinutes, readLedger, recordAudit, type Ledger } from '../src/lib/cooldown.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

describe('o registro sobrevive ao deploy', () => {
  /* O ledger ficava junto das capturas, em `outDir`, que na Fly é `/tmp`. O
     sistema de arquivos é recriado a cada deploy, então TODO `fly deploy`
     apagava o intervalo de 24h: bastava subir uma versão para poder auditar de
     novo a mesma loja de terceiro. §2.2 é conduta, e regra que some com o
     deploy não é regra. */
  test('com RAIO_X_LEDGER_DIR, apagar a pasta das capturas não apaga o intervalo', async () => {
    const capturas = await mkdtemp(path.join(tmpdir(), 'raiox-out-'))
    const registro = await mkdtemp(path.join(tmpdir(), 'raiox-vol-'))
    const anterior = process.env['RAIO_X_LEDGER_DIR']
    process.env['RAIO_X_LEDGER_DIR'] = registro
    try {
      await recordAudit(capturas, 'loja.com.br', false, 'full')
      assert.ok((await readLedger(capturas))['loja.com.br'], 'não gravou nada')

      /* O deploy: a máquina volta com as capturas zeradas e o volume intacto. */
      await rm(capturas, { recursive: true, force: true })

      const depois = await readLedger(capturas)
      assert.ok(
        depois['loja.com.br']?.lastFullAuditAt,
        'o intervalo da §2.2 sumiu com a pasta das capturas — é o defeito de volta',
      )
    } finally {
      if (anterior === undefined) delete process.env['RAIO_X_LEDGER_DIR']
      else process.env['RAIO_X_LEDGER_DIR'] = anterior
      await rm(registro, { recursive: true, force: true })
      await rm(capturas, { recursive: true, force: true })
    }
  })

  test('sem a variável, o registro continua onde sempre esteve', async () => {
    /* CLI e testes não precisam montar disco nenhum. */
    const capturas = await mkdtemp(path.join(tmpdir(), 'raiox-out-'))
    const anterior = process.env['RAIO_X_LEDGER_DIR']
    delete process.env['RAIO_X_LEDGER_DIR']
    try {
      await recordAudit(capturas, 'loja.com.br', false, 'full')
      assert.ok((await readLedger(capturas))['loja.com.br'])
      await rm(capturas, { recursive: true, force: true })
      assert.deepEqual(await readLedger(capturas), {}, 'devia ter sumido junto com a pasta')
    } finally {
      if (anterior !== undefined) process.env['RAIO_X_LEDGER_DIR'] = anterior
      await rm(capturas, { recursive: true, force: true })
    }
  })
})
