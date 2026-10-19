/**
 * Metadatos de los proveedores del engine: etiqueta legible y enlace para
 * obtener la clave. Los ids coinciden con `phoson_cli`.
 *
 * El orden es el de presentación en la UI.
 *
 * Aquí solo queda lo que **no** se traduce (el nombre comercial y la URL de las
 * claves). El texto humano («Recomendado: …», «Usa tus credenciales…») es UI y
 * vive en el catálogo (`system:providers.<id>.hint|note`), que además es la
 * fuente de la unión de ids: ver `providerHint` / `providerNote`.
 */

import i18n from "@/lib/i18n";
import system from "@/locales/es/system.json";

export interface ProviderMeta {
  label: string;
  keysUrl?: string;
}

/**
 * Nombre comercial y URL de las claves de cada proveedor. Los textos humanos se
 * piden con `providerHint` / `providerNote` (ver abajo).
 */
export const PROVIDER_META: Record<string, ProviderMeta> = {
  openrouter: { label: "OpenRouter", keysUrl: "https://openrouter.ai/keys" },
  openai: { label: "OpenAI", keysUrl: "https://platform.openai.com/api-keys" },
  // Suscripciones (OAuth, sin API key): no hay página de claves que ofrecer.
  chatgpt: { label: "ChatGPT (Plus/Pro)" },
  anthropic: { label: "Anthropic", keysUrl: "https://console.anthropic.com/settings/keys" },
  ollama: { label: "Ollama" },
  github: { label: "GitHub Models", keysUrl: "https://github.com/settings/tokens" },
  nvidia: { label: "NVIDIA", keysUrl: "https://build.nvidia.com" },
  xai: { label: "Grok (X.AI)", keysUrl: "https://console.x.ai" },
  groq: { label: "Groq", keysUrl: "https://console.groq.com/keys" },
  deepseek: { label: "DeepSeek", keysUrl: "https://platform.deepseek.com/api_keys" },
  alibaba: {
    label: "Alibaba Cloud (DashScope)",
    keysUrl: "https://modelstudio.console.alibabacloud.com/",
  },
  together: { label: "Together AI", keysUrl: "https://api.together.ai/settings/api-keys" },
  perplexity: { label: "Perplexity", keysUrl: "https://www.perplexity.ai/settings/api" },
  lmstudio: { label: "LM Studio" },
  vllm: { label: "vLLM" },
  azure: { label: "Azure OpenAI", keysUrl: "https://portal.azure.com" },
  gemini: { label: "Google Gemini", keysUrl: "https://aistudio.google.com/app/apikey" },
  "google-code-assist": { label: "Google Code Assist" },
  mistral: { label: "Mistral AI", keysUrl: "https://console.mistral.ai/api-keys" },
  bedrock: { label: "AWS Bedrock" },
  fireworks: { label: "Fireworks AI", keysUrl: "https://fireworks.ai/account/api-keys" },
  cohere: { label: "Cohere", keysUrl: "https://dashboard.cohere.com/api-keys" },
  omniroute: { label: "OmniRoute" },
};

/** base_url por defecto de los proveedores locales. */
export const BASE_URL_DEFAULTS: Record<string, string> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
  vllm: "http://localhost:8000/v1",
  omniroute: "http://localhost:3000/v1",
};

export const providerLabel = (id: string): string => PROVIDER_META[id]?.label ?? id;

/* ── Texto humano del catálogo ────────────────────────────────────────────── */

/** Textos por id: el `es` manda y de ahí sale la unión (nada de listas a mano). */
type ProviderTexts = typeof system.providers;
type ProviderId = keyof ProviderTexts;

/**
 * Sub-unión de ids que traen un campo concreto. Si mañana se añade un `hint` en
 * el JSON, su id entra solo en la unión y `t()` comprueba la plantilla en
 * compilación (una clave inexistente no compila).
 */
type WithField<Field extends string> = {
  [K in ProviderId]: Field extends keyof ProviderTexts[K] ? K : never;
}[ProviderId];

type HintId = WithField<"hint">;
type NoteId = WithField<"note">;

/**
 * Campos que trae cada id del catálogo. Los ids llegan de la UI como `string`
 * libre (los pone el engine), así que hay que acotarlos antes de pedir la clave;
 * este mapa lo hace con los datos del JSON.
 */
const FIELDS = new Map<string, ReadonlySet<string>>(
  Object.entries(system.providers).map(([id, texts]) => [id, new Set(Object.keys(texts))]),
);

const hasHint = (id: string): id is HintId => FIELDS.get(id)?.has("hint") ?? false;
const hasNote = (id: string): id is NoteId => FIELDS.get(id)?.has("note") ?? false;

/**
 * Frase corta del catálogo sobre por qué usar ese proveedor («Local: no necesita
 * clave»), o `undefined` si el catálogo no la trae.
 *
 * El idioma se resuelve **en la llamada**: quien pinte el texto solo tiene que
 * volver a renderizar al cambiar de idioma (lo que ya hace `useTranslation` en
 * el componente que lo consume).
 */
export const providerHint = (id: string): string | undefined =>
  hasHint(id) ? i18n.t(`system:providers.${id}.hint`) : undefined;

/** Nota del catálogo para proveedores que no usan credencial en el config. */
export const providerNote = (id: string): string | undefined =>
  hasNote(id) ? i18n.t(`system:providers.${id}.note`) : undefined;