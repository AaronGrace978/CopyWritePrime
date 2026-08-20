import type { ProviderId } from "./providers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type FlowMode = "off" | "write" | "enhance";
export type TypeScale = "auto" | "sm" | "md" | "lg";

export interface Settings {
  keys: Partial<Record<ProviderId, string>>;
  customBaseUrl: string;
  ollamaLocalHost: string;
  provider: ProviderId;
  model: string;
  flow: FlowMode;
  autoCorrect: boolean;
  typeScale: TypeScale;
  showAiMarks: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  keys: {},
  customBaseUrl: "http://127.0.0.1:1234/v1",
  ollamaLocalHost: "http://127.0.0.1:11434",
  provider: "openai",
  model: "gpt-4o",
  flow: "enhance",
  autoCorrect: true,
  typeScale: "auto",
  showAiMarks: true,
};

export function normalizeFlow(flow: unknown): FlowMode {
  if (flow === "off") return "off";
  if (flow === "light" || flow === "write") return "write";
  return "enhance";
}

export function normalizeTypeScale(scale: unknown): TypeScale {
  if (scale === "sm" || scale === "md" || scale === "lg" || scale === "auto") return scale;
  return "auto";
}
