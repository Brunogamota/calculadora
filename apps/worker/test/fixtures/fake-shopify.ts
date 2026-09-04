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
  overlay?: 'none' | 'geo-redirect' | 'consent' | 'oferta'
  /**
   * Sobreposição na ENTRADA da loja e no CARRINHO — não só na página de
   * produto.
   *
   * A fixture só tinha overlay no produto, então a única pergunta exercitada
   * era "tem algo cobrindo o botão de comprar?". Banner de cookie na entrada e
   * gaveta no carrinho, que são os casos que o lojista encontra primeiro,
   * nunca passaram por teste nenhum.
   */
  overlayNaHome?: 'geo-redirect' | 'consent' | 'oferta'
  overlayNoCarrinho?: 'geo-redirect' | 'consent' | 'oferta'
  /** Atrasa a injeção do formulário, para exercitar a espera do DOM. */
  formDelayMs?: number
  /** robots.txt proíbe /checkout. */
  blockCheckout?: boolean
  /** Responde desafio antibot na página de produto. */
  botChallenge?: boolean
  /** `/cart/add.js` responde 422: exercita a queda para o caminho seguinte. */
  apiRecusaAdd?: boolean
  /**
   * O add responde 200 e o `/cart.js` fica ILEGÍVEL: a jornada segue, e o
   * carrinho não pode ser confirmado nem desmentido.
   *
   * É o caso que produz `AddToCartResult.ok === null`, e é o único jeito de a
   * jornada continuar sem confirmação — carrinho legível e vazio faz o `via`
   * ficar nulo e a jornada lançar `BUY_BUTTON_NOT_FOUND` antes disso.
   *
   * Existe porque o painel mostrava o certinho preto aqui, dizendo "consegui"
   * sobre uma etapa que o motor sabia não ter confirmado.
   */
  carrinhoIlegivel?: boolean
  /**
   * `/products.json` responde 200 com a página de senha do Shopify em HTML,
   * no lugar do catálogo — achado numa loja real (`raiox-teste.myshopify.com`,
   * ainda em desenvolvimento). Ver `lib/senha-de-loja.ts`.
   */
  comSenha?: boolean
  /**
   * A home manda o conteúdo visível na hora e só FECHA a conexão N ms depois.
   *
   * Nenhuma loja real entrega a página inteira num pacote só, e é essa janela
   * — entre "já dá para ver alguma coisa" e "terminou de carregar" — que faz a
   * captura tardia doer.
   *
   * Foi um `<script>` no fim do corpo antes. Script sem `async` bloqueia o
   * parser, então o navegador pode não pintar nada até ele responder, e aí o
   * que se mede passa a ser a heurística de primeira pintura do Chromium em
   * vez do defeito. Entregar em pedaços não depende disso.
   */
  homeStreamDelayMs?: number
  /**
   * Catálogo com um add-on sem entrega física, mais barato que tudo.
   * É o "Free Returns Coverage" da allbirds.
   */
  protecaoDeEnvio?: boolean
  /** Catálogo só de itens sem frete: curso e ebook. */
  soDigital?: boolean
  /**
   * Loja SEM etapa de carrinho: o botão leva direto para o checkout, e
   * /cart.js nunca conta nada. É o formato que reprovava a compra por
   * procurar uma confirmação que naquela loja jamais apareceria.
   */
  semCarrinho?: boolean
  /**
   * Nenhum dos quatro caminhos funciona: API recusa, não há formulário, não há
   * botão, não há rótulo de compra. É o desfecho de falha de verdade — o que
   * mais precisa deixar evidência em disco.
   */
  semCompra?: boolean
  /** Catálogo inclui produto de teste a R$ 0. */
  includeZeroPriceProduct?: boolean
  /**
   * Como o botão de comprar é construído.
   *
   * 'aluguel' reproduz a Circulei (circulei.co): loja de aluguel em Shopify
   * onde o botão diz "QUERO ALUGAR", NÃO é submit, e a página ainda tem um
   * "FALE COM A NINA" que começa parecido e não pode ser clicado.
   */
  buyButton?: 'submit' | 'aluguel' | 'sem-formulario'
}

const PRODUCTS = [
  { handle: 'camiseta-basica', title: 'Camiseta Básica', price: '89.90', id: 111, available: true },
  { handle: 'tenis-corrida', title: 'Tênis de Corrida', price: '349.90', id: 222, available: true },
  { handle: 'meia-esgotada', title: 'Meia Esgotada', price: '19.90', id: 333, available: false },
]

function productsJson(
  includeZero: boolean,
  opcoes?: { protecaoDeEnvio?: boolean; soDigital?: boolean },
): string {
  const list = PRODUCTS.map((p) => ({
    handle: p.handle,
    title: p.title,
    product_type: 'Vestuário',
    options: [{ name: 'Title', values: ['Default Title'] }],
    variants: [
      {
        id: p.id,
        title: 'Default Title',
        available: p.available,
        price: p.price,
        // Produto físico normal. O Shopify manda este campo no products.json.
        requires_shipping: true,
      },
    ],
  }))
  /* Add-on sem entrega física, e o mais barato do catálogo — que é o que faz
     "mais barato" elegê-lo. É o caso da allbirds: a auditoria escolheu "Free
     Returns Coverage", um seguro de devolução, e abriu um checkout que não
     representava compra nenhuma. */
  if (opcoes?.protecaoDeEnvio) {
    list.unshift({
      handle: 'protecao-de-envio',
      title: 'Proteção de Envio',
      product_type: 'Serviço',
      options: [{ name: 'Title', values: ['Default Title'] }],
      variants: [
        { id: 777, title: 'Default Title', available: true, price: '4.90', requires_shipping: false },
      ],
    })
  }
  /* Loja 100% digital: curso e ebook, nada com frete. Recusá-la inteira seria
     trocar resultado errado por nenhum resultado. */
  if (opcoes?.soDigital) {
    return JSON.stringify({
      products: [
        {
          handle: 'curso-de-marketing',
          title: 'Curso de Marketing',
          product_type: 'Curso',
          options: [{ name: 'Title', values: ['Default Title'] }],
          variants: [
            { id: 881, title: 'Default Title', available: true, price: '297.00', requires_shipping: false },
          ],
        },
        {
          handle: 'ebook-vendas',
          title: 'Ebook de Vendas',
          product_type: 'Ebook',
          options: [{ name: 'Title', values: ['Default Title'] }],
          variants: [
            { id: 882, title: 'Default Title', available: true, price: '47.00', requires_shipping: false },
          ],
        },
      ],
    })
  }
  if (includeZero) {
    list.unshift({
      handle: 'teste-de-valor-0',
      title: 'Teste de valor 0',
      product_type: 'Teste',
      options: [{ name: 'Title', values: ['Default Title'] }],
      /* `requires_shipping: true` de propósito: este item existe para o teste
         do PREÇO ZERO, e deixá-lo sem frete faria a exclusão acontecer pelo
         motivo errado — o teste passaria medindo outra coisa. */
      variants: [
        { id: 999, title: 'Default Title', available: true, price: '0.00', requires_shipping: true },
      ],
    })
  }
  return JSON.stringify({ products: list })
}

/* Cada sobreposição FECHA de verdade ao clicar: o script tira o elemento do
   DOM. Sem isto, `dismissed` nunca sairia true e o teste mediria só a
   tentativa, não o resultado — o robô "tentou fechar" com o modal ainda na
   tela, que é exatamente o desfecho que não pode passar por sucesso. */
const FECHA_AO_CLICAR = (id: string): string =>
  `<script>
     (function () {
       var caixa = document.getElementById('${id}');
       var botoes = caixa.querySelectorAll('button');
       for (var i = 0; i < botoes.length; i++) {
         botoes[i].addEventListener('click', function () { caixa.remove() });
       }
     })();
   </script>`

const OVERLAY_HTML: Record<string, string> = {
  'geo-redirect': `
    <div id="geoModal" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6)">
      <style>#geoModal p{color:#fff}</style>
      <p>Dear customer. We have a dedicated store to serve your region. Would you like to go there?</p>
      <button type="button">Yes</button>
      <button type="button">No, thanks</button>
    </div>${FECHA_AO_CLICAR('geoModal')}`,
  consent: `
    <div id="cookieBar" role="dialog" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6)">
      <p>Usamos cookies para melhorar sua experiência.</p>
      <button type="button" aria-label="Fechar">Aceitar</button>
    </div>${FECHA_AO_CLICAR('cookieBar')}`,
  /* Popup de oferta: sem `role`, sem rótulo acessível de fechar, e o botão que
     recusa diz "Não, obrigado". Só o léxico do DISMISS_TEXT resolve — que é o
     caso real que o Bruno levantou: "ele precisa identificar o x pra recusar". */
  oferta: `
    <div id="promoModal" style="position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6)">
      <p>Ganhe 10% de desconto! Assine nossa newsletter.</p>
      <button type="button">Não, obrigado</button>
    </div>${FECHA_AO_CLICAR('promoModal')}`,
}

function productPage(handle: string, options: FakeStoreOptions): string {
  const product = PRODUCTS.find((p) => p.handle === handle)
  if (!product) return '<html><body><h1>404</h1></body></html>'

  // O caso da Circulei: formulário existe, mas o botão não é submit e o rótulo
  // vem do modelo de negócio ("QUERO ALUGAR", não "adicionar ao carrinho").
  /* O caso da Carnan: nenhum `form[action="/cart/add"]` na página. O botão
     "Comprar" é um botão solto que manda o item por fetch. Tema assim era
     auditoria perdida — a jornada exigia o formulário clássico antes de
     procurar qualquer botão. */
  /* Sem etapa de carrinho: o botão manda direto para o checkout. Nenhum
     form de /cart/add, nenhum carrinho para confirmar. */
  const form =
    options.semCompra === true
      ? `<div class="product-buy"><p>Consulte disponibilidade pelo telefone.</p></div>`
      : options.semCarrinho === true
      ? `
    <div class="product-buy">
      <button type="button" id="comprar" class="btn-buy">Comprar</button>
    </div>
    <script>
      document.getElementById('comprar').addEventListener('click', async function () {
        await fetch('/cart/add.js', { method: 'POST' })
        location.href = '/checkout'
      })
    </script>`
      : options.buyButton === 'sem-formulario'
      ? `
    <div class="product-buy">
      <button type="button" id="comprar" class="btn-buy">Comprar</button>
    </div>
    <script>
      document.getElementById('comprar').addEventListener('click', async function () {
        await fetch('/cart/add', { method: 'POST' })
        location.href = '/cart'
      })
    </script>`
      : options.buyButton === 'aluguel'
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
      /* A Shopify de verdade manda este header em TODA resposta do servidor —
         é por isso que uma loja real com senha ativa ainda é identificada
         como Shopify (o header não depende do corpo nem do tema). A fixture
         não mandava, e isso escondeu o bug: toda detecção de plataforma nos
         testes se apoiava sem perceber na confirmação de alto peso do
         `/products.json`, que é exatamente o sinal que some quando a loja
         tem senha. */
      res.writeHead(status, { 'content-type': withCharset, 'x-shopid': '1', ...setCookie })
      res.end(body)
    }

    if (path === '/robots.txt') {
      return send(200, 'text/plain', options.blockCheckout ? 'User-agent: *\nDisallow: /checkout\n' : 'User-agent: *\nDisallow:\n')
    }
    if (path === '/products.json') {
      /* A Shopify de verdade responde 200 (não 401, não 403) com a página de
         senha em HTML no lugar do JSON quando a loja ainda não foi
         publicada — é isto que faz o `JSON.parse` falhar em vez de a
         requisição falhar antes. Reproduzindo o formato exato visto na
         loja real, incluindo o texto que `pareceSenhaDeLoja` procura. */
      if (options.comSenha === true) {
        return send(
          200,
          'text/html',
          '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>loja-falsa</title></head>\n' +
            '<body><h1>loja-falsa</h1><p>This store is password protected. Use the password to enter the store.</p>' +
            '<label>Enter store password</label><input type="password"><button>Enter</button></body></html>',
        )
      }
      return send(
        200,
        'application/json',
        productsJson(options.includeZeroPriceProduct === true, {
          protecaoDeEnvio: options.protecaoDeEnvio === true,
          soDigital: options.soDigital === true,
        }),
      )
    }
    if (path === '/cart.js') {
      // Loja sem etapa de carrinho: o carrinho existe e está sempre vazio.
      if (options.semCarrinho === true) return send(200, 'application/json', JSON.stringify({ item_count: 0 }))
      /* Ilegível de verdade: não é 0, é "não sei". A diferença é a mesma que o
         motor faz entre `ok: false` e `ok: null`. */
      if (options.carrinhoIlegivel === true) return send(503, 'text/plain', 'cart unavailable')
      return send(200, 'application/json', JSON.stringify({ item_count: carts.get(session) ?? 0 }))
    }
    if (path === '/cart/add') {
      carts.set(session, (carts.get(session) ?? 0) + 1)
      res.writeHead(302, { location: '/cart', ...setCookie })
      return res.end()
    }
    /* `/cart/add.js` é o contrato de verdade do Shopify, e é por ele que a
       jornada entra primeiro. A loja falsa não tinha esta rota, então o
       primeiro caminho da cadeia falhava aqui por defeito da FIXTURE — e o
       teste passava pelo segundo caminho sem que ninguém percebesse. */
    if (path === '/cart/add.js') {
      if (req.method !== 'POST') return send(405, 'text/plain', 'method not allowed')
      /* Sem etapa de carrinho, o add responde 200 e joga a pessoa no
         checkout: a compra ENTROU, e mesmo assim o /cart.js segue zerado. */
      if (options.semCarrinho === true) {
        carts.set(session, 1)
        return send(200, 'application/json', JSON.stringify({ id: 111, quantity: 1 }))
      }
      // Variante inexistente responde 422, como o Shopify de verdade.
      if (options.apiRecusaAdd === true || options.semCompra === true) {
        return send(422, 'application/json', JSON.stringify({ status: 422, message: 'Cart Error' }))
      }
      carts.set(session, (carts.get(session) ?? 0) + 1)
      return send(200, 'application/json', JSON.stringify({ id: 111, quantity: 1 }))
    }
    if (path === '/cart') {
      const sobre = options.overlayNoCarrinho ? (OVERLAY_HTML[options.overlayNoCarrinho] ?? '') : ''
      return send(
        200,
        'text/html',
        `<html><body><h1>Carrinho</h1><p>${carts.get(session) ?? 0} item(ns)</p>${sobre}</body></html>`,
      )
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

    if (path === '/checkout' && options.semCarrinho === true) {
      const p = PRODUCTS[0]!
      return send(
        200,
        'text/html',
        `<html><body><h1>Finalizar compra</h1>
         <h2>Resumo do pedido</h2>
         <p>${p.title} — R$ ${p.price}</p>
         <p>E-mail</p><p>Endereço de entrega</p><p>Frete</p>
         <p>Forma de pagamento: Pix, cartão, boleto</p>
         </body></html>`,
      )
    }
    if (path === '/checkout') {
      return send(200, 'text/html', CHECKOUT_PAGE)
    }
    if (path.startsWith('/products/')) {
      if (options.botChallenge) return send(200, 'text/html', CHALLENGE_PAGE)
      return send(200, 'text/html', productPage(path.replace('/products/', ''), options))
    }
    /* Home em pedaços: o visível sai agora, o resto depois. `domcontentloaded`
       só dispara quando a conexão fecha, e nesse meio-tempo já há loja na
       tela — que é a janela que a transmissão precisa cobrir. */
    if (options.homeStreamDelayMs && options.homeStreamDelayMs > 0) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-shopid': '1' })
      res.write('<html><body><h1 style="font-size:64px">Loja Falsa</h1><a href="/cart">carrinho</a>')
      setTimeout(() => res.end('<p>fim</p></body></html>'), options.homeStreamDelayMs)
      return
    }
    const naHome = options.overlayNaHome ? (OVERLAY_HTML[options.overlayNaHome] ?? '') : ''
    return send(
      200,
      'text/html',
      `<html><body><h1>Loja Falsa</h1><a href="/cart">carrinho</a>${naHome}</body></html>`,
    )
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
