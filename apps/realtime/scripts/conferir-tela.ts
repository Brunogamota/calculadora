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
  await page.close()

  if (!visto.atrasou) {
    await browser.close()
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

  /* Segunda cena: o PAINEL DE ETAPAS. Uma loja cujo `/cart.js` fica ilegível
     faz a jornada seguir sem confirmação — `AddToCartResult.ok === null` — e o
     painel marcava aquilo com o certinho preto, dizendo "consegui" sobre o que
     o motor sabia não ter confirmado. Só dá para olhar DURANTE a auditoria: a
     tela de execução some quando o relatório chega. */
  /* A home entrega em pedaços, como loja real: dá tempo de a transmissão
     mostrar alguma coisa antes de o carregamento terminar. */
  const lojaIlegivel = await startFakeStore({ carrinhoIlegivel: true, homeStreamDelayMs: 1500 })
  const painel = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  await painel.route('**://fonts.googleapis.com/**', (r) => r.abort())
  await painel.route('**://fonts.gstatic.com/**', (r) => r.abort())
  /* Terceira cena, na mesma auditoria: QUANDO a imagem começa.
     A captura só subia depois do `prepare` inteiro — home carregada e
     plataforma detectada —, então o primeiro frame chegava 72ms DEPOIS do fim
     do `identify` e o espectador olhava para o esqueleto durante os 4,5s que
     aquela etapa levou na allbirds. Agora ela começa quando o navegador
     nasce, e o primeiro frame tem que chegar ANTES de o `identify` acabar.
     Vai como texto pelo mesmo motivo do outro: o esbuild embrulha função. */
  await painel.addInitScript({
    content: `(() => {
      window.__t = { primeiroFrame: null, identifyFim: null, emBranco: 0 };
      const Original = window.WebSocket;
      const Espiao = function (...args) {
        const ws = new Original(...args);
        ws.addEventListener('message', (m) => {
          let ev = null;
          try { ev = JSON.parse(String(m.data)); } catch (e) { return; }
          if (ev.type === 'frame') {
            if (window.__t.primeiroFrame === null) window.__t.primeiroFrame = Date.now();
            /* Frame de página em branco: o navegador já existe e ainda não
               navegou. Publicar aquilo troca o esqueleto honesto por um
               retângulo vazio que parece defeito. */
            if (ev.url === 'about:blank' || ev.url === '') window.__t.emBranco++;
          }
          if (ev.type === 'step:done' && ev.id === 'identify' && window.__t.identifyFim === null) {
            window.__t.identifyFim = Date.now();
          }
        });
        return ws;
      };
      Espiao.prototype = Original.prototype;
      window.WebSocket = Espiao;
    })()`,
  })
  await painel.goto(`http://localhost:${PORTA_SITE}/`, { waitUntil: 'domcontentloaded' })
  await painel.fill('input[aria-label="endereço da sua loja"]', lojaIlegivel.url)
  const aceite2 = painel.locator('input[type="checkbox"]').first()
  if ((await aceite2.count()) > 0) await aceite2.check()
  await painel.locator('form.url-form button[type="submit"]').click()

  let marcaVista: { classe: string; motivo: string } | null = null
  const limite = Date.now() + 180_000
  while (Date.now() < limite) {
    const agora = await painel
      .evaluate(() => {
        const etapas = Array.from(document.querySelectorAll('.etapa'))
        // "adicionando ao carrinho" é a terceira etapa do painel.
        const alvo = etapas.find((e) => (e.querySelector('h3')?.textContent ?? '').includes('carrinho'))
        if (!alvo) return null
        const ponto = alvo.querySelector('.etapa-ponto')
        const classe = ponto?.className ?? ''
        if (classe.includes('agora') || classe.includes('fila')) return null
        return { classe, motivo: alvo.querySelector('.etapa-desfecho')?.textContent ?? '' }
      })
      .catch(() => null)
    if (agora) {
      marcaVista = agora
      break
    }
    if (await painel.evaluate(() => document.querySelector('.resultado') !== null).catch(() => false)) break
    await painel.waitForTimeout(150)
  }
  /* A cena do tempo precisa da auditoria inteira, então espera o relatório. */
  await painel.waitForSelector('.resultado', { timeout: 180_000 }).catch(() => undefined)
  const tempos = await painel
    .evaluate(() => (window as unknown as { __t?: { primeiroFrame: number | null; identifyFim: number | null; emBranco: number } }).__t)
    .catch(() => undefined)
  await lojaIlegivel.close()

  /**
   * O que se afirma aqui é o que NÃO depende da máquina: a imagem chega, e
   * nenhum frame sai com a página em branco.
   *
   * Havia uma terceira afirmação — "o primeiro frame chega antes de o
   * `identify` terminar" — e ela foi removida porque não era verificável. O
   * primeiro frame só existe depois de a loja PINTAR, e isso varia com a
   * máquina, a versão do Chromium e a loja: a mesma asserção, com o mesmo
   * código, deu 1470ms de folga aqui e 16ms de atraso no Mac do Bruno. Duas
   * tentativas de estabilizá-la falharam lá.
   *
   * O que a correção mudou de fato — a captura começar quando o navegador
   * nasce, e não quando o `prepare` acaba — é medido em
   * `apps/worker/test/e2e/captura-cedo.test.ts`, no relógio do motor, sem
   * pintura no meio.
   */
  if (!tempos || tempos.primeiroFrame === null) {
    problemas.push('nenhum frame chegou à tela durante a auditoria')
  } else {
    if (tempos.emBranco > 0) {
      problemas.push(`${tempos.emBranco} frame(s) publicados com a página ainda em branco`)
    }
    if (problemas.length === 0) {
      const relativo = tempos.identifyFim === null ? 'sem `identify` para comparar' : `${tempos.identifyFim - tempos.primeiroFrame}ms em relação ao fim do \`identify\` (informativo)`
      console.log(`  imagem: chegou · 0 frames em branco · ${relativo}`)
    }
  }

  if (marcaVista === null) {
    problemas.push('não consegui observar a etapa do carrinho no painel — o roteiro não testou o painel')
  } else {
    if (marcaVista.classe.includes('feito')) {
      problemas.push(`painel marcou "adicionando ao carrinho" como CONCLUÍDA num carrinho que não confirmou (${marcaVista.classe})`)
    }
    if (!marcaVista.classe.includes('sem-confirmar')) {
      problemas.push(`painel não usou a marca de "sem confirmar": classe "${marcaVista.classe}"`)
    }
    if (marcaVista.motivo.trim().length === 0) {
      problemas.push('painel não mostrou o motivo que o motor mandou')
    }
  }

  await browser.close()

  if (problemas.length > 0) {
    console.error('\n  A TELA MENTIU:')
    for (const p of problemas) console.error(`    · ${p}`)
    return 1
  }
  console.log(`  painel: ${marcaVista?.classe.trim()} · "${marcaVista?.motivo}"`)
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
