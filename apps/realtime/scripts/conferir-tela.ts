/**
 * Confere que a TELA DE RESULTADO não inventa — num navegador de verdade.
 *
 *   npm run conferir:tela
 *
 * Existe porque a auditoria da allbirds saiu com cinco achados críticos e um
 * print de "Sérum de vitamina C 30ml" carimbado com o endereço real da loja, e
 * as 427 checagens da suíte passaram enquanto isso acontecia: todas elas
 * exercitam o motor, nenhuma abre a tela. Suíte verde com produto mentindo é
 * evidência de teste ausente, não de código são.
 *
 * O defeito era uma corrida. O motor emite `step:done report` e, logo em
 * seguida, `complete`. Enquanto a tela saía da execução pelo CONTADOR de
 * etapas, o primeiro evento já bastava para navegar; o `Running` desmontava, e
 * o `complete` chegava para um componente morto, levando nota e cobertura
 * embora. Sem cobertura, a tela caía no ramo do desenho.
 *
 * Medido: numa rodada os dois eventos chegaram no mesmo lote (9316ms) e o
 * relatório saiu certo; noutra, 22ms os separaram (23604ms e 23626ms) e saiu o
 * desenho. Por isso este roteiro ATRASA o `complete` de propósito: contar com
 * a sorte do agendador faria uma rodada boa "confirmar" uma correção que não
 * fez nada.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startFakeStore } from '../../worker/test/fixtures/fake-shopify.ts'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const site = path.join(raiz, 'apps/web/raio-x-checkout')

const PORTA_MOTOR = 4000
const PORTA_SITE = 5173
/* Bem acima dos 22ms que quebraram na prática: se a correção depender de o
   `complete` chegar rápido, ela falha aqui. */
const ATRASO_DO_COMPLETE_MS = 300

process.env['PORT'] = String(PORTA_MOTOR)
process.env['RAIO_X_QUIET'] = '1'
process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'
process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'

const filhos: ChildProcess[] = []

function parar(): void {
  for (const f of filhos) {
    if (f.pid === undefined) continue
    // O menos no pid alcança o grupo: sem isso o Vite fica vivo segurando a porta.
    try {
      process.kill(-f.pid, 'SIGKILL')
    } catch {
      /* já morreu */
    }
  }
}

async function esperarNoAr(url: string, tentativas = 60): Promise<void> {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} não subiu`)
}

async function main(): Promise<number> {
  const loja = await startFakeStore({ overlay: 'consent' })
  await import('../src/server.ts')
  await esperarNoAr(`http://localhost:${PORTA_MOTOR}/health`)

  const vite = spawn('npm', ['run', 'dev'], { cwd: site, stdio: 'ignore', detached: true })
  filhos.push(vite)
  await esperarNoAr(`http://localhost:${PORTA_SITE}/`)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  /* As fontes do Google não são o objeto do teste e penduram a carga em rede
     restrita. Cortar aqui deixa o roteiro rodar em qualquer máquina. */
  await page.route('**://fonts.googleapis.com/**', (r) => r.abort())
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort())

  /**
   * Vai como TEXTO, não como função.
   *
   * O `tsx` transpila este arquivo com esbuild, e o esbuild embrulha funções
   * nomeadas num auxiliar `__name` que existe no módulo e NÃO existe dentro da
   * página. Passando a função, o Playwright serializa o código embrulhado, ele
   * quebra calado no navegador, o atraso nunca acontece — e o roteiro passava
   * anunciando "tela honesta" sem ter testado a corrida. Foi o que aconteceu
   * aqui, e só apareceu porque o roteiro confere o próprio instrumento.
   */
  await page.addInitScript({
    content: `(() => {
      window.__atrasou = false;
      const Original = window.WebSocket;
      const Atrasado = function (...args) {
        const ws = new Original(...args);
        let daTela = null;
        /* A tela usa \`ws.onmessage = ...\`; interceptar a propriedade é o que
           permite segurar UM evento sem tocar no código de produção. */
        Object.defineProperty(ws, 'onmessage', {
          set(fn) { daTela = fn; },
          get() { return daTela; },
        });
        ws.addEventListener('message', (m) => {
          if (!daTela) return;
          let tipo = '';
          try { tipo = JSON.parse(String(m.data)).type || ''; } catch (e) { /* não é JSON nosso */ }
          if (tipo === 'complete') {
            window.__atrasou = true;
            setTimeout(() => daTela(m), ${ATRASO_DO_COMPLETE_MS});
          } else {
            daTela(m);
          }
        });
        return ws;
      };
      Atrasado.prototype = Original.prototype;
      window.WebSocket = Atrasado;
    })()`,
  })

  await page.goto(`http://localhost:${PORTA_SITE}/`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[aria-label="endereço da sua loja"]', loja.url)
  // Marcar o aceite manda a auditoria em `consentido`, que é o caminho que
  // percorre carrinho e checkout — o que produz cobertura de verdade.
  const aceite = page.locator('input[type="checkbox"]').first()
  if ((await aceite.count()) > 0) await aceite.check()
  await page.locator('form.url-form button[type="submit"]').click()

  await page.waitForSelector('.resultado', { timeout: 180_000 })
  await page.waitForTimeout(1000)

  const visto = await page.evaluate(() => ({
    texto: document.body.innerText,
    manchete: document.querySelector('.nota-copy h1')?.textContent ?? '',
    temEvidenciaDoDesenho: document.querySelector('.evidencia') !== null,
    atrasou: (window as unknown as { __atrasou?: boolean }).__atrasou === true,
  }))
  await browser.close()

  if (!visto.atrasou) {
    console.error('\n  O ROTEIRO NÃO TESTOU NADA: não conseguiu atrasar o `complete`.')
    console.error('  Sem a separação forçada, a corrida não acontece e o resultado não vale.')
    return 1
  }

  const problemas: string[] = []
  /* Cada item aqui é uma coisa que a tela mostrou numa auditoria real de uma
     loja que ela nunca mediu. São literais de propósito: se alguém trocar o
     texto do desenho, o teste tem que ser atualizado junto e olhar para ele. */
  if (visto.texto.includes('Sérum de vitamina C')) problemas.push('mostrou o carrinho inventado do desenho')
  if (visto.temEvidenciaDoDesenho) problemas.push('mostrou o quadro de evidência do desenho')
  if (visto.manchete.includes('Veja onde a venda está se perdendo')) {
    problemas.push('caiu na manchete de reserva — sinal de que a cobertura se perdeu no caminho')
  }
  if (!/Verificamos \d+ das \d+ checagens/.test(visto.manchete)) {
    problemas.push(`manchete não é o resumo medido: "${visto.manchete}"`)
  }

  if (problemas.length > 0) {
    console.error('\n  A TELA MENTIU:')
    for (const p of problemas) console.error(`    · ${p}`)
    return 1
  }
  console.log(`\n  Tela honesta, com o complete atrasado em ${ATRASO_DO_COMPLETE_MS}ms.`)
  console.log(`  manchete: ${visto.manchete}`)
  return 0
}

const codigo = await main().catch((e: unknown) => {
  console.error(`\n  o roteiro falhou: ${e instanceof Error ? e.message : String(e)}`)
  return 1
})
parar()
process.exit(codigo)
