import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function textRuns(text: string, opts?: { bold?: boolean; italics?: boolean; size?: number }) {
  return new TextRun({
    text,
    bold: opts?.bold,
    italics: opts?.italics,
    size: opts?.size ?? 24,
    font: "Calibri",
  });
}

export async function htmlToDocxBuffer(title: string, html: string): Promise<Uint8Array> {
  const host = document.createElement("div");
  host.innerHTML = html;
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
      children: [textRuns(title, { bold: true, size: 48 })],
    }),
  ];

  const blocks = Array.from(host.childNodes);
  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const text = el.textContent ?? "";
    if (!text.trim() && tag !== "hr") return;
    if (tag === "h1") {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
          children: [textRuns(text, { bold: true, size: 36 })],
        }),
      );
    } else if (tag === "h2") {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 80 },
          children: [textRuns(text, { bold: true, size: 30 })],
        }),
      );
    } else if (tag === "h3") {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 180, after: 60 },
          children: [textRuns(text, { bold: true, size: 26 })],
        }),
      );
    } else if (tag === "blockquote") {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 80 },
          indent: { left: 360 },
          children: [textRuns(text, { italics: true })],
        }),
      );
    } else if (tag === "li") {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [textRuns(text)],
        }),
      );
    } else if (tag === "ul" || tag === "ol") {
      Array.from(el.children).forEach((c) => walk(c));
    } else if (tag === "p" || tag === "div") {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          alignment: AlignmentType.LEFT,
          children: inlineRuns(el),
        }),
      );
    } else if (tag === "hr") {
      children.push(new Paragraph({ spacing: { before: 120, after: 120 }, children: [textRuns("")] }));
    } else {
      Array.from(el.childNodes).forEach((n) => {
        if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
      });
    }
  };

  if (blocks.length === 0) {
    children.push(new Paragraph({ children: [textRuns(host.textContent ?? "")] }));
  } else {
    blocks.forEach((n) => {
      if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
      else if (n.textContent?.trim()) {
        children.push(new Paragraph({ children: [textRuns(n.textContent.trim())] }));
      }
    });
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

function inlineRuns(el: Element) {
  const runs: TextRun[] = [];
  const visit = (node: Node, bold = false, italics = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t) runs.push(textRuns(t, { bold, italics }));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    const nextBold = bold || tag === "strong" || tag === "b";
    const nextItalics = italics || tag === "em" || tag === "i";
    e.childNodes.forEach((c) => visit(c, nextBold, nextItalics));
  };
  el.childNodes.forEach((c) => visit(c));
  if (runs.length === 0) runs.push(textRuns(el.textContent ?? ""));
  return runs;
}

export async function exportWord(title: string, html: string) {
  const bytes = await htmlToDocxBuffer(title, html);
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "CopyWritePrime";
  if (inTauri()) {
    const path = await save({
      defaultPath: `${safe}.docx`,
      filters: [{ name: "Word document", extensions: ["docx"] }],
    });
    if (!path) return;
    await writeFile(path, bytes);
    return;
  }
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
