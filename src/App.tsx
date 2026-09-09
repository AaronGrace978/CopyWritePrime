import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FlowGhost } from "./extensions/flowGhost";
import { InkMark } from "./extensions/inkMark";
import { SentenceSelect } from "./extensions/sentenceSelect";
import { exportWord } from "./lib/docx";
import {
  completeFromBrief,
  distillVoice,
  workshopChat,
  DEFAULT_SETTINGS,
  defaultModelFor,
  enhanceSentence,
  flowContinue,
  hasKey,
  polishSentence,
  transform,
  type Settings,
} from "./lib/llm";
import { isAbortError } from "./lib/abort";
import { killEmDashes } from "./lib/dashes";
import { filesFromList, joinCorpus, pickWritingFolder, samplesOf, type CorpusFile } from "./lib/corpus";
import { downloadText } from "./lib/download";
import {
  allWorkshopMarkdown,
  archiveMarkdown,
  docPlain,
  pagesMarkdown,
  turnCount,
  workshopCount,
  workshopMarkdown,
} from "./lib/logs";
import { buildVoiceProfile } from "./lib/voice";
import { KOKORO_VOICES, listenWithKokoro, stopKokoro, unlockKokoroAudio, warmupKokoro } from "./lib/kokoro";
import {
  findLastTextRange,
  insertAiContent,
  lastParagraph,
  lastWritingUnit,
  markDocAsAi,
  pagePlain,
  proseToHtml,
  replaceLastOccurrence,
  stripEmDashesInEditor,
} from "./lib/prose";
import { PROVIDERS, type ProviderId } from "./lib/providers";
import { isOllamaProvider, listOllamaModels } from "./lib/ollama";
import { isFailedWorkshopTurn, withoutFailedTail, workshopHistory } from "./lib/workshop";
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
  type WorkshopTurn,
} from "./lib/storage";
import type { FlowMode, TypeScale } from "./lib/types";

const QUICK = [
  { label: "Fix", prompt: "Fix spelling, grammar, missing words, and punctuation. Keep the voice. No extra ideas. No preamble. Keep every section." },
  { label: "Enhance", prompt: "Fix errors, then make this one notch clearer and more specific. Same person. Keep the same structure and length. Do not drop sections. You may **bold** punch phrases. Use headings if they were headings. No em dashes. No preamble." },
  { label: "Tighten", prompt: "Tighten this copy. Keep the voice and the structure. Cut fat. Do not drop sections. No preamble." },
  { label: "Human", prompt: "Rewrite so it sounds like a person wrote it for a person. Kill marketing fog. Kill every em dash. Keep the meaning, structure, and length. Do not drop sections." },
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

function TypeBar({
  editor,
  showAiMarks,
  onToggleAiMarks,
  listening,
  onListen,
  onStop,
}: {
  editor: Editor | null;
  showAiMarks: boolean;
  onToggleAiMarks: () => void;
  listening: boolean;
  onListen: () => void;
  onStop: () => void;
}) {
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
      <button className={editor.isActive("inkMark", { kind: "user" }) ? "active" : ""} onClick={() => editor.chain().focus().toggleUserHighlight().run()}>
        HL
      </button>
      <button className={showAiMarks ? "active" : ""} title="Show AI writing in gold" onClick={onToggleAiMarks}>
        AI
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
      <span className="type-gap" />
      {listening ? (
        <button className="active" title="Stop Kokoro" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button title="Read with Kokoro" onClick={onListen}>
          Listen
        </button>
      )}
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
  const [showArchive, setShowArchive] = useState(false);
  const [railTab, setRailTab] = useState<"flow" | "workshop" | "voice">("flow");
  const [workshopInput, setWorkshopInput] = useState("");
  const [workshopBusy, setWorkshopBusy] = useState(false);
  const [workshopPhase, setWorkshopPhase] = useState<"waiting" | "thinking" | "writing">("waiting");
  const [workshopStarted, setWorkshopStarted] = useState(0);
  const [tick, setTick] = useState(0);
  const [liveWorkshop, setLiveWorkshop] = useState<WorkshopTurn[] | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [kokoroBusy, setKokoroBusy] = useState(false);
  const workshopEndRef = useRef<HTMLDivElement>(null);
  const workshopFieldRef = useRef<HTMLTextAreaElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const flowTimer = useRef<number | null>(null);
  const flowAbortRef = useRef<AbortController | null>(null);
  const jobAbortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  const applyingRef = useRef(false);
  const flowGenRef = useRef(0);
  const jobGenRef = useRef(0);
  const lastFixedRef = useRef("");
  const briefRef = useRef("");
  const workshopBusyRef = useRef(false);
  const workshopRef = useRef<WorkshopTurn[] | undefined>(undefined);
  const railTabRef = useRef<"flow" | "workshop" | "voice">("flow");
  const busyRef = useRef(false);
  const listenGenRef = useRef(0);
  const paperRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPauseRef = useRef<() => Promise<void>>(async () => undefined);
  const placeSelbarRef = useRef<(ed: Editor) => void>(() => undefined);
  settingsRef.current = settings;
  railTabRef.current = railTab;

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
      InkMark,
      SentenceSelect,
    ],
    content: "<p></p>",
    onUpdate: ({ editor: ed }) => {
      if (applyingRef.current) return;
      if (flowTimer.current) window.clearTimeout(flowTimer.current);
      ed.commands.clearFlowGhost();
      flowAbortRef.current?.abort();
      if (workshopBusyRef.current || busyRef.current || railTabRef.current === "workshop") return;
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
      workshopRef.current = current.workshop;
      setScanName(current.brief?.name ?? "");
      setScanText(current.brief?.text ?? "");
      editor?.commands.setContent(current.html, { emitUpdate: false });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    const t = window.setTimeout(() => warmupKokoro(), 1600);
    return () => window.clearTimeout(t);
  }, []);

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
            workshop: workshopRef.current,
          }
        : d,
    );
  }, [activeId, docs, editor]);

  const activeDoc = docs.find((d) => d.id === activeId);
  briefRef.current = activeDoc?.brief?.text ?? "";

  useEffect(() => {
    workshopEndRef.current?.scrollIntoView({ block: "end" });
  }, [liveWorkshop, activeDoc?.workshop]);

  useEffect(() => {
    if (!workshopBusy) return;
    setTick(Date.now());
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [workshopBusy]);

  const workshopElapsed = workshopBusy && workshopStarted ? Math.max(0, Math.floor((tick - workshopStarted) / 1000)) : 0;
  const workshopWaitLabel =
    workshopPhase === "thinking" ? "Thinking" : workshopPhase === "writing" ? "Writing" : "Listening";

  useEffect(() => {
    const t = window.setInterval(() => {
      void persist(snapshot());
    }, 2500);
    return () => window.clearInterval(t);
  }, [persist, snapshot]);

  async function onPause() {
    const s = settingsRef.current;
    if (!editor || !hasKey(s) || busyRef.current || workshopBusyRef.current || railTabRef.current === "workshop") return;
    const gen = ++flowGenRef.current;
    flowAbortRef.current?.abort();
    const ac = new AbortController();
    flowAbortRef.current = ac;

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
          if (gen !== flowGenRef.current) return;
          if (next) {
            applyingRef.current = true;
            replaceLastOccurrence(editor, unit, next, s.flow === "enhance");
            lastFixedRef.current = next.replace(/\*\*/g, "").replace(/\*/g, "");
            applyingRef.current = false;
            setStatus(s.flow === "enhance" ? "Line enhanced. Tab keeps the next words." : "Line fixed. Tab keeps the next words.");
          }
        } catch (e) {
          if (gen !== flowGenRef.current || isAbortError(e)) return;
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }

    if (s.flow === "off" || gen !== flowGenRef.current || workshopBusyRef.current) return;
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
        if (gen !== flowGenRef.current) return;
        acc += chunk;
        editor.commands.setFlowGhost(killEmDashes(acc).replace(/\s+/g, " ").replace(/^[\s,.;:]+/, ""));
      }, ac.signal, brief);
      if (gen !== flowGenRef.current || ac.signal.aborted) return;
      setStatus(acc.trim() ? "Tab to keep the line. Esc to dismiss." : "Flow is listening.");
    } catch (e) {
      if (gen !== flowGenRef.current || isAbortError(e)) return;
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
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("Writing…");
    flowAbortRef.current?.abort();
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
        markDocAsAi(editor);
      } else if (hasRange) {
        const size = editor.state.doc.content.size;
        const fromSafe = Math.max(1, Math.min(from, size));
        const toSafe = Math.max(fromSafe, Math.min(to, size));
        insertAiContent(editor, html, { from: fromSafe, to: toSafe });
      } else {
        insertAiContent(editor, html);
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
      busyRef.current = false;
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
    workshopRef.current = doc.workshop;
    lastFixedRef.current = "";
    setScanName(doc.brief?.name ?? "");
    setScanText(doc.brief?.text ?? "");
    setLiveWorkshop(null);
    editor.commands.setContent(doc.html, { emitUpdate: false });
  }

  function createDoc() {
    const nextDocs = snapshot();
    const doc: DocRecord = { id: newId(), title: "Untitled", html: "<p></p>", updatedAt: Date.now() };
    void persist([doc, ...nextDocs], doc.id);
    setActiveId(doc.id);
    workshopRef.current = undefined;
    lastFixedRef.current = "";
    setScanName("");
    setScanText("");
    setLiveWorkshop(null);
    editor?.commands.setContent("<p></p>", { emitUpdate: false });
  }

  function showPage(doc: DocRecord) {
    setActiveId(doc.id);
    workshopRef.current = doc.workshop;
    lastFixedRef.current = "";
    setScanName(doc.brief?.name ?? "");
    setScanText(doc.brief?.text ?? "");
    setLiveWorkshop(null);
    briefRef.current = doc.brief?.text ?? "";
    editor?.commands.setContent(doc.html || "<p></p>", { emitUpdate: false });
  }

  function clearPage() {
    if (!editor) return;
    lastFixedRef.current = "";
    setScanName("");
    setScanText("");
    setLiveWorkshop(null);
    workshopRef.current = undefined;
    briefRef.current = "";
    editor.commands.setContent("<p></p>", { emitUpdate: false });
    const next = snapshot().map((d) =>
      d.id === activeId
        ? { ...d, title: "Untitled", html: "<p></p>", updatedAt: Date.now(), workshop: undefined }
        : d,
    );
    void persist(next);
    setStatus("Page cleared.");
  }

  function archiveDoc(id: string) {
    const stamped = snapshot().map((d) => (d.id === id ? { ...d, archivedAt: Date.now(), updatedAt: Date.now() } : d));
    const live = stamped.filter((d) => !d.archivedAt);
    if (id === activeId) {
      const fallback = live[0] ?? { id: newId(), title: "Untitled", html: "<p></p>", updatedAt: Date.now() };
      const list = live[0] ? stamped : [fallback, ...stamped];
      void persist(list, fallback.id);
      showPage(fallback);
    } else {
      void persist(stamped);
    }
    setStatus("Archived.");
  }

  function clearAndArchive() {
    if (!editor) return;
    const stamped = snapshot().map((d) =>
      d.id === activeId ? { ...d, archivedAt: Date.now(), updatedAt: Date.now() } : d,
    );
    const fresh: DocRecord = { id: newId(), title: "Untitled", html: "<p></p>", updatedAt: Date.now() };
    void persist([fresh, ...stamped], fresh.id);
    showPage(fresh);
    setStatus("Archived. Fresh page.");
  }

  function restoreDoc(id: string) {
    const next = snapshot().map((d) => {
      if (d.id !== id) return d;
      const { archivedAt: _gone, ...rest } = d;
      return { ...rest, updatedAt: Date.now() };
    });
    const restored = next.find((d) => d.id === id);
    void persist(next, id);
    if (restored) showPage(restored);
    setStatus("Restored.");
  }

  function deleteDoc(id: string) {
    const stamped = snapshot();
    const remaining = stamped.filter((d) => d.id !== id);
    if (remaining.length === 0) {
      const fresh: DocRecord = { id: newId(), title: "Untitled", html: "<p></p>", updatedAt: Date.now() };
      void persist([fresh], fresh.id);
      showPage(fresh);
    } else if (id === activeId) {
      const fallback = remaining.find((d) => !d.archivedAt) ?? remaining[0];
      void persist(remaining, fallback.id);
      showPage(fallback);
    } else {
      void persist(remaining);
    }
    setStatus("Deleted.");
  }

  function setWorkshop(turns: WorkshopTurn[]) {
    workshopRef.current = turns;
    void persist(snapshot());
  }

  function openWorkshop() {
    setRailTab("workshop");
    flowAbortRef.current?.abort();
    if (flowTimer.current) window.clearTimeout(flowTimer.current);
    editor?.commands.clearFlowGhost();
    window.setTimeout(() => workshopFieldRef.current?.focus(), 40);
  }

  async function runWorkshop(question?: string, opts: { retry?: boolean } = {}) {
    const q = (question ?? workshopInput).trim();
    if (!q || !editor) return;
    const s = settingsRef.current;
    if (!hasKey(s)) {
      setSettingsOpen(true);
      setError("Add a model key to workshop.");
      return;
    }
    let prior = (workshopRef.current ?? snapshot().find((d) => d.id === activeId)?.workshop ?? []).slice();
    if (opts.retry) prior = withoutFailedTail(prior);
    const userTurn: WorkshopTurn = { role: "user", content: q };
    const history = workshopHistory(prior);
    setLiveWorkshop([...prior, userTurn, { role: "assistant", content: "" }]);
    setWorkshopInput("");
    workshopBusyRef.current = true;
    setWorkshopBusy(true);
    setWorkshopPhase("waiting");
    setWorkshopStarted(Date.now());
    setRailTab("workshop");
    setError("");
    setStatus(`Workshop is on the line with ${s.model}…`);
    flowAbortRef.current?.abort();
    if (flowTimer.current) window.clearTimeout(flowTimer.current);
    const job = ++jobGenRef.current;
    jobAbortRef.current?.abort();
    const ac = new AbortController();
    jobAbortRef.current = ac;
    let acc = "";
    let thoughtChars = 0;
    let paintScheduled = false;
    const paint = () => {
      if (job !== jobGenRef.current || paintScheduled) return;
      paintScheduled = true;
      requestAnimationFrame(() => {
        paintScheduled = false;
        if (job !== jobGenRef.current) return;
        setLiveWorkshop([...prior, userTurn, { role: "assistant", content: killEmDashes(acc) }]);
      });
    };
    const finish = (turn: WorkshopTurn, note: string) => {
      setWorkshop([...prior, userTurn, turn]);
      setLiveWorkshop(null);
      setStatus(note);
    };
    try {
      await workshopChat(
        s,
        {
          page: pagePlain(editor),
          selection: sel?.text ?? "",
          brief: briefRef.current,
          history,
          question: q,
          onThinking: (chunk) => {
            if (job !== jobGenRef.current) return;
            thoughtChars += chunk.length;
            if (thoughtChars === chunk.length) {
              setWorkshopPhase("thinking");
              setStatus(
                s.reasoning
                  ? `${s.model} is thinking before it writes. Reasoning is on under Keys.`
                  : `${s.model} is thinking before it writes. Stop any time, or pick a model that skips the trace.`,
              );
            }
          },
        },
        (chunk) => {
          if (job !== jobGenRef.current) return;
          if (!acc) setWorkshopPhase("writing");
          acc += chunk;
          paint();
        },
        ac.signal,
      );
      if (job !== jobGenRef.current) return;
      const text = killEmDashes(acc).trim();
      if (!text) {
        finish(
          {
            role: "assistant",
            content: `Nothing came back from ${s.model}. Try again, or pick a faster model under the model menu.`,
            failed: true,
          },
          "Workshop got an empty reply.",
        );
        return;
      }
      finish({ role: "assistant", content: text }, "Workshop answered. The page didn't move.");
    } catch (e) {
      if (job !== jobGenRef.current) return;
      if (isAbortError(e)) {
        const partial = killEmDashes(acc).trim();
        finish(
          partial
            ? { role: "assistant", content: partial }
            : { role: "assistant", content: "(stopped before a reply.)", failed: true },
          "Workshop stopped.",
        );
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      finish({ role: "assistant", content: `Couldn't answer. ${msg}`, failed: true }, "Workshop paused.");
      setError(msg);
    } finally {
      if (job === jobGenRef.current) {
        workshopBusyRef.current = false;
        setWorkshopBusy(false);
        setWorkshopPhase("waiting");
      }
    }
  }

  function retryWorkshop() {
    const turns = workshopRef.current ?? activeDoc?.workshop ?? [];
    const last = turns[turns.length - 1];
    const asked = last?.role === "assistant" && isFailedWorkshopTurn(last) ? turns[turns.length - 2] : undefined;
    if (!asked || asked.role !== "user") return;
    void runWorkshop(asked.content, { retry: true });
  }

  function stopWorkshop() {
    jobAbortRef.current?.abort();
  }

  function killDashesNow() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const scoped = to > from && to - from > 1;
    const changed = stripEmDashesInEditor(editor, scoped ? { from, to } : undefined);
    setSel(null);
    setStatus(changed ? "Em dashes are gone." : "No em dashes on the page.");
  }

  function haltKokoro() {
    listenGenRef.current += 1;
    stopKokoro();
    setKokoroBusy(false);
    setStatus("Kokoro stopped.");
  }

  async function listenNow(source?: string) {
    unlockKokoroAudio();
    const text = (source ?? sel?.text ?? pagePlain(editor)).replace(/\s+/g, " ").trim();
    if (!text) {
      setError("Write something, then Listen.");
      return;
    }
    const n = ++listenGenRef.current;
    setError("");
    setKokoroBusy(true);
    setStatus("Kokoro warming up…");
    try {
      await listenWithKokoro(text, {
        voice: settingsRef.current.kokoroVoice,
        speed: settingsRef.current.kokoroSpeed,
        onStatus: (msg) => {
          if (n === listenGenRef.current) setStatus(msg);
        },
      });
    } catch (e) {
      if (n !== listenGenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Kokoro paused.");
    } finally {
      if (n === listenGenRef.current) setKokoroBusy(false);
    }
  }

  function insertWorkshop(text: string) {
    if (!editor || !text.trim()) return;
    insertAiContent(editor, proseToHtml(killEmDashes(text)));
    setStatus("Dropped onto the page.");
  }

  function copyTurn(text: string) {
    void navigator.clipboard.writeText(text).then(
      () => setStatus("Copied."),
      () => setStatus("Couldn't copy."),
    );
  }

  async function exportThisChat() {
    const turns = liveWorkshop ?? activeDoc?.workshop ?? [];
    if (!turns.length) {
      setError("No Workshop log on this page.");
      return;
    }
    const ok = await downloadText(`${activeDoc?.title || "Workshop"}-workshop`, workshopMarkdown(activeDoc?.title || "Untitled", turns, activeDoc?.updatedAt));
    if (ok) setStatus("Workshop log exported.");
  }

  async function exportAllChats() {
    const n = workshopCount(docs);
    if (!n) {
      setError("No Workshop logs to export.");
      return;
    }
    const ok = await downloadText("copywriteprime-workshop-logs", allWorkshopMarkdown(docs));
    if (ok) {
      setStatus(`Exported ${n} Workshop log${n === 1 ? "" : "s"}.`);
      setLogsOpen(false);
    }
  }

  async function exportArchive() {
    const n = docs.filter((d) => d.archivedAt).length;
    if (!n) {
      setError("Archive is empty.");
      return;
    }
    const ok = await downloadText("copywriteprime-archive", archiveMarkdown(docs));
    if (ok) {
      setStatus(`Exported ${n} archived page${n === 1 ? "" : "s"}.`);
      setLogsOpen(false);
    }
  }

  async function exportPages() {
    const ok = await downloadText("copywriteprime-pages", pagesMarkdown(docs));
    if (ok) {
      setStatus("Pages exported.");
      setLogsOpen(false);
    }
  }

  function clearThisChat() {
    if (!(activeDoc?.workshop?.length || liveWorkshop?.length)) return;
    if (!window.confirm("Delete this page's Workshop log?")) return;
    jobAbortRef.current?.abort();
    setLiveWorkshop(null);
    setWorkshop([]);
    setStatus("Workshop log cleared.");
  }

  function deleteAllChats() {
    const n = workshopCount(docs);
    if (!n) return;
    if (!window.confirm(`Delete every Workshop log (${n} chat${n === 1 ? "" : "s"}, ${turnCount(docs)} turns)? This does not touch the pages.`)) return;
    jobAbortRef.current?.abort();
    setLiveWorkshop(null);
    const next = snapshot().map((d) => ({ ...d, workshop: undefined, updatedAt: Date.now() }));
    workshopRef.current = undefined;
    void persist(next);
    setLogsOpen(false);
    setStatus("All Workshop logs deleted.");
  }

  function emptyArchive() {
    const n = docs.filter((d) => d.archivedAt).length;
    if (!n) return;
    if (!window.confirm(`Delete ${n} archived page${n === 1 ? "" : "s"} forever?`)) return;
    const remaining = snapshot().filter((d) => !d.archivedAt);
    if (!remaining.length) {
      setError("Keep at least one live page. Restore something first, or delete archive items one by one.");
      return;
    }
    if (activeDoc?.archivedAt) {
      const fallback = remaining[0];
      editor?.commands.setContent(fallback.html, { emitUpdate: false });
      setActiveId(fallback.id);
      void persist(remaining, fallback.id);
    } else {
      void persist(remaining);
    }
    setLogsOpen(false);
    setStatus("Archive emptied.");
  }

  async function learnVoice(files: CorpusFile[], sourceLabel: string) {
    if (!files.length) {
      setError("No readable writing in that set. PDF, Word, .txt, .md, .html.");
      return;
    }
    setVoiceBusy(true);
    setRailTab("voice");
    setError("");
    setStatus(`Reading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      const corpus = joinCorpus(files);
      const s = settingsRef.current;
      let distilled = "";
      try {
        if (hasKey(s)) distilled = await distillVoice(s, corpus);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      const profile = buildVoiceProfile({
        text: corpus,
        samples: samplesOf(files),
        sourceLabel,
        distilled,
      });
      await patchSettings({ voice: profile, voiceEnabled: true });
      setStatus(`Voice locked from ${files.length} file${files.length === 1 ? "" : "s"} · ${profile.wordCount.toLocaleString()} words.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVoiceBusy(false);
    }
  }

  async function scanVoiceFolder() {
    setVoiceBusy(true);
    setError("");
    try {
      const picked = await pickWritingFolder();
      if (picked && picked.length) {
        await learnVoice(picked, "folder");
        return;
      }
      if (picked && picked.length === 0) {
        setError("That folder had no readable writing.");
        setVoiceBusy(false);
        return;
      }
      folderRef.current?.click();
      setVoiceBusy(false);
    } catch (e) {
      setVoiceBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function learnFromPages() {
    const files: CorpusFile[] = docs
      .filter((d) => !d.archivedAt)
      .map((d) => {
        const text = docPlain(d.html);
        return { name: d.title || "Untitled", text, words: text.split(/\s+/).filter(Boolean).length };
      })
      .filter((f) => f.words >= 20);
    await learnVoice(files, "pages");
  }

  async function forgetVoice() {
    if (!settings.voice) return;
    if (!window.confirm("Forget the learned voice?")) return;
    await patchSettings({ voice: null });
    setStatus("Voice cleared. Flow is generic again.");
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
      const { brief: _gone, ...rest } = d;
      return { ...rest, updatedAt: Date.now() };
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
    busyRef.current = true;
    setBusy(true);
    setScanOpen(false);
    setError("");
    flowAbortRef.current?.abort();
    if (flowTimer.current) window.clearTimeout(flowTimer.current);
    const job = ++jobGenRef.current;
    jobAbortRef.current?.abort();
    const ac = new AbortController();
    jobAbortRef.current = ac;
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
      editor.commands.setContent(proseToHtml(killEmDashes(acc)) || "<p></p>", { emitUpdate: false });
    };
    try {
      await completeFromBrief(s, text, existing, (chunk) => {
        if (job !== jobGenRef.current) return;
        acc += chunk;
        paint();
      }, ac.signal);
      if (job !== jobGenRef.current) return;
      paint(true);
      markDocAsAi(editor);
      setStatus("On the page. Gold is AI. Edit from here. Flow still has the brief.");
    } catch (e) {
      if (isAbortError(e)) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Complete paused.");
    } finally {
      applyingRef.current = false;
      busyRef.current = false;
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
      setStatus("Word saved. Times New Roman 12, double-spaced. Em dashes stripped.");
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
      if (meta && e.key.toLowerCase() === "j") {
        e.preventDefault();
        openWorkshop();
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
        setLogsOpen(false);
        haltKokoro();
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
          <button className={`ghost ${railTab === "workshop" ? "on" : ""}`} onClick={openWorkshop}>
            Workshop
          </button>
          <button className={`ghost ${railTab === "voice" ? "on" : ""} ${settings.voiceEnabled && settings.voice ? "lit" : ""}`} onClick={() => setRailTab("voice")}>
            Voice
          </button>
          <button className={`ghost ${kokoroBusy ? "on" : ""}`} onClick={() => (kokoroBusy ? haltKokoro() : void listenNow())}>
            {kokoroBusy ? "Stop" : "Listen"}
          </button>
          <button className={`ghost ${logsOpen ? "on" : ""}`} onClick={() => setLogsOpen(true)}>
            Logs
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
            {docs
              .filter((d) => !d.archivedAt)
              .map((d) => (
                <div key={d.id} className={`doc-row ${d.id === activeId ? "active" : ""}`}>
                  <button className={`doc-item ${d.id === activeId ? "active" : ""}`} onClick={() => openDoc(d.id)}>
                    {d.title}
                    <small>{new Date(d.updatedAt).toLocaleString()}</small>
                  </button>
                  <button
                    className="doc-mini"
                    title="Archive"
                    onClick={(e) => {
                      e.stopPropagation();
                      archiveDoc(d.id);
                    }}
                  >
                    Archive
                  </button>
                </div>
              ))}
          </div>
          <button className="rail-btn" onClick={createDoc}>
            + New page
          </button>
          <button className="rail-btn" onClick={clearAndArchive}>
            Clear & archive
          </button>
          <button className="rail-btn" onClick={clearPage}>
            Clear page
          </button>
          <button className="rail-btn" onClick={() => archiveDoc(activeId)}>
            Archive this page
          </button>
          <button className="rail-btn" onClick={() => setLogsOpen(true)}>
            Export / delete logs
          </button>
          <button className="rail-btn" onClick={() => setScanOpen(true)}>
            Scan a paper
          </button>
          {docs.some((d) => d.archivedAt) && (
            <>
              <h2>
                <button className="archive-toggle" onClick={() => setShowArchive((v) => !v)}>
                  Archive ({docs.filter((d) => d.archivedAt).length}) {showArchive ? "–" : "+"}
                </button>
              </h2>
              {showArchive && (
                <div className="doc-list">
                  {docs
                    .filter((d) => d.archivedAt)
                    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
                    .map((d) => (
                      <div key={d.id} className={`doc-row ${d.id === activeId ? "active" : ""}`}>
                        <button className={`doc-item ${d.id === activeId ? "active" : ""}`} onClick={() => openDoc(d.id)}>
                          {d.title}
                          <small>{new Date(d.archivedAt ?? d.updatedAt).toLocaleString()}</small>
                        </button>
                        <button className="doc-mini" onClick={() => restoreDoc(d.id)}>
                          Restore
                        </button>
                        <button
                          className="doc-mini danger"
                          onClick={() => {
                            if (window.confirm(`Delete “${d.title}” forever?`)) deleteDoc(d.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
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
              <button onClick={killDashesNow}>Em dash</button>
              <button onClick={() => void listenNow(sel.text)}>Listen</button>
              <button
                onClick={() => {
                  openWorkshop();
                  if (sel.text) setWorkshopInput(`Look at this line: “${sel.text.replace(/\s+/g, " ").trim().slice(0, 280)}”`);
                }}
              >
                Workshop
              </button>
            </div>
          )}
          <TypeBar
            editor={editor}
            showAiMarks={settings.showAiMarks}
            onToggleAiMarks={() => void patchSettings({ showAiMarks: !settings.showAiMarks })}
            listening={kokoroBusy}
            onListen={() => void listenNow()}
            onStop={haltKokoro}
          />
          <div className={`paper scale-${settings.typeScale}${settings.showAiMarks ? "" : " hide-ai"}`} ref={paperRef} data-scale={settings.typeScale}>
            <EditorContent editor={editor} />
          </div>
          <div className="status">
            <span>
              {error ? <span className="err">{error}</span> : status}{" "}
              {!hasKey(settings) && <b> · add a key to unlock Flow</b>}
              {settings.voiceEnabled && settings.voice && (
                <b>
                  {" "}
                  · voice on · {settings.voice.wordCount.toLocaleString()} words
                </b>
              )}
            </span>
            <span>{words} words</span>
          </div>
        </main>

        <aside className={`guard ${railTab !== "flow" ? "workshop-open" : ""}`}>
          <div className="toggles" style={{ padding: 0, marginBottom: 12 }}>
            <button className={railTab === "flow" ? "active" : ""} onClick={() => setRailTab("flow")}>
              Flow
            </button>
            <button className={railTab === "workshop" ? "active" : ""} onClick={openWorkshop}>
              Workshop
            </button>
            <button className={railTab === "voice" ? "active" : ""} onClick={() => setRailTab("voice")}>
              Voice
            </button>
          </div>
          {railTab === "workshop" ? (
            <div className="workshop">
              <p className="kit" style={{ paddingLeft: 0 }}>
                Argue the line. The page stays put until you drop a rewrite.
                {sel?.text ? ` Using: “${sel.text.replace(/\s+/g, " ").trim().slice(0, 80)}${sel.text.length > 80 ? "…" : ""}”` : " Reading the whole page."}
              </p>
              <div className="log-bar">
                <button className="doc-mini" onClick={() => void exportThisChat()}>
                  Export
                </button>
                <button className="doc-mini" onClick={clearThisChat}>
                  Delete
                </button>
                <button className="doc-mini" onClick={() => setLogsOpen(true)}>
                  All logs
                </button>
              </div>
              <details className="workshop-page">
                <summary>On the page · {words} words</summary>
                <pre>{pagePlain(editor) || "(empty. Write on the paper, then ask.)"}</pre>
              </details>
              <div className="workshop-log">
                {((liveWorkshop ?? activeDoc?.workshop) ?? []).length === 0 && (
                  <div className="empty-log">
                    <p>Ask anything. “Should I spell out $349?” “Is this headline doing the job?”</p>
                    <p>Typing on the page no longer kills the reply.</p>
                  </div>
                )}
                {((liveWorkshop ?? activeDoc?.workshop) ?? []).map((turn, i, all) => {
                  const last = i === all.length - 1;
                  const waiting = workshopBusy && turn.role === "assistant" && last && !turn.content.trim();
                  return (
                    <div key={`${turn.role}-${i}`} className={`workshop-turn ${turn.role}${isFailedWorkshopTurn(turn) ? " failed" : ""}`}>
                      <span className="label">{turn.role === "user" ? "You" : "Workshop"}</span>
                      <p>
                        {turn.content}
                        {waiting ? (
                          <span className="pulse">
                            {workshopWaitLabel}… {workshopElapsed}s
                          </span>
                        ) : null}
                      </p>
                      {waiting && workshopElapsed >= 20 && (
                        <p className="kit slow-note">
                          {workshopPhase === "thinking"
                            ? `${settings.model} is still reasoning. Stop, or turn Reasoning off under Keys for a straight answer.`
                            : `Still waiting on ${settings.model}. It gives up on its own after ~75s of silence. Stop, or try a faster model.`}
                        </p>
                      )}
                      {turn.role === "assistant" && isFailedWorkshopTurn(turn) && last && !workshopBusy && (
                        <div className="turn-actions">
                          <button className="rail-btn" onClick={retryWorkshop}>
                            Try again
                          </button>
                        </div>
                      )}
                      {turn.role === "assistant" && !isFailedWorkshopTurn(turn) && turn.content.trim() && (
                        <div className="turn-actions">
                          <button className="rail-btn" onClick={() => insertWorkshop(turn.content)}>
                            Drop on page
                          </button>
                          <button className="rail-btn" onClick={() => copyTurn(turn.content)}>
                            Copy
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={workshopEndRef} />
              </div>
              <textarea
                ref={workshopFieldRef}
                className="workshop-input"
                placeholder="Workshop this…"
                value={workshopInput}
                disabled={workshopBusy}
                onChange={(e) => setWorkshopInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void runWorkshop();
                  }
                }}
              />
              <div className="ask-row">
                {workshopBusy ? (
                  <button className="rail-btn" onClick={stopWorkshop}>
                    Stop
                  </button>
                ) : (
                  <button className="rail-btn" disabled={!workshopInput.trim()} onClick={() => void runWorkshop()}>
                    Ask
                  </button>
                )}
              </div>
            </div>
          ) : railTab === "voice" ? (
            <div className="voice-pane">
              <h2>Voice harness</h2>
              <p className="kit" style={{ paddingLeft: 0 }}>
                Scan a folder of past work, or learn from these pages. Flow, Workshop, Enhance, and Complete write like that person.
              </p>
              <div className="toggles" style={{ padding: 0, margin: "12px 0" }}>
                <button
                  className={settings.voiceEnabled && settings.voice ? "active" : ""}
                  onClick={() => void patchSettings({ voiceEnabled: !settings.voiceEnabled })}
                >
                  Write like me {settings.voiceEnabled ? "on" : "off"}
                </button>
              </div>
              {settings.voice ? (
                <div className="voice-card">
                  <div className="voice-meta">
                    {settings.voice.wordCount.toLocaleString()} words · {settings.voice.samples.length} files · {settings.voice.sourceLabel}
                  </div>
                  <div className="trait-row">
                    <span>{settings.voice.traits.sentence}</span>
                    <span>{settings.voice.traits.person}</span>
                    <span>{settings.voice.traits.energy}</span>
                    <span>{settings.voice.traits.diction}</span>
                  </div>
                  <pre>{settings.voice.card}</pre>
                </div>
              ) : (
                <p className="kit" style={{ paddingLeft: 0 }}>
                  No voice yet. Drop a folder of ads, decks, emails, or papers. The agent reads how they punch a line.
                </p>
              )}
              <button className="rail-btn" disabled={voiceBusy} onClick={() => void scanVoiceFolder()}>
                {voiceBusy ? "Reading…" : "Scan a folder"}
              </button>
              <button className="rail-btn" disabled={voiceBusy} onClick={() => void learnFromPages()}>
                Learn from these pages
              </button>
              <button className="rail-btn" disabled={!settings.voice} onClick={() => void forgetVoice()}>
                Forget voice
              </button>
              {settings.voice && settings.voice.samples.length > 0 && (
                <ul className="sample-list">
                  {settings.voice.samples.slice(0, 12).map((s) => (
                    <li key={s.name}>
                      {s.name} <small>{s.words.toLocaleString()}w</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
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
            <button className={settings.reasoning ? "active" : ""} onClick={() => void patchSettings({ reasoning: !settings.reasoning })}>
              Reasoning {settings.reasoning ? "on" : "off"}
            </button>
          </div>
          <p className="kit" style={{ paddingLeft: 0 }}>
            {settings.reasoning
              ? "Reasoning on: thinking models plan first. Slower. The trace eats into the reply budget."
              : "Reasoning off: thinking models answer straight away. Right for Flow and Workshop."}
          </p>
          <button className="rail-btn" onClick={() => void fixNow()}>
            Fix last line
          </button>
          <button className="rail-btn" onClick={() => void enhanceNow()}>
            Enhance last paragraph
          </button>
          <button
            className="rail-btn"
            onClick={() => {
              editor?.commands.clearAiMarks();
              setStatus("AI marks cleared. The words stay.");
            }}
          >
            Clear AI marks
          </button>
          <button className="rail-btn" onClick={killDashesNow}>
            Kill em dashes
          </button>
          <h2 style={{ marginTop: 28 }}>Kokoro</h2>
          <p className="kit" style={{ paddingLeft: 0 }}>
            Reads the page out loud. Synthesis runs in a background worker so the studio does not freeze. Selection first if you have one.
          </p>
          <select
            className="voice-select"
            value={settings.kokoroVoice}
            onChange={(e) => void patchSettings({ kokoroVoice: e.target.value })}
          >
            {KOKORO_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
            {!KOKORO_VOICES.some((v) => v.id === settings.kokoroVoice) && settings.kokoroVoice && (
              <option value={settings.kokoroVoice}>{settings.kokoroVoice}</option>
            )}
          </select>
          <div className="toggles" style={{ padding: 0, margin: "10px 0" }}>
            {([0.85, 1, 1.15] as const).map((spd) => (
              <button
                key={spd}
                className={settings.kokoroSpeed === spd ? "active" : ""}
                onClick={() => void patchSettings({ kokoroSpeed: spd })}
              >
                {spd === 0.85 ? "slow" : spd === 1 ? "pace" : "fast"}
              </button>
            ))}
          </div>
          {kokoroBusy ? (
            <button className="rail-btn" onClick={haltKokoro}>
              Stop reading
            </button>
          ) : (
            <>
              <button className="rail-btn" onClick={() => void listenNow()}>
                Listen to page
              </button>
              <button className="rail-btn" disabled={!sel?.text} onClick={() => void listenNow(sel?.text)}>
                Listen to selection
              </button>
            </>
          )}
          <p className="kit" style={{ paddingLeft: 0, marginTop: 10 }}>
            Gold on the page is what the model wrote. HL is your highlighter. AI on the type bar hides the gold. Em dash is the AI tell. Kill it.
          </p>
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
            </>
          )}
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
              <button onClick={killDashesNow}>Em dash</button>
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
              <button className={settings.reasoning ? "active" : ""} onClick={() => void patchSettings({ reasoning: !settings.reasoning })}>
                Reasoning {settings.reasoning ? "on" : "off"}
              </button>
              {isOllamaProvider(settings.provider) && (
                <button onClick={() => void syncOllama(settings)}>Sync Ollama models</button>
              )}
            </div>
            <p className="lead" style={{ marginTop: 10 }}>
              Reasoning off asks thinking models (GLM, Qwen 3, DeepSeek, gpt-oss on Ollama) to answer straight away. On lets them
              think first: slower, and the trace eats into the reply budget. Off is right for Flow and Workshop.
            </p>
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
                placeholder="Or paste the brief here. Notion, email, the whole assignment…"
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

      {logsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setLogsOpen(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Logs</h3>
            <p className="lead">
              Export what you want to keep. Delete what you don’t. Pages stay unless you empty the archive.
            </p>
            <div className="log-block">
              <h4>This Workshop chat</h4>
              <p>
                {(activeDoc?.workshop?.length ?? liveWorkshop?.length ?? 0)} turn
                {(activeDoc?.workshop?.length ?? liveWorkshop?.length ?? 0) === 1 ? "" : "s"} on this page
              </p>
              <div className="toggles" style={{ padding: "8px 0 0" }}>
                <button className="active" onClick={() => void exportThisChat()}>
                  Export this chat
                </button>
                <button onClick={clearThisChat}>Delete this chat</button>
              </div>
            </div>
            <div className="log-block">
              <h4>Every Workshop chat</h4>
              <p>
                {workshopCount(docs)} chat{workshopCount(docs) === 1 ? "" : "s"} · {turnCount(docs)} turns
              </p>
              <div className="toggles" style={{ padding: "8px 0 0" }}>
                <button className="active" onClick={() => void exportAllChats()}>
                  Export all chats
                </button>
                <button onClick={deleteAllChats}>Delete all chats</button>
              </div>
            </div>
            <div className="log-block">
              <h4>Pages</h4>
              <p>
                {docs.filter((d) => !d.archivedAt).length} live · {docs.filter((d) => d.archivedAt).length} archived
              </p>
              <div className="toggles" style={{ padding: "8px 0 0" }}>
                <button onClick={() => void exportPages()}>Export live pages</button>
                <button onClick={() => void exportArchive()}>Export archive</button>
                <button onClick={emptyArchive}>Delete all archived</button>
              </div>
            </div>
            <div className="toggles">
              <button onClick={() => setLogsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(e) => {
          const list = e.target.files;
          e.target.value = "";
          if (!list || !list.length) return;
          void filesFromList(list).then((files) => learnVoice(files, "folder"));
        }}
      />
    </div>
  );
}
