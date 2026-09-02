/**
 * Liga a tela no motor: POST /api/audit e depois WebSocket /live?auditId=.
 *
 * O contrato é o de packages/types, que o worker e o realtime já falam. Aqui
 * não existe lógica de auditoria: só tradução de evento para estado de tela.
 *
 * Quando não há servidor, a tela roda em demonstração com os tempos do desenho.
 * Isso não é enfeite: é o que mantém `npm run telas`, a gravação de vídeo e a
 * revisão de layout funcionando sem subir o worker inteiro.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type StepId = "identify" | "open-product" | "add-to-cart" | "reach-checkout" | "read-payment" | "mobile" | "report";

export const STEP_IDS: StepId[] = ["identify", "open-product", "add-to-cart", "reach-checkout", "read-payment", "mobile", "report"];

type Severidade = "critica" | "alta" | "media" | "baixa";

/* O que deu e o que não deu para verificar, do jeito que o motor manda. É o
   que preenche o resumo e a lista de detalhe da tela de resultado — no lugar
   da manchete do desenho, que afirmava a mesma coisa em toda auditoria. */
export type Cobertura = {
  checked: number;
  unchecked: number;
  summary: string;
  rules: { id: string; title: string; status: "pass" | "fail" | "not_applicable"; reason: string | null }[];
};

type AuditEvent =
  | { type: "step:start"; id: StepId; label: string; at: string }
  | { type: "step:done"; id: StepId; detail?: string; at: string }
  | { type: "step:fail"; id: StepId; reason: string; at: string }
  | { type: "step:skip"; id: StepId; reason: string; at: string }
  | { type: "frame"; data: string; seq: number; url?: string }
  | { type: "finding"; code: string; severity: Severidade; title: string; at: string }
  | { type: "complete"; auditId: string; score: number | null; caveat: string | null; coverage?: Cobertura }
  | { type: "aborted"; auditId: string; code: string; reason: string }
  | { type: "state"; state: EstadoDoServidor };

/* O que o servidor manda para quem chega ou reconecta (§7.4): os PASSOS, nunca
   o histórico de frames. A tela ignorava isto — então quem reconectava via a
   barra voltar do zero, e mesmo quem só chegava tarde perdia o `step:start` da
   primeira etapa, que sai antes de o WebSocket abrir. */
type EstadoDoServidor = {
  steps?: { id: StepId; status: "running" | "done" | "failed" | "skipped"; startedAt?: string; finishedAt?: string }[];
  findings?: { code: string; severity: Severidade; title: string }[];
  finished?: boolean;
  score?: number | null;
  caveat?: string | null;
  coverage?: Cobertura;
};

export type EstadoAoVivo = {
  /** Quantas etapas já concluíram. É o mesmo `stage` que a tela simulada usa. */
  stage: number;
  /** Último frame recebido, já como data URI. null enquanto nenhum chegou. */
  frame: string | null;
  /** O endereço que o robô está vendo NESTE frame. A tela montava o endereço
   *  somando o domínio da loja com um caminho do desenho, e mostrava
   *  "carnan.com.br/serum-vitamina-c" — um produto que não existe naquela
   *  loja. Endereço inventado sobre imagem verdadeira parece evidência. */
  urlAtual: string | null;
  /** Os frames guardados para a gravação, com o segundo em que cada um chegou.
   *  Vivem só nesta aba: nada vai para disco, por decisão do Bruno. Quem abre
   *  o link sem ter assistido não tem gravação, e a tela diz isso. */
  gravacao: { data: string; t: number }[];
  /** Quantos frames o servidor mandou e não chegaram. Frame perdido é perdido,
   *  mas dá para saber QUE se perdeu — é o que o campo `seq` existe para dizer. */
  perdidos: number;
  achados: { code: string; severity: Severidade; title: string }[];
  fim: null | { score: number | null; caveat: string | null; cobertura: Cobertura | null };
  /** A auditoria parou por algo da LOJA: antibot, sessao cortada, prazo. */
  abortado: null | { code: string; reason: string };
  /** NOSSO lado falhou: servidor fora, rede, resposta invalida. Fica separado
   *  de propósito. Mostrar isto como "a loja caiu" seria acusar a loja de um
   *  problema nosso — e o projeto inteiro existe para nao inventar resultado. */
  falhaNossa: null | { reason: string };
  /** Há quantos segundos nenhuma imagem nova chega. Zero enquanto nem a
   *  primeira chegou — aí quem manda é `frame === null`. */
  semImagem: number;
  /** Etapas que a loja ou a fase PULARAM. Não são etapas feitas, e a tela não
   *  pode marcá-las como feitas: numa loja VTEX o robô pulou carrinho e
   *  checkout, e o painel exibiu as duas com o certinho verde, como se
   *  tivessem acontecido. */
  pulados: StepId[];
  /** Quanto cada etapa levou DE VERDADE, do relógio do motor. A tela trazia os
   *  segundos do desenho aqui, então uma etapa que levou 90s aparecia como
   *  "4.1s" — e era justamente onde a pessoa precisava olhar. */
  duracoes: Partial<Record<StepId, number>>;
  /** Segundos desde o início, para o cronômetro e as janelas de estado. */
  segundos: number;
  /** true quando existe servidor e a ligação está de pé. */
  aoVivo: boolean;
};

const VAZIO: EstadoAoVivo = {
  stage: 0, frame: null, gravacao: [], perdidos: 0, achados: [], fim: null, abortado: null, falhaNossa: null, segundos: 0, semImagem: 0, duracoes: {}, pulados: [], urlAtual: null, aoVivo: false,
};

/** Base da API. Sem ela, a tela roda em demonstração. */
export const API = (import.meta.env["VITE_API"] as string | undefined)?.replace(/\/$/, "") ?? "";

export function temServidor(): boolean {
  return API.length > 0;
}

/**
 * O texto EXATO que o responsável lê antes de marcar o aceite.
 *
 * Mora aqui, e não na tela, porque é o mesmo texto que viaja no registro do
 * aceite para o motor. Se a tela mostrasse um texto e o registro guardasse
 * outro, o registro seria falso — e ele é justamente o que autoriza a
 * auditoria a mexer no carrinho.
 */
export const TEXTO_DO_ACEITE =
  "Sou responsável por esta loja e autorizo a auditoria a adicionar um produto ao carrinho e abrir o checkout. A auditoria não finaliza pedido nem envia pagamento.";

/** O registro do aceite: quando, de qual loja, e o que foi lido. */
export type Aceite = { em: string; url: string; texto: string };

/** Monta o registro no instante do clique — antes da execução, como exigido. */
export function registrarAceite(url: string): Aceite {
  return { em: new Date().toISOString(), url, texto: TEXTO_DO_ACEITE };
}

/* Teto de frames na memória da aba. A 8 fps, 90s dão umas 720 imagens de ~9 KB,
   perto de 6 MB — muito para segurar sem limite. Ao estourar, eu ralo pela
   metade os mais antigos em vez de cortar o fim: a gravação perde suavidade no
   começo, mas continua cobrindo a auditoria inteira. Cortar o fim perderia
   justamente os achados, que aparecem tarde. */
const TETO_DE_FRAMES = 900;

function guardar(atual: { data: string; t: number }[], novo: { data: string; t: number }) {
  if (atual.length < TETO_DE_FRAMES) return [...atual, novo];
  const metade = Math.floor(atual.length / 2);
  const ralado = atual.filter((_, i) => i >= metade || i % 2 === 0);
  return [...ralado, novo];
}

/**
 * `aceite` decide o modo, e o modo decide o que a auditoria pode tocar.
 *
 * Com aceite registrado vai `consentido`: o robô adiciona ao carrinho e abre o
 * checkout. Sem ele vai `leitura`: lê a página do produto e para ali. Não há
 * padrão do lado do motor — auditoria sem modo declarado é recusada.
 */
export function useAuditoriaAoVivo(url: string | null, aceite: Aceite | null = null): EstadoAoVivo {
  const [estado, setEstado] = useState<EstadoAoVivo>(VAZIO);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!url || !temServidor()) return;

    let vivo = true;
    let ultimaSeq = 0;
    let ultimoFrameEm = 0;
    const inicio = Date.now();
    const relogio = window.setInterval(() => {
      if (!vivo) return;
      const semImagem = ultimoFrameEm === 0 ? 0 : (Date.now() - ultimoFrameEm) / 1000;
      setEstado((e) => ({ ...e, segundos: (Date.now() - inicio) / 1000, semImagem }));
    }, 100);

    /* Quando cada etapa começou, pelo relógio do motor. `at` vem em ISO no
       evento; usar o relógio do navegador aqui somaria a latência da rede à
       conta da loja. */
    const comecouEm = new Map<StepId, number>();

    /* Traduz o estado inteiro de uma vez. Cada etapa que já tem começo e fim
       entra com a duração medida; a que só começou entra só com o começo, para
       o `step:done` que vier depois ter de onde contar. */
    const doEstado = (e: EstadoAoVivo, st: EstadoDoServidor): EstadoAoVivo => {
      const duracoes = { ...e.duracoes };
      let stage = e.stage;
      for (const p of st.steps ?? []) {
        if (p.startedAt) comecouEm.set(p.id, Date.parse(p.startedAt));
        const inicio = comecouEm.get(p.id);
        if (p.finishedAt && inicio !== undefined) duracoes[p.id] = (Date.parse(p.finishedAt) - inicio) / 1000;
        if (p.status === "done" || p.status === "skipped") stage = Math.max(stage, STEP_IDS.indexOf(p.id) + 1);
      }
      const pulados = [...e.pulados];
      for (const p of st.steps ?? []) {
        if (p.status === "skipped" && !pulados.includes(p.id)) pulados.push(p.id);
      }
      const achados = [...e.achados];
      for (const f of st.findings ?? []) {
        if (!achados.some((a) => a.code === f.code)) achados.push({ code: f.code, severity: f.severity, title: f.title });
      }
      const fim =
        st.finished && st.score !== undefined
          ? { score: st.score, caveat: st.caveat ?? null, cobertura: st.coverage ?? null }
          : e.fim;
      return { ...e, stage, duracoes, achados, pulados, fim };
    };

    const aplicar = (ev: AuditEvent) => {
      if (ev.type === "step:start") comecouEm.set(ev.id, Date.parse(ev.at));
      setEstado((e) => {
        switch (ev.type) {
          case "step:fail": {
            const inicio = comecouEm.get(ev.id);
            if (inicio === undefined) return e;
            return { ...e, duracoes: { ...e.duracoes, [ev.id]: (Date.parse(ev.at) - inicio) / 1000 } };
          }
          case "step:done":
          case "step:skip":
          {
            /* Pulada conta como ANDADA, para a barra não ficar pendurada numa
               etapa que não vai acontecer — mas não conta como FEITA: fica
               registrada em `pulados`, e a tela a desenha diferente. */
            const inicio = comecouEm.get(ev.id);
            const duracoes =
              inicio === undefined ? e.duracoes : { ...e.duracoes, [ev.id]: (Date.parse(ev.at) - inicio) / 1000 };
            const pulados =
              ev.type === "step:skip" && !e.pulados.includes(ev.id) ? [...e.pulados, ev.id] : e.pulados;
            return { ...e, stage: Math.max(e.stage, STEP_IDS.indexOf(ev.id) + 1), duracoes, pulados };
          }
          case "frame": {
            const pulados = ev.seq > ultimaSeq + 1 ? ev.seq - ultimaSeq - 1 : 0;
            ultimaSeq = ev.seq;
            ultimoFrameEm = Date.now();
            const uri = `data:image/jpeg;base64,${ev.data}`;
            return {
              ...e,
              frame: uri,
              urlAtual: ev.url ?? e.urlAtual,
              perdidos: e.perdidos + pulados,
              gravacao: guardar(e.gravacao, { data: uri, t: (Date.now() - inicio) / 1000 }),
            };
          }
          case "finding":
            if (e.achados.some((a) => a.code === ev.code)) return e;
            return { ...e, achados: [...e.achados, { code: ev.code, severity: ev.severity, title: ev.title }] };
          case "complete":
            return {
              ...e,
              fim: { score: ev.score, caveat: ev.caveat, cobertura: ev.coverage ?? null },
              stage: STEP_IDS.length,
            };
          case "aborted":
            return { ...e, abortado: { code: ev.code, reason: ev.reason } };
          case "state":
            return doEstado(e, ev.state);
          default:
            return e;
        }
      });
    };

    void (async () => {
      let auditId = "";
      try {
        const r = await fetch(`${API}/api/audit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            aceite ? { url, modo: "consentido", aceite } : { url, modo: "leitura" },
          ),
        });
        const corpo = (await r.json()) as { auditId?: string; error?: string };
        if (!r.ok || !corpo.auditId) throw new Error(corpo.error ?? `HTTP ${r.status}`);
        auditId = corpo.auditId;
      } catch (erro) {
        /* Nao alcancamos o nosso proprio servidor. A tela precisa dizer isso e
           nao girar para sempre — mas dizer como falha NOSSA, nunca da loja. */
        if (vivo) setEstado((e) => ({ ...e, falhaNossa: { reason: String(erro) } }));
        return;
      }
      if (!vivo) return;

      const ws = new WebSocket(`${API.replace(/^http/, "ws")}/live?auditId=${encodeURIComponent(auditId)}`);
      socketRef.current = ws;
      ws.onmessage = (m) => {
        try {
          aplicar(JSON.parse(String(m.data)) as AuditEvent);
        } catch {
          /* Mensagem que não é JSON não derruba a tela. */
        }
      };
      ws.onopen = () => { if (vivo) setEstado((e) => ({ ...e, aoVivo: true })); };
      ws.onclose = () => { if (vivo) setEstado((e) => ({ ...e, aoVivo: false })); };
      ws.onerror = () => {
        if (vivo) setEstado((e) => ({ ...e, falhaNossa: { reason: "a transmissão caiu antes de terminar" } }));
      };
    })();

    return () => {
      vivo = false;
      window.clearInterval(relogio);
      socketRef.current?.close();
      socketRef.current = null;
    };
    /* `aceite` fica FORA das dependências de propósito: ele é montado uma vez,
       no clique, e guardado em estado. Entrar aqui só criaria o risco de um
       objeto novo a cada render reabrir a auditoria — e a auditoria é uma por
       clique, não uma por render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return estado;
}

/** Mapeia a severidade do motor para as duas do desenho. */
export function paraSeveridade(s: Severidade): "crítico" | "atenção" {
  return s === "critica" || s === "alta" ? "crítico" : "atenção";
}

export function useReiniciar(): [number, () => void] {
  const [n, setN] = useState(0);
  return [n, useCallback(() => setN((x) => x + 1), [])];
}

/* De quem é a culpa quando a auditoria para.

   Isto existe porque eu tinha mandado TODO aborto para a tela "perdemos a
   conexão com a loja" — inclusive COOLDOWN_ACTIVE, que é o nosso próprio piso
   entre tentativas. Dizer que a loja caiu quando quem barrou fomos nós é
   inventar resultado, que é o que este projeto mais evita.

   A regra: só afirmo que foi a loja quando o código diz que foi a loja. */

/** A loja nos barrou de propósito. Isso é achado, não erro. */
const A_LOJA_BLOQUEOU = new Set(["BOT_CHALLENGE", "HOME_NOT_OK", "RATE_LIMITED_BY_SITE", "ROBOTS_DISALLOWED"]);

/** A loja parou de responder no meio. Também é sobre a loja. */
const A_LOJA_CAIU = new Set(["NETWORK_ERROR", "REQUEST_TIMEOUT", "DNS_FAILURE"]);

/* Não achamos o botão de comprar, o formulário, ou o catálogo desta loja.
   Isto NÃO é queda de conexão e NÃO é defeito da loja: é o nosso alcance que
   acabou naquele tema. O motor mandava tudo isso como NETWORK_ERROR, e a
   tela lia NETWORK_ERROR como "a loja caiu" — então um limite nosso chegava
   no lojista como "perdemos a conexão com a loja no meio do checkout". */
const NAO_ALCANCAMOS = new Set([
  "BUY_FORM_NOT_FOUND",
  "BUY_BUTTON_NOT_FOUND",
  "CATALOG_UNREADABLE",
  "CATALOG_EMPTY",
]);

export type Culpa = "loja-bloqueou" | "loja-caiu" | "nossa";

export function deQuemEAculpa(code: string): Culpa {
  if (A_LOJA_BLOQUEOU.has(code)) return "loja-bloqueou";
  if (NAO_ALCANCAMOS.has(code)) return "nossa";
  if (A_LOJA_CAIU.has(code)) return "loja-caiu";
  /* Cooldown, prazo estourado, blocklist, navegador que não subiu, endereço
     inválido: tudo isto é nosso. Nenhum deles vira tela de erro da loja. */
  return "nossa";
}
