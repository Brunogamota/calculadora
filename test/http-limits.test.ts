/**
 * Corpo cortado no limite de bytes não pode voltar em silêncio: o chamador faz
 * JSON.parse, quebra, e o erro sai como "resposta inválida" — culpando o site
 * por um limite nosso. Foi exatamente o que aconteceu com o /products.json da
 * Insider Store.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { AuditError } from '../src/lib/errors.ts'

describe('RESPONSE_TOO_LARGE', () => {
  test('o código de erro existe e é distinto de erro de rede', () => {
    const err = new AuditError('RESPONSE_TOO_LARGE', 'corpo cortado', { maxBytes: 1024 })
    assert.equal(err.code, 'RESPONSE_TOO_LARGE')
    assert.notEqual(err.code, 'NETWORK_ERROR')
    assert.equal(err.detail['maxBytes'], 1024)
  })

  test('a mensagem diz o limite, para não parecer culpa do site', () => {
    const err = new AuditError('RESPONSE_TOO_LARGE', 'resposta de https://x/y passou de 8388608 bytes e foi cortada', {})
    assert.match(err.message, /passou de \d+ bytes/)
  })
})
