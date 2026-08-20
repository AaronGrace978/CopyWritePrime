# CopyWritePrime

A desktop writing studio that stays in the sentence with you.

Ghost-text **Flow** finishes the line when you pause. **Tab** keeps it. **⌘K** drops a prompt on the page. Superpower **Guard** flags the language that gets a health brand auto-rejected. One click exports **Word**.

Bring your own keys. OpenAI, Anthropic, Gemini, Groq, xAI, Mistral, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, Cohere, Ollama, and any OpenAI-compatible endpoint. Keys live in local Tauri store. Not our servers — there are no servers.

## Run it

```bash
npm install
npm run tauri dev
```

Add a provider key under **Keys**. Flow needs a model. Ollama does not need a key if `ollama serve` is running.

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
