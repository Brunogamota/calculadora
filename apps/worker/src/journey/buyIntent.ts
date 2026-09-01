/**
 * Reconhecer o botão de comprar pelo TEXTO — o ÚLTIMO recurso, depois de a
 * API da plataforma, o formulário e os atributos terem falhado.
 *
 * A regra que este arquivo aprendeu: lista fechada de rótulos não fecha.
 * Ele começou com frases inteiras ("adicionar ao carrinho", "quero alugar")
 * comparadas por início de texto, e cada loja nova pedia mais uma frase. Loja
 * brasileira escreve "ADICIONE À SACOLA", "Comprar agora", "Colocar na
 * cestinha", "EU QUERO!", e a lista nunca alcança. Manter aquilo era assinar
 * uma dívida que crescia a cada cliente.
 *
 * Agora são RADICAIS procurados em qualquer posição do rótulo: "compr" pega
 * comprar, compre, comprando; "adicion" pega adicionar, adicione, adicionando.
 * O que decide não é a frase exata, é a intenção que o radical carrega.
 *
 * O caso difícil continua sendo o mesmo, e é por isso que a EXCLUSÃO vem
 * primeiro: na Circulei, "FICOU COM DÚVIDA? CLIQUE AQUI E FALE COM A NINA"
 * convive com o botão de alugar na mesma página, e clicar nele leva a jornada
 * para uma conversa de WhatsApp. Radical solto sem exclusão erraria mais que a
 * lista fechada, não menos.
 */

import { fold } from './vocabulary.ts'

/**
 * O que NUNCA é botão de comprar, mesmo contendo um radical de intenção.
 * Avaliado primeiro: um falso positivo aqui clica no lugar errado e leva a
 * jornada para uma página que não é a que a auditoria mede.
 */
const NAO_E_COMPRA = [
  'fale com',
  'falar com',
  'duvida',
  'saiba mais',
  'saber mais',
  'ver mais',
  'como funciona',
  'continuar comprando',
  'seguir comprando',
  'continuar a comprar',
  'ver carrinho',
  'meu carrinho',
  'ver sacola',
  'minha sacola',
  'finalizar compra',
  'finalizar pedido',
  'fechar pedido',
  'ir para o checkout',
  'checkout',
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
  // A lista de desejos e a comparação contêm "adicionar" e não são compra.
  'lista de desejos',
  'lista de favoritos',
  'favorito',
  'wishlist',
  'comparar',
  'compare',
  'presente',
  // Cupom e frete têm botão de "adicionar"/"calcular" perto do preço.
  'cupom',
  'calcular frete',
  'calcular',
  /* "adicional" é adjetivo e começa igual ao verbo: "Frete adicional" casava
     com o radical `adicion`. A exclusão roda antes, então resolve — e nenhum
     botão de comprar de verdade traz a palavra. */
  'adicional',
]

/**
 * Radicais de intenção de aquisição, do mais específico para o mais genérico.
 *
 * `curto: true` marca radical que também vive dentro de outra palavra —
 * "add" está em "adicional" e em "address", "bag" em "baggage". Esses exigem
 * fronteira de palavra; os longos não precisam.
 */
const RADICAIS: ReadonlyArray<{ radical: string; curto?: boolean }> = [
  { radical: 'adicionar ao carrinho' },
  { radical: 'adicionar a sacola' },
  { radical: 'add to cart' },
  { radical: 'add to bag' },
  { radical: 'colocar no carrinho' },
  { radical: 'por no carrinho' },
  { radical: 'carrinho' },
  { radical: 'sacola' },
  { radical: 'cestinha' },
  { radical: 'cesta' },
  { radical: 'bolsa' },
  { radical: 'compr' },
  { radical: 'adicion' },
  { radical: 'alug' },
  { radical: 'assin' },
  { radical: 'reserv' },
  { radical: 'contrat' },
  { radical: 'pedir' },
  { radical: 'levar' },
  { radical: 'quero' },
  { radical: 'cart', curto: true },
  { radical: 'bag', curto: true },
  { radical: 'add', curto: true },
]

export interface BuyIntentMatch {
  /** Texto observado no botão, como evidência. */
  label: string
  /** Radical que casou — o relatório diz por que aquele botão foi escolhido. */
  term: string
  /**
   * Quanto o casamento é específico: 0 é o mais específico da lista.
   * Serve para escolher ENTRE candidatos. Com radical solto, uma frase como
   * "Você pode comprar depois" também casa — e casar não é o mesmo que ser
   * escolhida: quem procura compara todos e fica com o melhor.
   */
  rank: number
}

/** Radical curto só vale como palavra inteira, não como pedaço de outra. */
function contemRadical(texto: string, radical: string, curto: boolean): boolean {
  if (!curto) return texto.includes(radical)
  return new RegExp(`(^|[^a-z0-9])${radical}([^a-z0-9]|$)`).test(texto)
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
  // Rótulo de botão é curto. Seis palavras já é frase, não botão.
  if (label.split(' ').length > 6) return null

  const normalizado = fold(label)

  // Exclusão primeiro: clicar no botão errado leva a jornada para outra página.
  for (const proibido of NAO_E_COMPRA) {
    if (normalizado.includes(proibido)) return null
  }

  for (let i = 0; i < RADICAIS.length; i++) {
    const { radical, curto } = RADICAIS[i] as { radical: string; curto?: boolean }
    if (contemRadical(normalizado, radical, curto === true)) return { label, term: radical, rank: i }
  }

  return null
}

/**
 * Entre vários rótulos que casam, qual é mais provável de ser O botão.
 *
 * Menor é melhor. Primeiro a especificidade do radical: "adicionar ao
 * carrinho" ganha de "compr" solto. No empate, o rótulo mais curto: botão diz
 * "Comprar", frase diz "Você pode comprar depois".
 */
export function melhorQue(a: BuyIntentMatch, b: BuyIntentMatch): boolean {
  if (a.rank !== b.rank) return a.rank < b.rank
  return a.label.length < b.label.length
}

/** Léxico exposto para teste e para o relatório poder dizer o que foi procurado. */
export const BUY_INTENT_TERMS: ReadonlyArray<string> = RADICAIS.map((r) => r.radical)
export const NOT_BUY_TERMS: ReadonlyArray<string> = NAO_E_COMPRA
