#!/usr/bin/env node
/**
 * CLI do motor.
 *
 *   npm run preflight -- <url> [--pretty]
 *   npm run detect    -- <url> [--pretty] [--headless] [--owner-verified]
 *
 * `audit` (jornada completa) entra no Bloco 3.
 *
 * Padrão do projeto é headed (§19). Em máquina sem tela, rode sob
 * `xvfb-run -a` ou passe --headless.
 */

import { preflight, createDeps } from './preflight.ts'
import { detect } from './detect.ts'

const COMMANDS = ['preflight', 'detect'] as const
type Command = (typeof COMMANDS)[number]

function usage(): never {
  console.error(
    [
      'Uso:',
      '  npm run preflight -- <url> [--pretty]',
      '  npm run detect    -- <url> [--pretty] [--headless] [--owner-verified]',
      '',
      'Flags:',
      '  --pretty           JSON indentado',
      '  --headless         desliga o modo headed (padrão do projeto é headed)',
      '  --save-html        salva o HTML renderizado em out/ (automático quando',
      '                     a plataforma não é identificada)',
      '  --owner-verified   audita caminhos proibidos pelo robots.txt sob',
      '                     titularidade confirmada. Na Fase 1 a titularidade é',
      '                     DECLARADA, não verificada. Use só com autorização do dono.',
    ].join('\n'),
  )
  process.exit(2)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0] as Command | undefined
  if (!command || !COMMANDS.includes(command)) usage()

  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const target = argv.slice(1).find((a) => !a.startsWith('--'))
  if (!target) usage()

  const indent = flags.has('--pretty') ? 2 : 0

  const result =
    command === 'preflight'
      ? await preflight(target, createDeps())
      : await detect(target, {
          headed: !flags.has('--headless'),
          ownerVerified: flags.has('--owner-verified'),
          saveHtml: flags.has('--save-html'),
        })

  console.log(JSON.stringify(result, null, indent))
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, errorCode: 'NETWORK_ERROR', errorReason: String(e) }))
  process.exit(1)
})
