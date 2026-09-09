import { extractPaper, isPaperFile } from "./scan";
import { isVoiceFileName, skipVoiceDir, type VoiceSample } from "./voice";

export interface CorpusFile {
  name: string;
  text: string;
  words: number;
}

const MAX_FILES = 80;
const MAX_WORDS = 80000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function filesFromList(files: Iterable<File>): Promise<CorpusFile[]> {
  const out: CorpusFile[] = [];
  let words = 0;
  for (const file of files) {
    if (out.length >= MAX_FILES || words >= MAX_WORDS) break;
    const name = file.webkitRelativePath || file.name;
    const parts = name.split(/[/\\]/);
    if (parts.some((p) => skipVoiceDir(p))) continue;
    if (!isPaperFile(file) && !isVoiceFileName(file.name)) continue;
    if (file.size > MAX_FILE_BYTES) continue;
    try {
      const text = (await extractPaper(file)).trim();
      if (text.length < 40) continue;
      const w = wordCount(text);
      if (!w) continue;
      out.push({ name: parts[parts.length - 1] || file.name, text, words: w });
      words += w;
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

async function walkTauri(dir: string, acc: CorpusFile[], words: { n: number }, depth: number) {
  if (depth > 5 || acc.length >= MAX_FILES || words.n >= MAX_WORDS) return;
  const { readDir, readFile } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES || words.n >= MAX_WORDS) return;
    if (!entry.name || entry.name.startsWith(".")) continue;
    if (skipVoiceDir(entry.name)) continue;
    const path = await join(dir, entry.name);
    if (entry.isDirectory) {
      await walkTauri(path, acc, words, depth + 1);
      continue;
    }
    if (!isVoiceFileName(entry.name)) continue;
    try {
      const bytes = await readFile(path);
      if (bytes.byteLength > MAX_FILE_BYTES) continue;
      const file = new File([bytes], entry.name);
      const text = (await extractPaper(file)).trim();
      if (text.length < 40) continue;
      const w = wordCount(text);
      if (!w) continue;
      acc.push({ name: entry.name, text, words: w });
      words.n += w;
    } catch {
      /* skip */
    }
  }
}

export async function pickWritingFolder(): Promise<CorpusFile[] | null> {
  if (inTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false, title: "Choose a folder of past writing" });
    if (!dir || Array.isArray(dir)) return null;
    const acc: CorpusFile[] = [];
    await walkTauri(dir, acc, { n: 0 }, 0);
    return acc;
  }
  return null;
}

export function samplesOf(files: CorpusFile[]): VoiceSample[] {
  return files.map((f) => ({ name: f.name, words: f.words }));
}

export function joinCorpus(files: CorpusFile[]) {
  return files.map((f) => `SOURCE: ${f.name}\n${f.text}`).join("\n\n");
}
