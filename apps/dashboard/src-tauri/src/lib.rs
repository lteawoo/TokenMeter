mod codex;
mod commands;

use tauri::{
  menu::MenuBuilder,
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Runtime, Size,
  WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const DASHBOARD_WINDOW_LABEL: &str = "dashboard";
const TRAY_ID: &str = "tokenmeter-tray";
const MENU_OPEN_DASHBOARD: &str = "open-dashboard";
const MENU_REFRESH_DASHBOARD: &str = "refresh-dashboard";
const MENU_QUIT_APP: &str = "quit-app";
const PANEL_WIDTH: f64 = 352.0;
const PANEL_HEIGHT: f64 = 332.0;
const PANEL_OFFSET_Y: f64 = 10.0;

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
  app.get_webview_window(MAIN_WINDOW_LABEL)
}

fn dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
  app.get_webview_window(DASHBOARD_WINDOW_LABEL)
}

fn configure_main_window<R: Runtime>(app: &AppHandle<R>) {
  let Some(window) = main_window(app) else {
    return;
  };

  let _ = window.set_decorations(false);
  let _ = window.set_always_on_top(true);
  let _ = window.set_skip_taskbar(true);
  let _ = window.set_shadow(true);
  let _ = window.set_size(LogicalSize::new(PANEL_WIDTH, PANEL_HEIGHT));
  let _ = window.hide();

  if let Ok(mut url) = window.url() {
    if url.query() != Some("view=panel") {
      url.set_query(Some("view=panel"));
      let _ = window.navigate(url);
    }
  }
}

pub(crate) fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = dashboard_window(app) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    return;
  }

  let Ok(window) = WebviewWindowBuilder::new(
    app,
    DASHBOARD_WINDOW_LABEL,
    WebviewUrl::App("index.html?view=dashboard".into()),
  )
  .title("TokenMeter Dashboard")
  .inner_size(1200.0, 820.0)
  .min_inner_size(960.0, 680.0)
  .resizable(true)
  .focused(true)
  .build() else {
    return;
  };

  let _ = window.show();
  let _ = window.set_focus();
}

fn toggle_or_show_main_window_at_tray<R: Runtime>(
  app: &AppHandle<R>,
  tray_position: Position,
  tray_size: Size,
) {
  let Some(window) = main_window(app) else {
    return;
  };

  let is_visible = window.is_visible().unwrap_or(false);
  let is_focused = window.is_focused().unwrap_or(false);
  if is_visible && is_focused {
    let _ = window.hide();
    return;
  }

  let _ = window.set_size(LogicalSize::new(PANEL_WIDTH, PANEL_HEIGHT));

  let outer_size = window.outer_size().ok();
  let window_width = outer_size
    .map(|size| size.width as f64)
    .unwrap_or(PANEL_WIDTH);

  let (tray_x, tray_y) = match tray_position {
    Position::Physical(position) => (position.x, position.y),
    Position::Logical(position) => (position.x as i32, position.y as i32),
  };
  let (tray_width, tray_height) = match tray_size {
    Size::Physical(size) => (size.width, size.height),
    Size::Logical(size) => (size.width as u32, size.height as u32),
  };

  let x = (f64::from(tray_x) + (f64::from(tray_width) / 2.0) - (window_width / 2.0)).round()
    as i32;
  let y = (f64::from(tray_y) + f64::from(tray_height) + PANEL_OFFSET_Y).round() as i32;

  let _ = window.set_position(PhysicalPosition::new(x, y));
  let _ = window.show();
  let _ = window.set_focus();
}

fn refresh_dashboard<R: Runtime>(app: &AppHandle<R>) {
  for label in [MAIN_WINDOW_LABEL, DASHBOARD_WINDOW_LABEL] {
    if let Some(window) = app.get_webview_window(label) {
      let _ = window.eval("window.location.reload()");
    }
  }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
  let menu = MenuBuilder::new(app)
    .text(MENU_OPEN_DASHBOARD, "Open Dashboard")
    .text(MENU_REFRESH_DASHBOARD, "Refresh")
    .separator()
    .text(MENU_QUIT_APP, "Quit TokenMeter")
    .build()?;

  let mut tray = TrayIconBuilder::with_id(TRAY_ID)
    .menu(&menu)
    .tooltip("TokenMeter")
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id().0.as_str() {
      MENU_OPEN_DASHBOARD => show_dashboard_window(app),
      MENU_REFRESH_DASHBOARD => refresh_dashboard(app),
      MENU_QUIT_APP => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        rect,
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        toggle_or_show_main_window_at_tray(
          tray.app_handle(),
          rect.position,
          rect.size,
        );
      }
    });

  if let Some(icon) = app.default_window_icon().cloned() {
    tray = tray.icon(icon);
  }

  #[cfg(target_os = "macos")]
  {
    tray = tray.icon_as_template(true);
  }

  tray.build(app)?;

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .on_window_event(|window, event| {
      if window.label() != MAIN_WINDOW_LABEL {
        return;
      }

      if let WindowEvent::Focused(false) = event {
        let _ = window.hide();
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      configure_main_window(&app.handle());
      build_tray(&app.handle())?;

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_codex_overview,
      commands::show_dashboard_window
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
