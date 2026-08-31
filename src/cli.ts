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
import { audit, summarize } from './audit.ts'

const COMMANDS = ['preflight', 'detect', 'audit'] as const
type Command = (typeof COMMANDS)[number]

function usage(): never {
  console.error(
    [
      'Uso:',
      '  npm run preflight -- <url> [--pretty]',
      '  npm run detect    -- <url> [--pretty] [--headless] [--owner-verified]',
      '  npm run audit     -- <url> [--pretty] [--headless] [--owner-verified] [--fill-checkout]',
      '',
      'preflight  valida URL, SSRF, blocklist e robots. Não abre browser.',
      'detect     identifica a plataforma. Abre o browser.',
      'audit      jornada: produto -> carrinho. Salva screenshots em out/.',
      '',
      'Flags:',
      '  --pretty           JSON indentado',
      '  --summary          só o que interessa para conferir a rodada (audit)',
      '  --headless         desliga o modo headed (padrão do projeto é headed)',
      '  --save-html        salva o HTML renderizado em out/ (automático quando',
      '                     a plataforma não é identificada)',
      '  --force            ignora o intervalo mínimo entre auditorias do mesmo',
      '                     domínio. Só em loja própria: repetir contra loja de',
      '                     terceiro é o que a §2.2 proíbe.',
      '  --from-br          declara que a auditoria sai de IP brasileiro. Sem isto,',
      '                     modal de redirecionamento regional é tratado como provável',
      '                     artefato e não vira achado contra a loja.',
      '  --fill-checkout    preenche contato e entrega para alcançar a tela de',
      '                     meios de pagamento. Exige identidade no .env.',
      '                     NUNCA preenche cartão nem conclui pedido (§2.1).',
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

  const shared = {
    headed: !flags.has('--headless'),
    ownerVerified: flags.has('--owner-verified'),
  }

  const result =
    command === 'preflight'
      ? await preflight(target, createDeps())
      : command === 'detect'
        ? await detect(target, { ...shared, saveHtml: flags.has('--save-html') })
        : await audit(target, { ...shared, fillCheckout: flags.has('--fill-checkout'),
            // undefined, não false: sem a flag NÃO se sabe de onde a auditoria
            // sai. `false` afirmaria "não é Brasil", que ninguém declarou.
            ...(flags.has('--from-br') ? { fromBrazil: true } : {}),
            force: flags.has('--force'),
          })

  const output =
    command === 'audit' && flags.has('--summary')
      ? summarize(result as Awaited<ReturnType<typeof audit>>)
      : result

  console.log(JSON.stringify(output, null, indent))
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, errorCode: 'NETWORK_ERROR', errorReason: String(e) }))
  process.exit(1)
})
