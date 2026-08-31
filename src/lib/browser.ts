/**
 * Playwright: launch, guards em tempo de request e captura da sonda de detecção.
 *
 * O safeFetch protege o que o motor pede; ele NÃO protege o que a página pede.
 * Por isso existe também um guard na camada de route: um redirect ou um script
 * que aponte para 127.0.0.1 morre aqui.
 */

import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright'
import { AuditError } from './errors.ts'
import { normalizeUrl, assertUrlShapeIsSafe } from './guards.ts'
import type { PageGlobals } from '../types.ts'

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

export interface LaunchOptions {
  /** §19: `headless: false` durante o desenvolvimento. Padrão do projeto. */
  headed?: boolean
  userAgent: string
  timeoutMs?: number
}

export interface BrowserSession {
  browser: Browser
  context: BrowserContext
  page: Page
  /** URLs que o guard barrou, para o relatório poder mostrar. */
  blockedRequests: string[]
  close(): Promise<void>
}

export async function launchBrowser(options: LaunchOptions): Promise<BrowserSession> {
  const headed = options.headed !== false

  if (headed && !process.env['DISPLAY']) {
    throw new AuditError(
      'NO_DISPLAY',
      [
        'Modo headed pedido, mas não há DISPLAY nesta máquina.',
        'O padrão do projeto é headed (§19), então isto falha em vez de cair para',
        'headless em silêncio — ver a tela é o que permite depurar loja real.',
        '',
        'Em servidor ou devcontainer sem tela, escolha um:',
        '  xvfb-run -a npm run smoke          (headed de verdade, em display virtual)',
        '  npm run smoke -- --headless        (sem janela)',
        '  xvfb-run -a npm run detect -- <url>',
        '  npm run detect -- <url> --headless',
        '',
        'Se faltar o xvfb: apt-get install -y xvfb',
        'Em máquina com tela, nada disso é necessário.',
      ].join('\n'),
    )
  }

  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({
    userAgent: options.userAgent,
    viewport: DESKTOP_VIEWPORT,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  })
  context.setDefaultTimeout(options.timeoutMs ?? 30_000)

  const blockedRequests: string[] = []

  // Guard de SSRF na camada do browser (§2.5).
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) {
      return route.continue()
    }
    try {
      assertUrlShapeIsSafe(normalizeUrl(url))
      return route.continue()
    } catch {
      blockedRequests.push(url)
      return route.abort('blockedbyclient')
    }
  })

  const page = await context.newPage()

  return {
    browser,
    context,
    page,
    blockedRequests,
    async close() {
      await context.close().catch(() => undefined)
      await browser.close().catch(() => undefined)
    },
  }
}

/**
 * Lê os globais das plataformas numa passada só.
 *
 * O corpo do evaluate não define NENHUMA função interna, de propósito: o esbuild
 * (usado pelo tsx) injeta um helper `__name` em função nomeada, e esse helper não
 * existe dentro da página — o evaluate quebra com "__name is not defined". Sem
 * função aninhada, o código serializa igual em qualquer transpilador.
 */
export async function readPageGlobals(page: Page): Promise<PageGlobals> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>

    let shopifyPresent = false
    let shopifyShop: string | null = null
    let shopifyTheme: string | null = null
    try {
      const shopify = w['Shopify'] as Record<string, unknown> | undefined
      shopifyPresent = shopify !== undefined && shopify !== null
      if (shopifyPresent) {
        const shop = shopify?.['shop']
        if (typeof shop === 'string') shopifyShop = shop
        const theme = shopify?.['theme'] as Record<string, unknown> | undefined
        if (theme && typeof theme['name'] === 'string') shopifyTheme = theme['name'] as string
      }
    } catch {
      /* acesso a global pode lançar em página hostil */
    }

    let vtexPresent = false
    let vtexAccount: string | null = null
    try {
      const vtex = w['vtex']
      const runtime = w['__RUNTIME__'] as Record<string, unknown> | undefined
      const account = runtime?.['account']
      if (typeof account === 'string') vtexAccount = account
      vtexPresent = (vtex !== undefined && vtex !== null) || vtexAccount !== null
    } catch {
      /* idem */
    }

    let nuvemshopPresent = false
    try {
      nuvemshopPresent = w['LS'] !== undefined && w['LS'] !== null
    } catch {
      /* idem */
    }

    let wooPresent = false
    try {
      wooPresent =
        w['woocommerce_params'] !== undefined ||
        w['wc_add_to_cart_params'] !== undefined ||
        w['wc_cart_fragments_params'] !== undefined
    } catch {
      /* idem */
    }

    const hosts: string[] = []
    try {
      for (const el of document.querySelectorAll('script[src], link[href]')) {
        const raw = el.getAttribute('src') ?? el.getAttribute('href')
        if (!raw) continue
        try {
          const host = new URL(raw, location.href).hostname
          if (host && !hosts.includes(host)) hosts.push(host)
        } catch {
          /* href inválido */
        }
      }
    } catch {
      /* DOM indisponível */
    }
    hosts.sort()

    return {
      shopify: { present: shopifyPresent, shop: shopifyShop, theme: shopifyTheme },
      vtex: { present: vtexPresent, account: vtexAccount },
      nuvemshop: { present: nuvemshopPresent },
      woocommerce: { present: wooPresent },
      scriptHosts: hosts,
    }
  })
}

export interface OpenResult {
  response: Response | null
  headers: Record<string, string>
  html: string
  finalUrl: string
  loadMs: number
}

export async function openPage(page: Page, url: string, timeoutMs: number): Promise<OpenResult> {
  const startedAt = Date.now()
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  // Dá um respiro para scripts que definem os globais das plataformas.
  await page.waitForLoadState('load', { timeout: Math.min(timeoutMs, 10_000) }).catch(() => undefined)
  const loadMs = Date.now() - startedAt

  const headers: Record<string, string> = {}
  if (response) {
    for (const [k, v] of Object.entries(response.headers())) headers[k.toLowerCase()] = v
  }

  return {
    response,
    headers,
    html: await page.content(),
    finalUrl: page.url(),
    loadMs,
  }
}
