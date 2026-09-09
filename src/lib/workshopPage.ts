export const WORKSHOP_PAGE_BUDGET = 12_000;
export const WORKSHOP_PREVIEW_CHARS = 6_000;
export const WORKSHOP_STALL_MS = 45_000;

export type PackedPage = {
  text: string;
  packed: boolean;
  originalChars: number;
  sentChars: number;
};

export function packPageForWorkshop(
  page: string,
  selection = "",
  budget = WORKSHOP_PAGE_BUDGET,
): PackedPage {
  const raw = page.replace(/\r\n/g, "\n").trim();
  const originalChars = raw.length;
  if (!raw) {
    return { text: "(empty)", packed: false, originalChars: 0, sentChars: 7 };
  }
  if (raw.length <= budget) {
    return { text: raw, packed: false, originalChars, sentChars: raw.length };
  }

  const outline = extractOutline(raw);
  const headN = Math.min(4200, Math.floor(budget * 0.34));
  const tailN = Math.min(2800, Math.floor(budget * 0.24));
  const selN = Math.min(3200, Math.floor(budget * 0.28));

  const head = raw.slice(0, headN);
  const tailStart = Math.max(headN, raw.length - tailN);
  const tail = raw.slice(tailStart);

  let around = "";
  const sel = selection.trim();
  if (sel.length >= 8) {
    const needle = sel.slice(0, Math.min(sel.length, 240));
    const idx = raw.indexOf(needle);
    if (idx >= 0) {
      const pad = Math.floor(selN / 5);
      const start = Math.max(0, idx - pad);
      const end = Math.min(raw.length, idx + Math.min(sel.length, selN) + pad);
      around = raw.slice(start, end);
    } else {
      around = sel.slice(0, selN);
    }
  }

  const banner = `PAGE PACKED. The live page is ${originalChars} characters. You have an outline, the opening, the close${around ? ", and the selected stretch" : ""}. Do not invent the missing middle. If they want a full rewrite, do one named section, not the whole document.`;

  const parts = [banner];
  if (outline) parts.push(`OUTLINE\n${outline}`);
  parts.push(`OPENING\n${head}`);
  if (around) parts.push(`AROUND SELECTION\n${around}`);
  parts.push(`CLOSING\n${tail}`);
  let text = parts.join("\n\n");
  const cap = budget + 1500;
  if (text.length > cap) {
    text = `${text.slice(0, cap)}\n\n[truncated pack]`;
  }
  return { text, packed: true, originalChars, sentChars: text.length };
}

export function previewPage(page: string, limit = WORKSHOP_PREVIEW_CHARS): string {
  const raw = page.replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  if (raw.length <= limit) return raw;
  const rest = raw.length - limit;
  return `${raw.slice(0, limit)}\n\n… ${rest} more characters on the page. Workshop packs outline, opening, and close before it asks.`;
}

export function wantsFullRewrite(question: string): boolean {
  return /\b(rewrite|write over|replace the page|from scratch|whole page|entire page|full (?:draft|page|rewrite)|start over|do the whole)\b/i.test(
    question,
  );
}

export function clipWorkshopHistory(
  history: { role: "user" | "assistant"; content: string }[],
  turns = 8,
  maxChars = 3500,
): { role: "user" | "assistant"; content: string }[] {
  return history.slice(-turns).map((turn) => ({
    ...turn,
    content: turn.content.length > maxChars ? `${turn.content.slice(0, maxChars)}\n…` : turn.content,
  }));
}

function extractOutline(page: string): string {
  const heads: string[] = [];
  const lineRe = /^(#{1,6})\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(page)) && heads.length < 80) {
    heads.push(`${m[1]} ${m[2].trim().slice(0, 120)}`);
  }
  if (heads.length) return heads.join("\n");

  const paras: string[] = [];
  const paraRe = /\S[^\n]*(?:\n(?!\n)[^\n]*)*/g;
  let p: RegExpExecArray | null;
  while ((p = paraRe.exec(page)) && paras.length < 40) {
    const first = p[0].split("\n")[0].replace(/\s+/g, " ").trim();
    if (first.length < 12) continue;
    paras.push(`- ${first.slice(0, 80)}${first.length > 80 ? "…" : ""}`);
  }
  return paras.length >= 4 ? paras.join("\n") : "";
}
