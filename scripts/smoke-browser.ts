/**
 * Smoke test do browser. Não entra no `npm test` porque precisa de Chromium e
 * de display — mas é o único que prova o que os testes puros não alcançam:
 * que o browser sobe headed, que os globais são lidos de dentro da página e
 * que o guard de route mata request para faixa privada.
 *
 *   npm run smoke              (máquina com tela)
 *   xvfb-run -a npm run smoke  (servidor sem tela)
 */

import { launchBrowser, readPageGlobals } from '../src/lib/browser.ts'
import { DEFAULT_USER_AGENT } from '../src/lib/http.ts'

const headed = !process.argv.includes('--headless')
const session = await launchBrowser({ headed, userAgent: DEFAULT_USER_AGENT })
let failures = 0

function check(label: string, condition: boolean, detail?: unknown): void {
  console.log(`${condition ? 'ok  ' : 'FALHOU'} ${label}`)
  if (!condition) {
    failures++
    if (detail !== undefined) console.log('        ', JSON.stringify(detail))
  }
}

try {
  const ua = await session.page.evaluate(() => navigator.userAgent)
  check('User-Agent identificável chega na página (§2.4)', ua === DEFAULT_USER_AGENT, ua)

  await session.page.setContent(`
    <html><head>
      <script src="https://cdn.shopify.com/s/files/x.js"></script>
      <script>window.Shopify = { shop: 'exemplo.myshopify.com', theme: { name: 'Dawn' } };</script>
    </head><body>loja.myshopify.com</body></html>
  `)
  const globals = await readPageGlobals(session.page)
  check('lê window.Shopify de dentro da página', globals.shopify.present)
  check('extrai o shop', globals.shopify.shop === 'exemplo.myshopify.com', globals.shopify.shop)
  check('extrai o tema', globals.shopify.theme === 'Dawn', globals.shopify.theme)
  check('coleta hosts de script', globals.scriptHosts.includes('cdn.shopify.com'), globals.scriptHosts)
  check('não inventa outras plataformas', !globals.vtex.present && !globals.woocommerce.present)

  await session.page.setContent('<img src="http://127.0.0.1/x.png"><img src="http://169.254.169.254/meta">')
  await session.page.waitForTimeout(800)
  check(
    'guard de route mata request para loopback e metadata (§2.5)',
    session.blockedRequests.some((u) => u.includes('127.0.0.1')) &&
      session.blockedRequests.some((u) => u.includes('169.254.169.254')),
    session.blockedRequests,
  )
} finally {
  await session.close()
}

console.log(failures === 0 ? '\ntudo passou' : `\n${failures} verificação(ões) falharam`)
process.exit(failures === 0 ? 0 : 1)
