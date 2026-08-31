/**
 * Campos do checkout do Shopify.
 *
 * A busca é feita em três estratégias, nesta ordem — da mais estável para a
 * menos:
 *
 *   1. `autocomplete` — atributo PADRÃO da web (WHATWG). `autocomplete="email"`,
 *      `"given-name"`, `"postal-code"`. Não é convenção de tema nem do Shopify:
 *      é especificação, e existe justamente para preenchimento automático.
 *   2. rótulo visível — acha o campo pelo texto que o comprador lê, que é como
 *      uma pessoa preencheria. Sobrevive a mudança de marcação.
 *   3. atributo `name` — convenção do Shopify. Menos estável que as anteriores.
 *
 * TODAS as entradas estão `verified: false`: nenhuma foi confirmada contra um
 * checkout real, porque as lojas testadas proíbem /checkout no robots.txt. O
 * motor registra qual estratégia casou em cada campo, e salva o HTML quando
 * nenhuma casa — é assim que isto vira verificado, com evidência.
 */

export interface FieldFinder {
  id: string
  /** Valor do atributo autocomplete (WHATWG). */
  autocomplete?: string
  /** Regex para o rótulo visível. */
  label?: RegExp
  /** Seletores CSS de último recurso. */
  css?: string[]
  /** Campo cuja ausência não impede a jornada. */
  optional: boolean
  verified: boolean
}

export const CHECKOUT_FIELDS: Record<string, FieldFinder> = {
  email: {
    id: 'email',
    autocomplete: 'email',
    label: /e-?mail/i,
    css: ['input[name="email"]', 'input[type="email"]'],
    optional: false,
    verified: false,
  },
  firstName: {
    id: 'firstName',
    autocomplete: 'given-name',
    label: /^nome|first name/i,
    css: ['input[name="firstName"]'],
    optional: false,
    verified: false,
  },
  lastName: {
    id: 'lastName',
    autocomplete: 'family-name',
    label: /sobrenome|last name/i,
    css: ['input[name="lastName"]'],
    optional: false,
    verified: false,
  },
  address1: {
    id: 'address1',
    autocomplete: 'address-line1',
    label: /endereço|endereco|address/i,
    css: ['input[name="address1"]'],
    optional: false,
    verified: false,
  },
  addressNumber: {
    id: 'addressNumber',
    autocomplete: 'address-line2',
    label: /número|numero/i,
    css: ['input[name="address2"]'],
    optional: true,
    verified: false,
  },
  postalCode: {
    id: 'postalCode',
    autocomplete: 'postal-code',
    label: /cep|postal/i,
    css: ['input[name="postalCode"]'],
    optional: false,
    verified: false,
  },
  city: {
    id: 'city',
    autocomplete: 'address-level2',
    label: /cidade|city/i,
    css: ['input[name="city"]'],
    optional: true,
    verified: false,
  },
  phone: {
    id: 'phone',
    autocomplete: 'tel',
    label: /telefone|celular|phone/i,
    css: ['input[name="phone"]', 'input[type="tel"]'],
    optional: true,
    verified: false,
  },
  cpf: {
    id: 'cpf',
    // Não há autocomplete padrão para CPF; só rótulo mesmo.
    label: /cpf|documento/i,
    optional: true,
    verified: false,
  },
}

/** Botões de avançar etapa. NUNCA de concluir pedido — ver FORBIDDEN abaixo. */
export const CONTINUE_LABELS =
  /continuar para (o )?(pagamento|entrega|envio)|ir para (o )?pagamento|continue to (payment|shipping)|continuar/i

/**
 * TRAVA DA §2.1 — nunca finalizar pedido, nunca submeter dado de pagamento.
 *
 * Não é comentário de aviso: é lista consultada antes de todo clique e todo
 * preenchimento. Bate aqui, o motor para.
 */
export const FORBIDDEN_BUTTON_TEXT =
  /pagar agora|finalizar (compra|pedido)|concluir (pedido|compra)|confirmar (pedido|pagamento)|pay now|complete order|place order|submit payment/i

/** Campos de cartão, pela especificação de autocomplete. Nunca preenchidos. */
export const FORBIDDEN_AUTOCOMPLETE = [
  'cc-number',
  'cc-name',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
]
