import { killEmDashes } from "./dashes.ts";

export interface LogTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LogDoc {
  title: string;
  html: string;
  updatedAt: number;
  archivedAt?: number;
  workshop?: LogTurn[];
}

function stamp(ms?: number) {
  return new Date(ms || Date.now()).toLocaleString();
}

export function docPlain(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToPlain(html: string) {
  return docPlain(html);
}

export function workshopMarkdown(title: string, turns: LogTurn[], updatedAt?: number) {
  const body = (turns.length ? turns : []).map((turn) => {
    const who = turn.role === "user" ? "You" : "Workshop";
    return `## ${who}\n\n${killEmDashes(turn.content).trim() || "(empty)"}`;
  });
  return [`# Workshop · ${killEmDashes(title) || "Untitled"}`, `_${stamp(updatedAt)}_`, "", ...body].join("\n\n").trim() + "\n";
}

export function allWorkshopMarkdown(docs: LogDoc[]) {
  const chats = docs.filter((d) => (d.workshop?.length ?? 0) > 0);
  if (!chats.length) return "# Workshop logs\n\n_(none)_\n";
  const parts = [
    "# CopyWritePrime Workshop logs",
    `_${chats.length} chat${chats.length === 1 ? "" : "s"} · ${stamp()}_`,
    "",
  ];
  for (const doc of chats) {
    parts.push(workshopMarkdown(doc.title, doc.workshop ?? [], doc.updatedAt));
  }
  return parts.join("\n\n---\n\n");
}

export function archiveMarkdown(docs: LogDoc[]) {
  const archived = docs.filter((d) => d.archivedAt).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  if (!archived.length) return "# Archive\n\n_(empty)_\n";
  const parts = [`# CopyWritePrime archive`, `_${archived.length} page${archived.length === 1 ? "" : "s"} · ${stamp()}_`, ""];
  for (const doc of archived) {
    const text = htmlToPlain(doc.html);
    parts.push(`## ${killEmDashes(doc.title) || "Untitled"}`, `_${stamp(doc.archivedAt)}_`, "", text || "_(blank page)_", "");
  }
  return parts.join("\n");
}

export function pagesMarkdown(docs: LogDoc[]) {
  const live = docs.filter((d) => !d.archivedAt);
  const parts = [`# CopyWritePrime pages`, `_${live.length} page${live.length === 1 ? "" : "s"} · ${stamp()}_`, ""];
  for (const doc of live) {
    parts.push(`## ${killEmDashes(doc.title) || "Untitled"}`, `_${stamp(doc.updatedAt)}_`, "", htmlToPlain(doc.html) || "_(blank page)_", "");
  }
  return parts.join("\n");
}

export function workshopCount(docs: LogDoc[]) {
  return docs.reduce((n, d) => n + (d.workshop?.length ? 1 : 0), 0);
}

export function turnCount(docs: LogDoc[]) {
  return docs.reduce((n, d) => n + (d.workshop?.length ?? 0), 0);
}
