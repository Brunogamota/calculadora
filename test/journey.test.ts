/**
 * Escolha de produto (§6.3): disponível, barato, sem variação obrigatória
 * complexa. É lógica pura sobre o /products.json, então dá para travar sem
 * loja nenhuma.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pickProduct, priceToCents, requiresVariantChoice } from '../src/platforms/shopify.journey.ts'

function produto(over: Partial<{
  handle: string
  title: string
  product_type: string
  variants: Array<{ id: number; title: string; available: boolean; price: string }>
  options: Array<{ name: string; values: string[] }>
}> = {}) {
  return {
    handle: over.handle ?? 'produto',
    title: over.title ?? 'Produto',
    product_type: over.product_type ?? 'Camiseta',
    variants: over.variants ?? [{ id: 1, title: 'Default Title', available: true, price: '99.90' }],
    options: over.options ?? [{ name: 'Title', values: ['Default Title'] }],
  }
}

describe('priceToCents', () => {
  test('converte decimal com ponto', () => {
    assert.equal(priceToCents('129.90'), 12990)
    assert.equal(priceToCents('7.00'), 700)
    assert.equal(priceToCents('5'), 500)
  })
  test('aceita vírgula', () => {
    assert.equal(priceToCents('129,90'), 12990)
  })
  test('aceita número', () => {
    assert.equal(priceToCents(49.9), 4990)
  })
  test('devolve null em vez de chutar zero', () => {
    for (const bad of ['R$ 129,90', 'grátis', '', null, undefined, {}, 'abc']) {
      assert.equal(priceToCents(bad), null, String(bad))
    }
  })
})

describe('requiresVariantChoice', () => {
  test('variação única não exige escolha', () => {
    assert.equal(requiresVariantChoice(produto()), false)
  })
  test('várias variações com opção real exige escolha', () => {
    const p = produto({
      variants: [
        { id: 1, title: 'P', available: true, price: '10.00' },
        { id: 2, title: 'M', available: true, price: '10.00' },
      ],
      options: [{ name: 'Tamanho', values: ['P', 'M'] }],
    })
    assert.equal(requiresVariantChoice(p), true)
  })
  test('várias variações mas uma opção só não conta como escolha', () => {
    const p = produto({
      variants: [
        { id: 1, title: 'Default Title', available: true, price: '10.00' },
        { id: 2, title: 'Default Title', available: true, price: '10.00' },
      ],
      options: [{ name: 'Title', values: ['Default Title'] }],
    })
    assert.equal(requiresVariantChoice(p), false)
  })
})

describe('pickProduct — §6.3', () => {
  test('escolhe o mais barato entre os simples', () => {
    const pick = pickProduct([
      produto({ handle: 'caro', variants: [{ id: 1, title: 'x', available: true, price: '500.00' }] }),
      produto({ handle: 'barato', variants: [{ id: 2, title: 'x', available: true, price: '29.90' }] }),
    ])
    assert.equal(pick?.product.handle, 'barato')
    assert.equal(pick?.variant.id, 2)
  })

  test('prefere produto sem variação obrigatória, mesmo mais caro', () => {
    const complexo = produto({
      handle: 'complexo',
      variants: [
        { id: 1, title: 'P', available: true, price: '10.00' },
        { id: 2, title: 'M', available: true, price: '10.00' },
      ],
      options: [{ name: 'Tamanho', values: ['P', 'M'] }],
    })
    const simples = produto({
      handle: 'simples',
      variants: [{ id: 3, title: 'x', available: true, price: '90.00' }],
    })
    assert.equal(pickProduct([complexo, simples])?.product.handle, 'simples')
  })

  test('ignora produto sem variação disponível', () => {
    const pick = pickProduct([
      produto({ handle: 'esgotado', variants: [{ id: 1, title: 'x', available: false, price: '10.00' }] }),
      produto({ handle: 'ok', variants: [{ id: 2, title: 'x', available: true, price: '80.00' }] }),
    ])
    assert.equal(pick?.product.handle, 'ok')
    assert.equal(pick?.skipped.unavailable, 1)
  })

  test('escolhe a variação disponível, não a primeira', () => {
    const pick = pickProduct([
      produto({
        variants: [
          { id: 1, title: 'P', available: false, price: '10.00' },
          { id: 2, title: 'M', available: true, price: '10.00' },
        ],
        options: [{ name: 'Tamanho', values: ['P', 'M'] }],
      }),
    ])
    assert.equal(pick?.variant.id, 2)
  })

  test('pula vale-presente: não tem frete e distorce a jornada', () => {
    const pick = pickProduct([
      produto({ handle: 'gift', title: 'Gift Card R$ 100', variants: [{ id: 1, title: 'x', available: true, price: '1.00' }] }),
      produto({ handle: 'real', variants: [{ id: 2, title: 'x', available: true, price: '80.00' }] }),
    ])
    assert.equal(pick?.product.handle, 'real')
    assert.equal(pick?.skipped.giftCard, 1)
  })

  test('preço ilegível vai para o fim da fila, não vira zero', () => {
    const pick = pickProduct([
      produto({ handle: 'sem-preco', variants: [{ id: 1, title: 'x', available: true, price: 'R$ 1,00' }] }),
      produto({ handle: 'com-preco', variants: [{ id: 2, title: 'x', available: true, price: '300.00' }] }),
    ])
    assert.equal(pick?.product.handle, 'com-preco')
  })

  test('catálogo sem nada disponível devolve null em vez de inventar', () => {
    const pick = pickProduct([
      produto({ variants: [{ id: 1, title: 'x', available: false, price: '10.00' }] }),
    ])
    assert.equal(pick, null)
  })

  test('catálogo vazio devolve null', () => {
    assert.equal(pickProduct([]), null)
  })
})
