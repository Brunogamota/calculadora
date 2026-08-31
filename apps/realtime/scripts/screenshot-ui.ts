/**
 * Abre a tela de execução, roda uma auditoria contra a loja falsa e captura a
 * tela em dois momentos: no meio da jornada e no veredito.
 *
 *   npm run ui:shot
 *
 * Serve para revisar a tela sem precisar de olho humano em cima o tempo todo,
 * e para ter o antes/depois quando ela mudar.
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startFakeStore } from '../../worker/test/fixtures/fake-shopify.ts'

const PORT = 4311
process.env['PORT'] = String(PORT)
process.env['RAIO_X_QUIET'] = '1'
process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'
process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'

const store = await startFakeStore({ overlay: 'consent' })
const { closeServer } = await import('../src/server.ts')
await new Promise((r) => setTimeout(r, 400))

await mkdir('out/ui', { recursive: true })
const browser = await chromium.launch({ headless: true })

const page = await browser.newPage({ viewport: { width: 1440, height: 860 } })
await page.goto(`http://localhost:${PORT}/`)
await page.screenshot({ path: 'out/ui/1-home.png' })

await page.fill('#url', store.url)
await page.click('#botao')

// No meio da jornada: passos correndo, frames chegando.
await page.waitForTimeout(7000)
await page.screenshot({ path: 'out/ui/2-execucao.png' })

// No fim: último frame congelado e escurecido, nota e ressalva (§7.5).
await page.waitForSelector('.veredito.ativo', { timeout: 60000 })
await page.waitForTimeout(800)
await page.screenshot({ path: 'out/ui/3-veredito.png' })

// Mobile: navegador em cima ocupando 60% da altura (§7.5).
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
await mobile.goto(`http://localhost:${PORT}/?a=${new URL(page.url()).searchParams.get('a')}`)
await mobile.waitForTimeout(1500)
await mobile.screenshot({ path: 'out/ui/4-mobile.png' })

await browser.close()
await closeServer()
await store.close()
console.log('capturas em out/ui/')
process.exit(0)
