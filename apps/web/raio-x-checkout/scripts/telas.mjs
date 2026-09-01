/**
 * Tira print das cinco telas em desktop e celular, e falha se achar problema.
 *
 * Existe porque revisar por print pedido ao Bruno nao escala: o build passa
 * limpo em erro visual, e duas regressoes desta sessao (selo branco sobre
 * branco, card escuro escondendo o titulo) so apareceram no navegador.
 *
 *   node scripts/telas.mjs            usa http://127.0.0.1:4173
 *   node scripts/telas.mjs http://localhost:5173
 */
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";

const BASE = (process.argv[2] || "http://127.0.0.1:4173").replace(/\/$/, "");
const SAIDA = "telas";

const TELAS = [
  { id: "1-landing", nome: "Landing" },
  { id: "2-execucao", nome: "Execução ao vivo", espera: 7000 },
  { id: "3-resultado", nome: "Resultado", inteira: true },
  { id: "4-bloqueio", nome: "Loja bloqueou o robô" },
  { id: "5-conexao", nome: "Conexão interrompida" },
  { id: "6-gravacao", nome: "Resultado", gravacao: true },
];

const TAMANHOS = [
  { id: "desktop", viewport: { width: 1280, height: 900 } },
  { id: "celular", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

const problemas = [];

/** Erro de fonte e do sandbox sem rede, nao do app. */
const ruido = (t) => t.includes("fonts.googleapis") || t.includes("ERR_CONNECTION_RESET");

async function abrir(page, tela) {
  await page.goto(`${BASE}/?estados=1`, { waitUntil: "networkidle" });
  /* No celular o menu de estados fica escondido pelo CSS, e e so por ele que
     da para alcancar as outras telas. Forco a visibilidade aqui, no arnes: o
     produto continua sem o menu no celular. */
  await page.addStyleTag({ content: ".state-menu{display:block!important}.state-popover{display:block!important}" });
  await page.waitForTimeout(600);
  if (tela.id === "1-landing") return;
  await page.evaluate(() => { const d = document.querySelector(".state-menu"); if (d) d.open = true; });
  await page.waitForTimeout(200);
  await page.click(`.state-popover button:has-text("${tela.nome}")`);
  await page.evaluate(() => { const d = document.querySelector(".state-menu"); if (d) d.open = false; });
  await page.waitForTimeout(tela.espera ?? 900);
  /* A gravacao so se alcanca pelo rodape do resultado, que e onde ela mora
     de verdade — nao ha atalho no menu de estados, e nao vou inventar um. */
  if (tela.gravacao) {
    await page.click('button:has-text("Ver a gravação")');
    await page.waitForTimeout(700);
  }
}

const b = await chromium.launch();
await rm(SAIDA, { recursive: true, force: true });
await mkdir(SAIDA, { recursive: true });

for (const tam of TAMANHOS) {
  const ctx = await b.newContext(tam);
  for (const tela of TELAS) {
    const page = await ctx.newPage();
    const onde = `${tela.id} ${tam.id}`;
    page.on("pageerror", (e) => problemas.push(`${onde}: erro de JS — ${e.message.slice(0, 130)}`));
    page.on("console", (m) => { if (m.type() === "error" && !ruido(m.text())) problemas.push(`${onde}: console — ${m.text().slice(0, 120)}`); });

    try {
      await abrir(page, tela);
    } catch (e) {
      problemas.push(`${onde}: nao consegui abrir a tela — ${String(e).slice(0, 110)}`);
      await page.close();
      continue;
    }

    await page.screenshot({ path: `${SAIDA}/${tela.id}-${tam.id}.png`, fullPage: !!tela.inteira });

    const achados = await page.evaluate(() => {
      const out = [];
      const doc = document.documentElement;
      const sobra = doc.scrollWidth - doc.clientWidth;
      if (sobra > 1) out.push(`rola ${sobra}px na horizontal`);

      /* Texto invisivel: mesma cor que o fundo atras dele. Foi assim que os
         selos de severidade sumiram sem o build reclamar. */
      const cor = (el) => {
        let n = el;
        while (n && n !== doc) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
          n = n.parentElement;
        }
        return "rgb(255, 255, 255)";
      };
      for (const el of document.querySelectorAll("span, h1, h2, h3, h4, p, button, a")) {
        const t = (el.textContent || "").trim();
        if (!t || el.children.length) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
        if (!el.getClientRects().length) continue;
        if (cs.color === cor(el)) out.push(`texto invisivel: "${t.slice(0, 42)}"`);
      }
      return out;
    });
    for (const a of achados) problemas.push(`${onde}: ${a}`);
    await page.close();
  }
  await ctx.close();
}
await b.close();

console.log(`${TELAS.length * TAMANHOS.length} prints em ${SAIDA}/`);
if (problemas.length) {
  console.log(`\n${problemas.length} problema(s):`);
  for (const p of [...new Set(problemas)]) console.log(`  ${p}`);
  process.exit(1);
}
console.log("nenhum problema encontrado");
