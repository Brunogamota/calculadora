/**
 * Reconhecer o botão de comprar pelo TEXTO, quando a estrutura não basta.
 *
 * Observado na Circulei (circulei.co, loja de aluguel de roupas em Shopify): o
 * botão diz "QUERO ALUGAR". Não é "adicionar ao carrinho", não é `type=submit`,
 * e a jornada parou dizendo que não achou botão dentro do formulário.
 *
 * A lição é que o rótulo varia com o MODELO DE NEGÓCIO, não só com o tema:
 * aluguel diz alugar, assinatura diz assinar, marketplace diz reservar. Nenhum
 * seletor estrutural cobre isso, e inventar um seletor por loja não escala.
 *
 * O caso difícil está na mesma página: "FICOU COM DÚVIDA? CLIQUE AQUI E FALE
 * COM A NINA" começa parecido com intenção de compra e NÃO pode ser clicado.
 * Por isso a lista de exclusão vem antes da de inclusão.
 */

import { fold } from './vocabulary.ts'

/**
 * O que NUNCA é botão de comprar, mesmo contendo um verbo de intenção.
 * Avaliado primeiro: um falso positivo aqui clica no lugar errado e leva a
 * jornada para uma página que não é a que a auditoria mede.
 */
const NAO_E_COMPRA = [
  'fale com',
  'falar com',
  'duvida',
  'ficou com duvida',
  'saiba mais',
  'saber mais',
  'ver mais',
  'como funciona',
  'continuar comprando',
  'seguir comprando',
  'ver carrinho',
  'meu carrinho',
  'finalizar compra',
  'finalizar pedido',
  'ir para o checkout',
  'entrar',
  'criar conta',
  'buscar',
  'pesquisar',
  'filtrar',
  'newsletter',
  'aceitar',
  'fechar',
  'avise-me',
  'avise me',
  'me avise',
  'notifique',
  'esgotado',
  'indisponivel',
  'lista de espera',
]

/**
 * Verbos de intenção de aquisição, em ordem de especificidade.
 *
 * Precisam aparecer no INÍCIO do rótulo: "quero alugar" é botão, "quero saber
 * mais" não é, e as duas começam com a mesma palavra.
 */
const INTENCAO_DE_COMPRA = [
  'adicionar ao carrinho',
  'adicionar a sacola',
  'adicionar a bolsa',
  'adicionar',
  'add to cart',
  'add to bag',
  'comprar agora',
  'comprar',
  'quero alugar',
  'quero comprar',
  'quero esse',
  'quero essa',
  'quero este',
  'quero esta',
  'eu quero',
  'alugar agora',
  'alugar',
  'reservar',
  'assinar agora',
  'assinar',
  'contratar',
  'pedir agora',
  'colocar no carrinho',
  'por no carrinho',
  'levar',
]

export interface BuyIntentMatch {
  /** Texto observado no botão, como evidência. */
  label: string
  /** Termo do léxico que casou. */
  term: string
}

/**
 * Decide se o rótulo de um elemento indica intenção de comprar/alugar/assinar.
 * Devolve `null` quando não dá para afirmar — e "não dá para afirmar" inclui
 * rótulo vazio, que é o caso de botão só com ícone.
 */
export function matchBuyIntent(rawLabel: string | null | undefined): BuyIntentMatch | null {
  if (!rawLabel) return null

  const label = rawLabel.replace(/\s+/g, ' ').trim()
  if (label.length === 0 || label.length > 60) return null

  const normalizado = fold(label)

  // Exclusão primeiro: clicar no botão errado leva a jornada para outra página.
  for (const proibido of NAO_E_COMPRA) {
    if (normalizado.includes(proibido)) return null
  }

  for (const termo of INTENCAO_DE_COMPRA) {
    // Início do rótulo: "quero alugar" é botão, "quero saber mais" não é.
    if (normalizado.startsWith(termo)) return { label, term: termo }
  }

  return null
}

/** Léxico exposto para teste e para o relatório poder dizer o que foi procurado. */
export const BUY_INTENT_TERMS: ReadonlyArray<string> = INTENCAO_DE_COMPRA
export const NOT_BUY_TERMS: ReadonlyArray<string> = NAO_E_COMPRA
