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
  /** Quantos frames o servidor mandou e não chegaram. Frame perdido é perdido,
   *  mas dá para saber QUE se perdeu — é o que o campo `seq` existe para dizer. */
  perdidos: number;
  achados: { code: string; severity: Severidade; title: string }[];
  fim: null | { score: number | null; caveat: string | null };
  abortado: null | { code: string; reason: string };
  /** Segundos desde o início, para o cronômetro e as janelas de estado. */
  segundos: number;
  /** true quando existe servidor e a ligação está de pé. */
  aoVivo: boolean;
};

const VAZIO: EstadoAoVivo = {
  stage: 0, frame: null, perdidos: 0, achados: [], fim: null, abortado: null, segundos: 0, aoVivo: false,
};

/** Base da API. Sem ela, a tela roda em demonstração. */
export const API = (import.meta.env["VITE_API"] as string | undefined)?.replace(/\/$/, "") ?? "";

export function temServidor(): boolean {
  return API.length > 0;
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
            return { ...e, frame: `data:image/jpeg;base64,${ev.data}`, perdidos: e.perdidos + pulados };
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
        /* Sem auditoria não há o que assistir. A tela mostra o motivo em vez
           de girar para sempre, que é o que `aborted` existe para evitar. */
        if (vivo) setEstado((e) => ({ ...e, abortado: { code: "SEM_SERVIDOR", reason: String(erro) } }));
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
