use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct PiState(Mutex<Option<PiProc>>);
struct PiProc { child: Child, stdin: ChildStdin }

#[derive(Clone, Serialize)]
struct PiEvent { raw: String }

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with('-') && (a.ends_with(".md") || a.ends_with(".txt")))
}

fn pi_binary() -> String {
    if let Ok(p) = std::env::var("PI_BIN") { return p; }
    let home = std::env::var("HOME").unwrap_or_default();
    for cand in [format!("{home}/.pi/agent/bin/pi"), format!("{home}/.npm-global/bin/pi"), "/opt/homebrew/bin/pi".into(), "/usr/local/bin/pi".into()] {
        if std::path::Path::new(&cand).exists() { return cand; }
    }
    "pi".into()
}

#[tauri::command]
fn pi_start(app: AppHandle, state: State<PiState>, cwd: String, provider: String, model: String, api_key: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut old) = guard.take() { let _ = old.child.kill(); }
    let mut cmd = Command::new(pi_binary());
    cmd.args(["--mode", "rpc", "--no-session"]).current_dir(&cwd)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if !provider.is_empty() { cmd.args(["--provider", &provider]); }
    if !model.is_empty() { cmd.args(["--model", &model]); }
    if !api_key.is_empty() {
        // pi reads provider keys from env; map common providers, default to provider-specific name
        let env_name = match provider.as_str() {
            "anthropic" => "ANTHROPIC_API_KEY",
            "openai" => "OPENAI_API_KEY",
            "google" => "GEMINI_API_KEY",
            "groq" => "GROQ_API_KEY",
            "openrouter" => "OPENROUTER_API_KEY",
            "xai" => "XAI_API_KEY",
            "mistral" => "MISTRAL_API_KEY",
            _ => "ANTHROPIC_API_KEY",
        };
        cmd.env(env_name, &api_key);
    }
    let mut child = cmd.spawn().map_err(|e| format!("failed to start pi ({e}) — is pi installed? https://pi.dev"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => { let _ = app.emit("pi-event", PiEvent { raw: l }); }
                _ => break,
            }
        }
        let _ = app.emit("pi-event", PiEvent { raw: "{\"type\":\"pi_exited\"}".into() });
    });
    *guard = Some(PiProc { child, stdin });
    Ok(())
}

fn pi_send(state: &State<PiState>, obj: serde_json::Value) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let proc = guard.as_mut().ok_or("pi not started — open Settings, choose a model, and Connect")?;
    writeln!(proc.stdin, "{}", obj.to_string()).map_err(|e| e.to_string())?;
    proc.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
fn pi_prompt(state: State<PiState>, message: String) -> Result<(), String> {
    pi_send(&state, serde_json::json!({"id":"w1","type":"prompt","message": message}))
}
#[tauri::command]
fn pi_abort(state: State<PiState>) -> Result<(), String> {
    pi_send(&state, serde_json::json!({"type":"abort"}))
}
#[tauri::command]
fn pi_models(state: State<PiState>) -> Result<(), String> {
    pi_send(&state, serde_json::json!({"id":"models","type":"get_available_models"}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PiState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_file, write_file, initial_file, pi_start, pi_prompt, pi_abort, pi_models])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
