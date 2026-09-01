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

type AuditEvent =
  | { type: "step:start"; id: StepId; label: string; at: string }
  | { type: "step:done"; id: StepId; detail?: string; at: string }
  | { type: "step:fail"; id: StepId; reason: string; at: string }
  | { type: "step:skip"; id: StepId; reason: string; at: string }
  | { type: "frame"; data: string; seq: number }
  | { type: "finding"; code: string; severity: Severidade; title: string; at: string }
  | { type: "complete"; auditId: string; score: number | null; caveat: string | null }
  | { type: "aborted"; auditId: string; code: string; reason: string }
  | { type: "state"; state: unknown };

export type EstadoAoVivo = {
  /** Quantas etapas já concluíram. É o mesmo `stage` que a tela simulada usa. */
  stage: number;
  /** Último frame recebido, já como data URI. null enquanto nenhum chegou. */
  frame: string | null;
  /** Os frames guardados para a gravação, com o segundo em que cada um chegou.
   *  Vivem só nesta aba: nada vai para disco, por decisão do Bruno. Quem abre
   *  o link sem ter assistido não tem gravação, e a tela diz isso. */
  gravacao: { data: string; t: number }[];
  /** Quantos frames o servidor mandou e não chegaram. Frame perdido é perdido,
   *  mas dá para saber QUE se perdeu — é o que o campo `seq` existe para dizer. */
  perdidos: number;
  achados: { code: string; severity: Severidade; title: string }[];
  fim: null | { score: number | null; caveat: string | null };
  /** A auditoria parou por algo da LOJA: antibot, sessao cortada, prazo. */
  abortado: null | { code: string; reason: string };
  /** NOSSO lado falhou: servidor fora, rede, resposta invalida. Fica separado
   *  de propósito. Mostrar isto como "a loja caiu" seria acusar a loja de um
   *  problema nosso — e o projeto inteiro existe para nao inventar resultado. */
  falhaNossa: null | { reason: string };
  /** Segundos desde o início, para o cronômetro e as janelas de estado. */
  segundos: number;
  /** true quando existe servidor e a ligação está de pé. */
  aoVivo: boolean;
};

const VAZIO: EstadoAoVivo = {
  stage: 0, frame: null, gravacao: [], perdidos: 0, achados: [], fim: null, abortado: null, falhaNossa: null, segundos: 0, aoVivo: false,
};

/** Base da API. Sem ela, a tela roda em demonstração. */
export const API = (import.meta.env["VITE_API"] as string | undefined)?.replace(/\/$/, "") ?? "";

export function temServidor(): boolean {
  return API.length > 0;
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

export function useAuditoriaAoVivo(url: string | null): EstadoAoVivo {
  const [estado, setEstado] = useState<EstadoAoVivo>(VAZIO);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!url || !temServidor()) return;

    let vivo = true;
    let ultimaSeq = 0;
    const inicio = Date.now();
    const relogio = window.setInterval(() => {
      if (vivo) setEstado((e) => ({ ...e, segundos: (Date.now() - inicio) / 1000 }));
    }, 100);

    const aplicar = (ev: AuditEvent) => {
      setEstado((e) => {
        switch (ev.type) {
          case "step:done":
          case "step:skip":
            /* Pulada conta como andada: a etapa não vai acontecer, e travar a
               barra nela deixaria a tela parecendo pendurada. */
            return { ...e, stage: Math.max(e.stage, STEP_IDS.indexOf(ev.id) + 1) };
          case "frame": {
            const pulados = ev.seq > ultimaSeq + 1 ? ev.seq - ultimaSeq - 1 : 0;
            ultimaSeq = ev.seq;
            const uri = `data:image/jpeg;base64,${ev.data}`;
            return {
              ...e,
              frame: uri,
              perdidos: e.perdidos + pulados,
              gravacao: guardar(e.gravacao, { data: uri, t: (Date.now() - inicio) / 1000 }),
            };
          }
          case "finding":
            if (e.achados.some((a) => a.code === ev.code)) return e;
            return { ...e, achados: [...e.achados, { code: ev.code, severity: ev.severity, title: ev.title }] };
          case "complete":
            return { ...e, fim: { score: ev.score, caveat: ev.caveat }, stage: STEP_IDS.length };
          case "aborted":
            return { ...e, abortado: { code: ev.code, reason: ev.reason } };
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
          body: JSON.stringify({ url }),
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

export type Culpa = "loja-bloqueou" | "loja-caiu" | "nossa";

export function deQuemEAculpa(code: string): Culpa {
  if (A_LOJA_BLOQUEOU.has(code)) return "loja-bloqueou";
  if (A_LOJA_CAIU.has(code)) return "loja-caiu";
  /* Cooldown, prazo estourado, blocklist, navegador que não subiu, endereço
     inválido: tudo isto é nosso. Nenhum deles vira tela de erro da loja. */
  return "nossa";
}
