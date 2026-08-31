/**
 * Checagens que dependem de coleta ainda não implementada nesta fase.
 *
 * Elas existem, e saem `not_applicable` dizendo exatamente o que falta. Isso é
 * melhor do que omiti-las: o relatório mostra o que NÃO foi medido, em vez de
 * dar a impressão de cobertura completa.
 */

import { fail, notApplicable, pass, type CheckRule } from '../types.ts'

/** §8: MOBILE_PARITY, alta. Exige a §6.7, que é Fase 4. */
export const mobileParity: CheckRule = {
  id: 'MOBILE_PARITY',
  title: 'Mobile com menos meios ou mais passos que desktop',
  severity: 'alta',

  evaluate(input) {
    if (!input.mobile) {
      return notApplicable('a jornada em mobile (§6.7) não roda nesta fase')
    }
    if (!input.checkout?.reachedPaymentScreen || !input.payment) {
      return notApplicable('sem a jornada desktop completa não há com o que comparar')
    }
    const desktopMeios = input.payment.methods.length
    const desktopPassos = input.checkout.stepsFromProduct
    const problemas: string[] = []
    if (input.mobile.methods < desktopMeios) {
      problemas.push(`mobile mostra ${input.mobile.methods} meios contra ${desktopMeios} no desktop`)
    }
    if (input.mobile.steps > desktopPassos) {
      problemas.push(`mobile exige ${input.mobile.steps} passos contra ${desktopPassos} no desktop`)
    }
    if (problemas.length === 0) {
      return pass([`mobile e desktop equivalentes: ${desktopMeios} meios, ${desktopPassos} passos`])
    }
    return fail(
      problemas,
      'Equipare a experiência mobile à do desktop. A maior parte do tráfego brasileiro é mobile, ' +
        'então o pior caminho costuma ser o mais usado.',
    )
  },
}

/** §8: DESCRIPTOR_UNCLEAR, média. Exige a coleta paralela da §6.8. */
export const descriptorUnclear: CheckRule = {
  id: 'DESCRIPTOR_UNCLEAR',
  title: 'Descritor de fatura ausente ou sem relação com a marca',
  severity: 'media',

  evaluate() {
    return notApplicable(
      'o descritor de fatura (§6.8) não é coletado nesta fase; ele raramente aparece no site e ' +
        'exige leitura de rodapé e termos',
    )
  },
}
