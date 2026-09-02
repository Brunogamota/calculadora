/**
 * Sobe o Raio-X num endereço público temporário.
 *
 *   npm run publico
 *
 * Existe porque "põe o localhost no ar" tem uma pegadinha que só aparece
 * depois de já ter mandado o link para alguém: o site fala com o motor em
 * `localhost:4000`. Expondo só a porta do site, quem abre de fora tenta falar
 * com o localhost DA MÁQUINA DELE, não com a sua — e a tela fica girando sem
 * nunca conectar. Os dois lados têm que sair juntos, e o site precisa ser
 * construído já sabendo o endereço público do motor.
 *
 * O túnel é do Cloudflare, na modalidade rápida: sem conta, sem cadastro, URL
 * sorteada a cada vez. Enquanto este terminal estiver aberto, o link vive.
 * Ctrl+C aqui derruba tudo.
 *
 * E não precisa instalar nada. A instrução era `brew install cloudflared`, que
 * pressupõe Homebrew — e quem não tem esbarra em `command not found: brew`
 * antes de chegar perto do produto. O pacote npm `cloudflared` baixa o binário
 * sozinho na primeira vez. Se o binário já estiver no PATH, ele ganha, porque
 * aí não há download nenhum.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const site = path.join(raiz, 'apps/web/raio-x-checkout')
const dist = path.join(site, 'dist-publico')

const PORTA_MOTOR = 4000
const PORTA_SITE = 5174

const filhos: ChildProcess[] = []

function subir(nome: string, comando: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): ChildProcess {
  const filho = spawn(comando, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    detached: true,
  })
  filhos.push(filho)
  const escrever = (linha: string): void => {
    for (const l of linha.split('\n')) if (l.trim().length > 0) console.log(`[${nome}] ${l}`)
  }
  filho.stdout?.on('data', (d: Buffer) => escrever(d.toString()))
  return filho
}

function matarGrupo(f: ChildProcess, sinal: NodeJS.Signals): void {
  if (f.pid === undefined) return
  try {
    process.kill(-f.pid, sinal)
  } catch {
    // já morreu
  }
}

let parando = false
function parar(): void {
  if (parando) return
  parando = true
  console.log('\n  Derrubando o link público e os dois servidores.')
  for (const f of filhos) matarGrupo(f, 'SIGTERM')
  setTimeout(() => {
    for (const f of filhos) matarGrupo(f, 'SIGKILL')
    process.exit(0)
  }, 1200)
}
process.on('SIGINT', parar)
process.on('SIGTERM', parar)

/** Versão fixada: túnel que muda de versão sozinho quebra sem aviso. */
const PACOTE_TUNEL = 'cloudflared@0.7.3'

/**
 * O binário instalado ganha do npm — não há download quando ele já existe.
 * `npx --yes` evita a pergunta de confirmação na primeira vez.
 */
function comandoDoTunel(): { comando: string; prefixo: string[] } {
  /* `timeout` porque `spawnSync` sem ele espera para sempre. Um binário
     chamado cloudflared que não responde a `--version` — outro programa com o
     mesmo nome, um script pela metade — travaria o comando inteiro antes de
     imprimir qualquer coisa, e sem nada na tela para explicar. */
  const existe = spawnSync('cloudflared', ['--version'], { stdio: 'ignore', timeout: 4000 })
  if (existe.status === 0) return { comando: 'cloudflared', prefixo: [] }
  return { comando: 'npx', prefixo: ['--yes', PACOTE_TUNEL] }
}

/**
 * Abre um túnel e devolve a URL pública.
 *
 * O cloudflared imprime a URL no stderr, no meio de um quadro desenhado com
 * caracteres de caixa — por isso a busca é por regex e não por linha.
 */
async function abrirTunel(nome: string, porta: number): Promise<string> {
  const { comando, prefixo } = comandoDoTunel()
  const filho = spawn(comando, [...prefixo, 'tunnel', '--url', `http://localhost:${porta}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  filhos.push(filho)

  return new Promise((resolve, reject) => {
    let achou = false
    /* 120s porque a PRIMEIRA vez inclui baixar o binário do cloudflared. As
       seguintes levam segundos. */
    const limite = setTimeout(() => {
      if (!achou) reject(new Error(`o túnel de ${nome} não respondeu em 120s`))
    }, 120_000)

    const olhar = (d: Buffer): void => {
      const texto = d.toString()
      const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(texto)?.[0]
      if (url && !achou) {
        achou = true
        clearTimeout(limite)
        resolve(url)
      }
    }
    filho.stdout?.on('data', olhar)
    filho.stderr?.on('data', olhar)
    filho.on('error', (e) => {
      clearTimeout(limite)
      reject(e)
    })
    filho.on('exit', (code) => {
      if (!achou) {
        clearTimeout(limite)
        reject(new Error(`cloudflared saiu com ${code} antes de dar a URL`))
      }
    })
  })
}

/** Serve o `dist` sem passar pelo vite, que recusa host desconhecido. */
function servirEstatico(dir: string, porta: number): void {
  const tipos: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
  }
  createServer((req, res) => {
    void (async () => {
      const pedido = (req.url ?? '/').split('?')[0] ?? '/'
      const relativo = pedido === '/' ? 'index.html' : pedido.replace(/^\//, '')
      // Nada de subir diretório.
      const seguro = path.normalize(relativo).replace(/^(\.\.[/\\])+/, '')
      let alvo = path.join(dir, seguro)
      let corpo = await readFile(alvo).catch(() => null)
      if (corpo === null) {
        // Rota do React que não é arquivo: devolve o index.
        alvo = path.join(dir, 'index.html')
        corpo = await readFile(alvo).catch(() => null)
      }
      if (corpo === null) {
        res.writeHead(404)
        return res.end('não encontrado')
      }
      res.writeHead(200, { 'content-type': tipos[path.extname(alvo)] ?? 'application/octet-stream' })
      res.end(corpo)
    })()
  }).listen(porta)
}

async function main(): Promise<void> {
  console.log('\n  Subindo o motor…')
  subir('motor', 'npx', ['tsx', 'apps/realtime/src/server.ts'], raiz)

  const { comando } = comandoDoTunel()
  console.log(
    comando === 'cloudflared'
      ? '  Abrindo o túnel do motor…'
      : '  Abrindo o túnel do motor… (na primeira vez, baixa o cloudflared; pode demorar)',
  )
  let motorPublico: string
  try {
    motorPublico = await abrirTunel('motor', PORTA_MOTOR)
  } catch (e) {
    console.error(`\n  Não consegui abrir o túnel: ${e instanceof Error ? e.message : String(e)}`)
    console.error('\n  Na primeira vez ele baixa o binário do cloudflared, o que pede')
    console.error('  internet liberada. Se a sua rede bloqueia, tente de outra.\n')
    return parar()
  }
  console.log(`  motor público: ${motorPublico}`)

  /* O endereço do motor entra no site na hora de CONSTRUIR, não de servir:
     o Vite troca `import.meta.env.VITE_API` por texto no bundle. Construir
     antes de conhecer a URL do túnel produziria um site apontando para
     localhost — que é justamente o erro que este script existe para evitar. */
  console.log('  Construindo o site apontado para esse endereço…')
  await new Promise<void>((resolve, reject) => {
    const build = spawn('npx', ['vite', 'build', '--outDir', 'dist-publico'], {
      cwd: site,
      stdio: 'inherit',
      env: { ...process.env, VITE_API: motorPublico },
    })
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite build saiu com ${code}`))))
  })

  servirEstatico(dist, PORTA_SITE)
  console.log('  Abrindo o túnel do site…')
  const sitePublico = await abrirTunel('site', PORTA_SITE)

  console.log('')
  console.log('  ┌─────────────────────────────────────────────────────────┐')
  console.log('  │  Manda este link:                                       │')
  console.log(`  │     ${sitePublico.padEnd(52)}│`)
  console.log('  └─────────────────────────────────────────────────────────┘')
  console.log('')
  console.log('  O link vive enquanto este terminal estiver aberto. Ctrl+C derruba.')
  console.log('  Quem abrir dispara auditorias a partir do SEU IP — não espalhe.')
  console.log('')
}

void main()
