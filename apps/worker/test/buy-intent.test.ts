/**
 * Reconhecer o botão de comprar pelo texto.
 *
 * O caso que motivou este arquivo: a Circulei (circulei.co) aluga roupas pelo
 * Shopify, e o botão diz "QUERO ALUGAR". A jornada parou dizendo que não achou
 * botão dentro do formulário.
 *
 * Na MESMA página existe "FICOU COM DÚVIDA? CLIQUE AQUI E FALE COM A NINA",
 * que começa parecido e não pode ser clicado — clicar ali levaria a jornada
 * para uma conversa de WhatsApp em vez do carrinho.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchBuyIntent, melhorQue } from '../src/journey/buyIntent.ts'

describe('rótulos que SÃO botão de comprar', () => {
  const compram = [
    'QUERO ALUGAR',
    'Quero alugar',
    'Adicionar ao carrinho',
    'ADICIONAR AO CARRINHO',
    'Adicionar à sacola',
    'Add to cart',
    'Comprar agora',
    'Comprar',
    'Eu quero',
    'Alugar',
    'Reservar',
    'Assinar',
    'Colocar no carrinho',
  ]
  for (const rotulo of compram) {
    test(`"${rotulo}"`, () => {
      assert.ok(matchBuyIntent(rotulo), `deveria reconhecer: ${rotulo}`)
    })
  }

  test('a evidência guarda o texto observado, e o radical que o explicou', () => {
    const achado = matchBuyIntent('  QUERO   ALUGAR  ')
    assert.equal(achado?.label, 'QUERO ALUGAR')
    // O radical, não a frase: a lista deixou de ser de frases inteiras.
    assert.equal(achado?.term, 'alug')
  })
})

describe('rótulos que NÃO são botão de comprar', () => {
  const naoCompram = [
    'FICOU COM DÚVIDA? CLIQUE AQUI E FALE COM A NINA',
    'Quero saber mais',
    'Saiba mais',
    'Como funciona',
    'Continuar comprando',
    'Ver carrinho',
    'Finalizar compra',
    'Avise-me quando chegar',
    'Entrar',
    'Criar conta',
    'Buscar',
    'Aceitar cookies',
    'Fechar',
    'Esgotado',
  ]
  for (const rotulo of naoCompram) {
    test(`"${rotulo}"`, () => {
      assert.equal(matchBuyIntent(rotulo), null, `não deveria reconhecer: ${rotulo}`)
    })
  }
})

describe('bordas', () => {
  test('rótulo vazio ou ausente não afirma nada', () => {
    for (const vazio of ['', '   ', null, undefined]) {
      assert.equal(matchBuyIntent(vazio), null)
    }
  })

  test('texto longo demais não é rótulo de botão', () => {
    // Parágrafo que contém "comprar" não é botão. Rótulo de botão é curto.
    assert.equal(matchBuyIntent('Comprar '.repeat(20)), null)
  })

  /* O radical vale em qualquer posição, então uma frase com "comprar" no meio
     também casa. Isso é o preço de não ter lista fechada, e é pago onde deve:
     na ESCOLHA. `melhorQue` põe o botão na frente da frase, e é assim que a
     busca na página decide. */
  test('frase que contém o verbo casa, mas perde para o botão', () => {
    const frase = matchBuyIntent('Você pode comprar depois')
    const botao = matchBuyIntent('Comprar')
    assert.ok(frase, 'radical em qualquer posição: a frase casa')
    assert.ok(botao)
    assert.ok(melhorQue(botao, frase), 'o botão tem que ganhar da frase')
    assert.ok(!melhorQue(frase, botao))
  })

  test('rótulo com cara de frase longa não é botão', () => {
    assert.equal(matchBuyIntent('Você pode comprar isso aqui depois se quiser'), null)
  })

  test('radical curto só vale como palavra inteira', () => {
    // "add" está dentro de "adicional" e de "address".
    assert.equal(matchBuyIntent('Frete adicional'), null)
    assert.ok(matchBuyIntent('ADD'))
  })

  test('acento não decide: "adicionar à sacola" e "a sacola" casam igual', () => {
    assert.ok(matchBuyIntent('Adicionar à sacola'))
    assert.ok(matchBuyIntent('Adicionar a sacola'))
  })

  test('a exclusão vence a inclusão', () => {
    // "quero" está no léxico de compra e "duvida" no de exclusão.
    assert.equal(matchBuyIntent('Quero tirar uma dúvida'), null)
  })
})
