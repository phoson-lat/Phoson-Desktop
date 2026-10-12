import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowDownUp,
  BookOpen,
  Brain,
  BrainCircuit,
  CircleStop,
  Database,
  Download,
  Eraser,
  FilePen,
  Files,
  FolderOpen,
  Globe,
  Hourglass,
  Image,
  Inbox,
  Keyboard,
  List,
  ListChecks,
  MessageCircle,
  Mic,
  Monitor,
  MousePointer,
  MousePointerClick,
  Move,
  Network,
  Plug,
  Rocket,
  Save,
  Scroll,
  Search,
  Send,
  Sparkles,
  SquareTerminal,
  Terminal,
  Timer,
  Trash2,
  Type,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  UsersRound,
  Wand2,
} from "lucide-react";

/**
 * Presentación humana de las herramientas: verbo, icono y "sobre qué actúa".
 *
 * Espeja `phoson_cli/formatting.py` (`_TOOL_VERBS` / `_TOOL_ICONS` / `tool_verb` /
 * `tool_icon` / `tool_detail` y el fallback `tool_args_preview`) para que la GUI y
 * el CLI describan la misma acción con las mismas palabras: `leyendo archivo ·
 * src/App.tsx` en vez del identificador crudo `read_file`.
 *
 * Además de las tools nativas cubre las de los plugins — computeruse, trabajos en
 * segundo plano, SSH, memoria, swarm, preguntas y transcripción — y las de MCP,
 * que son dinámicas (`mcp__servidor__tool`, `mcp_<servidor>_<tool>`): ésas caen en
 * una regla de prefijo («usando MCP») porque no pueden enumerarse.
 */

export interface ToolPresentation {
  /** Frase de acción («leyendo archivo»). */
  verb: string;
  icon: LucideIcon;
}

const PRESENTATION: Record<string, ToolPresentation> = {
  // ── Nativas (mismas familias que `_TOOL_VERBS` / `_TOOL_ICONS`) ─────────────
  read_file: { verb: "leyendo archivo", icon: BookOpen },
  write_file: { verb: "escribiendo archivo", icon: FilePen },
  patch_file: { verb: "editando archivo", icon: Wand2 },
  list_dir: { verb: "listando carpeta", icon: FolderOpen },
  grep: { verb: "buscando en archivos", icon: Search },
  glob: { verb: "buscando archivos", icon: Files },
  view_image: { verb: "viendo imagen", icon: Image },
  bash: { verb: "ejecutando comando", icon: Terminal },
  skill: { verb: "cargando skill", icon: Scroll },
  web_search: { verb: "buscando en la web", icon: Globe },
  web_fetch: { verb: "descargando página", icon: Globe },
  agent: { verb: "lanzando subagente", icon: Users },
  agents: { verb: "lanzando subagentes", icon: Users },

  // ── Plugin computeruse: primitivas de ratón/teclado/pantalla ───────────────
  computer_screenshot: { verb: "capturando pantalla", icon: Monitor },
  computer_move: { verb: "moviendo el cursor", icon: MousePointer },
  computer_click: { verb: "haciendo clic en pantalla", icon: MousePointerClick },
  computer_drag: { verb: "arrastrando en pantalla", icon: Move },
  computer_scroll: { verb: "desplazando la pantalla", icon: ArrowDownUp },
  computer_type: { verb: "escribiendo texto", icon: Type },
  computer_key: { verb: "pulsando teclas", icon: Keyboard },
  computer_wait: { verb: "esperando un momento", icon: Hourglass },

  // ── Plugin de trabajos en segundo plano ────────────────────────────────────
  run_bg_job: { verb: "lanzando tarea en segundo plano", icon: Rocket },
  list_bg_jobs: { verb: "listando tareas en segundo plano", icon: ListChecks },
  stop_bg_job: { verb: "deteniendo tarea en segundo plano", icon: CircleStop },
  wait_bg_jobs: { verb: "esperando tareas en segundo plano", icon: Timer },

  // ── Plugin SSH ─────────────────────────────────────────────────────────────
  ssh_exec: { verb: "ejecutando por SSH", icon: SquareTerminal },
  ssh_hosts: { verb: "listando hosts SSH", icon: Network },
  ssh_copy_local_to_remote: { verb: "subiendo archivo por SSH", icon: Upload },
  ssh_copy_remote_to_local: { verb: "descargando archivo por SSH", icon: Download },

  // ── Plugin de memoria (clave/valor y semántica) ────────────────────────────
  memory_read: { verb: "leyendo de memoria", icon: Database },
  memory_write: { verb: "guardando en memoria", icon: Save },
  memory_delete: { verb: "borrando de memoria", icon: Trash2 },
  memory_list: { verb: "listando memoria", icon: List },
  remember: { verb: "recordando", icon: Brain },
  recall: { verb: "recuperando recuerdo", icon: BrainCircuit },
  forget: { verb: "olvidando", icon: Eraser },

  // ── Plugin swarm ───────────────────────────────────────────────────────────
  swarm_create: { verb: "creando enjambre", icon: UsersRound },
  swarm_assign: { verb: "asignando tarea al enjambre", icon: UserPlus },
  swarm_message: { verb: "enviando mensaje al enjambre", icon: Send },
  swarm_status: { verb: "consultando estado del enjambre", icon: Activity },
  swarm_collect: { verb: "recogiendo resultados del enjambre", icon: Inbox },
  swarm_dissolve: { verb: "disolviendo enjambre", icon: UserMinus },

  // ── Otros plugins ──────────────────────────────────────────────────────────
  questions: { verb: "preguntando al usuario", icon: MessageCircle },
  transcribe_audio: { verb: "transcribiendo audio", icon: Mic },
};

/** Tools de MCP: nombre dinámico (`mcp_server_tool`), así que va por prefijo. */
const MCP_NAME = /^mcp[_-]/i;

const MCP_PRESENTATION: ToolPresentation = { verb: "usando MCP", icon: Plug };

/**
 * `snake_case` / `kebab-case` / `camelCase` → texto legible.
 *
 * Fallback para tools de plugins desconocidos (o de terceros): el identificador
 * crudo nunca debe llegar tal cual a una UI en español.
 */
const humanize = (name: string): string => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\s]+/g, " ")
    .trim()
    .toLowerCase();
  return words || "herramienta";
};

export const toolPresentation = (name: string): ToolPresentation =>
  PRESENTATION[name] ??
  (MCP_NAME.test(name) ? MCP_PRESENTATION : { verb: `usando ${humanize(name)}`, icon: Sparkles });

/** Máximo del detalle de una línea (igual que el CLI). */
const MAX_DETAIL = 72;

/** Presupuesto del resumen `clave=valor` con varios args (igual que el CLI). */
const ARGS_PREVIEW_BUDGET = 80;

const clip = (text: string): string => {
  const oneLine = text.split(/\s+/).filter(Boolean).join(" ");
  return oneLine.length > MAX_DETAIL ? `${oneLine.slice(0, MAX_DETAIL)}…` : oneLine;
};

/** Valor de un arg como texto de una línea (`""` si no hay nada mostrable). */
const argText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    // Ciclos o valores no serializables: mejor sin resumen que romper la fila.
    return "";
  }
};

/**
 * Último recurso (espejo de `tool_args_preview` en el CLI): un único argumento
 * se muestra tal cual; varios se resumen como `clave=valor` mientras quepan en
 * el presupuesto. Cubre tools sin `path`/`query`/`url`/`pattern`/`name`, como
 * `computer_click{x,y}`, `ssh_exec{host,command}` o cualquier tool de MCP.
 */
const argsPreview = (args: Record<string, unknown>): string => {
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  if (keys.length === 1) return clip(argText(args[keys[0]]));
  const parts: string[] = [];
  let budget = 0;
  for (const key of keys) {
    const part = `${key}=${argText(args[key])}`;
    budget += part.length;
    if (budget > ARGS_PREVIEW_BUDGET) {
      parts.push("…");
      break;
    }
    parts.push(part);
  }
  return clip(parts.join(" "));
};

/**
 * "Sobre qué" actúa la tool: el comando en `bash`, el patrón en las búsquedas,
 * la ruta/consulta/url en el resto (mismo orden de preferencia que el CLI) y,
 * si no hay ninguno, el resumen de argumentos de `argsPreview`.
 */
export const toolDetail = (name: string, args: Record<string, unknown> | undefined): string => {
  const a = args ?? {};
  if (name === "bash") {
    const cmd = typeof a.command === "string" ? a.command : "";
    return cmd ? clip(cmd) : "";
  }
  if (name === "grep" || name === "glob") {
    const pattern = typeof a.pattern === "string" ? a.pattern : "";
    if (pattern) return clip(pattern);
  }
  for (const key of ["path", "query", "url", "pattern", "name"]) {
    const value = a[key];
    if (typeof value === "string" && value) return clip(value);
  }
  return argsPreview(a);
};