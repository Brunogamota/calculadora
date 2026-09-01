/**
 * Sobe a tela de execução COM uma loja falsa junto.
 *
 *   npm run live:fake
 *
 * Serve para ver a tela funcionando sem tocar em site de ninguém: a loja falsa
 * responde no formato do Shopify, e a URL dela já vem preenchida na tela.
 */

import { startFakeStore } from '../../worker/test/fixtures/fake-shopify.ts'

const PORT = Number(process.env['PORT'] ?? 4000)
process.env['PORT'] = String(PORT)
process.env['RAIO_X_QUIET'] = '1'
process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'
process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'

// Com banner de cookie cobrindo o botão: rende um achado de verdade na tela.
const store = await startFakeStore({ overlay: 'consent' })
await import('../src/server.ts')

console.log('')
console.log('  ┌─────────────────────────────────────────────────────┐')
console.log('  │  Abra no navegador:                                 │')
console.log(`  │     http://localhost:${PORT}${' '.repeat(31 - String(PORT).length)}│`)
console.log('  │                                                     │')
console.log('  │  E cole esta URL no campo:                          │')
console.log(`  │     ${store.url}${' '.repeat(Math.max(0, 48 - store.url.length))}│`)
console.log('  └─────────────────────────────────────────────────────┘')
console.log('')
console.log('  Ctrl+C para parar.')

const parar = async (): Promise<void> => {
  await store.close()
  process.exit(0)
}
process.on('SIGINT', () => void parar())
process.on('SIGTERM', () => void parar())
