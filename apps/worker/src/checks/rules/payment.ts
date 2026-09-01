/**
 * Checagens sobre a tela de pagamento (§6.6 → §8).
 *
 * Todas dependem de `payment`, que só existe se a tela foi alcançada. Sem ela,
 * `not_applicable` — nunca `fail`. Uma loja não perde nota porque o robots
 * proibiu o checkout ou porque o preenchimento não foi autorizado.
 */

import {
  fail,
  melhorFonte,
  notApplicable,
  pass,
  NOME_DA_FONTE,
  type CheckInput,
  type CheckRule,
} from '../types.ts'
import { findTerm, CARD_BRANDS, PAYMENT_METHODS } from '../../journey/vocabulary.ts'
import type { PageObservation } from '../../types.ts'

/**
 * Por que nenhuma fonte serviu.
 *
 * Antes toda checagem desta família exigia a tela de pagamento, e como
 * /checkout quase sempre é proibido pelo robots, cinco das treze checagens
 * saíam não aplicáveis em quase toda loja. Produto e carrinho medem boa parte
 * disso e quase nunca são proibidos.
 */
function semFonte(input: CheckInput, ordem: ReadonlyArray<PageObservation['source']>): string | null {
  if (melhorFonte(input, ordem)) return null
  if (input.blockedBySite) return 'a loja bloqueou a auditoria antes de qualquer página medível'
  // O motivo importa mais que o fato: "o robots proibiu" é decisão da loja e
  // não penaliza ninguém; "não foi observada" é limitação nossa. Sair com o
  // texto genérico nos dois casos apagaria a diferença no relatório.
  const nomes = ordem.map((f) => NOME_DA_FONTE[f]).join(', ')
  if (ordem.includes('checkout') && input.robotsBlockedPaths.length > 0) {
    const outras = ordem.filter((f) => f !== 'checkout')
    if (outras.length === 0) return `o robots.txt da loja proíbe ${input.robotsBlockedPaths.join(', ')}`
    return (
      `o robots.txt da loja proíbe ${input.robotsBlockedPaths.join(', ')} e nenhuma outra ` +
      `página observada serve (procurado em: ${nomes})`
    )
  }
  return `nenhuma página observada serve para esta checagem (procurado em: ${nomes})`
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
    // A fonte de comparação vem primeiro porque é ela que o robots bloqueia: se
    // faltar, o motivo é da loja, não nosso, e precisa aparecer como tal.
    const razao = semFonte(input, ['checkout', 'cart'])
    if (razao) return notApplicable(razao)

    const depois = melhorFonte(input, ['checkout', 'cart'])!
    const produto = input.observations.find((o) => o.source === 'product')
    if (!produto) return notApplicable('a página de produto não foi observada')

    const pixDepois = depois.snapshot.pix
    if (!pixDepois.present) return notApplicable('a loja não oferece Pix')
    if (pixDepois.discountShownHere !== true) {
      return notApplicable('não há desconto no Pix anunciado para comparar')
    }

    const pixNoProduto = produto.snapshot.pix
    if (pixNoProduto.present && pixNoProduto.discountShownHere === true) {
      return pass(['o desconto no Pix já aparece na página do produto'])
    }
    return fail(
      [`o desconto no Pix só aparece na ${NOME_DA_FONTE[depois.source]}, não na página do produto`],
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
    // Ordem deliberada: o parcelamento é decidido na página de produto, e é lá
    // que a falta de clareza custa a venda.
    const ordem = ['product', 'checkout', 'cart'] as const
    const razao = semFonte(input, ordem)
    if (razao) return notApplicable(razao)

    const fonte = melhorFonte(input, ordem)!
    const p = fonte.snapshot.installments
    if (!p.present) {
      // Pode não haver parcelamento, ou ele pode só aparecer depois de escolher
      // cartão. Sem distinguir os dois, não dá para afirmar nada.
      return notApplicable(
        `nenhuma menção a parcelamento na ${NOME_DA_FONTE[fonte.source]}; ` +
          'pode aparecer só depois de escolher cartão',
      )
    }
    if (p.perInstallmentValueShown === null || p.interestExplicit === null) {
      return notApplicable('não foi possível ler valor por parcela e juros com certeza')
    }
    const faltando: string[] = []
    if (!p.perInstallmentValueShown) faltando.push('valor por parcela')
    if (!p.interestExplicit) faltando.push('presença ou ausência de juros')
    if (faltando.length === 0) {
      return pass([
        `na ${NOME_DA_FONTE[fonte.source]}: parcelamento em até ${p.maxCount ?? '?'}x ` +
          `com valor e juros explícitos — "${p.rawText ?? ''}"`,
      ])
    }
    return fail(
      [`na ${NOME_DA_FONTE[fonte.source]}: parcelamento sem ${faltando.join(' e ')} — "${p.rawText ?? ''}"`],
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
    // Só faz sentido no checkout: salvar cartão não existe antes dele.
    const razao = semFonte(input, ['checkout'])
    if (razao) return notApplicable(razao)
    const fonte = melhorFonte(input, ['checkout'])!
    if (fonte.snapshot.saveCard === null) return notApplicable('não foi possível verificar')
    if (fonte.snapshot.saveCard) return pass(['a loja oferece salvar o cartão'])
    return fail(
      ['nenhuma opção de salvar cartão na tela de pagamento'],
      'Ofereça salvar o cartão. A segunda compra é onde essa opção se paga, e ela reduz atrito ' +
        'justamente com quem já confia na loja.',
    )
  },
}

/**
 * Confirma presença antes do checkout, mas nunca conclui ausência a partir dele.
 *
 * Cupom e selo de segurança moram no checkout na Shopify padrão. Achar num
 * carrinho prova que a loja oferece; NÃO achar não prova nada, porque a página
 * seguinte não foi vista. Deixar o `fail` cair para o carrinho acusaria de
 * "não tem cupom" toda loja Shopify cujo checkout o robots proíbe — exatamente
 * o resultado inventado que a §2 proíbe.
 */
function presencaAntecipavel(
  input: CheckInput,
  ler: (o: PageObservation) => boolean | null,
): { fonte: PageObservation; valor: boolean } | { razao: string } {
  const checkout = melhorFonte(input, ['checkout'])
  if (checkout) {
    const valor = ler(checkout)
    if (valor === null) return { razao: 'não foi possível verificar na tela de pagamento' }
    return { fonte: checkout, valor }
  }

  const antes = melhorFonte(input, ['cart', 'product'])
  if (antes && ler(antes) === true) return { fonte: antes, valor: true }

  const razao = semFonte(input, ['checkout'])
  if (razao) return { razao }
  return { razao: 'a tela de pagamento não foi observada' }
}

/** §8: NO_COUPON_FIELD, baixa. */
export const noCouponField: CheckRule = {
  id: 'NO_COUPON_FIELD',
  title: 'Sem campo de cupom',
  severity: 'baixa',

  evaluate(input) {
    const r = presencaAntecipavel(input, (o) => o.snapshot.couponField)
    if ('razao' in r) return notApplicable(r.razao)
    if (r.valor) return pass([`há campo de cupom na ${NOME_DA_FONTE[r.fonte.source]}`])
    return fail(
      [`nenhum campo de cupom na ${NOME_DA_FONTE[r.fonte.source]}`],
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
    const r = presencaAntecipavel(input, (o) => o.snapshot.trustSignals.present)
    if ('razao' in r) return notApplicable(r.razao)
    if (r.valor) return pass(r.fonte.snapshot.trustSignals.evidence.slice(0, 3))
    return fail(
      [`nenhuma menção a segurança na ${NOME_DA_FONTE[r.fonte.source]}`],
      'Inclua uma menção clara de segurança na tela de pagamento. É onde o comprador decide se ' +
        'entrega o cartão, e o silêncio ali pesa contra a loja.',
    )
  },
}
