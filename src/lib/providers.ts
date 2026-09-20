/**
 * Metadatos de los proveedores del engine: etiqueta legible, enlace para
 * obtener la clave y notas. Los ids coinciden con `phoson_cli`.
 *
 * El orden es el de presentación en la UI.
 */
export interface ProviderMeta {
  label: string;
  keysUrl?: string;
  hint?: string;
  /** Nota para proveedores que no usan credencial en el config. */
  note?: string;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  openrouter: {
    label: "OpenRouter",
    keysUrl: "https://openrouter.ai/keys",
    hint: "Recomendado: cientos de modelos con una sola clave",
  },
  openai: { label: "OpenAI", keysUrl: "https://platform.openai.com/api-keys" },
  anthropic: { label: "Anthropic", keysUrl: "https://console.anthropic.com/settings/keys" },
  ollama: { label: "Ollama", hint: "Local: no necesita clave" },
  github: {
    label: "GitHub Models",
    keysUrl: "https://github.com/settings/tokens",
    hint: "Usa un token personal de GitHub",
  },
  nvidia: { label: "NVIDIA", keysUrl: "https://build.nvidia.com" },
  xai: { label: "Grok (X.AI)", keysUrl: "https://console.x.ai" },
  groq: { label: "Groq", keysUrl: "https://console.groq.com/keys" },
  deepseek: { label: "DeepSeek", keysUrl: "https://platform.deepseek.com/api_keys" },
  together: { label: "Together AI", keysUrl: "https://api.together.ai/settings/api-keys" },
  perplexity: { label: "Perplexity", keysUrl: "https://www.perplexity.ai/settings/api" },
  lmstudio: { label: "LM Studio", hint: "Local: no necesita clave" },
  vllm: { label: "vLLM", hint: "Clave opcional si tu servidor no la exige" },
  azure: { label: "Azure OpenAI", keysUrl: "https://portal.azure.com" },
  gemini: { label: "Google Gemini", keysUrl: "https://aistudio.google.com/app/apikey" },
  mistral: { label: "Mistral AI", keysUrl: "https://console.mistral.ai/api-keys" },
  bedrock: {
    label: "AWS Bedrock",
    note: "Usa tus credenciales de AWS (perfil o variables de entorno)",
  },
  fireworks: { label: "Fireworks AI", keysUrl: "https://fireworks.ai/account/api-keys" },
  cohere: { label: "Cohere", keysUrl: "https://dashboard.cohere.com/api-keys" },
  omniroute: { label: "OmniRoute", hint: "Clave opcional según tu despliegue" },
};

/** base_url por defecto de los proveedores locales. */
export const BASE_URL_DEFAULTS: Record<string, string> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
  vllm: "http://localhost:8000/v1",
  omniroute: "http://localhost:3000/v1",
};

export const providerLabel = (id: string): string => PROVIDER_META[id]?.label ?? id;
