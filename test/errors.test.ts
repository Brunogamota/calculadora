/**
 * O Playwright joga o call log inteiro, com ANSI, dentro de `message`. Isso
 * aparecia tres vezes no JSON de saida e deixava o resultado ilegivel.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeError, toAuditError, AuditError } from '../src/lib/errors.ts'

const ESC = String.fromCharCode(27)

/** Reproduz o formato exato que veio da Insider Store. */
const PLAYWRIGHT_REAL = [
  'locator.click: Timeout 15000ms exceeded.',
  'Call log:',
  `${ESC}[2m  - waiting for locator('form[action*="/cart/add"]')${ESC}[22m`,
  `${ESC}[2m    - <div class="cozy-crd__modal">…</div> intercepts pointer events${ESC}[22m`,
].join('\n')

describe('summarizeError', () => {
  test('fica so com a primeira linha', () => {
    assert.equal(summarizeError(PLAYWRIGHT_REAL), 'locator.click: Timeout 15000ms exceeded.')
  })

  test('remove codigo ANSI', () => {
    assert.ok(!summarizeError(`${ESC}[2mtexto${ESC}[22m`).includes(ESC))
    assert.equal(summarizeError(`${ESC}[2mtexto${ESC}[22m`), 'texto')
  })

  test('corta mensagem muito longa', () => {
    const summary = summarizeError('x'.repeat(500), 100)
    assert.equal(summary.length, 101)
    assert.ok(summary.endsWith('…'))
  })

  test('mensagem curta passa intacta', () => {
    assert.equal(summarizeError('falhou'), 'falhou')
  })
})

describe('toAuditError', () => {
  test('guarda o log completo em detail sem sujar a mensagem', () => {
    const err = toAuditError(new Error(PLAYWRIGHT_REAL))
    assert.equal(err.message, 'locator.click: Timeout 15000ms exceeded.')
    const log = String(err.detail['callLog'])
    assert.ok(log.includes('intercepts pointer events'), 'o log completo tem que sobreviver')
    assert.ok(!log.includes(ESC), 'mas sem ANSI')
  })

  test('erro de uma linha nao gera callLog redundante', () => {
    const err = toAuditError(new Error('falha simples'))
    assert.equal(err.message, 'falha simples')
    assert.equal(err.detail['callLog'], undefined)
  })

  test('AuditError passa direto, sem reprocessar', () => {
    const original = new AuditError('ROBOTS_DISALLOWED', 'proibido', { path: '/checkout' })
    assert.equal(toAuditError(original), original)
  })
})
