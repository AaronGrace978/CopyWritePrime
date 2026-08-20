import {
  AlignmentType,
  Document,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { killEmDashes } from "./dashes";

const FONT = "Times New Roman";
const SIZE = 24;
const DOUBLE = { line: 480, lineRule: "auto" as const, before: 0, after: 0 };
const INCH = 1440;

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function run(text: string, opts?: { bold?: boolean; italics?: boolean; underline?: boolean }) {
  const value = killEmDashes(text);
  if (!value) return null;
  return new TextRun({
    text: value,
    font: FONT,
    size: SIZE,
    bold: opts?.bold,
    italics: opts?.italics,
    underline: opts?.underline ? { type: "single" } : undefined,
  });
}

function pagePara(
  children: TextRun[],
  extra?: {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    indent?: { left?: number; hanging?: number };
    numbering?: { reference: string; level: number };
  },
) {
  return new Paragraph({
    spacing: DOUBLE,
    alignment: extra?.alignment,
    heading: extra?.heading,
    indent: extra?.indent,
    numbering: extra?.numbering,
    children: children.length ? children : [new TextRun({ text: "", font: FONT, size: SIZE })],
  });
}

function inlineRuns(el: Element, base?: { bold?: boolean; italics?: boolean; underline?: boolean }) {
  const runs: TextRun[] = [];
  const visit = (node: Node, bold = false, italics = false, underline = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const piece = run(node.textContent ?? "", { bold, italics, underline });
      if (piece) runs.push(piece);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === "br") {
      runs.push(new TextRun({ break: 1, font: FONT, size: SIZE }));
      return;
    }
    const nextBold = bold || tag === "strong" || tag === "b";
    const nextItalics = italics || tag === "em" || tag === "i";
    const nextUnderline = underline || tag === "u";
    e.childNodes.forEach((c) => visit(c, nextBold, nextItalics, nextUnderline));
  };
  el.childNodes.forEach((c) => visit(c, base?.bold ?? false, base?.italics ?? false, base?.underline ?? false));
  if (runs.length === 0) {
    const piece = run(el.textContent ?? "", base);
    if (piece) runs.push(piece);
  }
  return runs;
}

function runningHead(title: string) {
  const clean = killEmDashes(title).replace(/\s+/g, " ").trim();
  const named = clean.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
  if (named) {
    const parts = named[1].split(/\s+/);
    return parts[parts.length - 1];
  }
  return clean.slice(0, 28) || "CopyWritePrime";
}

function scrubDashes(node: Node) {
  if (node.nodeType === Node.TEXT_NODE && node.textContent) {
    node.textContent = killEmDashes(node.textContent);
    return;
  }
  node.childNodes.forEach(scrubDashes);
}

export async function htmlToDocxBuffer(title: string, html: string): Promise<Uint8Array> {
  const host = document.createElement("div");
  host.innerHTML = html;
  scrubDashes(host);

  const children: Paragraph[] = [];
  const first = host.querySelector("h1");
  const titleText = killEmDashes(title).trim();
  const pageHasTitle = Boolean(first?.textContent?.trim());
  if (titleText && !pageHasTitle) {
    children.push(
      pagePara([run(titleText, { bold: false })!].filter(Boolean) as TextRun[], {
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.TITLE,
      }),
    );
  }

  const walk = (el: Element, list?: "ul" | "ol") => {
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent ?? "").trim();
    if (!text && tag !== "br" && tag !== "hr") {
      if (tag === "ul" || tag === "ol") Array.from(el.children).forEach((c) => walk(c, tag));
      return;
    }

    if (tag === "h1") {
      children.push(
        pagePara(inlineRuns(el), {
          alignment: AlignmentType.CENTER,
          heading: HeadingLevel.HEADING_1,
        }),
      );
    } else if (tag === "h2") {
      children.push(pagePara(inlineRuns(el, { bold: true }), { heading: HeadingLevel.HEADING_2 }));
    } else if (tag === "h3") {
      children.push(pagePara(inlineRuns(el, { italics: true }), { heading: HeadingLevel.HEADING_3 }));
    } else if (tag === "blockquote") {
      children.push(
        pagePara(inlineRuns(el, { italics: true }), {
          indent: { left: INCH / 2 },
        }),
      );
    } else if (tag === "li") {
      children.push(
        pagePara(inlineRuns(el), {
          numbering:
            list === "ol"
              ? { reference: "mla-numbers", level: 0 }
              : { reference: "mla-bullets", level: 0 },
        }),
      );
    } else if (tag === "ul" || tag === "ol") {
      Array.from(el.children).forEach((c) => walk(c, tag));
    } else if (tag === "p" || tag === "div") {
      const nested = Array.from(el.children).filter((c) =>
        /^(H1|H2|H3|UL|OL|BLOCKQUOTE|P|DIV)$/.test(c.tagName),
      );
      if (nested.length && !el.querySelector("br")) {
        nested.forEach((c) => walk(c));
        return;
      }
      children.push(pagePara(inlineRuns(el)));
    } else if (tag === "hr") {
      children.push(pagePara([]));
    } else {
      Array.from(el.childNodes).forEach((n) => {
        if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element, list);
      });
    }
  };

  const blocks = Array.from(host.childNodes);
  if (blocks.length === 0) {
    const piece = run(host.textContent ?? "");
    children.push(pagePara(piece ? [piece] : []));
  } else {
    blocks.forEach((n) => {
      if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
      else if (n.textContent?.trim()) {
        const piece = run(n.textContent);
        if (piece) children.push(pagePara([piece]));
      }
    });
  }

  const doc = new Document({
    title: titleText,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE },
          paragraph: { spacing: DOUBLE },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "mla-numbers",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: "mla-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: INCH, right: INCH, bottom: INCH, left: INCH },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: DOUBLE,
                children: [
                  new TextRun({
                    font: FONT,
                    size: SIZE,
                    children: [`${runningHead(titleText)} `, PageNumber.CURRENT],
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportWord(title: string, html: string) {
  const bytes = await htmlToDocxBuffer(title, html);
  const safe = killEmDashes(title).replace(/[\\/:*?"<>|]+/g, " ").trim() || "CopyWritePrime";
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
