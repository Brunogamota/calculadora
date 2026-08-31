/**
 * Seletores de DOM do Shopify, isolados num arquivo só de propósito.
 *
 * Cada entrada declara de onde veio. A distinção importa e é a regra do projeto
 * (§19: "nunca aceite seletor inventado"):
 *
 *   'platform-contract' — contrato da plataforma, vale em qualquer tema.
 *                         `form[action*="/cart/add"]` é o endpoint do Shopify,
 *                         não uma escolha de tema.
 *   'aria'             — padrão ARIA do HTML, não específico de loja.
 *   'theme-convention' — convenção dos temas do Shopify (Dawn e derivados).
 *                        Pode falhar em tema customizado. NÃO é garantia.
 *
 * `verified` só vira true depois de casar contra loja real, e o motor registra
 * na trilha qual seletor casou em cada etapa. Nenhum fallback silencioso: se
 * nenhum casar, a etapa falha explicando, e o HTML é salvo para análise.
 */

export interface SelectorSpec {
  id: string
  selector: string
  source: 'platform-contract' | 'aria' | 'theme-convention'
  note: string
  verified: boolean
}

/** Formulário de adicionar ao carrinho. O action é contrato do Shopify. */
export const ADD_TO_CART_FORMS: SelectorSpec[] = [
  {
    id: 'form-cart-add',
    selector: 'form[action*="/cart/add"]',
    source: 'platform-contract',
    note: 'POST /cart/add é a rota do Shopify; todo tema envia por ela',
    verified: false,
  },
]

/** Botão de submit dentro do formulário acima. */
export const ADD_TO_CART_BUTTONS: SelectorSpec[] = [
  {
    id: 'button-name-add',
    selector: 'button[type="submit"][name="add"]',
    source: 'theme-convention',
    note: 'name="add" é a convenção dos temas oficiais (Dawn e derivados)',
    verified: false,
  },
  {
    id: 'button-submit-in-form',
    selector: 'button[type="submit"]',
    source: 'platform-contract',
    note: 'qualquer submit dentro do form de /cart/add envia o produto',
    verified: false,
  },
  {
    id: 'input-submit-in-form',
    selector: 'input[type="submit"]',
    source: 'platform-contract',
    note: 'temas antigos usam input em vez de button',
    verified: false,
  },
]

/**
 * Drawer/modal de carrinho. Só padrões ARIA — não invento classe de tema.
 * Se nada casar, o padrão de UI sai como 'unknown', nunca chutado.
 */
export const CART_OVERLAYS: SelectorSpec[] = [
  {
    id: 'aria-dialog',
    selector: '[role="dialog"]',
    source: 'aria',
    note: 'padrão ARIA para modal e drawer',
    verified: false,
  },
  {
    id: 'aria-modal',
    selector: '[aria-modal="true"]',
    source: 'aria',
    note: 'padrão ARIA para modal',
    verified: false,
  },
]

export function describeSelector(spec: SelectorSpec): string {
  return `${spec.selector} (${spec.source}${spec.verified ? ', verificado' : ', não verificado'})`
}
