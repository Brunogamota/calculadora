/**
 * §7.2 — cursor visível na página auditada.
 *
 * O screencast do Chrome não captura o ponteiro do mouse, e ele só entrega
 * frame quando a tela MUDA. Numa loja parada depois de carregar, nada muda:
 * medimos 6 frames numa auditoria inteira, um por navegação. O resultado é uma
 * imagem congelada onde deveria haver alguém navegando.
 *
 * O cursor resolve os dois de uma vez. Ele é um elemento dentro da página, e
 * mover ele repinta a tela — então o Chrome volta a mandar frame. O movimento
 * é a transmissão.
 *
 * Deslocar em passos, e não de um salto, é de propósito: cada passo é um
 * repaint, e a trajetória é o que deixa a gravação assistível. A §7.2 é
 * explícita — "fica mais lento de propósito, e é isso que torna assistível".
 */

import type { Page } from 'playwright'

/** Marca do cursor no DOM da loja. Nome improvável de colidir com o do site. */
const ID = '__reborn_cursor'

/**
 * Instala o cursor. Precisa rodar ANTES da primeira navegação: `addInitScript`
 * roda em toda navegação, inclusive nas que a jornada faz depois, então o
 * cursor sobrevive a mudar de página — que é onde um elemento injetado à mão
 * se perderia.
 */
export async function installCursor(page: Page): Promise<void> {
  await page.addInitScript(`
    (() => {
      const ID = ${JSON.stringify(ID)};
      const criar = () => {
        if (document.getElementById(ID)) return;
        const ponto = document.createElement('div');
        ponto.id = ID;
        ponto.style.cssText = [
          'position:fixed', 'left:0', 'top:0', 'z-index:2147483647',
          'width:22px', 'height:22px', 'border-radius:50%',
          'background:rgba(232,56,106,.28)', 'border:2px solid #E8386A',
          'box-shadow:0 0 0 6px rgba(232,56,106,.12)',
          'pointer-events:none', 'will-change:transform',
          'transform:translate(-100px,-100px) translate(-50%,-50%)',
          'transition:transform .08s linear'
        ].join(';');
        (document.body || document.documentElement).appendChild(ponto);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', criar);
      } else {
        criar();
      }
      window.__rebornCursor = (x, y) => {
        const el = document.getElementById(ID);
        if (el) el.style.transform = 'translate(' + x + 'px,' + y + 'px) translate(-50%,-50%)';
      };
    })();
  `)
}

/** Onde o cursor está, para o próximo movimento partir daqui. */
const onde = new WeakMap<Page, { x: number; y: number }>()

async function desenhar(page: Page, x: number, y: number): Promise<void> {
  await page
    .evaluate(([px, py]) => {
      const mover = (window as unknown as { __rebornCursor?: (x: number, y: number) => void }).__rebornCursor
      if (mover) mover(px as number, py as number)
    }, [x, y])
    .catch(() => undefined)
}

/**
 * Move o cursor até (x, y) em passos, movendo o mouse de verdade junto.
 *
 * O mouse real importa: hover, menu que abre ao passar e handler de
 * `mousemove` só disparam com ele. O cursor desenhado sozinho seria um enfeite
 * que mente sobre o que o robô está fazendo.
 */
export async function moveCursorTo(page: Page, x: number, y: number, passos = 14): Promise<void> {
  const de = onde.get(page) ?? { x: 0, y: 0 }
  for (let i = 1; i <= passos; i++) {
    /* Aceleração suave nas pontas: movimento linear lê como script, e a tela
       existe justamente para parecer alguém navegando. */
    const t = i / passos
    const suave = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    const px = Math.round(de.x + (x - de.x) * suave)
    const py = Math.round(de.y + (y - de.y) * suave)
    await page.mouse.move(px, py).catch(() => undefined)
    await desenhar(page, px, py)
    await page.waitForTimeout(18)
  }
  onde.set(page, { x, y })
}

/**
 * Leva o cursor até o elemento e clica, com a pausa que a §7.2 pede.
 *
 * Devolve false quando o elemento não tem caixa visível — aí quem chamou
 * decide, e continua podendo clicar do jeito antigo. O cursor nunca deve ser
 * o motivo de uma jornada falhar.
 */
export async function moveCursorToElement(page: Page, seletor: { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> }): Promise<boolean> {
  const caixa = await seletor.boundingBox().catch(() => null)
  if (!caixa || caixa.width === 0 || caixa.height === 0) return false
  await moveCursorTo(page, Math.round(caixa.x + caixa.width / 2), Math.round(caixa.y + caixa.height / 2))
  /* A pausa antes do clique é o que dá tempo de ver onde ele foi parar. */
  await page.waitForTimeout(220)
  return true
}

/**
 * Passeia enquanto a página está parada, para o screencast ter o que mandar.
 *
 * Sem isto, entre uma navegação e outra a tela fica congelada e a transmissão
 * emudece — que é exatamente o que o Bruno viu. O passeio é curto e some assim
 * que a jornada volta a agir.
 */
export async function idleCursor(page: Page, ms: number): Promise<void> {
  const fim = Date.now() + ms
  const tamanho = page.viewportSize() ?? { width: 1280, height: 720 }
  let i = 0
  while (Date.now() < fim) {
    const t = (i += 1) / 6
    const x = Math.round(tamanho.width * (0.34 + 0.22 * Math.sin(t)))
    const y = Math.round(tamanho.height * (0.38 + 0.16 * Math.cos(t * 1.3)))
    await moveCursorTo(page, x, y, 8)
  }
}
