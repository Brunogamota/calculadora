/**
 * Sobe o motor e o site juntos, numa aba só.
 *
 *   npm run tudo
 *
 * Existe porque a alternativa era "abra duas abas, numa rode isto na raiz, na
 * outra entre nesta pasta e rode aquilo" — e a pasta do site não é workspace
 * do npm, então `npm run dev` na raiz responde "Missing script: dev". Uma
 * instrução que erra assim é um defeito do projeto, não distração de quem
 * segue a instrução.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const site = path.join(raiz, 'apps/web/raio-x-checkout')

const filhos: ChildProcess[] = []

function subir(nome: string, comando: string, args: string[], cwd: string): void {
  /* `detached` para o filho virar líder do próprio grupo. Sem isto, o Ctrl+C
     matava o `npm` e deixava o Vite e o Chromium vivos segurando as portas —
     e a próxima subida morria com EADDRINUSE :::4000. Matar o GRUPO alcança
     o neto. */
  const filho = spawn(comando, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    detached: true,
  })
  filhos.push(filho)
  const escrever = (linha: string): void => {
    for (const l of linha.split('\n')) {
      if (l.trim().length > 0) console.log(`[${nome}] ${l}`)
    }
  }
  filho.stdout?.on('data', (d: Buffer) => escrever(d.toString()))
  filho.stderr?.on('data', (d: Buffer) => escrever(d.toString()))
  filho.on('exit', (code) => {
    console.log(`[${nome}] saiu (${code})`)
    parar()
  })
}

let parando = false
function matarGrupo(f: ChildProcess, sinal: NodeJS.Signals): void {
  if (f.pid === undefined) return
  // O menos na frente do pid é o grupo inteiro, não só o processo.
  try {
    process.kill(-f.pid, sinal)
  } catch {
    // Já morreu: nada a fazer.
  }
}

function parar(): void {
  if (parando) return
  parando = true
  for (const f of filhos) matarGrupo(f, 'SIGTERM')
  // Quem não sair no pedido educado sai no empurrão, para não deixar porta presa.
  setTimeout(() => {
    for (const f of filhos) matarGrupo(f, 'SIGKILL')
    process.exit(0)
  }, 1200)
}

process.on('SIGINT', parar)
process.on('SIGTERM', parar)

console.log('')
console.log('  motor  ->  http://localhost:4000')
console.log('  site   ->  http://localhost:5173')
console.log('')
console.log('  Abra o site no navegador. Ctrl+C aqui para o dos dois.')
console.log('')

subir('motor', 'npx', ['tsx', 'apps/realtime/src/server.ts'], raiz)
subir('site', 'npm', ['run', 'dev'], site)
