# A casa do motor.
#
# A imagem base é a OFICIAL do Playwright, presa na MESMA versão do
# package.json (1.56.0). Instalar Chromium à mão num Debian pelado significa
# caçar três dezenas de bibliotecas de sistema — libnss3, libdrm, libgbm,
# fontes — e descobrir qual falta pelo jeito mais caro: o navegador subindo e
# morrendo em produção. A imagem oficial já traz tudo, testado pela versão.
#
# Presa por versão de propósito: `latest` aqui significa que um dia o navegador
# muda sozinho e a jornada quebra sem ninguém ter tocado em nada. Ao subir o
# Playwright no package.json, esta linha sobe junto.
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

WORKDIR /app

# As dependências primeiro, e só elas: assim a camada de instalação é
# reaproveitada enquanto o package.json não mudar, e um deploy de código não
# rebaixa nada.
COPY package.json package-lock.json* ./
COPY packages/types/package.json ./packages/types/
COPY apps/worker/package.json ./apps/worker/
COPY apps/realtime/package.json ./apps/realtime/

# `--ignore-scripts` porque o postinstall do Playwright baixaria os navegadores
# de novo — e eles já vêm na imagem base. Sem isto o build fica minutos mais
# lento para chegar no mesmo lugar.
RUN npm ci --ignore-scripts || npm install --ignore-scripts

COPY packages ./packages
COPY apps/worker ./apps/worker
COPY apps/realtime ./apps/realtime

# O site NÃO entra aqui: ele é servido pelo Vercel. Esta imagem é só o motor.

ENV NODE_ENV=production
ENV PORT=8080

# `gru` é São Paulo, então a declaração é honesta. Ela muda como o motor lê
# tempo de carregamento e modal de redirecionamento por região — e declarar
# Brasil rodando de fora transformaria latência de datacenter em achado injusto
# contra a loja. Ver `vantageContradiction` em apps/worker/src/lib/environment.ts.
ENV AUDIT_FROM_BR=1

EXPOSE 8080

# Sem `--headed`: não há tela nenhuma num contêiner. A §19 pede headed por
# padrão no uso local, e o servidor já decide isso por `AUDIT_HEADED`.
CMD ["npx", "tsx", "apps/realtime/src/server.ts"]
