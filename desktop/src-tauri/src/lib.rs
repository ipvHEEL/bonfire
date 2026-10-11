use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW: &str = "main";
// Встроенная страница выбора сервера. На Windows Tauri раздаёт свои файлы
// с этого адреса
const SETUP_URL: &str = "http://tauri.localhost/index.html";

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    // Адрес сервера Bonfire, например https://192.168.1.13:8443/
    server: Option<String>,
}

struct AppState(Mutex<Settings>);

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("Не найдена папка настроек")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Приводит введённый адрес к виду https://хост:порт/
fn normalize_server(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Введите адрес сервера".into());
    }
    let with_scheme = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let url = Url::parse(&with_scheme).map_err(|_| "Не похоже на адрес сервера".to_string())?;
    // Микрофон для звонков браузер даёт только защищённым страницам
    if url.scheme() != "https" {
        return Err("Адрес должен начинаться с https://".into());
    }
    if url.host_str().is_none() {
        return Err("Не похоже на адрес сервера".into());
    }
    let origin = url.origin().ascii_serialization();
    Url::parse(&format!("{origin}/")).map_err(|e| e.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_setup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if let Ok(url) = Url::parse(SETUP_URL) {
            let _ = window.navigate(url);
        }
    }
    show_main_window(app);
}

/// Окно пускаем только на свой сервер и встроенную страницу настройки.
/// Остальные ссылки открываем в обычном браузере: чужой сайт внутри
/// клиента получил бы доступ к уведомлениям
fn is_allowed_navigation(app: &AppHandle, url: &Url) -> bool {
    if url.scheme() == "about" || url.host_str() == Some("tauri.localhost") {
        return true;
    }
    let server = app
        .state::<AppState>()
        .0
        .lock()
        .ok()
        .and_then(|settings| settings.server.clone())
        .and_then(|server| Url::parse(&server).ok());
    if let Some(server) = server {
        if server.origin() == url.origin() {
            return true;
        }
    }
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    false
}

#[tauri::command]
fn get_server(state: tauri::State<AppState>) -> Option<String> {
    state.0.lock().ok().and_then(|settings| settings.server.clone())
}

#[tauri::command]
fn set_server(app: AppHandle, state: tauri::State<AppState>, server: String) -> Result<String, String> {
    let url = normalize_server(&server)?;
    {
        let mut settings = state.0.lock().map_err(|e| e.to_string())?;
        settings.server = Some(url.to_string());
        save_settings(&app, &settings)?;
    }
    let window = app.get_webview_window(MAIN_WINDOW).ok_or("Окно не найдено")?;
    window.navigate(url.clone()).map_err(|e| e.to_string())?;
    Ok(url.to_string())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть Bonfire", true, None::<&str>)?;
    let server = MenuItem::with_id(app, "server", "Сменить сервер…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &server, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Bonfire")
        .menu(&menu)
        // Левый клик открывает окно, меню — по правому
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "server" => open_setup(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Должен быть первым: второй запуск не создаёт окно, а показывает уже открытое
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_server, set_server])
        .setup(|app| {
            let settings = load_settings(app.handle());
            let start = match settings.server.as_deref().and_then(|s| Url::parse(s).ok()) {
                Some(url) => WebviewUrl::External(url),
                None => WebviewUrl::App("index.html".into()),
            };
            app.manage(AppState(Mutex::new(settings)));

            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, MAIN_WINDOW, start)
                .title("Bonfire")
                .inner_size(1100.0, 720.0)
                .min_inner_size(480.0, 520.0)
                .on_navigation(move |url| is_allowed_navigation(&handle, url))
                .build()?;

            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Крестик прячет окно в трей: звонки и уведомления продолжают приходить
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить Bonfire");
}
