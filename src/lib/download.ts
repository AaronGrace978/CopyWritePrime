import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "CopyWritePrime";
}

export async function downloadText(filename: string, text: string, label = "Markdown") {
  const bytes = new TextEncoder().encode(text);
  const base = safeName(filename.replace(/\.md$/i, ""));
  if (inTauri()) {
    const path = await save({
      defaultPath: `${base}.md`,
      filters: [{ name: label, extensions: ["md", "txt"] }],
    });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.md`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
