#!/usr/bin/env node
/**
 * CLI do motor. Na Fase 1 só existe `preflight`; `audit` entra nos blocos 2-4.
 *
 *   npm run preflight -- https://loja.com.br
 *   npm run preflight -- loja.com.br --pretty
 */

import { preflight, createDeps } from './preflight.ts'

function usage(): never {
  console.error(
    [
      'Uso: npm run preflight -- <url> [--pretty]',
      '',
      'Roda a validação de URL, os guards de SSRF, a blocklist e o robots.txt',
      'e imprime o resultado em JSON. Nenhum browser é aberto nesta etapa.',
    ].join('\n'),
  )
  process.exit(2)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const positional = argv.slice(1).filter((a) => !a.startsWith('--'))

  if (command !== 'preflight') usage()
  const target = positional[0]
  if (!target) usage()

  const result = await preflight(target, createDeps())
  const indent = flags.has('--pretty') ? 2 : 0
  console.log(JSON.stringify(result, null, indent))
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, errorCode: 'NETWORK_ERROR', errorReason: String(e) }))
  process.exit(1)
})
