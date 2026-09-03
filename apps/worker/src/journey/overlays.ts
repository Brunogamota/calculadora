/**
 * Overlays que cobrem o botão de comprar, e a diferença crítica entre os dois
 * tipos que existem:
 *
 *   1. Overlay REAL — cookie, newsletter, promoção. O comprador brasileiro vê,
 *      e ele custa venda. Isso é achado.
 *
 *   2. Overlay de REDIRECIONAMENTO GEOGRÁFICO — "temos uma loja para a sua
 *      região". Só aparece para visitante de fora do país da loja. Se o motor
 *      roda de um datacenter fora do Brasil, ele vê essa tela e o comprador
 *      brasileiro NÃO vê.
 *
 * Reportar o segundo como defeito da loja é acusar o lojista de um problema
 * que só existe porque auditamos do lugar errado. Por isso ele é classificado
 * e marcado como provável artefato, nunca contado como achado.
 *
 * Observado em 2026-08-31 na Insider Store, auditada de um Codespaces fora do
 * Brasil: div#cozyCRModal, "We have a dedicated store to serve your region".
 */

export type OverlayKind = 'geo-redirect' | 'consent' | 'marketing' | 'unknown'

const GEO_TERMS = [
  'dedicated store',
  'your region',
  'sua região',
  'sua regiao',
  'outro país',
  'outro pais',
  'another country',
  'shop in your country',
  'change country',
  'mudar de país',
  'international store',
  'ship to',
]

const CONSENT_TERMS = ['cookie', 'privacidade', 'consentimento', 'aceitar todos', 'accept all']

const MARKETING_TERMS = ['newsletter', 'cupom', 'desconto', 'assine', 'inscreva', 'ganhe']

/** Texto de botão que fecha overlay sem sair da loja. Léxico, não seletor. */
export const DISMISS_TEXT =
  /^(fechar|close|x|×|continuar (no|neste) site|continuar comprando|ficar (aqui|no site)|stay|n(ã|a)o,? obrigad|no,? thanks|not now|agora n(ã|a)o|aceitar|accept|entendi|ok)/i

export function classifyOverlay(text: string): OverlayKind {
  const lower = text.toLowerCase()
  if (GEO_TERMS.some((t) => lower.includes(t))) return 'geo-redirect'
  if (CONSENT_TERMS.some((t) => lower.includes(t))) return 'consent'
  if (MARKETING_TERMS.some((t) => lower.includes(t))) return 'marketing'
  return 'unknown'
}

/**
 * Um overlay de geo-redirect visto de fora do país da loja quase certamente é
 * artefato do ponto de observação, não defeito da loja.
 */
export function isLikelyAuditArtifact(kind: OverlayKind, auditedFromBrazil: boolean | null): boolean {
  return kind === 'geo-redirect' && auditedFromBrazil !== true
}

// ---------------------------------------------------------------- detecção

/** O que foi observado cobrindo a tela, sem depender de um alvo específico. */
export interface SobreposicaoVista {
  identity: string
  text: string | null
}

/**
 * Acha sobreposição EM QUALQUER LUGAR da tela, não em cima de um alvo.
 *
 * O `findBlocker` da jornada pergunta "tem algo cobrindo ESTE botão?", e por
 * isso só enxerga modal na página de produto, em cima do botão de comprar.
 * Banner de cookie na entrada, popup de oferta e gaveta de carrinho não cobrem
 * botão nenhum — e ninguém os fechava.
 *
 * A busca é por FORMA, não por seletor de tema: diálogo declarado, ou elemento
 * presa à janela cobrindo boa parte dela. Lista de seletor por loja não escala
 * e já saiu do projeto uma vez.
 */
export async function acharSobreposicao(
  page: import('playwright').Page,
): Promise<SobreposicaoVista | null> {
  /* Vai como TEXTO, não como função.
     O `tsx` transpila este arquivo com esbuild, e o esbuild embrulha funções
     nomeadas — inclusive arrow atribuída a `const` — num auxiliar `__name` que
     existe no módulo e NÃO existe dentro da página. Passando a função, o
     Playwright serializa o código embrulhado e ele quebra com
     "ReferenceError: __name is not defined" no navegador.
     Foi exatamente o que aconteceu: a detecção devolvia "não tem sobreposição"
     em toda auditoria, e o `.catch` engolia o motivo. */
  const script = `(() => {
    const identidade = function (el) {
      const id = el.id ? '#' + el.id : '';
      const cls = typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
        : '';
      return (el.tagName.toLowerCase() + id + cls).slice(0, 160);
    };
    /* innerText, NÃO textContent: textContent traz o conteúdo de <style> e
       <script>, e um overlay real já devolveu um bloco de CSS aqui. Com CSS no
       lugar da frase a classificação vira "unknown", e o modal de geo deixa de
       ser marcado como artefato — o oposto do que a proteção faz. */
    const texto = function (el) {
      const t = (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
      return t || null;
    };
    const visivel = function (el) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // 1. Diálogo declarado. É o caso mais honesto e o mais barato de achar.
    const dialogos = Array.prototype.slice.call(
      document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')
    );
    for (let i = 0; i < dialogos.length; i++) {
      if (visivel(dialogos[i])) return { identity: identidade(dialogos[i]), text: texto(dialogos[i]) };
    }

    /* 2. Elemento preso à janela cobrindo boa parte dela: modal sem \`role\`,
          gaveta de carrinho, barra de cookie. O piso de área evita confundir
          com cabeçalho fixo, que é presença normal e não atrapalha nada. */
    const janela = window.innerWidth * window.innerHeight;
    let maior = null;
    const todos = Array.prototype.slice.call(document.body.querySelectorAll('*'));
    for (let i = 0; i < todos.length; i++) {
      const el = todos[i];
      const st = getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky') continue;
      if (!visivel(el)) continue;
      const r = el.getBoundingClientRect();
      const area =
        Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0)) *
        Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
      if (area < janela * 0.12) continue;
      if (maior === null || area > maior.area) maior = { el: el, area: area };
    }
    if (maior) return { identity: identidade(maior.el), text: texto(maior.el) };
    return null;
  })()`

  try {
    return (await page.evaluate(script)) as SobreposicaoVista | null
  } catch (e) {
    /* Não engole o motivo. Um `.catch(() => null)` aqui transformava "o script
       quebrou" em "não tem sobreposição" — que é resultado inventado, e mentira
       tranquila é o pior modo de falhar deste projeto. */
    console.error(`[raio-x] leitura de sobreposição falhou: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ----------------------------------------------------------------- dispensa

export interface Dispensa {
  /** O que foi tentado, na ordem. Vazio quando não havia o que fechar. */
  attempts: string[]
  /** Sumiu de fato — conferido de novo depois de cada tentativa. */
  dismissed: boolean
  /** Cliques dados para fechar. Um comprador daria os mesmos. */
  clicks: number
}

/**
 * A escada de fechar: Esc, rótulo acessível, texto visível.
 *
 * Recebe `aindaTem` porque as duas perguntas usam a mesma escada e não podem
 * divergir: "está cobrindo o botão de comprar?" e "tem sobreposição na tela?".
 * Havia só a primeira, escrita dentro do `addToCart`.
 *
 * `podeClicar` é a trava da §2.1, e ela passou a existir aqui porque não
 * existia: a escada clicava em qualquer coisa com rótulo de fechar, sem
 * conferir se aquilo era mesmo um "fechar". Botão que finaliza pedido com
 * `aria-label="close"` seria clicado sem ninguém perguntar nada.
 */
export async function dispensarSobreposicao(
  page: import('playwright').Page,
  aindaTem: () => Promise<boolean>,
  seletoresDeFechar: ReadonlyArray<{ id: string; selector: string }>,
  podeClicar: (l: import('playwright').Locator) => Promise<void>,
): Promise<Dispensa> {
  const attempts: string[] = []
  let clicks = 0

  // 1. Esc — gesto padrão, não depende de seletor nenhum.
  attempts.push('Escape')
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(400)
  if (!(await aindaTem())) return { attempts, dismissed: true, clicks }

  // 2. Botão de fechar por rótulo acessível.
  for (const spec of seletoresDeFechar) {
    const fechar = page.locator(spec.selector).first()
    if ((await fechar.count()) === 0) continue
    if (!(await fechar.isVisible().catch(() => false))) continue
    /* Recusa vira tentativa registrada, não exceção: um botão perigoso com
       rótulo de fechar não pode derrubar a auditoria — só não é clicado. */
    try {
      await podeClicar(fechar)
    } catch {
      attempts.push(`${spec.id}: recusado pela trava de clique`)
      continue
    }
    attempts.push(spec.id)
    await fechar.click({ timeout: 3000 }).catch(() => undefined)
    clicks++
    await page.waitForTimeout(400)
    if (!(await aindaTem())) return { attempts, dismissed: true, clicks }
  }

  // 3. Botão pelo TEXTO visível — é o que uma pessoa faria ao ver "aceitar"
  //    ou "continuar neste site". Léxico, não seletor de tema.
  const porTexto = page.getByRole('button', { name: DISMISS_TEXT }).first()
  if ((await porTexto.count()) > 0 && (await porTexto.isVisible().catch(() => false))) {
    let liberado = true
    try {
      await podeClicar(porTexto)
    } catch {
      liberado = false
      attempts.push('texto-de-fechar: recusado pela trava de clique')
    }
    if (liberado) {
      attempts.push('texto-de-fechar')
      await porTexto.click({ timeout: 3000 }).catch(() => undefined)
      clicks++
      await page.waitForTimeout(400)
    }
  }

  return { attempts, dismissed: !(await aindaTem()), clicks }
}

/** O que a passagem de limpeza observou e fez, num momento da jornada. */
export interface LimpezaDeSobreposicao {
  present: boolean
  identity: string | null
  text: string | null
  kind: OverlayKind
  dismissed: boolean
  attempts: string[]
  clicks: number
  likelyAuditArtifact: boolean
}

export const SEM_SOBREPOSICAO: LimpezaDeSobreposicao = {
  present: false,
  identity: null,
  text: null,
  kind: 'unknown',
  dismissed: false,
  attempts: [],
  clicks: 0,
  likelyAuditArtifact: false,
}

/**
 * Uma passagem: olha a tela, e fecha o que estiver cobrindo.
 *
 * Roda nos momentos em que o comprador encontraria o obstáculo — ao entrar na
 * loja, ao abrir o produto, ao chegar no carrinho. Antes só existia dentro do
 * `addToCart`, condicionada a haver algo em cima do botão de comprar, então
 * banner de cookie na entrada e popup de oferta ficavam na tela a jornada
 * inteira.
 *
 * `podeClicar` entra por parâmetro para este módulo não passar a depender do
 * adaptador da plataforma: a trava da §2.1 é de lá, a escada é daqui.
 */
export async function limparSobreposicao(
  page: import('playwright').Page,
  seletoresDeFechar: ReadonlyArray<{ id: string; selector: string }>,
  podeClicar: (l: import('playwright').Locator) => Promise<void>,
  auditedFromBrazil: boolean | null,
): Promise<LimpezaDeSobreposicao> {
  const vista = await acharSobreposicao(page)
  if (!vista) return SEM_SOBREPOSICAO

  const kind = classifyOverlay(vista.text ?? '')
  const dispensa = await dispensarSobreposicao(
    page,
    async () => (await acharSobreposicao(page)) !== null,
    seletoresDeFechar,
    podeClicar,
  )

  return {
    present: true,
    identity: vista.identity,
    text: vista.text,
    kind,
    dismissed: dispensa.dismissed,
    attempts: dispensa.attempts,
    clicks: dispensa.clicks,
    likelyAuditArtifact: isLikelyAuditArtifact(kind, auditedFromBrazil),
  }
}

/**
 * A frase que vai no relatório, em português de lojista.
 *
 * É OBSERVAÇÃO, não achado: sobreposição na entrada não está entre as 13
 * checagens da §8, e criar uma 14ª em silêncio mudaria o significado da nota,
 * que é normalizada pelas aplicáveis. Devolve null quando não há o que contar.
 */
export function notaDaSobreposicao(
  limpeza: LimpezaDeSobreposicao,
  onde: string,
): string | null {
  if (!limpeza.present) return null
  if (limpeza.likelyAuditArtifact) {
    return (
      `${onde} apareceu uma tela de redirecionamento por região. Ela provavelmente só ` +
      `aparece para quem acessa de fora do país da loja, então NÃO conta contra a loja: ` +
      `o comprador brasileiro não a vê.`
    )
  }
  const tipo =
    limpeza.kind === 'consent'
      ? 'um aviso de cookies'
      : limpeza.kind === 'marketing'
        ? 'um popup de oferta'
        : 'uma sobreposição'
  const desfecho = limpeza.dismissed
    ? `a auditoria fechou em ${limpeza.clicks} clique(s)`
    : 'a auditoria NÃO conseguiu fechar, e seguiu com ele na tela'
  return `${onde} apareceu ${tipo}; ${desfecho}. O comprador precisa do mesmo toque a mais.`
}
