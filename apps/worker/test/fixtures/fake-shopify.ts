/**
 * Loja falsa com o formato do Shopify, para exercitar a jornada inteira de
 * forma determinística.
 *
 * NÃO substitui teste contra loja real: ela responde o que eu espero, e é
 * exatamente por isso que ela não prova que uma loja real responde igual.
 * O que ela prova é que o CÓDIGO da jornada funciona quando a loja se comporta
 * conforme o contrato público do Shopify — e é essa classe de bug (corrida de
 * DOM, sessão de carrinho, parsing) que vinha aparecendo uma por vez.
 *
 * A marcação da página de produto segue o contrato do Shopify e a convenção dos
 * temas oficiais: form[action="/cart/add"] com button[name="add"].
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeStoreOptions {
  /** Simula o modal que cobre o botão de comprar. */
  overlay?: 'none' | 'geo-redirect' | 'consent'
  /** Atrasa a injeção do formulário, para exercitar a espera do DOM. */
  formDelayMs?: number
  /** robots.txt proíbe /checkout. */
  blockCheckout?: boolean
  /** Responde desafio antibot na página de produto. */
  botChallenge?: boolean
  /** Catálogo inclui produto de teste a R$ 0. */
  includeZeroPriceProduct?: boolean
  /**
   * Como o botão de comprar é construído.
   *
   * 'aluguel' reproduz a Circulei (circulei.co): loja de aluguel em Shopify
   * onde o botão diz "QUERO ALUGAR", NÃO é submit, e a página ainda tem um
   * "FALE COM A NINA" que começa parecido e não pode ser clicado.
   */
  buyButton?: 'submit' | 'aluguel'
}

const PRODUCTS = [
  { handle: 'camiseta-basica', title: 'Camiseta Básica', price: '89.90', id: 111, available: true },
  { handle: 'tenis-corrida', title: 'Tênis de Corrida', price: '349.90', id: 222, available: true },
  { handle: 'meia-esgotada', title: 'Meia Esgotada', price: '19.90', id: 333, available: false },
]

function productsJson(includeZero: boolean): string {
  const list = PRODUCTS.map((p) => ({
    handle: p.handle,
    title: p.title,
    product_type: 'Vestuário',
    options: [{ name: 'Title', values: ['Default Title'] }],
    variants: [{ id: p.id, title: 'Default Title', available: p.available, price: p.price }],
  }))
  if (includeZero) {
    list.unshift({
      handle: 'teste-de-valor-0',
      title: 'Teste de valor 0',
      product_type: 'Teste',
      options: [{ name: 'Title', values: ['Default Title'] }],
      variants: [{ id: 999, title: 'Default Title', available: true, price: '0.00' }],
    })
  }
  return JSON.stringify({ products: list })
}

const OVERLAY_HTML: Record<string, string> = {
  'geo-redirect': `
    <div id="geoModal" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6)">
      <style>#geoModal p{color:#fff}</style>
      <p>Dear customer. We have a dedicated store to serve your region. Would you like to go there?</p>
      <button type="button">Yes</button>
    </div>`,
  consent: `
    <div id="cookieBar" role="dialog" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6)">
      <p>Usamos cookies para melhorar sua experiência.</p>
      <button type="button" aria-label="Fechar">Aceitar</button>
    </div>`,
}

function productPage(handle: string, options: FakeStoreOptions): string {
  const product = PRODUCTS.find((p) => p.handle === handle)
  if (!product) return '<html><body><h1>404</h1></body></html>'

  // O caso da Circulei: formulário existe, mas o botão não é submit e o rótulo
  // vem do modelo de negócio ("QUERO ALUGAR", não "adicionar ao carrinho").
  const form =
    options.buyButton === 'aluguel'
      ? `
    <form action="/cart/add" method="post" id="product-form">
      <input type="hidden" name="id" value="${product.id}">
      <button type="button" id="alugar" class="btn-rent">QUERO ALUGAR</button>
    </form>
    <a href="https://wa.me/5511999999999" class="btn-help">
      FICOU COM DÚVIDA? CLIQUE AQUI E FALE COM A NINA
    </a>
    <script>
      document.getElementById('alugar').addEventListener('click', async function () {
        await fetch('/cart/add', { method: 'POST' })
        location.href = '/cart'
      })
    </script>`
      : `
    <form action="/cart/add" method="post" id="product-form">
      <input type="hidden" name="id" value="${product.id}">
      <button type="submit" name="add" class="product-form__submit">Adicionar ao carrinho</button>
    </form>`

  // Formulário injetado depois exercita a espera do DOM: com `count()` em vez
  // de `waitFor`, este caso falha — foi o bug real da Insider Store.
  const body =
    options.formDelayMs && options.formDelayMs > 0
      ? `<div id="slot"></div>
         <script>
           setTimeout(function () {
             document.getElementById('slot').innerHTML = ${JSON.stringify(form)}
           }, ${options.formDelayMs})
         </script>`
      : form

  return `<!doctype html><html lang="pt-BR"><head>
    <title>${product.title}</title>
    <!-- assets em cdn.shopify.com; referência em comentário para não disparar
         requisição externa de verdade durante o teste -->
    <script>window.Shopify = { shop: 'falsa.myshopify.com', theme: { name: 'Dawn' } };</script>
  </head><body>
    <h1>${product.title}</h1>
    <p>R$ ${product.price} — em até 10x de R$ ${(Number(product.price) / 10).toFixed(2)} sem juros</p>
    ${body}
    ${OVERLAY_HTML[options.overlay ?? 'none'] ?? ''}
  </body></html>`
}

const CHALLENGE_PAGE = `<!doctype html><html><head><title>Just a moment...</title>
<script>window._cf_chl_opt={cvId:'3'};</script>
<!-- challenges.cloudflare.com/turnstile/v0/api.js -->
</head><body><div id="challenge-running">Verificando…</div></body></html>`

const CHECKOUT_PAGE = `<!doctype html><html lang="pt-BR"><head><title>Checkout</title></head><body>
  <h1>Finalizar pedido</h1>
  <form id="checkout">
    <label for="email">E-mail</label><input id="email" name="email" autocomplete="email">
    <label for="fn">Nome</label><input id="fn" name="firstName" autocomplete="given-name">
    <label for="ln">Sobrenome</label><input id="ln" name="lastName" autocomplete="family-name">
    <label for="cpf">CPF</label><input id="cpf" name="cpf">
    <label for="cep">CEP</label><input id="cep" name="postalCode" autocomplete="postal-code">
    <label for="ad">Endereço</label><input id="ad" name="address1" autocomplete="address-line1">
    <label for="nu">Número</label><input id="nu" name="address2" autocomplete="address-line2">
    <label for="ci">Cidade</label><input id="ci" name="city" autocomplete="address-level2">
    <label for="tel">Telefone</label><input id="tel" name="phone" autocomplete="tel">
    <button type="button" id="go">Continuar para o pagamento</button>
  </form>
  <div id="payment" hidden>
    <h2>Forma de pagamento</h2>
    <p>Pix — 5% de desconto</p>
    <p>Cartão de crédito — Visa Mastercard Elo — em até 10x de R$ 34,99 sem juros</p>
    <p>Boleto bancário</p>
    <label for="cupom">Cupom de desconto</label><input id="cupom" name="discount">
    <label><input type="checkbox" name="save"> Salvar cartão para a próxima compra</label>
    <p>Compra segura. Seus dados são protegidos por criptografia.</p>
    <button type="button">Pagar agora</button>
  </div>
  <script>
    document.getElementById('go').addEventListener('click', function () {
      document.getElementById('payment').hidden = false
    })
  </script>
</body></html>`

export interface FakeStore {
  url: string
  /** Quantas requisições cada rota recebeu — para checar o rate limit. */
  hits: Record<string, number>
  close(): Promise<void>
}

export async function startFakeStore(options: FakeStoreOptions = {}): Promise<FakeStore> {
  const hits: Record<string, number> = {}
  const carts = new Map<string, number>()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    hits[path] = (hits[path] ?? 0) + 1

    const cookie = /session=([a-z0-9]+)/.exec(req.headers.cookie ?? '')?.[1]
    const session = cookie ?? Math.random().toString(36).slice(2, 10)
    const setCookie = cookie ? {} : { 'set-cookie': `session=${session}; Path=/` }

    const send = (status: number, type: string, body: string): void => {
      const withCharset = type.startsWith('text/') || type === 'application/json' ? `${type}; charset=utf-8` : type
      res.writeHead(status, { 'content-type': withCharset, ...setCookie })
      res.end(body)
    }

    if (path === '/robots.txt') {
      return send(200, 'text/plain', options.blockCheckout ? 'User-agent: *\nDisallow: /checkout\n' : 'User-agent: *\nDisallow:\n')
    }
    if (path === '/products.json') {
      return send(200, 'application/json', productsJson(options.includeZeroPriceProduct === true))
    }
    if (path === '/cart.js') {
      return send(200, 'application/json', JSON.stringify({ item_count: carts.get(session) ?? 0 }))
    }
    if (path === '/cart/add') {
      carts.set(session, (carts.get(session) ?? 0) + 1)
      res.writeHead(302, { location: '/cart', ...setCookie })
      return res.end()
    }
    if (path === '/cart') {
      return send(200, 'text/html', `<html><body><h1>Carrinho</h1><p>${carts.get(session) ?? 0} item(ns)</p></body></html>`)
    }
    // Página que se mexe sozinha: o screencast só entrega frame quando a tela
    // muda, então medir fps numa página estática mediria zero.
    if (path === '/animado') {
      return send(
        200,
        'text/html',
        `<!doctype html><html><head><style>
          @keyframes gira { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
          .bola { width: 120px; height: 120px; background: #ff2d6e; border-radius: 12px;
                  animation: gira 1s linear infinite; margin: 40px }
        </style></head><body><div class="bola"></div></body></html>`,
      )
    }

    if (path === '/checkout') {
      return send(200, 'text/html', CHECKOUT_PAGE)
    }
    if (path.startsWith('/products/')) {
      if (options.botChallenge) return send(200, 'text/html', CHALLENGE_PAGE)
      return send(200, 'text/html', productPage(path.replace('/products/', ''), options))
    }
    return send(200, 'text/html', '<html><body><h1>Loja Falsa</h1><a href="/cart">carrinho</a></body></html>')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
