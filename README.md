# CopyWritePrime

A desktop writing studio that stays in the sentence with you.

Ghost-text **Flow** finishes the line when you pause. **Tab** keeps it. **⌘K** drops a prompt on the page. Superpower **Guard** flags the language that gets a health brand auto-rejected. One click exports **Word**.

Bring your own keys. OpenAI, Anthropic, Gemini, Groq, xAI, Mistral, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, **Ollama local**, **Ollama Cloud**, and any OpenAI-compatible endpoint. Keys live in local Tauri store. Not our servers — there are no servers.

## Ollama

Two integrations, same native `/api/chat` stream:

**Local.** Point at `http://127.0.0.1:11434` (or your LAN host). No key. `Sync` pulls whatever you have pulled. If you ran `ollama signin`, models tagged `-cloud` (example: `gpt-oss:120b-cloud`) offload through that signed-in local daemon.

**Cloud.** Key from [ollama.com/settings/keys](https://ollama.com/settings/keys). Talks to `https://ollama.com` directly — no local daemon. `Sync` lists the live cloud catalog. Type any model id in the picker (`gpt-oss:120b`, `kimi-k2.6`, `minimax-m3`, …).

## Run it

```bash
npm install
npm run tauri dev
```

Add a provider key under **Keys**. Flow needs a model.

Ollama local needs `ollama serve` running. Ollama Cloud needs a key; no local GPU.

## Build

```bash
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/`.

## Releases

Push a tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds Windows, macOS (Intel + Apple Silicon), and Linux via `tauri-apps/tauri-action`.

## Superpower assessment

Printable leave-behind (File → Print → Save as PDF, sharing set to anyone with the link if you paste into Docs):

`assessment/Aaron-Grace-Superpower-Copywriter-Assessment.html`

The same piece is the starter document inside the app, with Guard on.

## Shortcuts

| Key | Action |
| --- | --- |
| Tab | Accept Flow ghost text |
| Esc | Dismiss ghost / overlays |
| ⌘/Ctrl K | Prompt bar |
| ⌘/Ctrl E | Tighten selection |
| ⌘/Ctrl S | Save |
| ⌘/Ctrl P | Export Word |
