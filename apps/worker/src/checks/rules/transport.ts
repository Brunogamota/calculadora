/** HTTPS em todas as etapas (§8: HTTPS_ISSUE, crítica). */

import { fail, notApplicable, pass, type CheckRule } from '../types.ts'

export const httpsIssue: CheckRule = {
  id: 'HTTPS_ISSUE',
  title: 'Alguma etapa fora de HTTPS',
  severity: 'critica',

  evaluate(input) {
    if (input.steps.length === 0) {
      return notApplicable('nenhuma etapa foi percorrida', 'jornada-parou')
    }
    const inseguras = input.steps.filter((s) => !s.httpsOk && s.outcome.status !== 'not_permitted_by_robots')
    if (inseguras.length === 0) {
      return pass([`${input.steps.length} etapa(s) percorridas, todas em HTTPS`])
    }
    return fail(
      inseguras.map((s) => `${s.label}: ${s.url}`),
      'Sirva toda a jornada em HTTPS. Navegador marca página de pagamento sem HTTPS como não segura, ' +
        'e o comprador abandona ali.',
      inseguras[0]?.screenshot ?? null,
    )
  },
}
