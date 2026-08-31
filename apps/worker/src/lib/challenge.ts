/**
 * Detecção de página de desafio antibot.
 *
 * §18 pede: "site protegido retorna partial explicado, nunca erro cru". E §2.2
 * proíbe testar a proteção de terceiros. Então a única resposta correta a um
 * desafio é RECONHECER, PARAR e EXPLICAR. Contornar seria transformar auditoria
 * em ataque, que é a linha que o documento traça.
 *
 * Isto também não é achado contra a loja: proteger a vitrine é decisão legítima
 * do lojista, e o comprador dela passa pelo desafio normalmente.
 *
 * Observado em 2026-08-31 na Insider Store, depois de várias auditorias
 * seguidas do mesmo IP: página de 10 KB com `_cf_chl_opt` e
 * `challenges.cloudflare.com`, servida no lugar da página de produto.
 */

export interface ChallengeEvidence {
  vendor: string
  signals: string[]
}

const VENDORS: Array<{ vendor: string; markers: string[] }> = [
  {
    vendor: 'Cloudflare',
    markers: ['_cf_chl_opt', 'challenges.cloudflare.com', 'cf-browser-verification', 'cf_chl_'],
  },
  { vendor: 'DataDome', markers: ['datadome', 'dd_cookie_test'] },
  { vendor: 'PerimeterX', markers: ['perimeterx', '_pxhd', 'px-captcha'] },
  { vendor: 'Akamai', markers: ['ak_bmsc', '_abck'] },
  { vendor: 'Imperva', markers: ['incapsula', '_incap_'] },
]

/** Páginas de desafio são pequenas. Página de loja de verdade não tem 15 KB. */
const CHALLENGE_MAX_BYTES = 60_000

export function detectBotChallenge(html: string, currentUrl: string): ChallengeEvidence | null {
  const lower = html.toLowerCase()

  for (const { vendor, markers } of VENDORS) {
    const hits = markers.filter((m) => lower.includes(m.toLowerCase()))
    if (hits.length === 0) continue

    // Marcador de fornecedor sozinho não basta: uma loja pode usar Cloudflare
    // como CDN sem estar desafiando ninguém. O que caracteriza o desafio é a
    // página ser pequena e não ter conteúdo de loja.
    const looksLikeChallengePage = html.length < CHALLENGE_MAX_BYTES
    if (!looksLikeChallengePage) continue

    return {
      vendor,
      signals: [
        ...hits.map((h) => `marcador "${h}" no HTML`),
        `página de ${(html.length / 1024).toFixed(0)} KB no lugar do conteúdo esperado`,
        `URL não mudou: ${currentUrl}`,
      ],
    }
  }
  return null
}
