/**
 * Modal para crear un rol del swarm desde el lienzo (botón flotante). Solo pide
 * lo esencial; el resto (tools, etc.) se ajusta luego en Propiedades.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface NewAgentDraft {
  name: string;
  purpose: string;
  model: string;
  maxTokens: number | null;
}

interface NewAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: NewAgentDraft) => void;
}

export function NewAgentDialog({ open, onOpenChange, onCreate }: NewAgentDialogProps) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [model, setModel] = useState("");
  const [maxTokens, setMaxTokens] = useState("");

  const reset = () => {
    setName("");
    setPurpose("");
    setModel("");
    setMaxTokens("");
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({
      name: trimmed,
      purpose: purpose.trim(),
      model: model.trim(),
      maxTokens: maxTokens ? Number(maxTokens) : null,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo agente</DialogTitle>
          <DialogDescription>
            Define un rol del equipo. Después podrás ajustar sus herramientas y demás detalles en
            Propiedades.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-agent-name" className="text-xs">
              Nombre
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-violet">
                @
              </span>
              <Input
                id="new-agent-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="investigador"
                className="h-8 pl-6 text-xs"
              />
            </div>
            <p className="text-[0.66rem] text-muted-foreground">
              Sin espacios ni arroba: es lo que se escribe tras <code>@</code> y el <code>recipient</code>.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-agent-purpose" className="text-xs">
              Propósito
            </Label>
            <Textarea
              id="new-agent-purpose"
              value={purpose}
              rows={3}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="Qué debe hacer exactamente, qué debe entregar y qué NO debe hacer."
              className="min-h-0 resize-y text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-agent-model" className="text-xs">
                Modelo
              </Label>
              <Input
                id="new-agent-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="heredado"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-agent-budget" className="text-xs">
                Tokens
              </Label>
              <Input
                id="new-agent-budget"
                type="number"
                min={0}
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
                placeholder="cap del plugin"
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="bg-violet text-white hover:bg-violet/90"
            onClick={submit}
            disabled={!name.trim()}
          >
            Crear agente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
