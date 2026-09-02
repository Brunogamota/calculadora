/**
 * Confere uma fatia contra LOJA REAL, e imprime só o que decide.
 *
 *   npm run conferir -- minhaloja.com.br
 *
 * Existe porque a verificação de cada fatia precisa ser uma linha que alguém
 * roda e cola de volta — não um JSON de trezentas linhas para garimpar. E
 * porque o container onde este código é escrito não alcança loja nenhuma: a
 * única verificação que vale acontece na máquina de quem tem internet.
 */

import { audit } from '../src/audit.ts'

const alvo = process.argv.slice(2).find((a) => !a.startsWith('-'))
if (!alvo) {
  console.error('uso: npm run conferir -- minhaloja.com.br [--consentido] [--headed]')
  process.exit(2)
}

const headed = process.argv.includes('--headed')

/* O modo é escolha explícita aqui também. O padrão é `leitura` porque é o
   único seguro para loja que não é sua: se a conferência assumisse
   `consentido` por conveniência, ela tocaria o carrinho de loja alheia sem
   ninguém ter dito nada. */
const consentido = process.argv.includes('--consentido')
const TEXTO_DO_ACEITE =
  'Sou responsável por esta loja e autorizo a auditoria, que vai navegar como ' +
  'um comprador e pode colocar um item no carrinho.'

const t0 = Date.now()
const r = await audit(alvo, {
  headed,
  modo: consentido ? 'consentido' : 'leitura',
  ...(consentido ? { aceite: { em: new Date().toISOString(), url: alvo, texto: TEXTO_DO_ACEITE } } : {}),
})
const regras = r.checks?.results ?? []
const comVeredito = regras.filter((c) => c.status === 'pass' || c.status === 'fail')

console.log('')
console.log(`  loja            ${alvo}`)
console.log(`  duração         ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`  status          ${r.status}${r.errorCode ? `  (${r.errorCode})` : ''}`)
if (r.errorReason) console.log(`  motivo          ${r.errorReason.slice(0, 100)}`)
console.log('')
console.log(`  modo            ${r.modo}${r.aceite ? `  (aceite de ${r.aceite.em})` : ''}`)
if (r.robots.blockedPaths.length > 0) {
  console.log(`  robots proíbe   ${r.robots.blockedPaths.join(', ')}`)
}
/* O que o consentimento de fato autorizou. Fica visível porque é o registro
   que justifica ter passado por cima do arquivo da loja. */
if (r.robots.overridesUsed.length > 0) {
  console.log(`  passou por cima ${r.robots.overridesUsed.map((o) => o.path).join(', ')}`)
}
console.log('')
console.log(`  resumo          ${r.checks?.coverageSummary ?? '-'}`)
console.log('')
console.log(`  FATIA 1 — a evidência sobrevive à falha:`)
console.log(`  observações     ${r.observations.length}  [${r.observations.map((o) => o.source).join(', ')}]`)
console.log(`  com veredito    ${comVeredito.length} de ${regras.length} regras`)
console.log(`  nota            ${r.checks?.score ?? '-'}`)
/* A ressalva de cobertura SEMPRE junto do número. Ela já existe no motor e já
   aparece na tela do lojista; era este script que imprimia a nota nua, e foi
   assim que um "nota 100" com 2 de 13 regras chegou até a conversa parecendo
   defeito do produto. Ferramenta de conferência que esconde a ressalva ensina
   a ler errado. */
if (r.checks?.scoreCaveat) console.log(`  ressalva        ${r.checks.scoreCaveat}`)
console.log(`  cobertura       ${Math.round((r.checks?.coverage.ratio ?? 0) * 100)}% da §8 em peso`)
console.log('')
for (const c of regras) {
  const motivo = c.status === 'not_applicable' ? `  ${(c.notApplicableReason ?? '').slice(0, 70)}` : ''
  const familia = c.coverageFamily ? `[${c.coverageFamily}] ` : ''
  console.log(`    ${c.status.padEnd(15)} ${c.id.padEnd(21)}  ${familia}${motivo.trim()}`)
}
console.log('')
console.log(`  achados         ${(r.checks?.findings ?? []).map((f) => f.id).join(', ') || '(nenhum)'}`)
console.log('')
process.exit(0)
