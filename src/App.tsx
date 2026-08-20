import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FlowGhost } from "./extensions/flowGhost";
import { SentenceSelect } from "./extensions/sentenceSelect";
import { exportWord } from "./lib/docx";
import {
  completeFromBrief,
  DEFAULT_SETTINGS,
  defaultModelFor,
  enhanceSentence,
  flowContinue,
  hasKey,
  polishSentence,
  transform,
  type Settings,
} from "./lib/llm";
import { findLastTextRange, lastParagraph, lastWritingUnit, proseToHtml, replaceLastOccurrence } from "./lib/prose";
import { PROVIDERS, type ProviderId } from "./lib/providers";
import { isOllamaProvider, listOllamaModels } from "./lib/ollama";
import {
  briefWordCount,
  extractPaper,
  isPaperFile,
  PAPER_ACCEPT,
  titleFromPaperName,
} from "./lib/scan";
import {
  loadActiveId,
  loadDocs,
  loadSettings,
  newId,
  saveActiveId,
  saveDocs,
  saveSettings,
  setProviderKey,
  titleFromHtml,
  type Brief,
  type DocRecord,
} from "./lib/storage";
import type { FlowMode, TypeScale } from "./lib/types";

const QUICK = [
  { label: "Fix", prompt: "Fix spelling, grammar, missing words, and punctuation. Keep the voice. No extra ideas. No preamble. Keep every section." },
  { label: "Enhance", prompt: "Fix errors, then make this one notch clearer and more specific. Same person. Keep the same structure and length. Do not drop sections. You may **bold** punch phrases. Use headings if they were headings. No preamble." },
  { label: "Tighten", prompt: "Tighten this copy. Keep the voice and the structure. Cut fat. Do not drop sections. No preamble." },
  { label: "Human", prompt: "Rewrite so it sounds like a person wrote it for a person. Kill marketing fog. Keep the meaning, structure, and length. Do not drop sections." },
];

const SIZES = [
  { label: "Auto", value: "" },
  { label: "S", value: "16px" },
  { label: "M", value: "18px" },
  { label: "L", value: "22px" },
  { label: "XL", value: "28px" },
  { label: "Title", value: "36px" },
];

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function win() {
  if (!inTauri()) return null;
  return getCurrentWindow();
}

function TypeBar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  const size = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  return (
    <div className="typebar">
      <button className={editor.isActive("bold") ? "active" : ""} onClick={() => editor.chain().focus().toggleBold().run()}>
        B
      </button>
      <button className={editor.isActive("italic") ? "active" : ""} onClick={() => editor.chain().focus().toggleItalic().run()}>
        I
      </button>
      <button className={editor.isActive("underline") ? "active" : ""} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        U
      </button>
      <span className="type-gap" />
      <button className={editor.isActive("heading", { level: 1 }) ? "active" : ""} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        H1
      </button>
      <button className={editor.isActive("heading", { level: 2 }) ? "active" : ""} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        H2
      </button>
      <button className={editor.isActive("paragraph") && !editor.isActive("heading") ? "active" : ""} onClick={() => editor.chain().focus().setParagraph().run()}>
        Body
      </button>
      <span className="type-gap" />
      {SIZES.map((s) => (
        <button
          key={s.label}
          className={s.value === size || (s.value === "" && !size) ? "active" : ""}
          onClick={() => {
            if (!s.value) editor.chain().focus().unsetFontSize().run();
            else editor.chain().focus().setFontSize(s.value).run();
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [status, setStatus] = useState("Start typing. Flow stays in the sentence.");
  const [error, setError] = useState("");
  const [palette, setPalette] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; text: string; below: boolean } | null>(null);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanName, setScanName] = useState("");
  const [scanText, setScanText] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const flowTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  const applyingRef = useRef(false);
  const genRef = useRef(0);
  const lastFixedRef = useRef("");
  const briefRef = useRef("");
  const paperRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPauseRef = useRef<() => Promise<void>>(async () => undefined);
  const placeSelbarRef = useRef<(ed: Editor) => void>(() => undefined);
  settingsRef.current = settings;

  placeSelbarRef.current = (ed: Editor) => {
    const { from, to } = ed.state.selection;
    if (from === to || to - from < 2) {
      setSel(null);
      return;
    }
    const text = ed.state.doc.textBetween(from, to, "\n");
    if (!text.trim()) {
      setSel(null);
      return;
    }
    try {
      const start = ed.view.coordsAtPos(from);
      const end = ed.view.coordsAtPos(Math.min(to, ed.state.doc.content.size));
      const x = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);
      const below = top < 88;
      setSel({ x, y: below ? bottom : top, text, below });
    } catch {
      setSel(null);
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      FontSize,
      Placeholder.configure({ placeholder: "Start typing. Flow fixes the line, then keeps writing with you." }),
      CharacterCount,
      FlowGhost,
      SentenceSelect,
    ],
    content: "<p></p>",
    onUpdate: ({ editor: ed }) => {
      if (applyingRef.current) return;
      if (flowTimer.current) window.clearTimeout(flowTimer.current);
      ed.commands.clearFlowGhost();
      abortRef.current?.abort();
      flowTimer.current = window.setTimeout(() => void onPauseRef.current(), 850);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      placeSelbarRef.current(ed);
    },
  });

  useEffect(() => {
    void (async () => {
      const loaded = await loadSettings();
      setSettings(loaded);
      let existing = await loadDocs();
      if (existing.length === 0) {
        existing = [
          {
            id: newId(),
            title: "Untitled",
            html: "<p></p>",
            updatedAt: Date.now(),
          },
        ];
        await saveDocs(existing);
      }
      setDocs(existing);
      const savedActive = await loadActiveId();
      const current = existing.find((d) => d.id === savedActive) ?? existing[0];
      setActiveId(current.id);
      setScanName(current.brief?.name ?? "");
      setScanText(current.brief?.text ?? "");
      editor?.commands.setContent(current.html, { emitUpdate: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    if (settings.typeScale !== "auto") {
      el.style.removeProperty("--body-size");
      return;
    }
    const apply = () => {
      const size = Math.round(Math.min(26, Math.max(17, el.clientWidth / 38)));
      el.style.setProperty("--body-size", `${size}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.typeScale]);

  useEffect(() => {
    const el = paperRef.current;
    if (!el || !editor) return;
    const onScroll = () => placeSelbarRef.current(editor);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [editor]);

  const persist = useCallback(
    async (nextDocs: DocRecord[], id = activeId) => {
      setDocs(nextDocs);
      await saveDocs(nextDocs);
      await saveActiveId(id);
    },
    [activeId],
  );

  const snapshot = useCallback(() => {
    if (!editor) return docs;
    return docs.map((d) =>
      d.id === activeId
        ? {
            ...d,
            html: editor.getHTML(),
            title: titleFromHtml(editor.getHTML(), d.title),
            updatedAt: Date.now(),
          }
        : d,
    );
  }, [activeId, docs, editor]);

  const activeDoc = docs.find((d) => d.id === activeId);
  briefRef.current = activeDoc?.brief?.text ?? "";

  useEffect(() => {
    const t = window.setInterval(() => {
      void persist(snapshot());
    }, 2500);
    return () => window.clearInterval(t);
  }, [persist, snapshot]);

  async function onPause() {
    const s = settingsRef.current;
    if (!editor || !hasKey(s) || busy) return;
    const gen = ++genRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    if (s.autoCorrect) {
      const unit = lastWritingUnit(editor.getText());
      if (unit && unit.length >= 10 && unit !== lastFixedRef.current) {
        setError("");
        setStatus(s.flow === "enhance" ? "Enhancing the line…" : "Fixing the line…");
        try {
          const next =
            s.flow === "enhance"
              ? await enhanceSentence(s, unit, ac.signal)
              : await polishSentence(s, unit, ac.signal);
          if (gen !== genRef.current) return;
          if (next) {
            applyingRef.current = true;
            replaceLastOccurrence(editor, unit, next, s.flow === "enhance");
            lastFixedRef.current = next.replace(/\*\*/g, "").replace(/\*/g, "");
            applyingRef.current = false;
            setStatus(s.flow === "enhance" ? "Line enhanced. Tab keeps the next words." : "Line fixed. Tab keeps the next words.");
          }
        } catch (e) {
          if (gen !== genRef.current) return;
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }

    if (s.flow === "off" || gen !== genRef.current) return;
    await runFlow(editor.getText(), gen, ac, briefRef.current);
  }
  onPauseRef.current = onPause;

  async function runFlow(text: string, gen: number, ac: AbortController, brief?: string) {
    const s = settingsRef.current;
    if (s.flow === "off" || !hasKey(s) || !editor) return;
    setError("");
    setStatus("Flow is drafting…");
    try {
      let acc = "";
      await flowContinue(s, text, (chunk) => {
        if (gen !== genRef.current) return;
        acc += chunk;
        editor.commands.setFlowGhost(acc.replace(/\s+/g, " ").replace(/^[\s,.;:]+/, ""));
      }, ac.signal, brief);
      if (gen !== genRef.current || ac.signal.aborted) return;
      setStatus(acc.trim() ? "Tab to keep the line. Esc to dismiss." : "Flow is listening.");
    } catch (e) {
      if (gen !== genRef.current) return;
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Flow paused.");
    }
  }

  async function runTransform(instruction: string, source?: string) {
    if (!editor) return;
    const s = settingsRef.current;
    if (!hasKey(s)) {
      setSettingsOpen(true);
      setError("Add a model key to write with you.");
      return;
    }
    const { from, to } = editor.state.selection;
    const selected = source ?? editor.state.doc.textBetween(from, to, "\n");
    const hasRange = to > from;
    const pageText = editor.getText().replace(/\s+/g, " ").trim();
    const selectedNorm = selected.replace(/\s+/g, " ").trim();
    const wholePage = Boolean(selectedNorm) && selectedNorm === pageText;
    const backup = editor.getHTML();
    setBusy(true);
    setError("");
    setStatus("Writing…");
    abortRef.current?.abort();
    applyingRef.current = true;
    editor.commands.clearFlowGhost();
    try {
      const out = await transform(s, instruction, selected || editor.getText().slice(-2000), briefRef.current);
      if (!out.trim()) {
        setError("Nothing came back. Your page is unchanged.");
        setStatus("Enhance missed. Try a smaller selection.");
        return;
      }
      const html = proseToHtml(out);
      if (!html || html === "<p></p>") {
        setError("Nothing came back. Your page is unchanged.");
        setStatus("Enhance missed. Try a smaller selection.");
        return;
      }
      if (wholePage) {
        editor.commands.setContent(html, { emitUpdate: false });
      } else if (hasRange) {
        const size = editor.state.doc.content.size;
        const fromSafe = Math.max(1, Math.min(from, size));
        const toSafe = Math.max(fromSafe, Math.min(to, size));
        editor.chain().focus().insertContentAt({ from: fromSafe, to: toSafe }, html).run();
      } else {
        editor.chain().focus().insertContent(html).run();
      }
      editor.commands.clearFlowGhost();
      setStatus("In the page.");
    } catch (e) {
      applyingRef.current = true;
      editor.commands.setContent(backup, { emitUpdate: false });
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Your page is unchanged.");
    } finally {
      applyingRef.current = false;
      setBusy(false);
      setPalette(false);
      setSel(null);
    }
  }

  async function fixNow() {
    if (!editor || !hasKey(settingsRef.current)) {
      setSettingsOpen(true);
      return;
    }
    const unit = lastWritingUnit(editor.getText());
    if (!unit) return;
    setStatus("Fixing the line…");
    try {
      const next = await polishSentence(settingsRef.current, unit);
      if (next) {
        applyingRef.current = true;
        replaceLastOccurrence(editor, unit, next, false);
        lastFixedRef.current = next;
        applyingRef.current = false;
        setStatus("Line fixed.");
      } else {
        setStatus("Already clean.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function enhanceNow() {
    if (!editor) return;
    const para = lastParagraph(editor.getText()) || editor.getText();
    const range = findLastTextRange(editor, para);
    if (range) editor.chain().focus().setTextSelection(range).run();
    await runTransform(
      "Fix errors, then enhance this. Same person. **Bold** the punch. Use # for a title if the first line is a title. Keep it them.",
      para,
    );
  }

  function openDoc(id: string) {
    const next = snapshot();
    const doc = next.find((d) => d.id === id);
    if (!doc || !editor) return;
    void persist(next, id);
    setActiveId(id);
    lastFixedRef.current = "";
    setScanName(doc.brief?.name ?? "");
    setScanText(doc.brief?.text ?? "");
    editor.commands.setContent(doc.html, { emitUpdate: false });
  }

  function createDoc() {
    const nextDocs = snapshot();
    const doc: DocRecord = { id: newId(), title: "Untitled", html: "<p></p>", updatedAt: Date.now() };
    void persist([doc, ...nextDocs], doc.id);
    setActiveId(doc.id);
    lastFixedRef.current = "";
    setScanName("");
    setScanText("");
    editor?.commands.setContent("<p></p>", { emitUpdate: false });
  }

  function attachBrief(brief: Brief) {
    const next = snapshot().map((d) =>
      d.id === activeId
        ? {
            ...d,
            brief,
            title: d.title === "Untitled" ? titleFromPaperName(brief.name) : d.title,
            updatedAt: Date.now(),
          }
        : d,
    );
    void persist(next);
    setScanName(brief.name);
    setScanText(brief.text);
    briefRef.current = brief.text;
  }

  function clearBrief() {
    const next = snapshot().map((d) => {
      if (d.id !== activeId) return d;
      return { id: d.id, title: d.title, html: d.html, updatedAt: Date.now() };
    });
    void persist(next);
    setScanName("");
    setScanText("");
    briefRef.current = "";
    setStatus("Brief cleared. Flow is just the page again.");
  }

  async function runComplete(text: string) {
    if (!editor) return;
    const s = settingsRef.current;
    if (!hasKey(s)) {
      setSettingsOpen(true);
      setError("Add a model key to complete a paper.");
      return;
    }
    setBusy(true);
    setScanOpen(false);
    setError("");
    const gen = ++genRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    applyingRef.current = true;
    editor.commands.clearFlowGhost();
    setStatus("Reading the paper. Completing onto the page…");
    const existing = editor.getText().trim();
    let acc = "";
    let lastPaint = 0;
    const paint = (force = false) => {
      const now = Date.now();
      if (!force && now - lastPaint < 90) return;
      lastPaint = now;
      editor.commands.setContent(proseToHtml(acc) || "<p></p>", { emitUpdate: false });
    };
    try {
      await completeFromBrief(s, text, existing, (chunk) => {
        if (gen !== genRef.current) return;
        acc += chunk;
        paint();
      }, ac.signal);
      if (gen !== genRef.current) return;
      paint(true);
      setStatus("On the page. Edit from here — Flow still has the brief.");
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Complete paused.");
    } finally {
      applyingRef.current = false;
      setBusy(false);
    }
  }

  async function ingestFile(file: File, complete: boolean) {
    if (!isPaperFile(file)) {
      setError("Scan wants a PDF, Word, or text paper.");
      setScanOpen(true);
      return;
    }
    setScanBusy(true);
    setError("");
    setStatus(`Reading ${file.name}…`);
    try {
      const extracted = await extractPaper(file);
      if (!extracted.trim()) throw new Error("Couldn't read any text from that file.");
      const brief: Brief = { name: file.name, text: extracted, scannedAt: Date.now() };
      attachBrief(brief);
      if (complete) await runComplete(extracted);
      else {
        setScanOpen(true);
        setStatus(`Scanned ${briefWordCount(extracted).toLocaleString()} words. Complete when you're ready.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setScanOpen(true);
    } finally {
      setScanBusy(false);
    }
  }

  async function ingestPasted(complete: boolean) {
    const text = scanText.trim();
    if (!text) {
      setError("Paste the paper, or drop a file.");
      return;
    }
    const brief: Brief = { name: scanName.trim() || "Pasted brief", text, scannedAt: Date.now() };
    attachBrief(brief);
    if (complete) await runComplete(text);
    else {
      setScanOpen(false);
      setStatus(`Brief attached · ${briefWordCount(text).toLocaleString()} words. Flow has it.`);
    }
  }

  async function onExport() {
    if (!editor) return;
    const title = docs.find((d) => d.id === activeId)?.title ?? "CopyWritePrime";
    try {
      await exportWord(title, editor.getHTML());
      setStatus("Word file saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function patchSettings(partial: Partial<Settings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    await saveSettings(next);
  }

  const syncOllama = useCallback(async (s: Settings) => {
    if (!isOllamaProvider(s.provider)) {
      setLiveModels([]);
      return;
    }
    try {
      const names = await listOllamaModels(s, s.provider);
      setLiveModels(names);
      setStatus(
        s.provider === "ollama-cloud"
          ? `Ollama Cloud · ${names.length} models${s.keys["ollama-cloud"] ? "" : " · add a key to write"}`
          : `Ollama local · ${names.length} models`,
      );
      setError("");
    } catch (e) {
      setLiveModels([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void syncOllama(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.provider, settings.ollamaLocalHost, settings.keys["ollama-cloud"]]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
      if (meta && e.key.toLowerCase() === "e" && sel?.text) {
        e.preventDefault();
        void runTransform(QUICK[1].prompt, sel.text);
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void persist(snapshot());
        setStatus("Saved.");
      }
      if (meta && e.key.toLowerCase() === "p") {
        e.preventDefault();
        void onExport();
      }
      if (e.key === "Escape") {
        setPalette(false);
        setSettingsOpen(false);
        setScanOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const words = editor?.storage.characterCount?.words?.() ?? editor?.getText().split(/\s+/).filter(Boolean).length ?? 0;
  const provider = useMemo(() => PROVIDERS.find((p) => p.id === settings.provider)!, [settings.provider]);
  const catalog = useMemo(() => {
    return [...new Set([settings.model, ...liveModels, ...provider.models].filter(Boolean))];
  }, [settings.model, liveModels, provider.models]);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="drag" data-tauri-drag-region>
          <div className="brand" data-tauri-drag-region>
            <span className="mark">C</span>
            CopyWritePrime
          </div>
        </div>
        <div className="center-controls">
          <select
            value={settings.provider}
            onChange={(e) => {
              const id = e.target.value as ProviderId;
              void patchSettings({ provider: id, model: defaultModelFor(id) });
            }}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="model"
            value={settings.model}
            onChange={(e) => void patchSettings({ model: e.target.value })}
          >
            {!catalog.includes(settings.model) && settings.model && (
              <option value={settings.model}>{settings.model}</option>
            )}
            {catalog.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {isOllamaProvider(settings.provider) && (
            <button className="ghost" onClick={() => void syncOllama(settings)}>
              Sync
            </button>
          )}
          <button className="ghost" onClick={() => setPalette(true)}>
            Prompt ⌘K
          </button>
          <button className="ghost" onClick={() => setScanOpen(true)}>
            Scan
          </button>
          <button className="ghost" onClick={() => void onExport()}>
            Word
          </button>
          <button className="ghost" onClick={() => setSettingsOpen(true)}>
            Keys
          </button>
        </div>
        <div className="win-btns">
          <button className="min" onClick={() => void win().then((w) => w?.minimize())} />
          <button className="max" onClick={() => void win().then((w) => w?.toggleMaximize())} />
          <button className="close" onClick={() => void win().then((w) => w?.close())} />
        </div>
      </header>

      <div
        className={`workspace ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void ingestFile(file, true);
        }}
      >
        {dragging && <div className="drop-veil">Drop the paper. Scan, then complete.</div>}
        <aside className="rail">
          <h2>Pages</h2>
          <div className="doc-list">
            {docs.map((d) => (
              <button key={d.id} className={`doc-item ${d.id === activeId ? "active" : ""}`} onClick={() => openDoc(d.id)}>
                {d.title}
                <small>{new Date(d.updatedAt).toLocaleString()}</small>
              </button>
            ))}
          </div>
          <button className="rail-btn" onClick={createDoc}>
            + New page
          </button>
          <button className="rail-btn" onClick={() => setScanOpen(true)}>
            Scan a paper
          </button>
        </aside>

        <main className="stage">
          {sel && (
            <div
              className={`selbar ${sel.below ? "below" : ""}`}
              style={{ left: sel.x, top: sel.y }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {QUICK.map((q) => (
                <button key={q.label} onClick={() => void runTransform(q.prompt, sel.text)}>
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <TypeBar editor={editor} />
          <div className={`paper scale-${settings.typeScale}`} ref={paperRef} data-scale={settings.typeScale}>
            <EditorContent editor={editor} />
          </div>
          <div className="status">
            <span>
              {error ? <span className="err">{error}</span> : status}{" "}
              {!hasKey(settings) && <b> · add a key to unlock Flow</b>}
            </span>
            <span>{words} words</span>
          </div>
        </main>

        <aside className="guard">
          <h2>Flow</h2>
          <div className="toggles" style={{ padding: 0, marginBottom: 14 }}>
            {(["off", "write", "enhance"] as FlowMode[]).map((mode) => (
              <button
                key={mode}
                className={settings.flow === mode ? "active" : ""}
                onClick={() => void patchSettings({ flow: mode })}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="kit" style={{ paddingLeft: 0 }}>
            {settings.flow === "off"
              ? "Ghost text is off. Auto-fix can still clean the last line when you pause."
              : settings.flow === "write"
                ? "When you pause, Flow fixes typos, then ghosts the next words. Tab keeps them."
                : "When you pause, Flow fixes the line, lifts it, then ghosts the next words. Tab keeps them."}
          </p>
          <div className="toggles" style={{ padding: 0, margin: "14px 0" }}>
            <button className={settings.autoCorrect ? "active" : ""} onClick={() => void patchSettings({ autoCorrect: !settings.autoCorrect })}>
              Auto-fix {settings.autoCorrect ? "on" : "off"}
            </button>
          </div>
          <button className="rail-btn" onClick={() => void fixNow()}>
            Fix last line
          </button>
          <button className="rail-btn" onClick={() => void enhanceNow()}>
            Enhance last paragraph
          </button>
          <h2 style={{ marginTop: 28 }}>Scan</h2>
          {activeDoc?.brief ? (
            <>
              <p className="kit" style={{ paddingLeft: 0 }}>
                {activeDoc.brief.name}
                <br />
                {briefWordCount(activeDoc.brief.text).toLocaleString()} words on this page. Flow writes against it.
              </p>
              <button className="rail-btn" disabled={busy || scanBusy} onClick={() => void runComplete(activeDoc.brief!.text)}>
                Complete this paper
              </button>
              <button className="rail-btn" onClick={clearBrief}>
                Clear brief
              </button>
            </>
          ) : (
            <>
              <p className="kit" style={{ paddingLeft: 0 }}>
                Drop a PDF, Word, or text brief. CopyWritePrime reads it, then writes the submission onto the page.
              </p>
              <button className="rail-btn" onClick={() => setScanOpen(true)}>
                Scan a paper
              </button>
            </>
          )}
          <h2 style={{ marginTop: 28 }}>Type size</h2>
          <div className="toggles" style={{ padding: 0 }}>
            {(["auto", "sm", "md", "lg"] as TypeScale[]).map((scale) => (
              <button
                key={scale}
                className={settings.typeScale === scale ? "active" : ""}
                onClick={() => void patchSettings({ typeScale: scale })}
              >
                {scale}
              </button>
            ))}
          </div>
          <p className="kit" style={{ paddingLeft: 0, marginTop: 12 }}>
            Auto sizes the page to the window. Bold, italic, underline, headings, and local sizes live on the bar above the paper. Ctrl/Cmd B I U.
          </p>
        </aside>
      </div>

      {palette && (
        <div className="palette-backdrop" onMouseDown={() => setPalette(false)}>
          <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
            <input
              autoFocus
              placeholder="Tell Flow what to write, or how to rewrite the selection…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && prompt.trim()) void runTransform(prompt.trim(), sel?.text);
              }}
            />
            <div className="hint">Enter runs it. Selection is the source if you have one. Otherwise it writes at the cursor.</div>
            <div className="actions">
              {QUICK.map((q) => (
                <button key={q.label} onClick={() => void runTransform(q.prompt, sel?.text)}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Every model. Your keys. Local only.</h3>
            <p className="lead">
              Nothing leaves this machine except the request you send to the provider you pick. Ollama Cloud uses an API key from ollama.com/settings/keys. Local Ollama needs no key.
            </p>
            {PROVIDERS.map((p) =>
              p.id === "ollama" ? (
                <div className="provider-row" key={p.id}>
                  <label>{p.name}</label>
                  <input
                    placeholder={p.placeholder}
                    defaultValue={settings.ollamaLocalHost}
                    onBlur={(e) => void patchSettings({ ollamaLocalHost: e.target.value.trim() || "http://127.0.0.1:11434" })}
                  />
                </div>
              ) : (
                <div className="provider-row" key={p.id}>
                  <label>{p.name}</label>
                  <input
                    type="password"
                    placeholder={p.placeholder}
                    defaultValue={settings.keys[p.id] ?? ""}
                    onBlur={(e) => void patchSettings(setProviderKey(settings, p.id, e.target.value.trim()))}
                  />
                </div>
              ),
            )}
            <div className="provider-row">
              <label>Custom base URL</label>
              <input
                defaultValue={settings.customBaseUrl}
                onBlur={(e) => void patchSettings({ customBaseUrl: e.target.value.trim() })}
              />
            </div>
            <div className="toggles">
              <button className={settings.autoCorrect ? "active" : ""} onClick={() => void patchSettings({ autoCorrect: !settings.autoCorrect })}>
                Auto-fix {settings.autoCorrect ? "on" : "off"}
              </button>
              {isOllamaProvider(settings.provider) && (
                <button onClick={() => void syncOllama(settings)}>Sync Ollama models</button>
              )}
            </div>
          </div>
        </div>
      )}

      {scanOpen && (
        <div className="modal-backdrop" onMouseDown={() => setScanOpen(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Scan a paper</h3>
            <p className="lead">
              Drop a take-home, brief, RFP, or assignment. CopyWritePrime reads it, then completes it onto the page. PDF, Word, or paste.
            </p>
            <div
              className="scan-drop"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (file) void ingestFile(file, false);
              }}
            >
              {scanBusy ? "Reading…" : scanName ? scanName : "Drop a file, or click to choose"}
              {scanText.trim() ? (
                <small>{briefWordCount(scanText).toLocaleString()} words scanned</small>
              ) : (
                <small>PDF · Word · .txt · .md</small>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={PAPER_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void ingestFile(file, false);
              }}
            />
            <div className="provider-row" style={{ gridTemplateColumns: "1fr" }}>
              <textarea
                className="scan-paste"
                placeholder="Or paste the brief here — Notion, email, the whole assignment…"
                value={scanText}
                onChange={(e) => setScanText(e.target.value)}
              />
            </div>
            <div className="provider-row">
              <label>Name</label>
              <input value={scanName} placeholder="Take-home" onChange={(e) => setScanName(e.target.value)} />
            </div>
            <div className="toggles">
              <button
                className="active"
                disabled={busy || scanBusy || !scanText.trim()}
                onClick={() => void ingestPasted(true)}
              >
                Complete this paper
              </button>
              <button disabled={!scanText.trim()} onClick={() => void ingestPasted(false)}>
                Attach only
              </button>
              <button onClick={() => setScanOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
