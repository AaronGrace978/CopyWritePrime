import type { ProviderId } from "./providers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Settings {
  keys: Partial<Record<ProviderId, string>>;
  customBaseUrl: string;
  ollamaLocalHost: string;
  provider: ProviderId;
  model: string;
  flow: "off" | "light" | "full";
  autoCorrect: boolean;
  brandKit: "none" | "superpower";
}

export const DEFAULT_SETTINGS: Settings = {
  keys: {},
  customBaseUrl: "http://127.0.0.1:1234/v1",
  ollamaLocalHost: "http://127.0.0.1:11434",
  provider: "openai",
  model: "gpt-4o",
  flow: "full",
  autoCorrect: true,
  brandKit: "superpower",
};
