# CopyWritePrime

A desktop writing studio that stays in the sentence with you.

You type messy. **Flow** waits for the pause, fixes the line, lifts it, then ghosts the next words. **Tab** keeps them. **⌘K** drops a prompt on the page. **Scan** a paper — PDF, Word, or paste — and **Complete** writes the submission onto the page. Bold, italic, underline, headings, and type size sit on the bar. One click exports **Word**.

Bring your own keys. OpenAI, Anthropic, Gemini, Groq, xAI, Mistral, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, **Ollama local**, **Ollama Cloud**, and any OpenAI-compatible endpoint. Keys live in local Tauri store. Not our servers — there are no servers.

## Flow

- **Enhance** (default) — pause, then the last line is fixed and sharpened in place. Ghost text continues the thought.
- **Write** — pause, then typos get cleaned. Ghost text continues in your voice.
- **Off** — no ghost. Auto-fix can still clean the last line.
- **Fix last line** / **Enhance last paragraph** — run it now, no waiting.

Type bar: **B I U**, H1 / H2 / Body, Auto / S / M / L / XL / Title. Auto sizes the page to the window.

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
git tag v0.3.0
git push origin v0.3.0
```

GitHub Actions builds Windows, macOS (Intel + Apple Silicon), and Linux.

## Shortcuts

| Key | Action |
| --- | --- |
| Tab | Accept Flow ghost text |
| Triple-click / Alt+click | Select the sentence |
| Esc | Dismiss ghost / overlays |
| ⌘/Ctrl B I U | Bold / italic / underline |
| ⌘/Ctrl K | Prompt bar |
| ⌘/Ctrl E | Enhance selection |
| ⌘/Ctrl S | Save |
| ⌘/Ctrl P | Export Word |
