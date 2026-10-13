import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { vim, Vim } from "@replit/codemirror-vim";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

const $ = (s: string) => document.querySelector(s) as HTMLElement;
let currentPath: string | null = null;
let vimOn = localStorage.getItem("write:vim") !== "off";
let pendingReplace: { from: number; to: number; text: string } | null = null;
let streaming = "";
let currentAction = "";

const cfg = {
  provider: localStorage.getItem("write:provider") || "anthropic",
  model: localStorage.getItem("write:model") || "",
  key: localStorage.getItem("write:key") || "",
};
($("#cfg-provider") as HTMLInputElement).value = cfg.provider;
($("#cfg-model") as HTMLInputElement).value = cfg.model;
($("#cfg-key") as HTMLInputElement).value = cfg.key;

function applyThemeLabel() {
  const t = localStorage.getItem("write:theme") || "auto";
  document.documentElement.dataset.theme = t === "auto" ? "" : t;
  $("#theme-label").textContent = `theme: ${t}`;
}
applyThemeLabel();

function updateCounts() {
  const text = view.state.doc.toString();
  $("#wordcount").textContent = `${text.trim() ? text.trim().split(/\s+/).length : 0} words`;
  $("#doc-title").textContent = currentPath ? currentPath.split("/").pop()! : "Untitled";
}

const view = new EditorView({
  parent: $("#editor"),
  state: EditorState.create({
    doc: "# Start writing\n\nSelect any passage and press Cmd+K — reword it, tighten it, make the argument stronger.\n",
    extensions: [
      ...(vimOn ? [vim()] : []),
      history(), markdown(), EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of(u => { if (u.docChanged) updateCounts(); }),
    ],
  }),
});
updateCounts();
($("#btn-vim") as HTMLElement).textContent = `Vim: ${vimOn ? "on" : "off"}`;

// Vim :w
try { (Vim as any).defineEx?.("write", "w", () => saveFile()); } catch {}

async function openPath(path: string) {
  const text = await invoke<string>("read_file", { path });
  currentPath = path;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  updateCounts();
  await connectPi();
}
async function openFile() {
  const p = await openDialog({ filters: [{ name: "Writing", extensions: ["md", "txt"] }] });
  if (typeof p === "string") openPath(p);
}
async function saveFile() {
  if (!currentPath) {
    const p = await saveDialog({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (!p) return; currentPath = p;
  }
  await invoke("write_file", { path: currentPath, contents: view.state.doc.toString() });
  $("#status").textContent = "saved";
  setTimeout(() => ($("#status").textContent = ""), 1500);
  updateCounts();
}

async function connectPi() {
  cfg.provider = ($("#cfg-provider") as HTMLInputElement).value.trim();
  cfg.model = ($("#cfg-model") as HTMLInputElement).value.trim();
  cfg.key = ($("#cfg-key") as HTMLInputElement).value;
  localStorage.setItem("write:provider", cfg.provider);
  localStorage.setItem("write:model", cfg.model);
  localStorage.setItem("write:key", cfg.key);
  const cwd = currentPath ? currentPath.slice(0, currentPath.lastIndexOf("/")) : (await homeDir());
  $("#connect-status").textContent = "starting pi…";
  try {
    await invoke("pi_start", { cwd, provider: cfg.provider, model: cfg.model, apiKey: cfg.key });
    $("#connect-status").textContent = `pi connected (${cfg.provider}${cfg.model ? " / " + cfg.model : ""})`;
    $("#status").textContent = "pi ready";
  } catch (e) { $("#connect-status").textContent = String(e); }
}
async function homeDir(): Promise<string> { return "."; }

const PROMPTS: Record<string, (sel: string, doc: string) => string> = {
  reword: sel => `Reword the following passage. Return ONLY the reworded text, no preamble or quotes:\n\n${sel}`,
  tighten: sel => `Tighten the following passage — cut words, keep meaning and voice. Return ONLY the revised text:\n\n${sel}`,
  stronger: sel => `Make the argument in the following passage stronger and more persuasive, keeping the author's voice. Return ONLY the revised text:\n\n${sel}`,
  critique: sel => `Critique the following passage: what could make the argument better? Be specific and concise. Do NOT rewrite it.\n\n${sel}`,
  continue: sel => `Continue writing naturally from the following passage, in the same voice, for one paragraph. Return ONLY the continuation:\n\n${sel}`,
};

function showAiBar() { if (view.state.selection.main.from !== view.state.selection.main.to) $("#ai-bar").classList.remove("hidden"); }
function runAction(action: string, custom?: string) {
  const sel = view.state.selection.main;
  const text = view.state.doc.sliceString(sel.from, sel.to) || view.state.doc.sliceString(Math.max(0, sel.from - 500), sel.from);
  currentAction = action; streaming = ""; pendingReplace = null;
  $("#ai-panel").classList.remove("hidden"); $("#ai-bar").classList.add("hidden");
  $("#ai-action").textContent = action; $("#ai-output").textContent = "thinking…";
  $("#ai-accept").classList.add("hidden"); $("#ai-reject").classList.add("hidden");
  const msg = custom ? `${custom}\n\nPassage:\n${text}` : PROMPTS[action](text, view.state.doc.toString());
  invoke("pi_prompt", { message: msg }).catch(e => { $("#ai-output").textContent = String(e); });
}

document.querySelectorAll("#ai-bar button[data-action]").forEach(b =>
  b.addEventListener("click", () => runAction((b as HTMLElement).dataset.action!)));
($("#ai-custom") as HTMLInputElement).addEventListener("keydown", e => {
  if (e.key === "Enter") runAction("custom", (e.target as HTMLInputElement).value);
});
$("#ai-accept").addEventListener("click", () => {
  if (pendingReplace) view.dispatch({ changes: pendingReplace });
  $("#ai-panel").classList.add("hidden");
});
$("#ai-reject").addEventListener("click", () => $("#ai-panel").classList.add("hidden"));
$("#ai-close").addEventListener("click", () => $("#ai-panel").classList.add("hidden"));
$("#ai-abort").addEventListener("click", () => invoke("pi_abort"));
$("#btn-open").addEventListener("click", openFile);
$("#btn-save").addEventListener("click", saveFile);
$("#btn-settings").addEventListener("click", () => $("#settings").classList.toggle("hidden"));
$("#btn-connect").addEventListener("click", connectPi);
$("#btn-models").addEventListener("click", () => { $("#ai-panel").classList.remove("hidden"); $("#ai-output").textContent = "asking pi for models…"; invoke("pi_models").catch(e => $("#ai-output").textContent = String(e)); });
$("#btn-help").addEventListener("click", () => $("#help").classList.toggle("hidden"));
$("#btn-theme").addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  const next = order[(order.indexOf(localStorage.getItem("write:theme") || "auto") + 1) % 3];
  localStorage.setItem("write:theme", next); applyThemeLabel();
});
$("#btn-vim").addEventListener("click", () => {
  vimOn = !vimOn; localStorage.setItem("write:vim", vimOn ? "on" : "off");
  alert("Vim " + (vimOn ? "enabled" : "disabled") + " — takes effect on next launch (or reload).");
});

window.addEventListener("keydown", e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "s") { e.preventDefault(); saveFile(); }
  if (mod && e.key === "o") { e.preventDefault(); openFile(); }
  if (mod && e.key === "k") { e.preventDefault(); showAiBar(); }
  if (mod && e.key === "/") { e.preventDefault(); $("#help").classList.toggle("hidden"); }
  if (e.key === "Escape") { $("#ai-bar").classList.add("hidden"); $("#help").classList.add("hidden"); }
});
view.dom.addEventListener("mouseup", showAiBar);

listen<{ raw: string }>("pi-event", ev => {
  try {
    const rec = JSON.parse(ev.payload.raw);
    if (rec.type === "message_update" && rec.assistantMessageEvent?.type === "text_delta") {
      if ($("#ai-output").textContent === "thinking…") $("#ai-output").textContent = "";
      streaming += rec.assistantMessageEvent.delta;
      $("#ai-output").textContent = streaming;
    }
    if (rec.type === "response" && rec.command === "get_available_models") {
      $("#ai-output").textContent = JSON.stringify(rec.data, null, 2).slice(0, 6000);
    }
    if (rec.type === "agent_settled" && streaming) {
      const sel = view.state.selection.main;
      if (currentAction !== "critique") {
        pendingReplace = currentAction === "continue"
          ? { from: sel.to, to: sel.to, text: " " + streaming.trim() }
          : { from: sel.from, to: sel.to, text: streaming.trim() };
        $("#ai-accept").classList.remove("hidden"); $("#ai-reject").classList.remove("hidden");
        $("#ai-accept").textContent = currentAction === "continue" ? "✓ Insert continuation" : "✓ Replace selection";
      }
      streaming = "";
    }
    if (rec.type === "pi_exited") $("#status").textContent = "pi exited — reconnect in Model settings";
  } catch {}
});

invoke<string | null>("initial_file").then(p => { if (p) openPath(p); });
