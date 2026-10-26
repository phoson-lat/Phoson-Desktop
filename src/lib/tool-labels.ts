import type { TFunction } from "i18next";
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

import chat from "@/locales/es/chat.json";

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
 *
 * Los verbos ya no viven aquí: van al catálogo (`chat:tools.verbs.<tool>`, con el
 * nombre de la tool como clave) y se resuelven con la `t` del idioma activo; este
 * módulo solo aporta el icono y el detalle («sobre qué actúa»), que son datos.
 */

export interface ToolPresentation {
  /** Frase de acción («leyendo archivo»). */
  verb: string;
  icon: LucideIcon;
}

/**
 * Icono por tool (mismas familias que `_TOOL_VERBS` / `_TOOL_ICONS` del CLI).
 * Las claves de este mapa son también las claves válidas de `tools.verbs`, así
 * que sirven para decidir el verbo sin salirse del tipado del catálogo.
 */
const ICONS: Record<string, LucideIcon> = {
  // ── Nativas (mismas familias que `_TOOL_VERBS` / `_TOOL_ICONS`) ─────────────
  read_file: BookOpen,
  write_file: FilePen,
  patch_file: Wand2,
  list_dir: FolderOpen,
  grep: Search,
  glob: Files,
  view_image: Image,
  bash: Terminal,
  skill: Scroll,
  web_search: Globe,
  web_fetch: Globe,
  agent: Users,
  agents: Users,

  // ── Plugin computeruse: primitivas de ratón/teclado/pantalla ───────────────
  computer_screenshot: Monitor,
  computer_move: MousePointer,
  computer_click: MousePointerClick,
  computer_drag: Move,
  computer_scroll: ArrowDownUp,
  computer_type: Type,
  computer_key: Keyboard,
  computer_wait: Hourglass,

  // ── Plugin de trabajos en segundo plano ────────────────────────────────────
  run_bg_job: Rocket,
  list_bg_jobs: ListChecks,
  stop_bg_job: CircleStop,
  wait_bg_jobs: Timer,

  // ── Plugin SSH ─────────────────────────────────────────────────────────────
  ssh_exec: SquareTerminal,
  ssh_hosts: Network,
  ssh_copy_local_to_remote: Upload,
  ssh_copy_remote_to_local: Download,

  // ── Plugin de memoria (clave/valor y semántica) ────────────────────────────
  memory_read: Database,
  memory_write: Save,
  memory_delete: Trash2,
  memory_list: List,
  remember: Brain,
  recall: BrainCircuit,
  forget: Eraser,

  // ── Plugin swarm ───────────────────────────────────────────────────────────
  swarm_create: UsersRound,
  swarm_assign: UserPlus,
  swarm_message: Send,
  swarm_status: Activity,
  swarm_collect: Inbox,
  swarm_dissolve: UserMinus,

  // ── Otros plugins ──────────────────────────────────────────────────────────
  questions: MessageCircle,
  transcribe_audio: Mic,
};

/** Claves de verbo del catálogo, derivadas del propio JSON (type-safe). */
type VerbName = keyof typeof chat.tools.verbs;

/**
 * Las claves de `ICONS` son exactamente las tools con verbo propio en el
 * catálogo, así que este chequeo da el narrowing a `VerbName` sin castings.
 */
const hasOwnVerb = (name: string): name is VerbName => name in ICONS;

/** Tools de MCP: nombre dinámico (`mcp_server_tool`), así que va por prefijo. */
const MCP_NAME = /^mcp[_-]/i;

const MCP_ICON = Plug;
const UNKNOWN_ICON = Sparkles;

/**
 * `snake_case` / `kebab-case` / `camelCase` → texto legible.
 *
 * Fallback para tools desconocidas (plugins de terceros): su verbo en el catálogo
 * es «usando {{name}}», así que aquí solo se deja legible el identificador. Si no
 * queda ni una letra (nombre vacío o solo signos) se devuelve el nombre tal cual:
 * es lo único que hay que enseñar.
 */
const humanize = (name: string): string => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\s]+/g, " ")
    .trim()
    .toLowerCase();
  return words || name;
};

/**
 * Verbo e icono de una tool. El verbo sale del catálogo (`tools.verbs`): con la
 * unión de claves derivada del JSON, el nombre de la tool es una clave válida y
 * el resto cae en `mcp` (por prefijo) o en `unknown` («usando {{name}}»).
 */
export const toolPresentation = (name: string, t: TFunction<"chat">): ToolPresentation => {
  const mcp = MCP_NAME.test(name);
  const key: VerbName = hasOwnVerb(name) ? name : mcp ? "mcp" : "unknown";
  return {
    verb: t(`tools.verbs.${key}`, { name: humanize(name) }),
    icon: ICONS[name] ?? (mcp ? MCP_ICON : UNKNOWN_ICON),
  };
};

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
 *
 * Como en el CLI, la ruta/consulta/url va **completa**: solo el comando y el
 * patrón se recortan. La fila ya trunca con CSS y deja el valor en el tooltip.
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
    if (typeof value === "string" && value) return value;
  }
  return argsPreview(a);
};

/** `850ms` bajo un segundo, `1.2s` bajo un minuto, `2m05s` después (= CLI). */
export const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
};

/** Primera línea del error, recortada como en la tarjeta del CLI. */
export const errorHeadline = (error: string): string => {
  const first = error.split(/\r?\n/).find((line) => line.trim()) ?? error;
  return first.length > MAX_DETAIL ? `${first.slice(0, MAX_DETAIL)}…` : first;
};

/** Líneas de salida de `bash` que se ven sin pedir más (= `_BASH_PREVIEW_LINES`). */
export const BASH_PREVIEW_LINES = 6;

/** Secuencias de escape de terminal (OSC de título/colores y CSI/SGR). */
const TERMINAL_ESCAPES = /\x1b\][^\x1b\x07\n]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g;

/**
 * Salida de `bash` como la enseña el CLI: sin escapes de terminal (`ls
 * --color`, títulos de ventana…), las primeras `BASH_PREVIEW_LINES` líneas y
 * cuántas quedan ocultas. `all` trae la salida limpia completa.
 */
export const bashOutput = (result: string): { all: string[]; preview: string[]; hidden: number } => {
  const clean = result.replace(TERMINAL_ESCAPES, "").trim();
  const all = clean ? clean.split(/\r?\n/) : [];
  const preview = all.slice(0, BASH_PREVIEW_LINES);
  return { all, preview, hidden: all.length - preview.length };
};

/** Nombres distintos que lista el resumen de un grupo antes de elidir (= CLI). */
const SUMMARY_MAX_NAMES = 4;

export interface ToolGroupSummary {
  count: number;
  /** `bash ×2`, `read_file`… (en orden de aparición; `…` si hay más). */
  names: string[];
  errors: number;
  /** Suma de duraciones conocidas (0 = ninguna conocida). */
  totalMs: number;
}

/**
 * Resumen de una racha de tools consecutivas (espejo de
 * `render_tool_group_summary`): `7 tools used · read_file ×4, grep ×2, bash ·
 * ✗ 1 error · 3.2s`.
 */
export const toolGroupSummary = (
  tools: { name: string; status: string; durationMs?: number }[],
): ToolGroupSummary => {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  const entries = [...counts.entries()];
  const names = entries
    .slice(0, SUMMARY_MAX_NAMES)
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
  if (entries.length > SUMMARY_MAX_NAMES) names.push("…");
  return {
    count: tools.length,
    names,
    errors: tools.filter((tool) => tool.status === "error").length,
    totalMs: tools.reduce((sum, tool) => sum + (tool.durationMs ?? 0), 0),
  };
};