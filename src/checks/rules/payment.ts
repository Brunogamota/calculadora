/**
 * Checagens sobre a tela de pagamento (§6.6 → §8).
 *
 * Todas dependem de `payment`, que só existe se a tela foi alcançada. Sem ela,
 * `not_applicable` — nunca `fail`. Uma loja não perde nota porque o robots
 * proibiu o checkout ou porque o preenchimento não foi autorizado.
 */

import { fail, notApplicable, pass, type CheckInput, type CheckRule } from '../types.ts'
import { findTerm, CARD_BRANDS, PAYMENT_METHODS } from '../../journey/vocabulary.ts'

function semTelaDePagamento(input: CheckInput): string | null {
  if (input.blockedBySite) return 'a loja bloqueou a auditoria antes da tela de pagamento'
  if (input.robotsBlockedPaths.includes('/checkout')) {
    return 'robots.txt proíbe /checkout e não houve titularidade confirmada'
  }
  if (!input.payment) return 'a tela de meios de pagamento não foi alcançada'
  return null
}

/** §8: PAY_VISIBILITY, alta. Meios só aparecem depois do carrinho. */
export const payVisibility: CheckRule = {
  id: 'PAY_VISIBILITY',
  title: 'Meios de pagamento só aparecem depois do carrinho',
  severity: 'alta',

  evaluate(input) {
    if (input.productText === null) {
      return notApplicable('o texto da página de produto não foi capturado')
    }
    const vocabulario = [...PAYMENT_METHODS.flatMap((m) => m.terms), ...CARD_BRANDS]
    const naPagina = findTerm(input.productText, vocabulario)
    if (naPagina) {
      return pass([`a página de produto já menciona meios de pagamento: "${naPagina.excerpt}"`])
    }
    return fail(
      ['nenhum meio de pagamento é mencionado na página do produto'],
      'Mostre os meios de pagamento já na página do produto. Quem não sabe se pode pagar no Pix ' +
        'ou parcelar decide antes mesmo de ir ao carrinho.',
      input.steps.find((s) => s.id === 'add-to-cart')?.screenshot ?? null,
    )
  },
}

/** §8: PIX_DISCOUNT_LATE, alta. */
export const pixDiscountLate: CheckRule = {
  id: 'PIX_DISCOUNT_LATE',
  title: 'Desconto no Pix só revelado no checkout',
  severity: 'alta',

  evaluate(input) {
    const razao = semTelaDePagamento(input)
    if (razao) return notApplicable(razao)

    const pix = input.payment!.pix
    if (!pix.present) return notApplicable('a loja não oferece Pix')
    if (pix.discountShownHere !== true) return notApplicable('não há desconto no Pix para comparar')
    if (pix.discountShownEarlier === null) {
      return notApplicable('não foi possível verificar a página de produto para comparar')
    }
    if (pix.discountShownEarlier) {
      return pass(['o desconto no Pix já aparece na página do produto'])
    }
    return fail(
      ['o desconto no Pix só aparece no checkout, não na página do produto'],
      'Anuncie o desconto do Pix na página do produto. Revelar só no fim desperdiça o argumento ' +
        'de compra bem no momento em que ele decidiria a venda.',
    )
  },
}

/** §8: INSTALLMENT_UNCLEAR, alta. */
export const installmentUnclear: CheckRule = {
  id: 'INSTALLMENT_UNCLEAR',
  title: 'Parcelamento sem valor por parcela ou sem juros explícito',
  severity: 'alta',

  evaluate(input) {
    const razao = semTelaDePagamento(input)
    if (razao) return notApplicable(razao)

    const p = input.payment!.installments
    if (!p.present) {
      // Pode não haver parcelamento, ou ele pode só aparecer depois de escolher
      // cartão. Sem distinguir os dois, não dá para afirmar nada.
      return notApplicable('nenhuma menção a parcelamento na tela; pode aparecer só após escolher cartão')
    }
    if (p.perInstallmentValueShown === null || p.interestExplicit === null) {
      return notApplicable('não foi possível ler valor por parcela e juros com certeza')
    }
    const faltando: string[] = []
    if (!p.perInstallmentValueShown) faltando.push('valor por parcela')
    if (!p.interestExplicit) faltando.push('presença ou ausência de juros')
    if (faltando.length === 0) {
      return pass([`parcelamento em até ${p.maxCount ?? '?'}x com valor e juros explícitos: "${p.rawText ?? ''}"`])
    }
    return fail(
      [`parcelamento mostrado sem ${faltando.join(' e ')}: "${p.rawText ?? ''}"`],
      'Mostre o valor de cada parcela e diga se há juros. Parcelamento ambíguo faz o comprador ' +
        'desconfiar do preço final e abandonar.',
    )
  },
}

/** §8: NO_SAVED_CARD, média. */
export const noSavedCard: CheckRule = {
  id: 'NO_SAVED_CARD',
  title: 'Não oferece salvar cartão',
  severity: 'media',

  evaluate(input) {
    const razao = semTelaDePagamento(input)
    if (razao) return notApplicable(razao)
    if (input.payment!.saveCard === null) return notApplicable('não foi possível verificar')
    if (input.payment!.saveCard) return pass(['a loja oferece salvar o cartão'])
    return fail(
      ['nenhuma opção de salvar cartão na tela de pagamento'],
      'Ofereça salvar o cartão. A segunda compra é onde essa opção se paga, e ela reduz atrito ' +
        'justamente com quem já confia na loja.',
    )
  },
}

/** §8: NO_COUPON_FIELD, baixa. */
export const noCouponField: CheckRule = {
  id: 'NO_COUPON_FIELD',
  title: 'Sem campo de cupom',
  severity: 'baixa',

  evaluate(input) {
    const razao = semTelaDePagamento(input)
    if (razao) return notApplicable(razao)
    if (input.payment!.couponField === null) return notApplicable('não foi possível verificar')
    if (input.payment!.couponField) return pass(['há campo de cupom no checkout'])
    return fail(
      ['nenhum campo de cupom na tela de pagamento'],
      'Ofereça campo de cupom. Quem tem um código e não acha onde usar sai da página para procurar ' +
        'e muitas vezes não volta.',
    )
  },
}

/** §8: NO_TRUST_SIGNAL, baixa. */
export const noTrustSignal: CheckRule = {
  id: 'NO_TRUST_SIGNAL',
  title: 'Sem selo ou menção de segurança',
  severity: 'baixa',

  evaluate(input) {
    const razao = semTelaDePagamento(input)
    if (razao) return notApplicable(razao)
    const trust = input.payment!.trustSignals
    if (trust.present === null) return notApplicable('não foi possível verificar')
    if (trust.present) return pass(trust.evidence.slice(0, 3))
    return fail(
      ['nenhuma menção a segurança na tela de pagamento'],
      'Inclua uma menção clara de segurança na tela de pagamento. É onde o comprador decide se ' +
        'entrega o cartão, e o silêncio ali pesa contra a loja.',
    )
  },
}
