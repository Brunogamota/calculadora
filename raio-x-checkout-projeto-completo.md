# Raio-X do Checkout — Projeto completo

Ferramenta pública da Reborn. A pessoa cola a URL da própria loja, um robô faz uma jornada de compra real na frente dela, ao vivo, e no fim devolve um relatório com os achados que estão fazendo aquela loja perder venda.

A execução ao vivo não é detalhe técnico, é o produto. Os 60 segundos que o robô leva são o momento em que a pessoa grava a tela e manda pro sócio.

---

## Índice

1. Objetivo e princípios
2. Limites que não podem ser violados
3. Arquitetura
4. Stack
5. Fluxo do usuário
6. O motor de auditoria
7. Streaming ao vivo estilo Replit
8. Checagens e pontuação
9. Camada de IA
10. Estimativa de perda
11. Modelo de dados
12. API e eventos
13. Frontend
14. Tratamento de falha
15. Estrutura de pastas
16. Variáveis de ambiente
17. Fases de entrega
18. Critérios de aceite
19. Como trabalhar com o Claude Code neste projeto

---

## 1. Objetivo e princípios

**O que a ferramenta faz:** recebe a URL de um e-commerce brasileiro, detecta a plataforma, encontra um produto, adiciona ao carrinho, chega até a tela de pagamento, coleta evidências e devolve um relatório com nota e achados priorizados. Tudo isso transmitido ao vivo para o usuário assistir.

**Três princípios que decidem qualquer dúvida de implementação:**

1. **Nunca entregar resultado inventado.** Se uma checagem não pôde ser feita com certeza, ela sai como "não aplicável". Relatório errado queima a ferramenta na primeira vez.
2. **O resultado nunca fica atrás de formulário.** O relatório aparece antes de pedir e-mail. Travar mata o compartilhamento, que é a razão de existir do produto.
3. **A espera é o espetáculo.** Toda decisão de UX deve tornar a execução mais assistível, não mais curta.

---

## 2. Limites que não podem ser violados

Ler antes de codar. Isso define arquitetura, não é aviso legal.

1. **Nunca finalizar pedido.** A jornada para na tela onde os meios de pagamento aparecem. Nada de submeter cartão, gerar Pix real ou criar pedido.
2. **Nunca testar antifraude de terceiros.** Não tentar cartão de teste, não repetir tentativa para provocar velocity, não simular fraude. Isso é o que separa auditoria de ataque.
3. **Respeitar robots.txt** e limitar a 1 requisição por segundo por domínio.
4. **User-Agent identificável:** `RebornCheckoutAudit/1.0 (+https://rebornpay.io/raio-x)`, com página pública explicando o que a ferramenta faz e como pedir bloqueio.
5. **Proteção contra SSRF:** rejeitar IP direto, localhost, faixas privadas e redirect que caia nessas faixas.
6. **Blocklist e opt-out** funcionando desde a primeira versão pública.
7. **Publicação com marca só com autorização.** No relatório privado, tudo. Em conteúdo público, anonimiza ou pede autorização por escrito.

---

## 3. Arquitetura

```
Browser (Next.js)
   |  POST /api/audit
   v
API cria job -----> Redis + BullMQ
   |                     |
   |  WebSocket          v
   |  (sala = auditId)  Worker (container com Playwright)
   |                     |
   +<--- frames ---------+  screencast via CDP
   +<--- eventos --------+  passos da jornada
                         |
                         v
                  Postgres + R2/S3
```

Web e worker são processos separados. Playwright não roda em serverless: a web pode ficar na Vercel, o worker precisa de container.

O canal de tempo real liga o worker ao browser da pessoa. Na v1, o worker publica num Redis pub/sub e um servidor WebSocket leve repassa para a sala correspondente ao `auditId`. Isso evita expor o worker diretamente e facilita escalar depois.

---

## 4. Stack

- **Next.js 15 (App Router) + TypeScript** — site, API e relatório
- **Tailwind** — UI
- **Playwright (Chromium)** — automação
- **CDP `Page.startScreencast`** — transmissão dos frames
- **BullMQ + Redis** — fila, retry e pub/sub
- **ws** (ou Socket.IO) — canal de tempo real
- **Postgres + Prisma** — persistência
- **Cloudflare R2 ou S3** — screenshots finais
- **Anthropic API (claude-sonnet-4-6)** — interpretação qualitativa
- **Zod** — validação de entrada e do output do LLM
- **Resend** — envio do relatório

---

## 5. Fluxo do usuário

1. Cola a URL e clica em auditar.
2. A API valida, cria o job, devolve `auditId` e o usuário entra na sala do WebSocket.
3. **A tela abre em modo execução:** painel de passos à esquerda, navegador ao vivo à direita.
4. Os passos vão aparecendo com spinner e virando check. O navegador mostra o robô clicando de verdade.
5. Em 40 a 90 segundos a execução termina e a tela transiciona para o relatório.
6. O relatório aparece completo, sem pedir nada.
7. Abaixo dele, um campo opcional pede faturamento para calcular a estimativa de perda, e outro pede e-mail para receber o PDF.

---

## 6. O motor de auditoria

### 6.1 Normalização e validação
- Aceitar com ou sem protocolo, com ou sem www
- Rejeitar IP, localhost e faixas privadas
- Seguir redirect, revalidar o destino contra as mesmas regras
- Checar blocklist e robots.txt

### 6.2 Detecção de plataforma
Nesta ordem:
- **Shopify**: `window.Shopify`, `cdn.shopify.com`, header `x-shopid`, rota `/products.json`
- **VTEX**: `window.vtex`, `vtexassets.com`, `vtexcommercestable`, rota `/api/catalog_system/pub/products/search`
- **Nuvemshop**: `window.LS`, `nuvemshop`, `tiendanube`
- **WooCommerce**: `wp-content/plugins/woocommerce`
- **Fallback genérico**: heurística por seletores comuns

Cada plataforma é um módulo com a mesma interface:

```ts
interface PlatformAdapter {
  name: string
  detect(page: Page, html: string, headers: Headers): Promise<boolean>
  findProduct(page: Page, baseUrl: string): Promise<ProductRef>
  addToCart(page: Page, product: ProductRef): Promise<void>
  reachCheckout(page: Page): Promise<CheckoutContext>
}
```

### 6.3 Encontrar produto
- Preferir API pública quando existir (`/products.json`, catálogo VTEX)
- Fallback: abrir a home e procurar link de produto
- Escolher item disponível, barato, sem variação obrigatória complexa

### 6.4 Adicionar ao carrinho
- Selecionar variação padrão se necessário
- Clicar em comprar
- Confirmar carrinho por API quando disponível
- Registrar tempo e se apareceu modal, drawer ou redirect

### 6.5 Chegar ao checkout
- Registrar cada passo com URL, timestamp e screenshot
- Contar cliques desde a página do produto
- Detectar login obrigatório
- Parar na tela dos meios de pagamento

### 6.6 Coletar na tela de pagamento
- Meios visíveis e a ordem deles
- Presença de Pix e se o desconto aparece antes ou só ali
- Parcelas com valor e juros explícitos
- Campo de cupom
- Selo de segurança
- Opção de salvar cartão
- Se pede CPF (apenas observação de campo, sem submissão)

### 6.7 Repetir em mobile
Emular iPhone 14 e refazer a jornada. Comparar número de passos, tempo e meios visíveis. A diferença entre desktop e mobile costuma ser o achado mais forte do relatório.

### 6.8 Coleta paralela
- Descritor de fatura quando exposto no rodapé ou nos termos
- Tempo de carregamento de home, produto e checkout
- HTTPS válido em todas as etapas
- Gateway identificável nos scripts (Mercado Pago, Pagar.me, Stripe, Adyen, Cielo, Getnet, Braspag, Yapay, Appmax)

---

## 7. Streaming ao vivo estilo Replit

A referência é o Replit rodando um teste: painel de execução à esquerda, navegador à direita, passos aparecendo em texto enquanto a tela muda.

### 7.1 Captura de frames

Usar CDP em vez de screenshot em loop:

```ts
const client = await page.context().newCDPSession(page)
await client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 60,
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 2,
})

client.on('Page.screencastFrame', async ({ data, sessionId }) => {
  publish(auditId, { type: 'frame', data })
  await client.send('Page.screencastFrameAck', { sessionId })
})
```

O `screencastFrameAck` é obrigatório. Sem ele o Chrome para de enviar frames depois de alguns.

Alvo: 5 a 10 frames por segundo, qualidade 60. Acima disso o ganho visual é pequeno e o custo de banda sobe rápido.

### 7.2 Cursor visível

O screencast não captura o ponteiro do mouse. Sem cursor, parece que a página muda sozinha e perde metade do efeito. A solução é injetar um cursor falso na página e movê-lo junto com o mouse real:

```ts
await page.addInitScript(() => {
  const dot = document.createElement('div')
  dot.id = '__reborn_cursor'
  dot.style.cssText = `
    position: fixed; z-index: 2147483647; width: 20px; height: 20px;
    border-radius: 50%; background: rgba(255,45,110,.35);
    border: 2px solid #ff2d6e; pointer-events: none;
    transform: translate(-50%,-50%); transition: transform .08s linear;
  `
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(dot))
  window.__movecursor = (x, y) => {
    const el = document.getElementById('__reborn_cursor')
    if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`
  }
})
```

Antes de cada clique: mover o mouse de verdade com `page.mouse.move` em passos, chamando `__movecursor` a cada passo, esperar uns 200ms e só então clicar. Fica mais lento de propósito, e é isso que torna assistível.

### 7.3 Eventos de passo

Além dos frames, o worker publica eventos semânticos:

```ts
type AuditEvent =
  | { type: 'step:start';  id: string; label: string }
  | { type: 'step:done';   id: string; detail?: string }
  | { type: 'step:fail';   id: string; reason: string }
  | { type: 'frame';       data: string }
  | { type: 'finding';     code: string; severity: Severity; title: string }
  | { type: 'complete';    auditId: string }
```

Passos da v1, na ordem: identificando a loja, abrindo um produto, adicionando ao carrinho, indo pro checkout, lendo os meios de pagamento, repetindo no celular, montando o relatório.

Publicar achado durante a execução, e não só no fim, aumenta muito a retenção: a pessoa vê o problema aparecer em tempo real.

### 7.4 Transporte

Worker publica no Redis (`audit:{id}`). Um servidor WebSocket assina o canal e repassa para a sala. O front conecta com o `auditId` e renderiza.

Se a conexão cair, o front reconecta e recebe o estado atual dos passos, mas não o histórico de frames. Frame perdido é frame perdido.

### 7.5 Detalhes que decidem a percepção

- Colocar um leve atraso artificial entre passos. A execução crua é rápida e ilegível.
- Manter o último frame congelado ao terminar, com um leve escurecimento, antes de transicionar para o relatório.
- Botão de compartilhar visível **durante** a execução, não só no fim.
- No mobile, browser em cima e passos embaixo, com o browser ocupando 60% da altura.

---

## 8. Checagens e pontuação

Cada checagem tem id, severidade, evidência e recomendação. Nota final: 100 menos a soma dos pesos disparados, normalizada pelas checagens aplicáveis.

| ID | Checagem | Severidade |
|---|---|---|
| `HTTPS_ISSUE` | Alguma etapa fora de HTTPS | crítica |
| `PAY_VISIBILITY` | Meios de pagamento só aparecem depois do carrinho | alta |
| `PIX_DISCOUNT_LATE` | Desconto no Pix só revelado no checkout | alta |
| `INSTALLMENT_UNCLEAR` | Parcelamento sem valor por parcela ou sem juros explícito | alta |
| `STEP_COUNT` | Mais de 5 passos do produto ao pagamento | alta |
| `MOBILE_PARITY` | Mobile com menos meios ou mais passos que desktop | alta |
| `FORCED_LOGIN` | Login obrigatório antes do checkout | alta |
| `DESCRIPTOR_UNCLEAR` | Descritor de fatura ausente ou sem relação com a marca | média |
| `CHECKOUT_SPEED` | Checkout carregando acima de 3s | média |
| `NO_SAVED_CARD` | Não oferece salvar cartão | média |
| `NO_COUPON_FIELD` | Sem campo de cupom | baixa |
| `NO_TRUST_SIGNAL` | Sem selo ou menção de segurança | baixa |

Checagem não aplicável sai do denominador em vez de virar penalidade.

---

## 9. Camada de IA

O LLM **não** decide se a checagem passou. Isso é determinístico. Ele entra depois, para três coisas:

1. **Interpretar clareza.** Recebe o HTML limpo da tela de pagamento e diz se um comprador leigo entenderia parcelamento, prazo e valor final.
2. **Escrever o achado.** Transformar `STEP_COUNT: 8` numa frase que o dono da loja entende, com a recomendação.
3. **Resumir o veredito** em três linhas no topo do relatório.

Regras: output em JSON validado com Zod, temperatura baixa, proibido citar número que não veio da coleta. Se não validar, usa o texto padrão da checagem.

---

## 10. Estimativa de perda

O bloco mais delicado. Se parecer chute, o lojista descarta o relatório inteiro.

- Só aparece se a pessoa informar faturamento, num campo opcional depois do relatório
- Apresentar como intervalo, nunca número exato
- Premissas visíveis na tela
- Nunca prometer recuperação

Formato: "Lojas com esses achados costumam perder entre X% e Y% do faturamento em vendas que não se completam. No seu volume, isso são de R$ A a R$ B por mês."

---

## 11. Modelo de dados

```prisma
model Audit {
  id            String   @id @default(cuid())
  url           String
  finalDomain   String
  platform      String?
  status        String   // queued | running | done | partial | failed
  progressStep  String?
  score         Int?
  gateway       String?
  desktopSteps  Int?
  mobileSteps   Int?
  checkoutMs    Int?
  findings      Json?
  rawData       Json?
  errorReason   String?
  createdAt     DateTime @default(now())
  completedAt   DateTime?
  screenshots   Screenshot[]
  lead          Lead?
}

model Screenshot {
  id       String @id @default(cuid())
  auditId  String
  audit    Audit  @relation(fields: [auditId], references: [id])
  step     String
  viewport String // desktop | mobile
  url      String
}

model Lead {
  id        String   @id @default(cuid())
  auditId   String   @unique
  audit     Audit    @relation(fields: [auditId], references: [id])
  email     String
  revenue   String?
  segment   String?
  createdAt DateTime @default(now())
}

model Blocklist {
  domain    String   @id
  reason    String
  createdAt DateTime @default(now())
}
```

---

## 12. API e eventos

```
POST /api/audit            { url } -> { auditId }
GET  /api/audit/:id        status e resultado
POST /api/audit/:id/lead   { email, revenue?, segment? }
GET  /r/:id                relatório público, com og:image dinâmica
POST /api/optout           { domain, email }
WS   /live?auditId=...     canal de execução ao vivo
```

Rate limit: 3 auditorias por IP por hora. Cache de 24h por domínio.

---

## 13. Frontend

**Home:** um campo, um botão, e a prova social abaixo ("já auditamos N checkouts"). Nada mais acima da dobra.

**Tela de execução:** o coração do produto. Painel de passos à esquerda, navegador ao vivo à direita, achados aparecendo conforme surgem, botão de compartilhar visível.

**Relatório:**
- Nota grande com veredito de três linhas
- Achados por severidade, cada um com o print como evidência
- Desktop e mobile lado a lado
- Estimativa de perda opcional
- Compartilhamento com og:image gerada contendo a nota

A og:image dinâmica é o que faz o link circular no WhatsApp. Vale o esforço.

---

## 14. Tratamento de falha

Site fora, Cloudflare bloqueando, plataforma desconhecida, produto esgotado, checkout com login: tudo isso vai acontecer.

- Timeout global de 120s
- 2 tentativas com backoff
- Falha parcial vira `partial` com o que foi coletado, nunca resultado inventado
- Toda falha grava `errorReason`
- Painel interno simples listando últimas auditorias e causas de falha economiza semanas

---

## 15. Estrutura de pastas

```
/apps
  /web
    /app
      page.tsx
      /a/[id]/page.tsx        execução ao vivo
      /r/[id]/page.tsx        relatório
      /api/audit/route.ts
      /api/audit/[id]/route.ts
      /api/audit/[id]/lead/route.ts
      /api/optout/route.ts
    /components
      UrlForm.tsx
      LiveBrowser.tsx
      StepPanel.tsx
      Report.tsx
  /worker
    /src
      index.ts
      /platforms
        detect.ts shopify.ts vtex.ts nuvemshop.ts generic.ts
      /journey
        findProduct.ts addToCart.ts reachCheckout.ts collectPayment.ts
      /checks
        index.ts /rules/*.ts
      /stream
        screencast.ts cursor.ts publisher.ts
      /ai
        interpret.ts
      /lib
        browser.ts storage.ts robots.ts guards.ts
  /realtime
    server.ts                 WebSocket + Redis subscribe
/packages
  /db      Prisma
  /types   tipos e eventos compartilhados
```

---

## 16. Variáveis de ambiente

```
DATABASE_URL=
REDIS_URL=
ANTHROPIC_API_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
RESEND_API_KEY=
NEXT_PUBLIC_WS_URL=
AUDIT_USER_AGENT=RebornCheckoutAudit/1.0 (+https://rebornpay.io/raio-x)
MAX_AUDIT_MS=120000
```

---

## 17. Fases de entrega

**Fase 1 — Motor (não avançar antes de funcionar de verdade)**
Script de terminal que recebe URL, detecta plataforma, faz a jornada completa em Shopify, coleta os dados da seção 6.6, salva screenshots e imprime JSON tipado. Sem UI, sem fila, sem banco.

**Fase 2 — Ao vivo**
Screencast, cursor injetado, eventos de passo, WebSocket, tela de execução. É aqui que o produto vira conteúdo.

**Fase 3 — Produto**
Fila, banco, relatório, og:image, captura de e-mail.

**Fase 4 — Cobertura**
VTEX e Nuvemshop, mobile completo, painel interno, blocklist, opt-out, rate limit.

**Fase 5 — Dado agregado**
Estatística acumulada por segmento. É o que transforma a ferramenta em fonte de conteúdo recorrente e em benchmark que ninguém mais tem.

---

## 18. Critérios de aceite

- Auditar loja Shopify real de ponta a ponta em menos de 90 segundos
- Acertar a plataforma em pelo menos 9 de 10 lojas conhecidas
- Nenhum pedido criado em nenhuma loja auditada, verificado manualmente
- Execução ao vivo fluida, com cursor visível e passos sincronizados
- Relatório com pelo menos 4 achados com evidência visual
- Site protegido retorna `partial` explicado, nunca erro cru
- robots.txt e blocklist respeitados em toda execução

---

## 19. Como trabalhar com o Claude Code neste projeto

O gargalo aqui não é escrever código, é descobrir por que a loja X não abriu o carrinho. Isso é depuração contra site real.

**Trabalhe em blocos pequenos e testáveis.** Peça o detector de plataforma sozinho, teste em cinco lojas, só depois vá pra jornada. Pedir tudo de uma vez produz algo que parece pronto e falha na primeira loja real.

**Rode com `headless: false` durante o desenvolvimento.** Ver a tela é o que te permite descrever o problema.

**Salve o HTML das lojas que falharem.** Colar o HTML real resolve seletor em minutos; descrever por cima leva meia hora.

**Nunca aceite seletor inventado.** Se o modelo propuser um seletor, valide na loja antes de seguir. Seletor errado passa despercebido e contamina todo o resto.

**Ordem sugerida:** guards e validação de URL, detecção de plataforma, jornada Shopify, checagens, screencast, cursor, WebSocket, front de execução, relatório.
