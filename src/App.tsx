import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ASSESSMENT_HTML } from "./data/assessment";
import { FlowGhost } from "./extensions/flowGhost";
import { scanCompliance, SUPERPOWER_ANCHORS, SUPERPOWER_STATS, type GuardHit } from "./lib/compliance";
import { exportWord } from "./lib/docx";
import {
  DEFAULT_SETTINGS,
  defaultModelFor,
  flowContinue,
  hasKey,
  polishSentence,
  transform,
  type Settings,
} from "./lib/llm";
import { PROVIDERS, type ProviderId } from "./lib/providers";
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
  type DocRecord,
} from "./lib/storage";

const QUICK = [
  { label: "Tighten", prompt: "Tighten this copy. Keep the voice. Cut fat. No preamble." },
  { label: "Sharper", prompt: "Make this punchier and more specific. No slogans. No preamble." },
  { label: "Human", prompt: "Rewrite so it sounds like a person wrote it for a person. Kill marketing fog." },
  { label: "Guard", prompt: "Rewrite to Superpower compliance. Biomarkers not lab tests. Care team not medical team. No prevent/cure/treat/diagnose. Keep the heat." },
];

function inTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function win() {
  if (!inTauri()) return null;
  return getCurrentWindow();
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [status, setStatus] = useState("Flow is waiting.");
  const [error, setError] = useState("");
  const [hits, setHits] = useState<GuardHit[]>([]);
  const [palette, setPalette] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<{ x: number; y: number; text: string } | null>(null);
  const flowTimer = useRef<number | null>(null);
  const polishTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "The sentence starts. Flow finishes it." }),
      CharacterCount,
      FlowGhost,
    ],
    content: ASSESSMENT_HTML,
    onUpdate: ({ editor: ed }) => {
      const text = ed.getText();
      setHits(settingsRef.current.brandKit === "superpower" ? scanCompliance(text) : []);
      if (flowTimer.current) window.clearTimeout(flowTimer.current);
      ed.commands.clearFlowGhost();
      flowTimer.current = window.setTimeout(() => void runFlow(ed.getText()), 700);
      maybePolish(text);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      if (from === to) {
        setSel(null);
        return;
      }
      const text = ed.state.doc.textBetween(from, to, " ");
      const coords = ed.view.coordsAtPos(from);
      const rect = ed.view.dom.getBoundingClientRect();
      setSel({ x: coords.left - rect.left + 28, y: coords.top - rect.top + 18, text });
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
            title: "You're Fine. — Superpower assessment",
            html: ASSESSMENT_HTML,
            updatedAt: Date.now(),
          },
          {
            id: newId(),
            title: "Blank page",
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
      editor?.commands.setContent(current.html, { emitUpdate: false });
      setHits(loaded.brandKit === "superpower" ? scanCompliance(editor?.getText() ?? current.title) : []);
    })();
    // editor is created once
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    const t = window.setInterval(() => {
      void persist(snapshot());
    }, 2500);
    return () => window.clearInterval(t);
  }, [persist, snapshot]);

  async function runFlow(text: string) {
    const s = settingsRef.current;
    if (s.flow === "off" || !hasKey(s) || !editor) return;
    if (busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError("");
    setStatus("Flow is drafting…");
    try {
      let acc = "";
      await flowContinue(s, text, (chunk) => {
        acc += chunk;
        editor.commands.setFlowGhost(acc.replace(/\s+/g, " ").replace(/^[\s,.;:]+/, ""));
      });
      setStatus(acc.trim() ? "Tab to keep the line. Esc to dismiss." : "Flow is listening.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("Flow paused.");
    }
  }

  function maybePolish(text: string) {
    const s = settingsRef.current;
    if (!s.autoCorrect || !hasKey(s)) return;
    if (!/[.!?]$/.test(text.trim())) return;
    if (polishTimer.current) window.clearTimeout(polishTimer.current);
    polishTimer.current = window.setTimeout(() => void runPolish(text), 900);
  }

  async function runPolish(text: string) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const last = sentences[sentences.length - 1]?.trim();
    if (!last || last.length < 18 || !editor) return;
    try {
      const next = await polishSentence(settingsRef.current, last);
      if (!next) return;
      setStatus(`Corrected: ${next}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    setBusy(true);
    setError("");
    setStatus("Writing…");
    const selected = source ?? editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ");
    try {
      const out = await transform(s, instruction, selected || editor.getText().slice(-2000));
      const html = `<p>${out
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n\n/g, "</p><p>")
        .replace(/\n/g, "<br>")}</p>`;
      const chain = editor.chain().focus();
      if (selected) chain.deleteSelection();
      chain.insertContent(html).run();
      editor.commands.clearFlowGhost();
      setStatus("In the page.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPalette(false);
      setSel(null);
    }
  }

  function openDoc(id: string) {
    const next = snapshot();
    const doc = next.find((d) => d.id === id);
    if (!doc || !editor) return;
    void persist(next, id);
    setActiveId(id);
    editor.commands.setContent(doc.html, { emitUpdate: false });
  }

  function createDoc() {
    const nextDocs = snapshot();
    const doc: DocRecord = { id: newId(), title: "Untitled", html: "<p></p>", updatedAt: Date.now() };
    void persist([doc, ...nextDocs], doc.id);
    setActiveId(doc.id);
    editor?.commands.setContent("<p></p>", { emitUpdate: false });
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
      if (meta && e.key.toLowerCase() === "e" && sel?.text) {
        e.preventDefault();
        void runTransform("Tighten this copy. Keep voice. No preamble.", sel.text);
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const words = editor?.storage.characterCount?.words?.() ?? editor?.getText().split(/\s+/).filter(Boolean).length ?? 0;
  const provider = useMemo(() => PROVIDERS.find((p) => p.id === settings.provider)!, [settings.provider]);
  const blocks = hits.filter((h) => h.severity === "block");

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
          <select value={settings.model} onChange={(e) => void patchSettings({ model: e.target.value })}>
            {[settings.model, ...provider.models.filter((m) => m !== settings.model)].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={() => setPalette(true)}>
            Prompt ⌘K
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

      <div className="workspace">
        <aside className="rail">
          <h2>Pieces</h2>
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
          <h2 style={{ marginTop: 28 }}>Flow</h2>
          <div className="toggles" style={{ padding: 0 }}>
            {(["off", "light", "full"] as const).map((mode) => (
              <button
                key={mode}
                className={settings.flow === mode ? "active" : ""}
                onClick={() => void patchSettings({ flow: mode })}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="kit" style={{ paddingLeft: 0, marginTop: 12 }}>
            Ghost text arrives when you pause. Tab keeps the line. Prompt bar inserts a rewrite or a new block. Auto-correct waits for the period.
          </p>
        </aside>

        <main className="stage">
          {sel && (
            <div className="selbar" style={{ left: sel.x, top: sel.y }}>
              {QUICK.map((q) => (
                <button key={q.label} onClick={() => void runTransform(q.prompt, sel.text)}>
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="paper">
            <EditorContent editor={editor} />
          </div>
          <div className="status">
            <span>
              {error ? <span className="err">{error}</span> : status}{" "}
              {!hasKey(settings) && <b> · add a key to unlock Flow</b>}
            </span>
            <span>
              {words} words
              {settings.brandKit === "superpower" && (
                <>
                  {" "}
                  · Guard {blocks.length === 0 ? <b>clear</b> : <span className="err">{blocks.length} block</span>}
                </>
              )}
            </span>
          </div>
        </main>

        <aside className="guard">
          <h2>Superpower Guard</h2>
          <div className="toggles" style={{ padding: 0, marginBottom: 12 }}>
            <button className={settings.brandKit === "superpower" ? "active" : ""} onClick={() => void patchSettings({ brandKit: "superpower" })}>
              On
            </button>
            <button className={settings.brandKit === "none" ? "active" : ""} onClick={() => void patchSettings({ brandKit: "none" })}>
              Off
            </button>
          </div>
          {settings.brandKit === "none" ? (
            <p className="kit" style={{ paddingLeft: 0 }}>
              Guard is off. Flow will match your voice with no health rails.
            </p>
          ) : hits.length === 0 ? (
            <div className="ok-banner">No auto-reject language on the page. Punchy because of the rails, not despite them.</div>
          ) : (
            hits.map((h, i) => (
              <div key={`${h.phrase}-${i}`} className={`hit ${h.severity}`}>
                <div className="phrase">{h.severity === "block" ? "Never say" : "Check"} · {h.phrase}</div>
                <div className="instead">Say instead: {h.instead}</div>
              </div>
            ))
          )}
          <h2 style={{ marginTop: 22 }}>Approved stats</h2>
          <ul className="kit">
            {SUPERPOWER_STATS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h2 style={{ marginTop: 18 }}>Anchors</h2>
          <ul className="kit">
            {SUPERPOWER_ANCHORS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
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
            <p className="lead">Nothing leaves this machine except the request you send to the provider you pick. Ollama needs no key.</p>
            {PROVIDERS.map((p) => (
              <div className="provider-row" key={p.id}>
                <label>{p.name}</label>
                <input
                  type="password"
                  placeholder={p.placeholder}
                  defaultValue={settings.keys[p.id] ?? ""}
                  onBlur={(e) => void patchSettings(setProviderKey(settings, p.id, e.target.value.trim()))}
                />
              </div>
            ))}
            <div className="provider-row">
              <label>Custom base URL</label>
              <input
                defaultValue={settings.customBaseUrl}
                onBlur={(e) => void patchSettings({ customBaseUrl: e.target.value.trim() })}
              />
            </div>
            <div className="toggles">
              <button className={settings.autoCorrect ? "active" : ""} onClick={() => void patchSettings({ autoCorrect: !settings.autoCorrect })}>
                Auto-correct {settings.autoCorrect ? "on" : "off"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
