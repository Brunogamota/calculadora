/**
 * Lê um HTML salvo por `detect --save-html` e imprime um resumo compacto do que
 * há nele: hosts, globais definidos, meta generator e contagem de tokens de
 * plataforma.
 *
 * Serve para o caso da §19: a loja não foi identificada, e é preciso descobrir
 * em que sinal real dá para se apoiar — sem colar o HTML inteiro e sem inventar
 * seletor.
 *
 *   npm run sniff -- out/www.zeedog.com.br-home.html
 */

import { readFile } from 'node:fs/promises'

const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!file) {
  console.error('Uso: npm run sniff -- <arquivo.html>')
  process.exit(2)
}

const html = await readFile(file, 'utf8')
console.log(`arquivo: ${file}  (${(html.length / 1024).toFixed(0)} KB)\n`)

// 1. Hosts citados em qualquer atributo de URL
const hosts = new Map<string, number>()
for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
  const host = (m[1] ?? '').toLowerCase()
  hosts.set(host, (hosts.get(host) ?? 0) + 1)
}
console.log('— hosts mais citados —')
for (const [host, n] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${String(n).padStart(4)}  ${host}`)
}

// 2. Globais atribuídos em script inline: é onde mora o `window.Shopify` da vida
const globals = new Set<string>()
for (const m of html.matchAll(/window\.([A-Za-z_$][\w$]{1,40})\s*=/g)) globals.add(m[1] ?? '')
for (const m of html.matchAll(/\bvar\s+(__[A-Za-z_$][\w$]{1,40})\s*=/g)) globals.add(m[1] ?? '')
console.log('\n— globais definidos em script inline —')
console.log(globals.size ? `  ${[...globals].sort().join(', ')}` : '  (nenhum)')

// 3. meta generator e afins
console.log('\n— metas reveladoras —')
const metas = [...html.matchAll(/<meta[^>]+(name|property)="([^"]*(generator|platform|framework)[^"]*)"[^>]*>/gi)]
console.log(metas.length ? metas.map((m) => `  ${m[0].slice(0, 160)}`).join('\n') : '  (nenhuma)')

// 4. Contagem de tokens de plataforma. A lista é só um grep — a conclusão é sua.
const TOKENS = [
  'shopify', 'myshopify', 'vtex', 'vtexassets', 'vtexcommercestable',
  'nuvemshop', 'tiendanube', 'woocommerce', 'wp-content', 'magento',
  'deco.cx', 'decoims', 'lilstts', 'linx', 'tray', 'wake', 'yampi',
  'cartpanda', 'lojaintegrada', 'bagy', 'irroba', 'nextjs', '__NEXT_DATA__',
]
console.log('\n— tokens (contagem no HTML) —')
const lower = html.toLowerCase()
for (const token of TOKENS) {
  let count = 0
  let i = lower.indexOf(token)
  while (i !== -1) {
    count++
    i = lower.indexOf(token, i + token.length)
  }
  if (count > 0) console.log(`  ${String(count).padStart(4)}  ${token}`)
}

// 5. Primeira ocorrência com contexto dos tokens mais decisivos
console.log('\n— contexto da primeira ocorrência —')
for (const token of ['vtex', 'shopify', 'deco', 'lilstts']) {
  const i = lower.indexOf(token)
  if (i === -1) continue
  console.log(`  [${token}] …${html.slice(Math.max(0, i - 90), i + 110).replace(/\s+/g, ' ')}…`)
}
