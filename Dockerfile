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

# Sobe um Chromium assim que o servidor nasce, e fecha.
#
# Medido nesta imagem, nesta hospedagem, numa máquina recém-reiniciada: a
# PRIMEIRA subida do navegador custou 16,7s, e a segunda 224 ms. O que custa é
# ler o binário do disco; fechar não desfaz, porque o que ficou quente é o
# cache de página do sistema. Sem isto, a primeira auditoria depois de cada
# deploy paga os 16s inteiros com a tela ao vivo parada.
#
# Ligado AQUI e não por padrão no código: fora de máquina hospedada a mesma
# subida custa ~0,1s, e não há o que aquecer. Ver aquecimento.ts.
ENV RAIO_X_AQUECER=1

# Intervalo mínimo entre uma navegação de saída e a próxima, do processo
# inteiro — seguro contra reputação de IP por ritmo de pedidos, NÃO
# confirmado por experimento (decisão consciente de pular a confirmação e
# proteger assim mesmo). Ver `apps/worker/src/lib/ritmo.ts`.
#
# Ligado AQUI e não por padrão no código, mesmo motivo do aquecimento: um
# teste que sobe a loja falsa várias vezes numa suíte não deveria pagar
# segundos de espera por uma proteção que só faz sentido contra loja real.
ENV RAIO_X_RITMO_SAIDA_MS=2000

EXPOSE 8080

# Sem `--headed`: não há tela nenhuma num contêiner. A §19 pede headed por
# padrão no uso local, e o servidor já decide isso por `AUDIT_HEADED`.
CMD ["npx", "tsx", "apps/realtime/src/server.ts"]
