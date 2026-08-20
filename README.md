# CopyWritePrime

A desktop writing studio that stays in the sentence with you.

You type messy. **Flow** waits for the pause, fixes the line, lifts it, then ghosts the next words. **Tab** keeps them. **⌘K** drops a prompt on the page. **Scan** a paper — PDF, Word, or paste — and **Complete** writes the submission onto the page. **Workshop** argues the line without moving the page, and it can read what’s already written. Gold on the page is AI. **Clear & archive** files a finished page. One click exports **Word**: Times New Roman 12, double-spaced, 1-inch margins. Em dashes are stripped on the way out.

Bring your own keys. OpenAI, Anthropic, Gemini, Groq, xAI, Mistral, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, **Ollama local**, **Ollama Cloud**, and any OpenAI-compatible endpoint. Keys live in local Tauri store. Not our servers — there are no servers.

## Flow

- **Enhance** (default) — pause, then the last line is fixed and sharpened in place. Ghost text continues the thought.
- **Write** — pause, then typos get cleaned. Ghost text continues in your voice.
- **Off** — no ghost. Auto-fix can still clean the last line.
- **Fix last line** / **Enhance last paragraph** — run it now, no waiting.

Type bar: **B I U**, **HL** (your highlighter), **AI** (show/hide gold marks), H1 / H2 / Body, Auto / S / M / L / XL / Title. Auto sizes the page to the window. Gold wash is what Flow, Enhance, Complete, or Workshop dropped. **Clear AI marks** keeps the words and drops the gold. **Kill em dashes** (selbar or Flow rail) strips the AI tell off the page. Flow is banned from writing them.

## Pages

- **Clear page** — wipe the paper. The brief stays.
- **Archive this page** — hide it from Pages. Restore or delete it from Archive.
- **Clear & archive** — file the current page, open a blank one.

## Workshop

A copy chief in the right rail. It reads the page that’s already written — **On the page** shows you the same text. Ask about a line without moving the draft. **⌘J** opens it. Highlight a sentence and hit **Workshop** on the bar to bring that line in. **Drop on page** only when you want the rewrite. Dropped lines land in gold.

## Scan

Drop a take-home, brief, or RFP on the page — PDF, Word, `.txt`, `.md`, or paste. CopyWritePrime reads the paper, attaches it to the page, and can write the full submission in one pass. After that, Flow still has the brief, so edits stay on assignment.

- **Complete this paper** — stream the finished work onto the page.
- **Attach only** — keep the brief as project context. You write. Flow stays with you.

## Ollama

**Local.** Point at `http://127.0.0.1:11434`. No key. `Sync` pulls whatever you have pulled. If you ran `ollama signin`, models tagged `-cloud` offload through that signed-in local daemon.

**Cloud.** Key from [ollama.com/settings/keys](https://ollama.com/settings/keys). Talks to `https://ollama.com` directly. The model dropdown ships the full cloud catalog. `Sync` refreshes it live; a key is only required to write.

## Run it

```bash
npm install
npm run tauri dev
```

Add a provider key under **Keys**. Flow needs a model.

## Build

```bash
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/`.

## Releases

```bash
git tag v0.5.1
git push origin v0.5.1
```

GitHub Actions builds Windows, macOS (Intel + Apple Silicon), and Linux.

## Shortcuts

| Key | Action |
| --- | --- |
| Tab | Accept Flow ghost text |
| Triple-click / Alt+click | Select the sentence |
| Esc | Dismiss ghost / overlays |
| ⌘/Ctrl B I U | Bold / italic / underline |
| HL / AI | Highlighter / show AI gold |
| ⌘/Ctrl J | Open Workshop |
| ⌘/Ctrl E | Enhance selection |
| ⌘/Ctrl S | Save |
| ⌘/Ctrl P | Export Word |
