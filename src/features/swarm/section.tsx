/**
 * Sección «Swarms de agentes» — vista principal para definir un equipo de
 * agentes como un árbol: un **maestro** (el agente de la sesión, la única
 * conversación que mantiene la persona) y N **roles** a los que delega.
 *
 * Qué es real y qué no (para no prometer de más):
 * - El árbol se **traduce a las llamadas del engine**: `swarm_create` con los
 *   roles y `swarm_assign` con la misión. «Lanzar» envía eso al maestro como un
 *   turno normal y te devuelve al chat para que veas el trabajo en marcha.
 * - Los agentes se comunican por **bandeja de entrada**, entregada en su
 *   siguiente ejecución, y el maestro es quien enruta (`swarm_message`). No hay
 *   chat en vivo entre miembros: el engine les retira las tools `swarm_*`.
 * - La `@` es la convención de escritura que se inyecta en las instrucciones y
 *   se resalta en el registro; al engine se le pasa el nombre sin arroba.
 *
 * El árbol tiene dos niveles porque un miembro no puede delegar: el engine le
 * retira las tools de delegación para que no pueda crear swarms anidados.
 */

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  Info,
  Layers,
  LayoutGrid,
  List,
  Play,
  Plus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  MASTER_ID,
  MAX_AGENTS,
  TOPOLOGIES,
  createAgent,
  defaultEdgesFor,
  exampleAlreadyOffered,
  exampleSwarm,
  hasErrors,
  layoutFor,
  markExampleOffered,
  normalize,
  positionForAgent,
  toMasterInstruction,
  uid,
  validate,
  type Swarm,
  type SwarmAgent,
  type SwarmTopology,
} from "@/lib/swarm";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";
import { useSwarms } from "@/stores/swarms";
import { useSwarmRuns } from "@/stores/swarm-runs";
import { SwarmInspector } from "./inspector";
import { useSwarmTraffic } from "./live";
import { AgentLog } from "./log";
import { SwarmLiveContext, SwarmNodeCard, type SwarmNode } from "./node";
import { SwarmRuns } from "./runs";
import { SwarmChatComposer } from "./chat";
import { FloatingEdge } from "./edge";
import { NewAgentDialog, type NewAgentDraft } from "./new-agent";

const NODE_TYPES = { swarm: SwarmNodeCard } as unknown as NodeTypes;
const EDGE_TYPES = { floating: FloatingEdge } as unknown as EdgeTypes;
/** El maestro vive a la izquierda; los roles se apilan a su derecha. */
const MASTER_POSITION = { x: -340, y: -55 };

interface Meta {
  id: string;
  name: string;
  mission: string;
  topology: SwarmTopology;
  peerMessaging: boolean;
  createdAt: number;
}

interface SectionProps {
  /** La sección está a la vista. */
  active: boolean;
  swarmId?: string | null;
  /** Vuelve a la conversación. */
  onExit: () => void;
}

export function SwarmSection(props: SectionProps) {
  return (
    <ReactFlowProvider>
      <SwarmSectionBody {...props} />
    </ReactFlowProvider>
  );
}

/** Convierte los roles guardados en nodos del canvas (con el maestro delante). */
function toNodes(swarm: Swarm): SwarmNode[] {
  const master: SwarmNode = {
    id: MASTER_ID,
    type: "swarm",
    position: MASTER_POSITION,
    data: { role: "master", name: "", purpose: "", model: "", tools: [], maxTokens: null, order: 0 },
  };
  const agents = swarm.agents.map((agent, index) => ({
    id: agent.id,
    type: "swarm" as const,
    position: agent.position,
    data: {
      role: "agent" as const,
      name: agent.name,
      purpose: agent.purpose,
      model: agent.model,
      tools: agent.tools,
      maxTokens: agent.maxTokens,
      order: index + 1,
    },
  }));
  return [master, ...agents];
}

function SwarmSectionBody({ active, swarmId, onExit }: SectionProps) {
  const swarms = useSwarms((s) => s.swarms);
  const load = useSwarms((s) => s.load);
  const upsert = useSwarms((s) => s.upsert);
  const removeSwarm = useSwarms((s) => s.remove);
  const loadRuns = useSwarmRuns((s) => s.load);
  const { fitView } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const wideEnough = useMediaQuery("(min-width: 1150px)");

  const ready = useSession((s) => s.ready);
  const activeKey = useSession((s) => s.activeKey);
  const availableTools = useSession((s) => s.availableTools);
  const maskedTools = useSession((s) => s.maskedTools);
  const sendToSession = useSession((s) => s.send);
  const newSession = useSession((s) => s.newSession);

  /** Estado en vivo por rol, derivado del stream de tool calls de la sesión. */
  const traffic = useSwarmTraffic(activeKey);

  const [nodes, setNodes, onNodesChange] = useNodesState<SwarmNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"props" | "log" | "runs">("props");
  /** En pantallas estrechas, el panel es un overlay y esto lo abre/cierra. */
  const [panelOpen, setPanelOpen] = useState(false);
  /** Modal para crear un agente (botón flotante del lienzo). */
  const [createOpen, setCreateOpen] = useState(false);
  /** Ancho del panel lateral (redimensionable); se recuerda entre sesiones. */
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof localStorage === "undefined") return 340;
    const saved = Number(localStorage.getItem("phoson.swarm.panelWidth"));
    return Number.isFinite(saved) && saved >= 280 ? saved : 340;
  });
  const [launching, setLaunching] = useState(false);
  const fitTimer = useRef<number | null>(null);

  useEffect(() => {
    load();
    loadRuns();
  }, [load, loadRuns]);

  const scheduleFit = useCallback(() => {
    if (fitTimer.current) window.clearTimeout(fitTimer.current);
    fitTimer.current = window.setTimeout(() => {
      fitTimer.current = null;
      void fitView({ padding: 0.25, duration: 200 });
    }, 120);
  }, [fitView]);

  useEffect(
    () => () => {
      if (fitTimer.current) window.clearTimeout(fitTimer.current);
    },
    [],
  );

  useEffect(() => {
    try {
      localStorage.setItem("phoson.swarm.panelWidth", String(panelWidth));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [panelWidth]);

  /** Arrastra el borde del panel para darle más ancho (solo en escritorio). */
  const startResize = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panelWidth;
      const onMove = (move: PointerEvent) => {
        setPanelWidth(Math.min(640, Math.max(280, startWidth - (move.clientX - startX))));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelWidth],
  );

  /* ── Carga ───────────────────────────────────────────────────────────── */

  const openSwarm = useCallback(
    (id: string) => {
      const stored = useSwarms.getState().swarms.find((s) => s.id === id);
      if (!stored) return;
      const swarm = normalize(stored);
      setMeta({
        id: swarm.id,
        name: swarm.name,
        mission: swarm.mission,
        topology: swarm.topology,
        peerMessaging: swarm.peerMessaging,
        createdAt: swarm.createdAt,
      });
      setNodes(toNodes(swarm));
      setEdges(swarm.edges);
      setDirty(false);
      setSelectedId(null);
      setSelectedEdgeId(null);
      scheduleFit();
    },
    [setNodes, setEdges, scheduleFit],
  );

  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!active || loadedOnce.current) return;
    loadedOnce.current = true;
    const list = useSwarms.getState().swarms;
    const target = swarmId && list.some((s) => s.id === swarmId) ? swarmId : list[0]?.id;
    if (target) return openSwarm(target);
    if (!exampleAlreadyOffered()) {
      const seeded = exampleSwarm();
      markExampleOffered();
      useSwarms.getState().upsert(seeded);
      return openSwarm(seeded.id);
    }
    openSwarm(useSwarms.getState().create().id);
  }, [active, swarmId, openSwarm]);

  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) scheduleFit();
    wasActive.current = active;
  }, [active, scheduleFit]);

  /* ── Derivados ───────────────────────────────────────────────────────── */

  const agentNodes = useMemo(() => nodes.filter((node) => node.data.role === "agent"), [nodes]);

  /** Roles en el orden del array = orden de ejecución de la cadena. */
  const agents = useMemo<SwarmAgent[]>(
    () =>
      agentNodes.map((node) => ({
        id: node.id,
        name: node.data.name,
        purpose: node.data.purpose,
        model: node.data.model,
        tools: node.data.tools,
        maxTokens: node.data.maxTokens,
        position: node.position,
      })),
    [agentNodes],
  );

  const draft = useMemo<Swarm | null>(
    () =>
      meta
        ? {
            version: 1,
            id: meta.id,
            name: meta.name,
            mission: meta.mission,
            topology: meta.topology,
            edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
            peerMessaging: meta.peerMessaging,
            agents,
            createdAt: meta.createdAt,
            updatedAt: Date.now(),
          }
        : null,
    [meta, agents, edges],
  );

  const issues = useMemo(() => (draft ? validate(draft) : []), [draft]);
  const blocked = hasErrors(issues) || !agents.length;

  /** Aristas para React Flow: siempre tipo `floating` (estilo pizarra). */
  const flowEdges = useMemo<Edge[]>(
    () => edges.map((edge) => ({ ...edge, type: "floating" })),
    [edges],
  );

  // Solo se avisa si la lista de tools es completa: con tools enmascaradas, la
  // ausencia de `swarm_create` no demuestra nada.
  const swarmToolMissing =
    availableTools.length > 0 && maskedTools === 0 && !availableTools.includes("swarm_create");

  /* ── Edición ─────────────────────────────────────────────────────────── */

  const handleNodesChange = useCallback(
    (changes: NodeChange<SwarmNode>[]) => {
      onNodesChange(changes);
      if (changes.some((c) => c.type !== "select" && c.type !== "dimensions")) setDirty(true);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes);
      if (changes.some((c) => c.type !== "select")) setDirty(true);
    },
    [onEdgesChange],
  );

  /** Conecta dos nodos. Las conexiones son no dirigidas: A–B = B–A. */
  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (!source || !target || source === target) return;
      setEdges((current) => {
        const exists = current.some(
          (edge) =>
            (edge.source === source && edge.target === target) ||
            (edge.source === target && edge.target === source),
        );
        if (exists) return current;
        return [...current, { id: uid("e"), source, target }];
      });
      setSelectedEdgeId(null);
      setDirty(true);
    },
    [setEdges, setSelectedEdgeId],
  );

  const deleteSelectedEdge = useCallback(() => {
    setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
    setDirty(true);
  }, [selectedEdgeId, setEdges, setSelectedEdgeId]);

  /**
   * Reglas de conexión: un nodo puede recibir de cualquier otro (self-loops
   * fuera), pero no se admiten conexiones repetidas (A–B = B–A).
   */
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const { source, target } = connection;
      if (!source || !target || source === target) return false;
      return !edges.some(
        (edge) =>
          (edge.source === source && edge.target === target) ||
          (edge.source === target && edge.target === source),
      );
    },
    [edges],
  );

  // Suprimir la arista seleccionada con Supr/Backspace. Los nodos **no** se
  // borran por teclado: eso se hace desde el inspector.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!selectedEdgeId) return;
      event.preventDefault();
      deleteSelectedEdge();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEdgeId, deleteSelectedEdge]);

  /** Vuelve al grafo por defecto de la topología actual. */
  const resetGraph = useCallback(() => {
    if (!draft) return;
    setEdges(defaultEdgesFor(draft));
    setSelectedEdgeId(null);
    setDirty(true);
    toast.success("Grafo restablecido según la topología");
  }, [draft, setEdges, setSelectedEdgeId]);

  const patchAgent = useCallback(
    (id: string, patch: Partial<SwarmAgent>) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, ...patch, order: node.data.order } }
            : node,
        ),
      );
      setDirty(true);
    },
    [setNodes],
  );

  /** Crea un rol con los datos del modal y lo coloca según el layout. */
  const addAgentWithData = useCallback(
    (data: NewAgentDraft) => {
      if (agentNodes.length >= MAX_AGENTS) {
        return toast.error(`El engine limita el swarm a ${MAX_AGENTS} agentes`);
      }
      const agent = createAgent({ x: 0, y: 0 }, {
        name: data.name,
        purpose: data.purpose,
        model: data.model,
        maxTokens: data.maxTokens,
      });
      const node: SwarmNode = {
        id: agent.id,
        type: "swarm",
        position: { x: 0, y: 0 },
        data: {
          role: "agent",
          name: agent.name,
          purpose: agent.purpose,
          model: agent.model,
          tools: agent.tools,
          maxTokens: agent.maxTokens,
          order: agentNodes.length + 1,
        },
      };
      // Re-centra la columna de roles con el nuevo al final.
      setNodes((current) => {
        const master = current.filter((n) => n.data.role === "master");
        const agents = [...current.filter((n) => n.data.role === "agent"), node];
        const count = agents.length;
        return [
          ...master,
          ...agents.map((n, index) => ({
            ...n,
            position: positionForAgent(index, count),
            data: { ...n.data, order: index + 1 },
          })),
        ];
      });
      setSelectedId(agent.id);
      setSelectedEdgeId(null);
      setTab("props");
      // En estrecho, abre el editor para completar el rol (tools, etc.).
      if (!wideEnough) setPanelOpen(true);
      setDirty(true);
      toast.success(`Agente @${agent.name} añadido`);
    },
    [agentNodes.length, setNodes, wideEnough],
  );

  const openCreate = useCallback(() => {
    if (agentNodes.length >= MAX_AGENTS) {
      return toast.error(`El engine limita el swarm a ${MAX_AGENTS} agentes`);
    }
    setCreateOpen(true);
  }, [agentNodes.length]);

  const deleteAgent = useCallback(
    (id: string) => {
      setNodes((current) => current.filter((node) => node.id !== id));
      // Limpia las aristas que apuntaban al nodo eliminado.
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
      setSelectedId(null);
      setDirty(true);
    },
    [setNodes, setEdges],
  );

  /** Reordena el árbol según la topología y recoloca los nodos. */
  const applyLayout = useCallback(
    (swarm: Swarm, notify = false) => {
      const layout = layoutFor(swarm);
      setNodes((current) =>
        current.map((node) =>
          node.data.role === "agent" && layout[node.id]
            ? { ...node, position: layout[node.id] }
            : node,
        ),
      );
      setDirty(true);
      scheduleFit();
      if (notify) toast.success("Árbol reordenado");
    },
    [setNodes, scheduleFit],
  );

  const changeTopology = (topology: SwarmTopology) => {
    if (!meta) return;
    // Fuera del updater de estado: `applyLayout` muta los nodos, y un updater
    // debe ser puro (React puede invocarlo más de una vez).
    setMeta({ ...meta, topology });
    if (draft) applyLayout({ ...draft, topology });
    setDirty(true);
  };

  /* ── Persistencia y lanzamiento ──────────────────────────────────────── */

  const saveDraft = () => {
    if (!draft) return;
    upsert(draft);
    setDirty(false);
    toast.success("Swarm guardado");
  };

  const newSwarmFlow = () => {
    const created = useSwarms.getState().create();
    openSwarm(created.id);
    toast.success("Swarm creado");
  };

  const selectSwarm = (id: string) => {
    if (id === meta?.id) return;
    if (!dirty) return openSwarm(id);
    toast("Cambios sin guardar", {
      description: "Se descartarán si abres otro swarm.",
      action: { label: "Descartar y abrir", onClick: () => openSwarm(id) },
    });
  };

  const deleteSwarm = (id: string) => {
    toast("¿Eliminar este swarm?", {
      description: "No se puede deshacer.",
      action: {
        label: "Eliminar",
        onClick: () => {
          removeSwarm(id);
          const rest = useSwarms.getState().swarms;
          if (rest[0]) openSwarm(rest[0].id);
          else openSwarm(useSwarms.getState().create().id);
          toast.success("Swarm eliminado");
        },
      },
    });
  };

  /**
   * Envía el árbol al **maestro**: crea el swarm en el engine y le asigna la
   * misión. Nosotros solo hablamos con el maestro, así que lo que viaja es un
   * turno para él; después volvemos al chat para verlo trabajar.
   */
  const launch = async () => {
    if (!draft) return;
    if (blocked) {
      const first = issues.find((i) => i.level === "error");
      return toast.error("El swarm no está listo", { description: first?.message });
    }
    if (!draft.mission.trim()) {
      return toast.warning("Escribe la misión", {
        description: "Es la tarea que el maestro le pedirá al swarm.",
      });
    }
    if (!ready) {
      return toast.error("Sin conexión con el engine", {
        description: "El maestro no puede crear el swarm todavía.",
      });
    }

    setLaunching(true);
    try {
      if (!activeKey) await newSession();
      await sendToSession(toMasterInstruction(draft, draft.mission));
      // Registra la ejecución ligada a la sesión donde trabaja el maestro.
      useSwarmRuns.getState().add({
        swarmId: draft.id,
        name: draft.name,
        mission: draft.mission,
        topology: draft.topology,
        agentCount: agents.length,
        sessionKey: useSession.getState().activeKey,
      });
      toast.success("Swarm lanzado", {
        description: `${agents.length} roles · topología ${draft.topology}. El maestro está creando el equipo.`,
      });
      onExit();
    } catch (e) {
      toast.error("No se pudo lanzar el swarm", { description: String(e) });
    } finally {
      setLaunching(false);
    }
  };

  /** Abre la conversación de una ejecución y vuelve al chat. */
  const openRun = useCallback(
    (sessionKey: string) => {
      useSession.getState().setActive(sessionKey);
      onExit();
    },
    [onExit],
  );

  /* ── Render ──────────────────────────────────────────────────────────── */

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const selectedOrder = useMemo(
    () => agentNodes.findIndex((node) => node.id === selectedId) + 1,
    [agentNodes, selectedId],
  );
  const selectedIssues = selectedId ? issues.filter((issue) => issue.agentId === selectedId) : [];

  const inspector = (
    <div className="space-y-3">
      {selectedIssues.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
          {selectedIssues.map((issue, index) => (
            <p
              key={index}
              className={cn(
                "text-[0.68rem] leading-relaxed",
                issue.level === "error" ? "text-destructive" : "text-amber-500",
              )}
            >
              {issue.message}
            </p>
          ))}
        </div>
      )}
      <SwarmInspector
        agent={selectedAgent}
        masterSelected={selectedId === MASTER_ID}
        order={selectedOrder}
        onPatch={patchAgent}
        onDelete={deleteAgent}
      />
    </div>
  );

  /**
   * Cuerpo del panel lateral (pestañas Propiedades / Mensajes). Se pinta inline
   * en pantallas anchas y dentro de un overlay en las estrechas. Antes el panel
   * era `hidden` en estrecho y no había forma de editar un rol.
   */
  const panelBody = (
    <>
      <div className="flex shrink-0 gap-1 border-b border-[var(--dashboard-border)] p-1.5">
        {(
          [
            { id: "props" as const, label: "Propiedades" },
            { id: "log" as const, label: "Mensajes" },
            { id: "runs" as const, label: "Ejecuciones" },
          ]
        ).map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-[0.72rem] transition-colors",
              tab === item.id
                ? "bg-[var(--phoson-surface-2)] text-foreground"
                : "text-muted-foreground dashboard-hover",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "props" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {inspector}

          <div className="mt-6 space-y-1 border-t border-[var(--dashboard-border)] pt-3">
            <label htmlFor="swarm-mission" className="text-[0.7rem] font-medium text-muted-foreground">
              Misión
            </label>
            <textarea
              id="swarm-mission"
              value={meta?.mission ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setMeta((m) => (m ? { ...m, mission: value } : m));
                setDirty(true);
              }}
              rows={3}
              placeholder="Qué quieres que haga el equipo cuando pulses Lanzar…"
              className="w-full resize-y rounded-md border border-[var(--dashboard-border)] bg-transparent p-2 text-xs outline-none focus-visible:border-ring"
            />
            <p className="text-[0.66rem] leading-relaxed text-muted-foreground">
              Es la tarea que recibe el maestro, y el maestro la reparte según la
              topología.
            </p>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-2 text-[0.72rem]">
            <input
              type="checkbox"
              className="mt-0.5 size-3.5 accent-[var(--violet)]"
              checked={meta?.peerMessaging ?? true}
              onChange={(event) => {
                const value = event.target.checked;
                setMeta((m) => (m ? { ...m, peerMessaging: value } : m));
                setDirty(true);
              }}
            />
            <span>
              Permitir que los roles se mencionen entre sí con <code>@</code>
              <span className="block text-[0.66rem] leading-relaxed text-muted-foreground">
                Añade el roster de compañeros a las instrucciones de cada agente. El
                maestro sigue siendo quien enruta los mensajes.
              </span>
            </span>
          </label>
        </div>
      ) : tab === "log" ? (
        // El registro solo se monta a la vista: recorre los mensajes de la
        // sesión, y la sesión cambia en cada flush del streaming. Debajo va el
        // composer: aquí escribes al equipo (con `@rol`) o al maestro.
        active ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <AgentLog sessionKey={activeKey} />
            <SwarmChatComposer agents={agents} active={active} />
          </div>
        ) : (
          <div className="p-3 text-[0.7rem] text-muted-foreground">
            Vuelve a esta sección para seguir el tráfico de agentes.
          </div>
        )
      ) : (
        <SwarmRuns onOpen={openRun} />
      )}
    </>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 border-b border-dashboard-border-soft px-3 py-2 sm:gap-3 sm:px-4">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-muted-foreground"
          onClick={onExit}
          title="Volver a la conversación"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Volver</span>
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 px-2"
                title="Cambiar o gestionar swarms"
                aria-label="Swarms"
              >
                <Layers className="size-4 text-violet" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Mis swarms</DropdownMenuLabel>
              {swarms.map((swarm) => (
                <DropdownMenuItem key={swarm.id} onClick={() => selectSwarm(swarm.id)} className="gap-2">
                  <Check
                    className={cn(
                      "size-3.5 shrink-0 text-violet",
                      swarm.id === meta?.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{swarm.name}</span>
                  <span className="text-[0.62rem] text-muted-foreground">{swarm.agents.length}</span>
                </DropdownMenuItem>
              ))}
              {swarms.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  Todavía no hay swarms
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={newSwarmFlow} className="gap-2">
                <Plus className="size-3.5" /> Nuevo swarm
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => meta && deleteSwarm(meta.id)}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" /> Eliminar este swarm
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Input
            value={meta?.name ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setMeta((m) => (m ? { ...m, name: value } : m));
              setDirty(true);
            }}
            placeholder="Nombre del swarm"
            aria-label="Nombre del swarm"
            className="h-8 max-w-xs text-sm font-medium"
          />

          <Select value={meta?.topology ?? "star"} onValueChange={(v) => changeTopology(v as SwarmTopology)}>
            <SelectTrigger className="h-8 w-32 shrink-0 text-xs" aria-label="Topología">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOPOLOGIES.map((topology) => (
                <SelectItem key={topology.id} value={topology.id} className="text-xs">
                  {topology.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="hidden text-[0.68rem] text-muted-foreground lg:inline">
            {agents.length} roles
            {dirty && <span className="ml-1 text-amber-500">· sin guardar</span>}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={resetGraph}
            title="Restablecer el grafo según la topología"
            aria-label="Restablecer el grafo"
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => draft && applyLayout(draft, true)}
            title="Reordenar el árbol"
            aria-label="Reordenar el árbol"
          >
            <LayoutGrid className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            className={cn("h-8", dirty && "bg-violet text-white hover:bg-violet/90")}
            onClick={saveDraft}
            disabled={!meta}
          >
            <Save className="size-3.5" /> Guardar
          </Button>
          <Button
            size="sm"
            className="h-8 bg-violet text-white hover:bg-violet/90"
            onClick={() => void launch()}
            disabled={blocked || launching}
            title={
              blocked
                ? "Completa los roles (nombre y propósito) antes de lanzar"
                : "Enviar el swarm al maestro"
            }
          >
            <Play className="size-3.5" />
            {launching ? "Lanzando…" : "Lanzar"}
          </Button>
        </div>
      </header>

      {/* Aviso honesto: el grafo es editable, pero el engine aún no lo ejecuta. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-dashboard-border-soft bg-violet/5 px-3 py-1.5 text-[0.68rem] text-muted-foreground sm:px-4">
        <Info className="size-3.5 shrink-0 text-violet" />
        <span>
          Las conexiones indican <strong>comunicación bidireccional</strong>, pero por ahora son{" "}
          <strong>solo diseño</strong>: el engine todavía enruta por el maestro. Lo que se ejecuta es
          la <strong>topología</strong>. Ver <code>ENGINE_GAPS.md</code> (G1/G2).
        </span>
      </div>

      {(blocked || swarmToolMissing) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-dashboard-border-soft bg-amber-500/10 px-3 py-1.5 text-[0.68rem] text-amber-500 sm:px-4">
          <AlertTriangle className="size-3.5 shrink-0" />
          {swarmToolMissing ? (
            <span>
              El plugin <code>swarm</code> no aparece entre las tools del engine. Actívalo en
              el engine (<code>enable_swarm = true</code>) para que el maestro pueda usarlo.
            </span>
          ) : (
            <span>
              {issues.filter((i) => i.level === "error").length} problema(s) por resolver:{" "}
              {issues.find((i) => i.level === "error")?.message}
            </span>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── Lienzo del grafo ───────────────────────────────────────────── */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <SwarmLiveContext.Provider value={{ agents: traffic.agents, master: traffic.master }}>
          <ReactFlow
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose}
            onNodeClick={(_event, node) => {
              setSelectedId(node.id);
              setSelectedEdgeId(null);
              setTab("props");
              // En estrecho el editor es un overlay: seleccionar un rol lo abre.
              if (!wideEnough) setPanelOpen(true);
            }}
            onEdgeClick={(_event, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedId(null);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectedEdgeId(null);
            }}
            deleteKeyCode={null}
            nodesConnectable
            colorMode={resolvedTheme === "light" ? "light" : "dark"}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.3}
            maxZoom={1.6}
            connectionLineStyle={{ stroke: "var(--violet)" }}
            className="[&_.react-flow__edge-path]:stroke-[1.5] [&_.react-flow__edge-path]:stroke-[var(--dashboard-border)]"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                (node.data as { role?: string }).role === "master" ? "#5b2eff" : "#14b8a6"
              }
            />
          </ReactFlow>
          </SwarmLiveContext.Provider>

          {/* Arista seleccionada: borrado explícito (y también con Supr). */}
          {selectedEdgeId && (
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--dashboard-border)] bg-[var(--phoson-surface)] px-2.5 py-1 text-[0.68rem] shadow-md">
              <span className="text-muted-foreground">Conexión seleccionada</span>
              <button
                onClick={deleteSelectedEdge}
                className="rounded px-1.5 py-0.5 font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                Eliminar
              </button>
            </div>
          )}

          {!agents.length && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="text-xs text-muted-foreground">
                Pulsa el botón <strong>+</strong> para añadir tu primer rol.
              </p>
            </div>
          )}

          {/* Botón flotante: crea un agente (modal) en vez de la barra lateral. */}
          <button
            onClick={openCreate}
            title="Nuevo agente"
            aria-label="Nuevo agente"
            className="absolute bottom-4 right-4 z-10 grid size-11 place-items-center rounded-full bg-violet text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-5" />
          </button>
        </div>

        {/* ── Propiedades / registro (inline cuando hay ancho) ───────────── */}
        {wideEnough && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar panel"
            onPointerDown={startResize}
            className={cn(
              "group relative w-1 shrink-0 cursor-col-resize",
              "after:absolute after:inset-y-0 after:-left-1 after:right-0 after:content-['']",
            )}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--dashboard-border)] transition-colors group-hover:bg-violet/60" />
          </div>
        )}
        {wideEnough && (
          <div
            style={{ width: panelWidth }}
            className="flex min-h-0 shrink-0 flex-col"
          >
            {panelBody}
          </div>
        )}
      </div>

      {/* En estrecho el mismo panel es un overlay, para poder editar roles. */}
      {!wideEnough && (
        <Drawer open={panelOpen} onOpenChange={setPanelOpen}>
          <DrawerContent className="h-[85vh]">
            <DrawerTitle className="sr-only">Panel del swarm</DrawerTitle>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-3">{panelBody}</div>
          </DrawerContent>
        </Drawer>
      )}

      {!wideEnough && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--dashboard-border)] px-3 py-1.5">
          <span className="min-w-0 truncate text-[0.68rem] text-muted-foreground">
            <Bot className="mr-1 inline size-3" />
            {selectedAgent ? `Editando @${selectedAgent.name || "sin nombre"}` : "Ningún rol seleccionado"}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[0.68rem]"
              onClick={() => {
                setTab("props");
                setPanelOpen(true);
              }}
            >
              <SlidersHorizontal className="size-3" /> Propiedades
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[0.68rem]"
              onClick={() => {
                setTab("log");
                setPanelOpen(true);
              }}
            >
              <List className="size-3" /> Mensajes
            </Button>
          </div>
        </div>
      )}

      <NewAgentDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={addAgentWithData} />
    </div>
  );
}
