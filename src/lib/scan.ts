import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";

GlobalWorkerOptions.workerSrc = workerUrl;

export const PAPER_ACCEPT = ".pdf,.docx,.txt,.md,.html,.htm,.rtf";

const PAPER_EXTS = new Set(["pdf", "docx", "txt", "md", "html", "htm", "rtf"]);

export function isPaperFile(file: File) {
  const ext = extOf(file.name);
  return PAPER_EXTS.has(ext) || file.type.startsWith("text/");
}

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function stripHtml(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return (host.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdf(data: ArrayBuffer) {
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise;
  const max = Math.min(pdf.numPages, 40);
  const pages: string[] = [];
  for (let i = 1; i <= max; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(text);
  }
  return pages.join("\n\n");
}

export async function extractPaper(file: File): Promise<string> {
  const ext = extOf(file.name);
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("That paper is over 20 MB. Try a text, Word, or smaller PDF.");
  }
  if (ext === "pdf" || file.type === "application/pdf") {
    return extractPdf(await file.arrayBuffer());
  }
  if (ext === "docx" || file.type.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value.trim();
  }
  const raw = await file.text();
  if (ext === "html" || ext === "htm" || file.type === "text/html") {
    return stripHtml(raw);
  }
  return raw.replace(/^\uFEFF/, "").trim();
}

export function briefWordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function titleFromPaperName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Scanned paper";
}
