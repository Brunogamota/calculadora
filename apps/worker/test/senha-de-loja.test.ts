/**
 * O detector da página de senha do Shopify — texto, não estrutura, porque a
 * Shopify não documenta o HTML dessa tela como contrato estável. Ver
 * `lib/senha-de-loja.ts` para o porquê.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pareceSenhaDeLoja } from '../src/lib/senha-de-loja.ts'

describe('reconhece a página de senha', () => {
  test('o texto exato visto numa loja real', () => {
    const corpo =
      '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8">\n    <title>raiox-teste</title>\n' +
      '<p>This store is password protected. Use the password to enter the store.</p>'
    assert.equal(pareceSenhaDeLoja(corpo), true)
  })

  test('só o rótulo do campo já basta', () => {
    assert.equal(pareceSenhaDeLoja('<label>Enter store password</label>'), true)
  })

  test('catálogo de verdade não é confundido com página de senha', () => {
    const catalogoReal = JSON.stringify({ products: [{ id: 1, title: 'Produto', variants: [] }] })
    assert.equal(pareceSenhaDeLoja(catalogoReal), false)
  })

  test('página de erro genérica (404, 500) não é confundida com senha', () => {
    assert.equal(pareceSenhaDeLoja('<html><body><h1>404 Not Found</h1></body></html>'), false)
  })

  test('corpo vazio não é confundido com senha', () => {
    assert.equal(pareceSenhaDeLoja(''), false)
  })
})
