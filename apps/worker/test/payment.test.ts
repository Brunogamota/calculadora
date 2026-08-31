/**
 * Coleta da §6.6 sobre texto visível, e as travas da §2.
 *
 * O princípio nº 1 aparece aqui como forma de tipo: campo que não pôde ser
 * lido sai `null`, não `false`. "Não achei" e "não tem" são coisas diferentes,
 * e só a segunda pode virar achado contra a loja.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectFromText,
  detectGateway,
  extractInstallments,
  extractMethods,
} from '../src/journey/collectPayment.ts'
import { FORBIDDEN_AUTOCOMPLETE, FORBIDDEN_BUTTON_TEXT } from '../src/platforms/shopify.checkout.selectors.ts'

const TELA_TIPICA = `
  Forma de pagamento
  Pix — 5% de desconto à vista
  Cartão de crédito  Visa Mastercard Elo
  em até 12x de R$ 49,90 sem juros
  Boleto bancário
  Cupom de desconto
  Compra segura. Seus dados são protegidos por criptografia.
  CPF
`

describe('extractMethods — meios visíveis e a ordem deles', () => {
  test('encontra os meios na ordem em que aparecem', () => {
    const methods = extractMethods(TELA_TIPICA)
    assert.deepEqual(methods.map((m) => m.label), ['Pix', 'Cartão de crédito', 'Boleto'])
    assert.deepEqual(methods.map((m) => m.position), [1, 2, 3])
  })

  test('cada meio carrega o trecho que provou', () => {
    const pix = extractMethods(TELA_TIPICA)[0]
    assert.ok(pix?.evidence.toLowerCase().includes('pix'))
  })

  test('bandeira sem a palavra cartão ainda indica cartão', () => {
    const methods = extractMethods('Aceitamos Visa e Mastercard')
    assert.equal(methods.length, 1)
    assert.equal(methods[0]?.label, 'Cartão de crédito')
    assert.match(methods[0]?.evidence ?? '', /bandeira "visa"/)
  })

  test('tela sem meio nenhum devolve lista vazia, não inventa', () => {
    assert.deepEqual(extractMethods('Obrigado pela compra'), [])
  })
})

describe('extractInstallments', () => {
  test('lê quantidade, valor por parcela e juros', () => {
    const r = extractInstallments('em até 12x de R$ 49,90 sem juros')
    assert.equal(r.present, true)
    assert.equal(r.maxCount, 12)
    assert.equal(r.perInstallmentValueShown, true)
    assert.equal(r.interestExplicit, true)
  })

  test('parcela sem valor é registrada como sem valor', () => {
    const r = extractInstallments('parcele em até 6x')
    assert.equal(r.present, true)
    assert.equal(r.maxCount, 6)
    assert.equal(r.perInstallmentValueShown, false)
  })

  test('sem menção a parcela, tudo null menos present — pode aparecer só depois do cartão', () => {
    const r = extractInstallments('Pix e boleto')
    assert.equal(r.present, false)
    assert.equal(r.maxCount, null)
    assert.equal(r.perInstallmentValueShown, null)
    assert.equal(r.interestExplicit, null)
  })

  test('pega o maior número de parcelas quando há vários', () => {
    assert.equal(extractInstallments('3x sem juros ou 10x de R$ 20,00').maxCount, 10)
  })
})

describe('collectFromText — o null que impede resultado inventado', () => {
  test('sem Pix, o desconto do Pix não vira false: fica null', () => {
    const snap = collectFromText({ text: 'Cartão de crédito e boleto', scriptHosts: [] })
    assert.equal(snap.pix.present, false)
    assert.equal(snap.pix.discountShownHere, null)
  })

  test('sem o texto da página de produto, não se afirma onde o desconto aparecia', () => {
    const snap = collectFromText({ text: TELA_TIPICA, scriptHosts: [] })
    assert.equal(snap.pix.discountShownEarlier, null)
  })

  test('com o texto do produto, compara os dois lugares', () => {
    const tarde = collectFromText({
      text: TELA_TIPICA,
      scriptHosts: [],
      productText: 'Camiseta branca. Frete grátis.',
    })
    assert.equal(tarde.pix.discountShownHere, true)
    assert.equal(tarde.pix.discountShownEarlier, false)

    const cedo = collectFromText({
      text: TELA_TIPICA,
      scriptHosts: [],
      productText: 'Camiseta branca. 5% de desconto no Pix.',
    })
    assert.equal(cedo.pix.discountShownEarlier, true)
  })

  test('lê cupom, selo, CPF', () => {
    const snap = collectFromText({ text: TELA_TIPICA, scriptHosts: [] })
    assert.equal(snap.couponField, true)
    assert.equal(snap.trustSignals.present, true)
    assert.ok(snap.trustSignals.evidence.length > 0)
    assert.equal(snap.cpfField, true)
  })
})

describe('detectGateway — §6.8', () => {
  test('reconhece gateway pelos scripts', () => {
    assert.equal(detectGateway(['js.stripe.com']), 'Stripe')
    assert.equal(detectGateway(['sdk.mercadopago.com']), 'Mercado Pago')
    assert.equal(detectGateway(['deposit.shopifycs.com']), 'Shopify Payments')
  })
  test('sem gateway reconhecível devolve null', () => {
    assert.equal(detectGateway(['www.googletagmanager.com']), null)
  })
})

describe('§2.1 — travas contra finalizar pedido', () => {
  test('reconhece os botões que nunca podem ser clicados', () => {
    for (const texto of [
      'Pagar agora',
      'Finalizar compra',
      'Finalizar pedido',
      'Concluir pedido',
      'Confirmar pagamento',
      'Pay now',
      'Complete order',
      'Place order',
    ]) {
      assert.ok(FORBIDDEN_BUTTON_TEXT.test(texto), `deveria bloquear: ${texto}`)
    }
  })

  test('não bloqueia os botões de avançar etapa', () => {
    for (const texto of ['Continuar para o pagamento', 'Continuar para entrega', 'Continue to shipping']) {
      assert.ok(!FORBIDDEN_BUTTON_TEXT.test(texto), `não deveria bloquear: ${texto}`)
    }
  })

  test('cobre todos os campos de cartão da especificação de autocomplete', () => {
    for (const campo of ['cc-number', 'cc-csc', 'cc-exp', 'cc-name']) {
      assert.ok(FORBIDDEN_AUTOCOMPLETE.includes(campo), campo)
    }
  })
})

describe('léxico sem acento — falso negativo também é resultado inventado', () => {
  test('casa mesmo quando o acento se perde no caminho', () => {
    // Loja que serve UTF-8 sem declarar charset chega assim. Sem a
    // normalização, a §6.6 diria "não oferece salvar cartão" para uma loja que
    // oferece — e falso negativo é tão ruim quanto falso positivo.
    const semAcento = 'Salvar cartao para a proxima compra. Compra segura. Cupom de desconto. CPF'
    const snap = collectFromText({ text: semAcento, scriptHosts: [] })
    assert.equal(snap.saveCard, true)
    assert.equal(snap.couponField, true)
    assert.equal(snap.trustSignals.present, true)
    assert.equal(snap.cpfField, true)
  })

  test('e continua casando com acento', () => {
    const comAcento = 'Salvar cartão. Compra segura. Cupom de desconto.'
    const snap = collectFromText({ text: comAcento, scriptHosts: [] })
    assert.equal(snap.saveCard, true)
    assert.equal(snap.couponField, true)
  })

  test('a ordem dos meios sobrevive à normalização', () => {
    const methods = extractMethods('Boleto bancario. Cartao de credito. Pix.')
    assert.deepEqual(methods.map((m) => m.label), ['Boleto', 'Cartão de crédito', 'Pix'])
  })
})
