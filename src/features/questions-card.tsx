/**
 * Tarjeta de interacción con el usuario para las interacciones de plugins
 * (`PluginUiService`): la tool `questions` del plugin `phoson_plugin_questions`
 * (1–4 preguntas de opción múltiple, estilo AskUserQuestion) y su fallback
 * `select` / `form`. El engine espera la respuesta (mismo ciclo request/respond
 * que la confirmación de bash) y continúa el turno con lo que elijas.
 */

import { HelpCircle, Send, X } from "lucide-react";
import { useState } from "react";

import type { ConfirmRequest, Question } from "@/bridge/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface InteractionCardProps {
  request: ConfirmRequest;
  /** Envía la respuesta (`selections`/`other`, `choice` o `values`). */
  onAnswer: (requestId: string, payload: Record<string, unknown>) => void;
  onCancel: (requestId: string) => void;
}

/** ¿Tiene respuesta esta pregunta (opción elegida o texto libre)? */
const answered = (q: Question, ids: string[] | undefined, other: string | undefined): boolean =>
  (ids?.length ?? 0) > 0 || (q.allow_other !== false && !!other?.trim());

export function InteractionCard({ request, onAnswer, onCancel }: InteractionCardProps) {
  /** Opciones elegidas por pregunta (id de pregunta -> ids de opción). */
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  /** Texto libre ("Otro") por pregunta. */
  const [others, setOthers] = useState<Record<string, string>>({});
  /** Valores del formulario (kind `form`). */
  const [values, setValues] = useState<Record<string, string>>({});

  const questions = request.questions ?? [];
  const allAnswered =
    questions.length > 0 &&
    questions.every((q) => answered(q, selected[q.id], others[q.id]));

  const toggle = (q: Question, optionId: string) => {
    setSelected((prev) => {
      const current = prev[q.id] ?? [];
      if (q.multi_select) {
        return {
          ...prev,
          [q.id]: current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId],
        };
      }
      return { ...prev, [q.id]: current[0] === optionId ? [] : [optionId] };
    });
  };

  const submit = () => {
    if (request.kind === "questions") {
      const selections: Record<string, string[]> = {};
      for (const q of questions) {
        const ids = selected[q.id] ?? [];
        if (ids.length) selections[q.id] = ids;
      }
      const other: Record<string, string> = {};
      for (const [id, text] of Object.entries(others)) {
        if (text.trim()) other[id] = text.trim();
      }
      onAnswer(request.requestId, { selections, other });
      return;
    }
    if (request.kind === "form") {
      onAnswer(request.requestId, { values });
      return;
    }
    onCancel(request.requestId);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={request.title || "El agente pregunta"}
      className="dashboard-panel-strong mx-3 mb-2 rounded-xl border p-3 sm:mx-auto sm:w-full sm:max-w-3xl"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <HelpCircle className="size-3.5 text-violet" />
        {request.title || "El agente pregunta"}
      </div>

      {/* questions: 1–4 preguntas de opción múltiple */}
      {request.kind === "questions" &&
        questions.map((q) => (
          <div key={q.id} className="mb-3">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="rounded-full border border-violet/40 bg-violet/10 px-1.5 py-0.5 text-[0.58rem] font-medium text-violet-soft">
                {q.header}
              </span>
              {q.multi_select && (
                <span className="text-[0.58rem] text-muted-foreground">varias opciones</span>
              )}
            </div>
            <p className="mb-1.5 text-[0.8125rem]">{q.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((option) => {
                const picked = (selected[q.id] ?? []).includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    title={option.description ?? undefined}
                    aria-pressed={picked}
                    onClick={() => toggle(q, option.id)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      picked
                        ? "border-violet bg-violet text-white"
                        : "border-dashboard-border-soft text-foreground/85 hover:bg-violet/10",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {q.allow_other !== false && (
              <Input
                className="mt-1.5 h-8 text-xs"
                placeholder="Otro…"
                value={others[q.id] ?? ""}
                onChange={(e) => setOthers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              />
            )}
          </div>
        ))}

      {/* select: fallback de una sola elección */}
      {request.kind === "select" && (
        <div className="mb-3">
          {request.message && <p className="mb-1.5 text-[0.8125rem]">{request.message}</p>}
          <div className="flex flex-wrap gap-1.5">
            {(request.choices ?? []).map((choice) => (
              <button
                key={choice.id}
                type="button"
                title={choice.detail ?? undefined}
                onClick={() => onAnswer(request.requestId, { choice: choice.id })}
                className="rounded-md border border-dashboard-border-soft px-2.5 py-1 text-xs transition-colors hover:bg-violet/10"
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* form: fallback de campos de texto */}
      {request.kind === "form" && (
        <div className="mb-3 space-y-1.5">
          {request.message && <p className="mb-1.5 text-[0.8125rem]">{request.message}</p>}
          {(request.fields ?? []).map((field) => (
            <div key={field.id}>
              <label className="mb-0.5 block text-[0.7rem] text-muted-foreground" htmlFor={field.id}>
                {field.label}
              </label>
              <Input
                id={field.id}
                className="h-8 text-xs"
                type={field.kind === "password" ? "password" : field.kind === "integer" ? "number" : "text"}
                required={field.required !== false}
                defaultValue={field.default ?? ""}
                placeholder={field.help ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onCancel(request.requestId)}>
          <X className="size-3.5" /> Cancelar
        </Button>
        {request.kind !== "select" && (
          <Button
            size="sm"
            className="gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
            disabled={request.kind === "questions" ? !allAnswered : false}
            onClick={submit}
          >
            <Send className="size-3.5" /> Responder
          </Button>
        )}
      </div>
    </div>
  );
}
