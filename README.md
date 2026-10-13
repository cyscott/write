# write

A simple, focused writing editor for macOS — powered by [pi](https://pi.dev).

Vim controls, light/dark/auto themes, a nice writing surface, and AI on your
selected text: highlight a passage, press **Cmd+K**, and *reword it*, *tighten
it*, *make the argument stronger*, get a *critique*, or *continue* — then
accept or discard the suggestion. Your prose is never changed silently.

## How it works

```
write.app (Tauri: Rust + system WebKit)
  └─ CodeMirror 6 editor (vim mode, themes)
  └─ spawns `pi --mode rpc`  ← JSONL over stdin/stdout
       └─ your provider + model, streaming back token-by-token
```

**Bring your own key:** open **⚙ Model**, pick a provider (e.g. `anthropic`,
`openai`, `google`, `openrouter`…), enter a model id and your API key, and
Connect. Keys are stored only in the app's local storage on your Mac and
passed to your local `pi` process as an environment variable. Leave the key
blank to reuse your existing `pi` login (`pi` / `/login`).

## Install

Requires [pi](https://pi.dev) and Node 22+.

```bash
git clone https://github.com/cyscott/write
cd write
npm install
npm run tauri build        # produces src-tauri/target/release/bundle/
```

Copy `write.app` to `/Applications`, then launch from the command line:

```bash
./bin/write ~/writing/my-essay.md    # or: write my-essay.md once installed
```

## Develop

```bash
npm run tauri dev
```

## Keys

Press **Cmd+/** (or the `? Keys` button) in the app for the full cheat sheet.

| Key | Action |
|---|---|
| `Cmd+K` | AI actions for the current selection |
| `Cmd+S` / `:w` | Save |
| `Cmd+O` | Open |
| `Cmd+/` | Hotkey cheat sheet |
| `Cmd+B` (toolbar) | Toggle Vim |

## License

MIT
