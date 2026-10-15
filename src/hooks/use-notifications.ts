/**
 * Avisos del sistema cuando un turno termina (o pide confirmación) y la app
 * no está en primer plano. Cubre también las sesiones en segundo plano: el
 * indicador «running» de la barra lateral y estas notificaciones comparten la
 * misma fuente de verdad (`SessionView.sending` / `confirmations`).
 */

import { useEffect, useRef } from "react";

import { phoson } from "@/bridge/client";
import i18n from "@/lib/i18n";
import { cleanSessionTitle } from "@/lib/session-title";
import { messageText, type SessionView } from "@/stores/session";
import { notifyTurnEnd, type NotifyMode } from "@/lib/desktop";

/** Primeras palabras del último mensaje, como cuerpo de la notificación. */
function preview(view: SessionView): string {
  const last = [...view.messages].reverse().find((m) => m.role === "assistant");
  const text = last ? messageText(last).trim() : "";
  // Aviso nativo: el idioma se resuelve al disparar la notificación.
  if (!text) return i18n.t("system:notify.turnEnded");
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function useTurnNotifications(
  sessions: Record<string, SessionView>,
  sessionId: string | null,
): void {
  /** Estado por sesión en la pasada anterior: detecta transiciones. */
  const prev = useRef<Record<string, { sending: boolean; confirms: number }>>({});
  const mode = useRef<NotifyMode>("desktop");

  // Preferencia "Notificar al terminar" del config del engine (se cachea; se
  // refresca al cambiar de sesión, que es cuando Ajustes puede haberla tocado).
  useEffect(() => {
    if (!sessionId) return;
    phoson
      .getConfig(sessionId)
      .then((cfg) => {
        const value = cfg?.notifyOnCompletion;
        if (value === "off" || value === "bell" || value === "desktop") mode.current = value;
      })
      .catch(() => {
        /* sin config: se mantiene el valor actual */
      });
  }, [sessionId]);

  useEffect(() => {
    for (const [key, view] of Object.entries(sessions)) {
      const before = prev.current[key] ?? { sending: false, confirms: 0 };
      // "Phoson" es la marca: no se traduce.
      const title = cleanSessionTitle(view.title) || "Phoson";

      // Fin de turno: sending pasa de true a false.
      if (before.sending && !view.sending) {
        const last = view.messages[view.messages.length - 1];
        const failed = last?.status === "error";
        void notifyTurnEnd(mode.current, title, preview(view), { error: failed });
      }

      // Nueva interacción pendiente (confirmación de bash o pregunta del agente).
      if (view.confirmations.length > before.confirms) {
        void notifyTurnEnd(
          mode.current,
          `${title} · ${i18n.t("system:notify.replyPending")}`,
          i18n.t("system:notify.replyBody"),
        );
      }

      prev.current[key] = {
        sending: view.sending,
        confirms: view.confirmations.length,
      };
    }
    // Sesiones cerradas: no reutilizar su estado si se reabren.
    for (const key of Object.keys(prev.current)) {
      if (!(key in sessions)) delete prev.current[key];
    }
  }, [sessions]);
}
