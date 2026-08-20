import type { Editor } from "@tiptap/react";

export function splitSentences(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const re = /[.!?…]["')\]]*/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const before = text.slice(start, m.index);
    const word = before.match(/([A-Za-z]+)$/)?.[1] ?? "";
    if (/^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|al|St)$/i.test(word)) continue;
    if (/^[A-Z]$/.test(word) && end < text.length) continue;
    if (/\d$/.test(before) && /^\d/.test(text.slice(end))) continue;
    if (end < text.length && !/^\s/.test(text.slice(end))) continue;
    ranges.push({ start, end });
    start = end;
    while (start < text.length && /\s/.test(text[start])) start++;
    re.lastIndex = start;
  }
  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges.filter((r) => r.end > r.start);
}

export function lastWritingUnit(text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length < 8) return "";
  const parts = splitSentences(trimmed);
  const last = parts[parts.length - 1];
  return last ? trimmed.slice(last.start, last.end).trim() : "";
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
  const trimmed = text.replace(/\r\n/g, "\n").replace(/```(?:\w+)?\n?|\n?```/g, "").trim();
  if (!trimmed) return "<p></p>";
  if (/<[a-z][\s\S]*>/i.test(trimmed) && /<\/[a-z]+>/i.test(trimmed)) {
    return trimmed;
  }
  const blocks = trimmed.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.trim().split("\n");
      if (!lines[0]) return "";
      const first = lines[0];
      const rest = lines.slice(1).join("\n").trim();
      const restHtml = rest ? `<p>${inlineHtml(rest).replace(/\n/g, "<br>")}</p>` : "";
      if (/^###\s+/.test(first)) return `<h3>${inlineHtml(first.replace(/^###\s+/, ""))}</h3>${restHtml}`;
      if (/^##\s+/.test(first)) return `<h2>${inlineHtml(first.replace(/^##\s+/, ""))}</h2>${restHtml}`;
      if (/^#\s+/.test(first)) return `<h1>${inlineHtml(first.replace(/^#\s+/, ""))}</h1>${restHtml}`;
      if (/^>\s+/.test(first)) {
        return `<blockquote><p>${inlineHtml(lines.map((l) => l.replace(/^>\s?/, "")).join(" ")).trim()}</p></blockquote>`;
      }
      const bullets = lines.filter((l) => l.trim());
      if (bullets.length > 1 && bullets.every((l) => /^[-*•]\s+/.test(l))) {
        return `<ul>${bullets.map((l) => `<li>${inlineHtml(l.replace(/^[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (bullets.length > 1 && bullets.every((l) => /^\d+[.)]\s+/.test(l))) {
        return `<ol>${bullets.map((l) => `<li>${inlineHtml(l.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
      }
      return `<p>${inlineHtml(block.trim()).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

export function sentenceRangeAt(doc: Editor["state"]["doc"], pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(Math.max(1, Math.min(pos, doc.content.size)));
  if (!$pos.parent.isTextblock) return null;
  const start = $pos.start();
  const end = $pos.end();
  const text = doc.textBetween(start, end, "\n");
  if (!text.trim()) return null;
  const offset = Math.max(0, Math.min(pos - start, text.length));
  const parts = splitSentences(text);
  const hit =
    parts.find((r) => offset >= r.start && offset <= r.end) ??
    parts.find((r) => offset >= r.start && offset < r.end + 1) ??
    parts[parts.length - 1];
  if (!hit) return { from: start, to: end };
  return { from: start + hit.start, to: start + hit.end };
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

export function pagePlain(editor: Editor | null): string {
  if (!editor) return "";
  const parts: string[] = [];
  editor.state.doc.forEach((node) => {
    const text = node.textContent.trim();
    if (!text) return;
    if (node.type.name === "heading") {
      parts.push(`${"#".repeat(node.attrs.level || 1)} ${text}`);
    } else {
      parts.push(text);
    }
  });
  return parts.join("\n\n");
}

export function insertAiContent(editor: Editor, content: string, range?: { from: number; to: number }) {
  const from = range?.from ?? editor.state.selection.from;
  const to = range?.to ?? from;
  const before = editor.state.doc.content.size;
  const ok = editor.chain().focus().insertContentAt({ from, to }, content).run();
  if (!ok) return false;
  const after = editor.state.doc.content.size;
  const end = Math.min(from + (after - before) + (to - from), editor.state.doc.content.size);
  if (end > from) editor.chain().setTextSelection({ from, to: end }).setInkMark("ai").run();
  return true;
}

export function markDocAsAi(editor: Editor) {
  const size = editor.state.doc.content.size;
  if (size <= 2) return;
  editor.chain().selectAll().setInkMark("ai").run();
}

export function replaceLastOccurrence(editor: Editor, target: string, next: string, asHtml: boolean) {
  const range = findLastTextRange(editor, target);
  if (!range) return false;
  const content = asHtml ? inlineHtml(next) : next;
  return insertAiContent(editor, content, range);
}
