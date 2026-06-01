mod pty;

use pty::PtyManager;

#[tauri::command]
fn create_terminal(app: tauri::AppHandle, state: tauri::State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<String, String> {
    state.create_terminal(app, id, cols, rows)
}

#[tauri::command]
fn write_terminal(state: tauri::State<PtyManager>, id: String, data: Vec<u8>) -> Result<(), String> {
    state.write(&id, &data)
}

#[tauri::command]
fn resize_terminal(state: tauri::State<PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.resize(&id, cols, rows)
}

#[tauri::command]
fn close_terminal(state: tauri::State<PtyManager>, id: String) -> Result<(), String> {
    state.close(&id)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
