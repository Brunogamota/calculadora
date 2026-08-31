/**
 * Léxico de pagamento brasileiro.
 *
 * A coleta da §6.6 trabalha sobre o TEXTO VISÍVEL da tela, não sobre seletor de
 * tema. Motivo: o checkout do Shopify é montado pelo Shopify, mas apps de
 * pagamento brasileiros injetam blocos próprios, cada um com sua marcação. O
 * texto que o comprador lê é o que existe em todos.
 *
 * Toda detecção devolve o trecho que casou, para o relatório mostrar a
 * evidência em vez de pedir confiança.
 */

export interface LexiconHit {
  term: string
  /** Trecho real do texto onde o termo apareceu. */
  excerpt: string
  index: number
}

/** Meios de pagamento e bandeiras, em ordem de especificidade. */
export const PAYMENT_METHODS: Array<{ label: string; terms: string[] }> = [
  { label: 'Pix', terms: ['pix'] },
  { label: 'Boleto', terms: ['boleto'] },
  { label: 'Cartão de crédito', terms: ['cartão de crédito', 'cartao de credito', 'credit card'] },
  { label: 'Cartão de débito', terms: ['cartão de débito', 'cartao de debito', 'debit card'] },
  { label: 'Google Pay', terms: ['google pay', 'gpay'] },
  { label: 'Apple Pay', terms: ['apple pay'] },
  { label: 'PayPal', terms: ['paypal'] },
  { label: 'Shop Pay', terms: ['shop pay', 'shoppay'] },
  { label: 'Mercado Pago', terms: ['mercado pago', 'mercadopago'] },
  { label: 'PicPay', terms: ['picpay'] },
  { label: 'Ame', terms: ['ame digital'] },
  { label: 'PagBank', terms: ['pagbank', 'pagseguro'] },
]

export const CARD_BRANDS = [
  'visa',
  'mastercard',
  'master',
  'elo',
  'american express',
  'amex',
  'hipercard',
  'diners',
  'discover',
  'aura',
  'jcb',
]

export const COUPON_TERMS = ['cupom', 'código de desconto', 'codigo de desconto', 'discount code', 'gift card']

export const TRUST_TERMS = [
  'compra segura',
  'site seguro',
  'ambiente seguro',
  'pagamento seguro',
  'conexão segura',
  'criptografia',
  'ssl',
  'protegido',
  'secure checkout',
]

export const SAVE_CARD_TERMS = [
  'salvar cartão',
  'salvar este cartão',
  'salvar meus dados',
  'guardar cartão',
  'save my information',
  'save this card',
  'lembrar de mim',
]

export const CPF_TERMS = ['cpf', 'cpf/cnpj', 'documento', 'identification number']

export const INTEREST_TERMS = ['sem juros', 'com juros', 'juros de', 'acréscimo', 'a.m.', 'ao mês']

/** "12x de R$ 99,90" / "10 x R$ 50,00" / "3x sem juros". */
export const INSTALLMENT_PATTERN = /(\d{1,2})\s*x\s*(?:de\s*)?(?:R\$\s*([\d.,]+))?/gi

/**
 * Minúsculas e SEM acento.
 *
 * O léxico é quase todo em português, e depender de acento bater exatamente
 * cria falso negativo silencioso: loja que serve UTF-8 sem declarar charset
 * chega com o texto mexido, "salvar cartão" não casa, e a §6.6 diz "não
 * oferece salvar cartão" para uma loja que oferece. Falso negativo é tão ruim
 * quanto falso positivo — os dois são resultado inventado.
 *
 * A normalização preserva o comprimento em quase todos os casos (NFD separa o
 * diacrítico como caractere próprio, que é removido), então os índices
 * continuam servindo para ordenar os achados.
 */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function findTerm(haystack: string, terms: string[]): LexiconHit | null {
  const lower = fold(haystack)
  for (const term of terms) {
    const index = lower.indexOf(fold(term))
    if (index === -1) continue
    return {
      term,
      excerpt: haystack.slice(Math.max(0, index - 40), index + term.length + 60).replace(/\s+/g, ' ').trim(),
      index,
    }
  }
  return null
}

export function findAllTerms(haystack: string, terms: string[]): LexiconHit[] {
  const out: LexiconHit[] = []
  for (const term of terms) {
    const hit = findTerm(haystack, [term])
    if (hit) out.push(hit)
  }
  return out.sort((a, b) => a.index - b.index)
}
