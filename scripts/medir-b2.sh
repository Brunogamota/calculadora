#!/usr/bin/env bash
# Mede o limiar do B2: de N lojas brasileiras que TERMINAREM, quantas entregam
# pelo menos um achado?
#
# Roda de dentro da máquina em gru, onde existe egresso e onde a origem já é
# brasileira (FLY_REGION=gru, ver CAL-46):
#
#   fly ssh console -a raio-x-motor
#   bash /app/scripts/medir-b2.sh
#
# §2.2 protegida por construção: cada domínio aparece UMA VEZ na lista, não há
# --force, e os três já medidos em 06/09 (zerezes, simpleorganic, pantys) estão
# fora dela de propósito. O placar do fim relê os arquivos daquela rodada em
# vez de auditar de novo.
#
# --headless não é contorno da falta de tela: é o que a produção usa
# (server.ts:231 só liga headed com AUDIT_HEADED=1). Medir headed daria um
# número que a produção não entrega.
set -u
cd /app

SAIDA="${RAIO_X_LEDGER_DIR:-/dados}"
LOJAS="bluntbrasil.com.br labellamafia.com.br boldsnacks.com.br zissou.com.br cadernointeligente.com.br gringa.com.br nutrify.com.br"

for d in $LOJAS; do
  echo "===== $d ====="
  npm run --silent audit -- "https://$d" --leitura --headless --summary \
    > "$SAIDA/b2-$d.json" 2> "$SAIDA/b2-$d.err"
  node -e '
    const fs = require("fs")
    const f = process.argv[1]
    let j
    try { j = JSON.parse(fs.readFileSync(f, "utf8")) }
    catch (e) {
      const err = fs.readFileSync(f.replace(/\.json$/, ".err"), "utf8")
      console.log("  não saiu JSON:", err.split("\n").slice(-6).join("\n  "))
      process.exit(0)
    }
    console.log("  status:", j.status, "| erro:", j.errorCode || "-", j.errorReason || "")
    const c = j.checks
    if (!c) { console.log("  sem checks"); process.exit(0) }
    console.log("  aplicaveis:", c.aplicaveis, "| falharam:", c.falharam)
    for (const a of c.achados) console.log("  ACHADO:", a)
  ' "$SAIDA/b2-$d.json"
done

echo
echo "===== PLACAR (inclui a rodada de 06/09) ====="
node -e '
  const fs = require("fs")
  let terminaram = 0, comAchado = 0, naoTerminaram = 0
  for (const f of process.argv.slice(1)) {
    let j
    try { j = JSON.parse(fs.readFileSync(f, "utf8")) }
    catch (e) { naoTerminaram++; console.log("  não-json        " + require("path").basename(f)); continue }
    const nome = require("path").basename(f).replace(/^b2-/, "").replace(/\.json$/, "")
    const d = (j.domain || nome).padEnd(26)
    if (!j.checks) { naoTerminaram++; console.log("  NÃO TERMINOU   ", d, j.errorCode || ""); continue }
    terminaram++
    const n = j.checks.falharam
    if (n > 0) comAchado++
    console.log("  " + (n > 0 ? "COM ACHADO     " : "sem achado     ") + d +
                "aplicaveis " + j.checks.aplicaveis + "  falharam " + n)
  }
  console.log()
  console.log("  terminaram: " + terminaram +
              "  |  com achado: " + comAchado +
              "  |  não terminaram: " + naoTerminaram)
  if (terminaram === 0) { console.log("\n  sem base para o limiar: nenhuma loja terminou"); process.exit(0) }
  const taxa = comAchado / terminaram
  const veredito =
    taxa >= 2 / 3 ? "A leitura grátis é ISCA: vale prometer na landing."
    : taxa >= 1 / 3 ? "A leitura ACOMPANHA, não promete. Mantém o B2 como está no PLANO.md."
    : "A Camada 1 SAI do lançamento; a landing pede autorização desde o primeiro campo."
  console.log("  taxa de achado: " + comAchado + "/" + terminaram +
              " (" + Math.round(taxa * 100) + "%)  →  " + veredito)
' "$SAIDA"/b2-*.json
