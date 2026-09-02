/**
 * Checagens sobre a jornada: passos, login, velocidade — e o botão coberto.
 */

import { fail, familiaDaAusencia, notApplicable, pass, razaoDoModo, type CheckRule } from '../types.ts'

/** §8: STEP_COUNT, alta. Mais de 5 passos do produto ao pagamento. */
export const stepCount: CheckRule = {
  id: 'STEP_COUNT',
  title: 'Mais de 5 passos do produto ao pagamento',
  severity: 'alta',

  evaluate(input) {
    if (!input.checkout || !input.checkout.reachedPaymentScreen) {
      return notApplicable(
        razaoDoModo(input, ['checkout']) ?? 'a tela de pagamento não foi alcançada, então não há como contar os passos',
        familiaDaAusencia(input, ['checkout']),
      )
    }
    const passos = input.checkout.stepsFromProduct
    const cliques = input.checkout.clicksFromProduct
    if (passos <= 5) {
      return pass([`${passos} passo(s) e ${cliques} clique(s) do produto ao pagamento`])
    }
    return fail(
      [`${passos} passos e ${cliques} cliques do produto ao pagamento`],
      'Reduza a distância entre o produto e o pagamento. Cada passo a mais derruba a conversão, ' +
        'e acima de cinco a queda é acentuada.',
    )
  },
}

/** §8: FORCED_LOGIN, alta. */
export const forcedLogin: CheckRule = {
  id: 'FORCED_LOGIN',
  title: 'Login obrigatório antes do checkout',
  severity: 'alta',

  evaluate(input) {
    if (!input.checkout) {
      return notApplicable(
        razaoDoModo(input, ['checkout']) ?? 'o checkout não foi alcançado',
        familiaDaAusencia(input, ['checkout']),
      )
    }
    if (input.checkout.forcedLogin === null) {
      return notApplicable('não foi possível determinar com certeza se há parede de login')
    }
    if (input.checkout.forcedLogin === false) {
      return pass(['o checkout permite comprar sem conta'])
    }
    return fail(
      ['a loja pede login e não oferece caminho de visitante'],
      'Ofereça checkout como visitante. Exigir cadastro antes de pagar é um dos maiores ' +
        'causadores de abandono no carrinho.',
      input.checkout.trail.find((s) => s.id === 'reach-checkout')?.screenshot ?? null,
    )
  },
}

/** §8: CHECKOUT_SPEED, média. Acima de 3s. */
export const checkoutSpeed: CheckRule = {
  id: 'CHECKOUT_SPEED',
  title: 'Checkout carregando acima de 3s',
  severity: 'media',

  evaluate(input) {
    const ms = input.checkout?.loadMs.checkout ?? null
    if (ms === null) {
      return notApplicable(
        razaoDoModo(input, ['checkout']) ?? 'o tempo de carregamento do checkout não foi medido',
        familiaDaAusencia(input, ['checkout']),
      )
    }
    // Medir de fora do Brasil infla o número por latência de rede, e penalizar
    // a loja por isso seria acusá-la de um problema do nosso ponto de observação.
    if (input.auditedFromBrazil !== true) {
      return notApplicable(
        `checkout carregou em ${ms}ms, mas a auditoria não saiu de IP brasileiro: ` +
          'o número inclui latência que o comprador da loja não tem',
      )
    }
    if (ms <= 3000) {
      return pass([`checkout carregou em ${ms}ms`])
    }
    return fail(
      [`checkout carregou em ${ms}ms, medido do Brasil`],
      'Acelere o checkout. Acima de três segundos a desistência cresce rápido, e é a tela ' +
        'onde a venda já estava praticamente feita.',
    )
  },
}

/**
 * FORA DA TABELA DA §8.
 *
 * Apareceu na Insider Store: um modal cobrindo o botão de comprar, com o clique
 * do Playwright estourando 15s. É o achado mais concreto que os testes contra
 * loja real produziram — mas não está na §8, então fica marcado para poder ser
 * vetado sem procurar.
 *
 * Nunca dispara quando o overlay é provável artefato do ponto de observação.
 */
export const buyButtonObscured: CheckRule = {
  id: 'BUY_BUTTON_OBSCURED',
  title: 'Botão de comprar coberto por sobreposição',
  severity: 'alta',
  beyondSpec: true,

  evaluate(input) {
    const overlay = input.cart?.overlay
    if (!overlay) {
      return notApplicable(
        razaoDoModo(input, ['cart']) ?? 'a etapa de carrinho não rodou',
        familiaDaAusencia(input, ['cart']),
      )
    }
    if (!overlay.present) {
      return pass(['nada cobria o botão de comprar'])
    }
    if (overlay.likelyAuditArtifact) {
      return notApplicable(
        `sobreposição "${overlay.kind}" provavelmente só apareceu porque a auditoria não saiu ` +
          'de IP brasileiro; o comprador da loja não a vê',
      )
    }
    if (overlay.dismissed) {
      return pass([
        `sobreposição "${overlay.kind}" cobria o botão, mas fechou em ${overlay.dismissAttempts.length} tentativa(s)`,
      ])
    }
    return fail(
      [
        `sobreposição "${overlay.kind}" cobre o botão de comprar: ${overlay.identity ?? 'elemento não identificado'}`,
        overlay.text ? `texto: "${overlay.text.slice(0, 120)}"` : 'sem texto legível',
        `tentativas de fechar: ${overlay.dismissAttempts.join(', ') || 'nenhuma'}`,
        overlay.clickRequiredForce
          ? 'só foi possível comprar ignorando a sobreposição — um comprador não conseguiria'
          : '',
      ].filter(Boolean),
      'Garanta que nada cubra o botão de comprar. Modal que não fecha em cima do botão ' +
        'impede a compra por completo.',
      input.steps.find((s) => s.id === 'add-to-cart')?.screenshot ?? null,
    )
  },
}
