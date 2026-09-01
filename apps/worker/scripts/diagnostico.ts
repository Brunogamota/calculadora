/**
 * Lê o HTML que a jornada salvou quando não conseguiu comprar, e diz em uma
 * tela o que aquele tema usa.
 *
 *   npm run diagnostico
 *   npm run diagnostico -- out/www.carnan.com.br-produto-sem-formulario.html
 *
 * Existe porque a alternativa era pedir para alguém abrir um HTML de 800 KB e
 * procurar à mão qual seletor faltou. A evidência já estava salva; o que
 * faltava era alguém lê-la.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_OUT_DIR } from '../src/lib/artifacts.ts'
import { ADD_TO_CART_BUTTONS, ADD_TO_CART_FORMS } from '../src/platforms/shopify.selectors.ts'
import { matchBuyIntent } from '../src/journey/buyIntent.ts'

async function alvos(): Promise<string[]> {
  const passados = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (passados.length > 0) return passados
  const nomes = await readdir(DEFAULT_OUT_DIR).catch(() => [] as string[])
  return nomes
    .filter((n) => n.endsWith('.html') && /produto-sem-(formulario|botao)|checkout/.test(n))
    .map((n) => path.join(DEFAULT_OUT_DIR, n))
}

/** Só as tags de abertura: o conteúdo não interessa, a forma sim. */
function tags(html: string, nome: string): string[] {
  return html.match(new RegExp(`<${nome}\\b[^>]*>`, 'gi')) ?? []
}

/** O texto ENTRE a tag de abertura e o próximo `<`: o rótulo, e só ele. */
function rotulo(tag: string, html: string): string {
  const i = html.indexOf(tag)
  const depois = html.slice(i + tag.length, i + tag.length + 300)
  const ate = depois.indexOf('<')
  return (ate === -1 ? depois : depois.slice(0, ate)).replace(/\s+/g, ' ').trim().slice(0, 48)
}

function linha(rotulo: string, valor: string): void {
  console.log(`  ${rotulo.padEnd(30)} ${valor}`)
}

async function olhar(arquivo: string): Promise<void> {
  const html = await readFile(arquivo, 'utf8').catch(() => null)
  if (html === null) return console.log(`\n${arquivo}: não consegui abrir`)

  console.log(`\n${arquivo}  (${(html.length / 1024).toFixed(0)} KB)`)

  const forms = tags(html, 'form')
  const doCarrinho = forms.filter((f) => /action\s*=\s*["'][^"']*\/cart\/add/i.test(f))
  linha('formulários na página', String(forms.length))
  linha('com action de /cart/add', doCarrinho.length > 0 ? doCarrinho.join(' ') : 'NENHUM  <- é por aqui que a jornada tropeça')
  for (const spec of ADD_TO_CART_FORMS) {
    if (doCarrinho.length === 0) linha(`  seletor que falhou`, spec.selector)
  }

  linha('/cart/add aparece no HTML?', /\/cart\/add/i.test(html) ? 'sim (provavelmente por JavaScript)' : 'não')
  linha('marcas de Shopify', /Shopify\.(shop|theme)|ShopifyAnalytics/i.test(html) ? 'sim' : 'não')
  const tema = /"theme"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i.exec(html)?.[1]
  if (tema) linha('tema declarado', tema)

  const botoes = [...tags(html, 'button'), ...tags(html, 'a').filter((a) => /class=[^>]*b(tn|utton)/i.test(a))]
  linha('botões na página', String(botoes.length))

  const comprar = botoes
    .map((b) => ({ tag: b, texto: rotulo(b, html) }))
    .filter((b) => matchBuyIntent(b.texto) !== null)
  console.log(`  botões com cara de comprar:  ${comprar.length}`)
  for (const b of comprar.slice(0, 6)) {
    console.log(`     "${b.texto}"`)
    console.log(`        ${b.tag.slice(0, 150)}`)
  }
  if (comprar.length === 0) {
    console.log('     nenhum. Cole aqui as 6 primeiras linhas abaixo para eu ver os rótulos:')
    for (const b of botoes.slice(0, 6)) console.log(`        ${b.slice(0, 120)}  -> "${rotulo(b, html)}"`)
  }

  const seletores = ADD_TO_CART_BUTTONS.map((s) => s.selector)
  linha('seletores de botão tentados', seletores.join(' | '))
}

const arquivos = await alvos()
if (arquivos.length === 0) {
  console.log(`Nada para olhar em ${DEFAULT_OUT_DIR}/.`)
  console.log('A jornada só salva HTML quando não consegue comprar. Se não há arquivo,')
  console.log('a compra não foi o que falhou.')
} else {
  for (const a of arquivos) await olhar(a)
  console.log('')
}
