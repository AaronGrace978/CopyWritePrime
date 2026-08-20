import type { Editor } from "@tiptap/react";

export function lastWritingUnit(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length < 8) return "";
  const parts = trimmed.split(/(?<=[.!?])(?:\s+|\n+)/);
  return (parts[parts.length - 1] ?? "").trim();
}

export function lastParagraph(text: string): string {
  const parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function inlineHtml(md: string): string {
  return escapeHtml(md)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

export function proseToHtml(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "<p></p>";
  if (/<[a-z][\s\S]*>/i.test(trimmed) && !trimmed.includes("```")) {
    return trimmed;
  }
  const blocks = trimmed.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const line = block.trim();
      if (!line) return "";
      if (/^###\s+/.test(line)) return `<h3>${inlineHtml(line.replace(/^###\s+/, ""))}</h3>`;
      if (/^##\s+/.test(line)) return `<h2>${inlineHtml(line.replace(/^##\s+/, ""))}</h2>`;
      if (/^#\s+/.test(line)) return `<h1>${inlineHtml(line.replace(/^#\s+/, ""))}</h1>`;
      if (/^>\s+/.test(line)) return `<blockquote><p>${inlineHtml(line.replace(/^>\s+/, ""))}</p></blockquote>`;
      return `<p>${inlineHtml(line).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

export function findLastTextRange(editor: Editor, target: string): { from: number; to: number } | null {
  if (!target) return null;
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const idx = node.text.lastIndexOf(target);
    if (idx >= 0) {
      from = pos + idx;
      to = pos + idx + target.length;
    }
  });
  if (from < 0) return null;
  return { from, to };
}

export function replaceLastOccurrence(editor: Editor, target: string, next: string, asHtml: boolean) {
  const range = findLastTextRange(editor, target);
  if (!range) return false;
  const content = asHtml ? inlineHtml(next) : next;
  return editor.chain().focus().insertContentAt(range, content).run();
}
