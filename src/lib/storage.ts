import { Store } from "@tauri-apps/plugin-store";
import { DEFAULT_SETTINGS, normalizeFlow, normalizeTypeScale, type Settings } from "./llm";
import type { ProviderId } from "./providers";

export interface DocRecord {
  id: string;
  title: string;
  html: string;
  updatedAt: number;
}

const SETTINGS_KEY = "settings";
const DOCS_KEY = "documents";
const ACTIVE_KEY = "active-doc";

let storePromise: Promise<Store> | null = null;

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const memory = {
  settings: DEFAULT_SETTINGS,
  docs: [] as DocRecord[],
  activeId: "",
};

async function store() {
  if (!inTauri()) return null;
  if (!storePromise) storePromise = Store.load("copywriteprime.json");
  return storePromise;
}

export async function loadSettings(): Promise<Settings> {
  const s = await store();
  if (!s) return memory.settings;
  const saved = await s.get<Settings>(SETTINGS_KEY);
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    keys: { ...DEFAULT_SETTINGS.keys, ...saved.keys },
    ollamaLocalHost: saved.ollamaLocalHost || DEFAULT_SETTINGS.ollamaLocalHost,
    flow: normalizeFlow(saved.flow),
    typeScale: normalizeTypeScale((saved as Settings & { typeScale?: unknown }).typeScale),
    autoCorrect: saved.autoCorrect !== false,
  };
}

export async function saveSettings(settings: Settings) {
  memory.settings = settings;
  const s = await store();
  if (!s) return;
  await s.set(SETTINGS_KEY, settings);
  await s.save();
}

export async function loadDocs(): Promise<DocRecord[]> {
  const s = await store();
  if (!s) return memory.docs;
  return (await s.get<DocRecord[]>(DOCS_KEY)) ?? [];
}

export async function saveDocs(docs: DocRecord[]) {
  memory.docs = docs;
  const s = await store();
  if (!s) return;
  await s.set(DOCS_KEY, docs);
  await s.save();
}

export async function loadActiveId() {
  const s = await store();
  if (!s) return memory.activeId;
  return (await s.get<string>(ACTIVE_KEY)) ?? "";
}

export async function saveActiveId(id: string) {
  memory.activeId = id;
  const s = await store();
  if (!s) return;
  await s.set(ACTIVE_KEY, id);
  await s.save();
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromHtml(html: string, fallback = "Untitled") {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 72) || fallback;
}

export function maskKey(value?: string) {
  if (!value) return "";
  if (value.length < 8) return "••••";
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

export function setProviderKey(settings: Settings, id: ProviderId, key: string): Settings {
  return { ...settings, keys: { ...settings.keys, [id]: key } };
}
