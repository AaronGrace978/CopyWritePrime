export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "xai"
  | "mistral"
  | "deepseek"
  | "openrouter"
  | "together"
  | "fireworks"
  | "perplexity"
  | "cohere"
  | "ollama"
  | "ollama-cloud"
  | "custom";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  kind: "openai" | "anthropic" | "google" | "cohere" | "ollama";
  baseUrl: string;
  keyLabel: string;
  placeholder: string;
  models: string[];
  docs: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyLabel: "OpenAI API key",
    placeholder: "sk-...",
    models: ["gpt-5", "gpt-4.1", "gpt-4o", "gpt-4o-mini", "o4-mini"],
    docs: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    keyLabel: "Anthropic API key",
    placeholder: "sk-ant-...",
    models: [
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-sonnet-4-20250514",
      "claude-3-5-haiku-latest",
    ],
    docs: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    name: "Google Gemini",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyLabel: "Google AI Studio key",
    placeholder: "AIza...",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
    ],
    docs: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyLabel: "Groq API key",
    placeholder: "gsk_...",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "mixtral-8x7b-32768",
    ],
    docs: "https://console.groq.com/keys",
  },
  {
    id: "xai",
    name: "xAI",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyLabel: "xAI API key",
    placeholder: "xai-...",
    models: ["grok-3", "grok-3-mini", "grok-2-latest"],
    docs: "https://console.x.ai",
  },
  {
    id: "mistral",
    name: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    keyLabel: "Mistral API key",
    placeholder: "...",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "codestral-latest",
    ],
    docs: "https://console.mistral.ai/api-keys",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com",
    keyLabel: "DeepSeek API key",
    placeholder: "sk-...",
    models: ["deepseek-chat", "deepseek-reasoner"],
    docs: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyLabel: "OpenRouter key",
    placeholder: "sk-or-...",
    models: [
      "anthropic/claude-sonnet-4",
      "openai/gpt-4.1",
      "google/gemini-2.5-pro",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    docs: "https://openrouter.ai/keys",
  },
  {
    id: "together",
    name: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    keyLabel: "Together API key",
    placeholder: "...",
    models: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "mistralai/Mixtral-8x22B-Instruct-v0.1",
    ],
    docs: "https://api.together.xyz/settings/api-keys",
  },
  {
    id: "fireworks",
    name: "Fireworks",
    kind: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    keyLabel: "Fireworks API key",
    placeholder: "...",
    models: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/deepseek-v3",
    ],
    docs: "https://fireworks.ai/api-keys",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    kind: "openai",
    baseUrl: "https://api.perplexity.ai",
    keyLabel: "Perplexity API key",
    placeholder: "pplx-...",
    models: ["sonar-pro", "sonar", "sonar-reasoning-pro"],
    docs: "https://www.perplexity.ai/settings/api",
  },
  {
    id: "cohere",
    name: "Cohere",
    kind: "cohere",
    baseUrl: "https://api.cohere.ai/v2",
    keyLabel: "Cohere API key",
    placeholder: "...",
    models: ["command-a-03-2025", "command-r-plus", "command-r"],
    docs: "https://dashboard.cohere.com/api-keys",
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    keyLabel: "Local host (no key)",
    placeholder: "http://127.0.0.1:11434",
    models: [
      "llama3.2",
      "llama3.1",
      "mistral",
      "qwen2.5",
      "phi4",
      "gpt-oss:120b-cloud",
      "kimi-k2.6-cloud",
      "minimax-m3-cloud",
    ],
    docs: "https://docs.ollama.com/cloud",
  },
  {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    kind: "ollama",
    baseUrl: "https://ollama.com",
    keyLabel: "Ollama Cloud API key",
    placeholder: "ollama_...",
    models: [
      "gpt-oss:120b",
      "gpt-oss:20b",
      "kimi-k2.6",
      "kimi-k2.7-code",
      "minimax-m2.7",
      "minimax-m3",
      "glm-5.2",
      "qwen3.5:397b",
      "gemma4:31b",
      "deepseek-v4-flash",
      "mistral-large-3:675b",
    ],
    docs: "https://ollama.com/settings/keys",
  },
  {
    id: "custom",
    name: "OpenAI-compatible",
    kind: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    keyLabel: "API key (optional)",
    placeholder: "optional",
    models: ["local-model"],
    docs: "https://github.com/oobabooga/text-generation-webui",
  },
];

export function providerById(id: ProviderId): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
