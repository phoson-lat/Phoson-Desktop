/**
 * Modelo de datos de los **swarms de agentes** (multi-agente jerárquico).
 *
 * Un swarm es un árbol: un **maestro** (el agente de la sesión, con quien habla
 * la persona) y N **roles** especializados a los que delega. Traduce un árbol
 * dibujado a mano a las llamadas que el engine ya sabe ejecutar.
 *
 * Límites reales del engine (`phoson_plugin_swarm`), que este módulo respeta en
 * lugar de inventar comportamiento:
 *
 * - El maestro es el ÚNICO que enruta mensajes: a los miembros se les retiran
 *   las tools `swarm_*` y las de delegación, así que no pueden crear swarms
 *   anidados ni hablar entre ellos llamando a una herramienta.
 * - La comunicación entre agentes es por **bandeja + entrega en el siguiente
 *   run** del destinatario (el orquestador siembra el prompt del miembro con su
 *   inbox y recoge su informe en el blackboard). No es un chat en vivo.
 * - `swarm_create` admite 3 topologías: `star` (fan-out en paralelo), `mesh`
 *   (paralelo con blackboard compartido) y `pipeline` (cadena secuencial).
 * - `recipient` es el nombre exacto del agente, o `"*"` para difundir. La
 *   arroba (`@nombre`) es la **convención de escritura** que usamos en los
 *   textos y en las instrucciones; al engine se le pasa el nombre sin arroba.
 *
 * Módulo puro (sin React): la UI lo pinta y `toMasterInstruction()` produce el
 * turno que se le envía al maestro.
 */

/* ── Tipos ─────────────────────────────────────────────────────────────── */

/** Topología de ejecución soportada por el plugin del engine. */
export type SwarmTopology = "star" | "mesh" | "pipeline";

export interface TopologyMeta {
  id: SwarmTopology;
  label: string;
  hint: string;
}

/** Las tres únicas topologías que el plugin acepta. */
export const TOPOLOGIES: TopologyMeta[] = [
  {
    id: "star",
    label: "Estrella",
    hint: "Todos los roles trabajan en paralelo sobre la tarea y el maestro reúne los informes.",
  },
  {
    id: "mesh",
    label: "Malla",
    hint: "Como estrella, pero cada rol recibe además todo el estado compartido (visibilidad entre pares).",
  },
  {
    id: "pipeline",
    label: "Cadena",
    hint: "Los roles corren en secuencia, en el orden del árbol: el informe de cada uno alimenta al siguiente.",
  },
];

/** Un rol del swarm: se traduce 1:1 a un objeto de `swarm_create`. */
export interface SwarmAgent {
  id: string;
  /** Nombre de rol; es el `recipient` de los mensajes y lo que se escribe tras `@`. */
  name: string;
  /** Qué debe hacer este agente: viaja como `system_prompt`. */
  purpose: string;
  /** Modelo propio; vacío = hereda el del maestro. */
  model: string;
  /** Allowlist de herramientas; lista vacía = todas las que ofrezca el host. */
  tools: string[];
  /** Presupuesto de tokens del rol; `null` = el cap del plugin. */
  maxTokens: number | null;
  /** Posición en el lienzo del árbol. */
  position: { x: number; y: number };
}

/** Id del nodo maestro en el lienzo (nodo sintético, no es un rol). */
export const MASTER_ID = "master";

export interface Swarm {
  version: 1;
  id: string;
  name: string;
  /** Qué se le pide al swarm por defecto (la tarea que recibe el maestro). */
  mission: string;
  topology: SwarmTopology;
  /**
   * Aristas del grafo (ids de nodo: `MASTER_ID` o id de rol). Son **conexiones**
   * no dirigidas: A–B indica comunicación bidireccional. Es el grafo
   * **editable** del editor: hoy es solo diseño, no cambia la ejecución.
   */
  edges: SwarmEdge[];
  /**
   * Si los roles pueden dirigirse entre sí (el maestro les pasa el roster y la
   * convención `@`). Apagado, toda la comunicación pasa por el maestro.
   */
  peerMessaging: boolean;
  agents: SwarmAgent[];
  createdAt: number;
  updatedAt: number;
}

/** Arista del grafo editable del editor (solo diseño por ahora). */
export interface SwarmEdge {
  id: string;
  /** Id de nodo origen: `MASTER_ID` o el id de un rol. */
  source: string;
  target: string;
}

/** Un problema del árbol, con el elemento que lo provoca. */
export interface SwarmIssue {
  level: "error" | "warning";
  agentId?: string;
  message: string;
}

/* ── Límites del engine ────────────────────────────────────────────────── */

/** Cap por defecto del plugin (`swarm_max_agents`); configurable en el engine. */
export const MAX_AGENTS = 5;

/** Tools que el engine retira SIEMPRE a los miembros (no tienen sentido en una allowlist). */
export const RESERVED_TOOLS = [
  "agent",
  "agents",
  "swarm_create",
  "swarm_assign",
  "swarm_message",
  "swarm_status",
  "swarm_collect",
  "swarm_dissolve",
];

/** Nombre de rol válido: sin espacios ni arrobas (es un identificador de enrutado). */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export const uid = (prefix = "a"): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

/* ── Construcción ──────────────────────────────────────────────────────── */

export function createAgent(
  position: { x: number; y: number },
  patch: Partial<SwarmAgent> = {},
): SwarmAgent {
  return {
    id: uid(),
    name: "",
    purpose: "",
    model: "",
    tools: [],
    maxTokens: null,
    position,
    ...patch,
  };
}

/** Árbol inicial: un rol ya pensado, para que el lienzo explique el modelo. */
export function newSwarm(name = "Swarm sin título", mission = ""): Swarm {
  const now = Date.now();
  const swarm: Swarm = {
    version: 1,
    id: uid("s"),
    name,
    mission,
    topology: "star",
    edges: [],
    peerMessaging: true,
    agents: [
      createAgent({ x: -170, y: 170 }, {
        name: "investigador",
        purpose: "Reúne la información necesaria y devuelve hallazgos con fuentes concretas.",
      }),
      createAgent({ x: 170, y: 170 }, {
        name: "revisor",
        purpose: "Critica el trabajo de los demás: busca huecos, riesgos y afirmaciones sin respaldo.",
      }),
    ],
    createdAt: now,
    updatedAt: now,
  };
  swarm.edges = defaultEdgesFor(swarm);
  return withDefaultLayout(swarm);
}

/** Aristas por defecto de una topología: abanico bajo el maestro, o cadena. */
export function defaultEdgesFor(swarm: Swarm): SwarmEdge[] {
  if (!swarm.agents.length) return [];
  if (swarm.topology === "pipeline") {
    const chain: SwarmEdge[] = [];
    let previous = MASTER_ID;
    for (const agent of swarm.agents) {
      chain.push({ id: `${previous}->${agent.id}`, source: previous, target: agent.id });
      previous = agent.id;
    }
    return chain;
  }
  return swarm.agents.map((agent) => ({
    id: `${MASTER_ID}->${agent.id}`,
    source: MASTER_ID,
    target: agent.id,
  }));
}

/** Ejemplo completo que se siembra la primera vez que se abre la sección. */
export function exampleSwarm(): Swarm {
  const swarm = newSwarm(
    "Ejemplo · informe técnico",
    "Investiga el tema del día, redacta un informe breve y hazlo revisar antes de entregarlo.",
  );
  swarm.topology = "pipeline";
  swarm.agents = [
    createAgent({ x: 0, y: 150 }, {
      name: "investigador",
      purpose:
        "Reúne información del repositorio y de la web sobre el tema pedido. Devuelve hallazgos numerados, cada uno con su fuente o ruta de archivo.",
      tools: ["read_file", "grep", "glob", "web_search"],
    }),
    createAgent({ x: 0, y: 330 }, {
      name: "redactor",
      purpose:
        "Con los hallazgos recibidos, escribe el informe en Markdown: resumen, hallazgos y recomendaciones. Nada de relleno.",
      tools: ["read_file", "write_file"],
      model: "",
    }),
    createAgent({ x: 0, y: 510 }, {
      name: "revisor",
      purpose:
        "Revisa el informe del redactor contra los hallazgos del investigador: señala afirmaciones sin respaldo, contradicciones y omisiones. No reescribas el informe; entrega una lista de correcciones.",
      tools: ["read_file", "grep"],
    }),
  ];
  swarm.edges = defaultEdgesFor(swarm);
  return withDefaultLayout(swarm);
}

/* ── Validación ────────────────────────────────────────────────────────── */

/** Revisa el árbol y devuelve lo que impediría lanzarlo (o lo que conviene saber). */
export function validate(swarm: Swarm): SwarmIssue[] {
  const issues: SwarmIssue[] = [];
  const seen = new Map<string, number>();

  if (!swarm.agents.length) {
    issues.push({ level: "error", message: "El swarm no tiene ningún rol." });
  }
  if (swarm.agents.length > MAX_AGENTS) {
    issues.push({
      level: "error",
      message: `El engine limita el swarm a ${MAX_AGENTS} agentes (swarm_max_agents); tienes ${swarm.agents.length}.`,
    });
  }

  for (const agent of swarm.agents) {
    const name = agent.name.trim();
    if (!name) {
      issues.push({ level: "error", agentId: agent.id, message: "Falta el nombre del rol." });
    } else if (!NAME_RE.test(name)) {
      issues.push({
        level: "error",
        agentId: agent.id,
        message: `«${name}» no sirve como nombre: usa letras, números, guion o guion bajo (sin espacios ni «@»).`,
      });
    }
    seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) ?? 0) + 1);

    if (!agent.purpose.trim()) {
      issues.push({
        level: "error",
        agentId: agent.id,
        message: "Falta el propósito: es el `system_prompt` del agente.",
      });
    }
    const reserved = agent.tools.filter((tool) => RESERVED_TOOLS.includes(tool));
    if (reserved.length) {
      issues.push({
        level: "warning",
        agentId: agent.id,
        message: `El engine retira las tools de delegación/swarm a los miembros: ${reserved.join(", ")}. Quítalas de la allowlist.`,
      });
    }
  }

  for (const [name, count] of seen) {
    if (count > 1) {
      issues.push({
        level: "error",
        message: `El nombre «${name}» está repetido: el enrutado de mensajes necesita nombres únicos.`,
      });
    }
  }

  if (!swarm.mission.trim()) {
    issues.push({
      level: "warning",
      message: "Sin misión: el maestro no sabrá qué pedirle al swarm cuando pulses Lanzar.",
    });
  }
  return issues;
}

export const hasErrors = (issues: SwarmIssue[]): boolean => issues.some((i) => i.level === "error");

/* ── Traducción al engine ──────────────────────────────────────────────── */

/**
 * Guía de comunicación que se añade al `system_prompt` de cada rol.
 *
 * Es necesaria porque el engine NO da herramientas de mensajería a los
 * miembros: los mensajes van al *inbox* del destinatario y se le entregan en su
 * siguiente ejecución. Sin esta explicación, un agente intentaría inventarse una
 * conversación en vivo.
 */
export function commsGuide(swarm: Swarm, agent: SwarmAgent): string {
  const others = swarm.agents.filter((a) => a.id !== agent.id).map((a) => `@${a.name.trim()}`);
  const lines = [
    "## Comunicación",
    "",
    "- No puedes llamar a ninguna herramienta de mensajería: el maestro es quien enruta los mensajes entre agentes.",
    "- Redacta tu informe pensando en quién lo va a leer. Si necesitas que otro rol haga algo, dilo de forma explícita y accionable: puede recibirlo como mensaje.",
    "- Usa la arroba para referirte a otros roles, así el maestro sabe a quién dirigirlo (por ejemplo: «que @redactor desarrolle el punto 3»).",
  ];
  if (swarm.peerMessaging && others.length) {
    lines.push(
      `- Roles con los que compartes swarm: ${others.join(", ")}. Puedes pedirles algo mencionándolos con @; el maestro lo pondrá en su bandeja y lo verán en su siguiente ejecución.`,
    );
  } else {
    lines.push("- Dirige tus peticiones al maestro: él decide a quién corresponden.");
  }
  return lines.join("\n");
}

/** El `system_prompt` final de un rol: propósito + guía de comunicación. */
export function systemPromptFor(swarm: Swarm, agent: SwarmAgent): string {
  return [
    `Eres «${agent.name.trim()}», un agente especializado del swarm «${swarm.name}».`,
    "",
    "## Propósito",
    "",
    agent.purpose.trim(),
    "",
    commsGuide(swarm, agent),
    "",
    "## Formato de entrega",
    "",
    "Devuelve un informe breve (no una transcripción de tus pasos): qué has hecho, qué has encontrado y qué falta. El maestro lo integrará con el de los demás.",
  ].join("\n");
}

/** Argumentos de `swarm_create`, tal cual los espera la tool del engine. */
export function toSwarmCreateArgs(swarm: Swarm): {
  topology: SwarmTopology;
  agents: Array<Record<string, unknown>>;
} {
  return {
    topology: swarm.topology,
    agents: swarm.agents.map((agent) => {
      // Solo se envían los campos con valor: dejarlos vacíos o a null haría que
      // el engine aplicase un cap distinto del que el usuario ve en la UI.
      const entry: Record<string, unknown> = {
        name: agent.name.trim(),
        system_prompt: systemPromptFor(swarm, agent),
      };
      const model = agent.model.trim();
      if (model) entry.model = model;
      const tools = agent.tools.filter((tool) => !RESERVED_TOOLS.includes(tool));
      if (tools.length) entry.tools_allowlist = tools;
      if (agent.maxTokens && agent.maxTokens > 0) entry.max_tokens = agent.maxTokens;
      return entry;
    }),
  };
}

/** Bloque que se inserta en el turno del maestro: el árbol, como instrucciones. */
export function treeSummary(swarm: Swarm): string {
  const lines = [
    `- **Maestro** (tú, ${swarm.topology === "pipeline" ? "cadena secuencial" : "orquestación"})`,
  ];
  swarm.agents.forEach((agent, index) => {
    const lastName = index === swarm.agents.length - 1 && swarm.topology === "pipeline";
    const branch = lastName ? "└─" : "├─";
    const model = agent.model.trim() ? ` · modelo ${agent.model.trim()}` : "";
    const tools = agent.tools.length ? ` · tools: ${agent.tools.join(", ")}` : " · todas las tools";
    const budget = agent.maxTokens ? ` · ${agent.maxTokens} tokens` : "";
    lines.push(`  ${branch} @${agent.name.trim() || "(sin nombre)"}${model}${tools}${budget}`);
  });
  return lines.join("\n");
}

/**
 * El turno que se envía al **maestro** (la única conversación que mantiene la
 * persona). Contiene las llamadas exactas para que el swarm se cree y arranque,
 * más la convención `@` para el enrutado de mensajes entre agentes.
 */
export function toMasterInstruction(swarm: Swarm, task: string): string {
  const args = toSwarmCreateArgs(swarm);
  const roster = swarm.agents.map((a) => `@${a.name.trim()}`).join(", ");
  const payload = JSON.stringify(args, null, 2);

  const routing = swarm.peerMessaging
    ? [
        `Los roles pueden dirigirse entre sí. Cuando un informe mencione a otro rol (por ejemplo «que @revisor lo compruebe»),`,
        `envíalo a su bandeja con \`swarm_message\` usando \`recipient\` = el nombre **sin arroba** («revisor») y mantén la mención`,
        `\`@revisor\` en el texto. Usa \`recipient: "*"\` para difundir a todos. Los mensajes se entregan en la siguiente`,
        `ejecución del destinatario, así que vuelve a asignarle trabajo con \`swarm_assign\` para que los reciba.`,
      ].join(" ")
    : "Dirige tú cada petición al rol que corresponda: los agentes no se escriben entre ellos.";

  return [
    `Ejecuta el swarm «${swarm.name}» sobre esta tarea:`,
    "",
    `> ${task.trim()}`,
    "",
    "Árbol de agentes:",
    "",
    treeSummary(swarm),
    "",
    "Pasos, en este orden:",
    "",
    "1. Crea el swarm con `swarm_create` y exactamente estos argumentos:",
    "",
    "```json",
    payload,
    "```",
    "",
    `2. Lanza la tarea con \`swarm_assign\` (sin \`target\`, para que corra bajo la topología «${swarm.topology}»).`,
    "3. Espera los informes con `swarm_collect`.",
    `4. Integra los resultados en una respuesta única para mí. Roles involucrados: ${roster}.`,
    "",
    "Enrutado de mensajes entre agentes:",
    "",
    routing,
    "",
    "No inventes herramientas: si `swarm_create` no está disponible, dímelo en vez de simular el swarm.",
  ].join("\n");
}

/* ── Presentación ──────────────────────────────────────────────────────── */

/**
 * Los roles se apilan **a la derecha del maestro** (una columna), en vez de
 * debajo: así las conexiones salen por los **laterales**, son cortas y directas.
 */
const AGENT_X = 90;
const ROW = 170;

/** Posición ideal de un rol: columna a la derecha del maestro, centrada. */
export function positionForAgent(index: number, count: number): { x: number; y: number } {
  return { x: AGENT_X, y: (index - (count - 1) / 2) * ROW };
}

/**
 * Posiciones por defecto: el array de roles es el orden vertical (el de
 * ejecución en `pipeline`); el maestro vive a la izquierda (posición fija en la
 * sección) y cada rol se alinea a su altura.
 */
export function layoutFor(swarm: Swarm): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const count = swarm.agents.length;
  swarm.agents.forEach((agent, index) => {
    out[agent.id] = positionForAgent(index, count);
  });
  return out;
}

/** Aplica `layoutFor` a los roles (usado al crear/sembrar un swarm). */
export function withDefaultLayout(swarm: Swarm): Swarm {
  const layout = layoutFor(swarm);
  return {
    ...swarm,
    agents: swarm.agents.map((agent) =>
      layout[agent.id] ? { ...agent, position: layout[agent.id] } : agent,
    ),
  };
}

/* ── Persistencia local ────────────────────────────────────────────────── */

const STORAGE_KEY = "phoson.swarms.v1";
const SEED_FLAG = "phoson.swarms.seeded";

export function loadSwarms(): Swarm[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSwarm).map(normalize);
  } catch {
    return [];
  }
}

export function persistSwarms(swarms: Swarm[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(swarms));
  } catch {
    /* almacenamiento no disponible o lleno */
  }
}

/** ¿Ya se ofreció el ejemplo? (si no, borrarlo lo resucitaría.) */
export function exampleAlreadyOffered(): boolean {
  try {
    return localStorage.getItem(SEED_FLAG) === "1";
  } catch {
    return true;
  }
}

export function markExampleOffered(): void {
  try {
    localStorage.setItem(SEED_FLAG, "1");
  } catch {
    /* almacenamiento no disponible */
  }
}

function isSwarm(value: unknown): value is Swarm {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Swarm>;
  return typeof s.id === "string" && typeof s.name === "string" && Array.isArray(s.agents);
}

/** Sanea un swarm guardado (esquema previo o edición manual del JSON). */
export function normalize(swarm: Swarm): Swarm {
  const agents = (swarm.agents ?? []).map((agent, index) => ({
    id: agent.id || uid(),
    name: agent.name ?? "",
    purpose: agent.purpose ?? "",
    model: agent.model ?? "",
    tools: Array.isArray(agent.tools) ? agent.tools.filter((t) => typeof t === "string") : [],
    maxTokens: typeof agent.maxTokens === "number" ? agent.maxTokens : null,
    position: agent.position ?? { x: 0, y: 150 + index * 180 },
  }));
  const base: Swarm = {
    ...swarm,
    version: 1,
    mission: swarm.mission ?? "",
    topology: TOPOLOGIES.some((t) => t.id === swarm.topology) ? swarm.topology : "star",
    edges: Array.isArray(swarm.edges) ? swarm.edges : [],
    peerMessaging: swarm.peerMessaging ?? true,
    agents,
  };
  // Migración: los swarms guardados antes del grafo editable no tienen aristas.
  if (!base.edges.length) base.edges = defaultEdgesFor(base);
  // Descarta aristas que referencian nodos que ya no existen.
  const known = new Set([MASTER_ID, ...agents.map((a) => a.id)]);
  base.edges = base.edges.filter(
    (edge) =>
      edge &&
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      known.has(edge.source) &&
      known.has(edge.target),
  );
  return base;
}
