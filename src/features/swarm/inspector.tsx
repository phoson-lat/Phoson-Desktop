/**
 * Inspector de un rol del swarm: nombre (lo que se escribe tras `@`), propósito
 * (`system_prompt`), modelo, allowlist de herramientas y presupuesto de tokens.
 *
 * La allowlist se elige de las tools que el engine declaró en `initialize`
 * (`useSession.availableTools`) y admite añadir nombres a mano, porque esa lista
 * puede venir recortada cuando el engine enmascara tools.
 */

import { Crown, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RESERVED_TOOLS, type SwarmAgent } from "@/lib/swarm";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

interface InspectorProps {
  agent: SwarmAgent | null;
  /** El nodo seleccionado es el maestro (no editable). */
  masterSelected: boolean;
  order: number;
  onPatch: (id: string, patch: Partial<SwarmAgent>) => void;
  onDelete: (id: string) => void;
}

export function SwarmInspector({ agent, masterSelected, order, onPatch, onDelete }: InspectorProps) {
  const availableTools = useSession((s) => s.availableTools);
  const [manualTool, setManualTool] = useState("");

  if (masterSelected) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-violet/15 text-violet">
            <Crown className="size-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Maestro</div>
            <p className="text-[0.68rem] leading-relaxed text-muted-foreground">
              Es el agente de la sesión activa, no un miembro del swarm: él recibe tu
              petición, crea el swarm y reparte el trabajo. Su configuración es la de la
              conversación (modelo, tools, permisos), no se define aquí.
            </p>
          </div>
        </div>
        <p className="text-[0.66rem] leading-relaxed text-muted-foreground">
          El engine retira a los miembros las tools de delegación y todas las <code>swarm_*</code>,
          así que el árbol tiene dos niveles: el maestro y sus roles.
        </p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium">Propiedades</div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Pulsa un agente del árbol para definirlo. Arrastra los nodos para ordenarlos: en
          la topología «cadena», ese orden es el de ejecución.
        </p>
      </div>
    );
  }

  const selected = agent.tools;
  const toggleTool = (tool: string) =>
    onPatch(agent.id, {
      tools: selected.includes(tool) ? selected.filter((t) => t !== tool) : [...selected, tool],
    });

  const addManualTool = () => {
    const tool = manualTool.trim();
    if (!tool || selected.includes(tool)) return;
    onPatch(agent.id, { tools: [...selected, tool] });
    setManualTool("");
  };

  const catalogue = Array.from(new Set([...availableTools, ...selected])).sort();

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium">Rol {order > 0 ? order : ""}</div>
        <p className="text-[0.68rem] leading-relaxed text-muted-foreground">
          Se traduce a un objeto de <code>swarm_create</code>: nombre, propósito, modelo y
          allowlist.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-name" className="text-xs">
          Nombre
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-violet">
            @
          </span>
          <Input
            id="agent-name"
            value={agent.name}
            onChange={(event) => onPatch(agent.id, { name: event.target.value })}
            placeholder="investigador"
            className="h-8 pl-6 text-xs"
          />
        </div>
        <p className="text-[0.66rem] text-muted-foreground">
          Así se le menciona en los mensajes. Sin espacios ni arroba: el engine enruta por
          el nombre exacto.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-purpose" className="text-xs">
          Propósito
        </Label>
        <Textarea
          id="agent-purpose"
          value={agent.purpose}
          rows={5}
          onChange={(event) => onPatch(agent.id, { purpose: event.target.value })}
          placeholder="Qué debe hacer exactamente, qué debe entregar y qué NO debe hacer."
          className="min-h-0 resize-y text-xs"
        />
        <p className="text-[0.66rem] text-muted-foreground">
          Viaja como <code>system_prompt</code> del agente, junto a la guía de comunicación
          que se genera sola.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-model" className="text-xs">
          Modelo
        </Label>
        <Input
          id="agent-model"
          value={agent.model}
          onChange={(event) => onPatch(agent.id, { model: event.target.value })}
          placeholder="heredado del maestro"
          className="h-8 text-xs"
        />
        <p className="text-[0.66rem] text-muted-foreground">
          Útil para abaratar: un rol mecánico puede correr en un modelo más barato.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Herramientas permitidas</Label>

        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selected.map((tool) => (
              <button
                key={tool}
                onClick={() => toggleTool(tool)}
                title="Quitar de la allowlist"
                className={cn(
                  "flex items-center gap-1 rounded-md border border-[var(--dashboard-border)] px-1.5 py-0.5 text-[0.66rem]",
                  RESERVED_TOOLS.includes(tool) ? "text-amber-500" : "text-foreground",
                )}
              >
                {tool}
                <X className="size-2.5 opacity-60" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[0.68rem] text-muted-foreground">
            Sin allowlist: el agente puede usar todas las herramientas disponibles.
          </p>
        )}

        <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--dashboard-border)] p-1">
          {catalogue.length > 0 ? (
            catalogue.map((tool) => (
              <label
                key={tool}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[0.7rem] dashboard-hover"
              >
                <input
                  type="checkbox"
                  className="size-3 accent-[var(--violet)]"
                  checked={selected.includes(tool)}
                  onChange={() => toggleTool(tool)}
                />
                <span className={cn("truncate", RESERVED_TOOLS.includes(tool) && "text-amber-500")}>
                  {tool}
                </span>
              </label>
            ))
          ) : (
            <p className="px-1.5 py-1 text-[0.68rem] text-muted-foreground">
              El engine no declaró tools todavía.
            </p>
          )}
        </div>

        <div className="flex gap-1.5">
          <Input
            value={manualTool}
            onChange={(event) => setManualTool(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addManualTool();
              }
            }}
            placeholder="añadir tool a mano…"
            className="h-8 text-xs"
          />
          <Button size="sm" variant="outline" className="h-8" onClick={addManualTool}>
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-budget" className="text-xs">
          Presupuesto de tokens
        </Label>
        <Input
          id="agent-budget"
          type="number"
          min={0}
          value={agent.maxTokens ?? ""}
          onChange={(event) =>
            onPatch(agent.id, {
              maxTokens: event.target.value ? Number(event.target.value) : null,
            })
          }
          placeholder="cap del plugin"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex items-center justify-between border-t border-[var(--dashboard-border)] pt-3">
        <span className="font-mono text-[0.62rem] text-muted-foreground">{agent.id}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(agent.id)}
        >
          <Trash2 className="size-3.5" /> Eliminar rol
        </Button>
      </div>
    </div>
  );
}
