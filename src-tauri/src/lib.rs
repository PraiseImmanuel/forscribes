// This app keeps almost all logic in React (frontend) and Python (the
// "sidecar" process below). Rust's only job here is: start the Python
// sidecar when the app launches, stop it when the app quits, and track a
// small "did the last few launches actually work" counter for the update
// rollback safety net. The frontend talks to the sidecar directly over
// plain HTTP on localhost - it does NOT go through Tauri commands for
// that, which is what keeps this file small.
use std::fs;
use std::process::{Child, Command};
use std::sync::Mutex;

use tauri::Manager;

// The sidecar (venv python.exe in dev, the PyInstaller exe in production)
// is a console-subsystem executable. Spawned from a GUI app with no flags,
// Windows pops open a visible terminal for it - CREATE_NO_WINDOW tells
// Windows not to allocate that window while leaving the process's stdio
// handles intact.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Holds a handle to the running Python sidecar process so we can kill it
/// when the app exits. Without this, closing the window would leave an
/// orphaned python.exe running in the background.
struct SidecarProcess(Mutex<Option<Child>>);

#[cfg(debug_assertions)]
fn spawn_sidecar() -> std::io::Result<Child> {
    // Dev mode: run the sidecar straight out of its virtualenv, so editing
    // Python code doesn't require rebuilding a packaged binary. Production
    // builds instead spawn a PyInstaller-bundled sidecar exe shipped inside
    // the installer.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let sidecar_dir = std::path::Path::new(manifest_dir).join("../python-sidecar");
    let python_exe = sidecar_dir.join(".venv/Scripts/python.exe");

    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new(python_exe);
    cmd.arg("main.py").current_dir(sidecar_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

#[cfg(not(debug_assertions))]
fn spawn_sidecar() -> std::io::Result<Child> {
    // Production: the sidecar is a PyInstaller-bundled exe (built by
    // python-sidecar/build_sidecar.py) that Tauri's `externalBin` bundling
    // copies into the same directory as the main app executable - so we
    // just find our own exe and look next to it. No Python install, no
    // venv, needed on the end user's machine.
    let exe_path = std::env::current_exe()?;
    let exe_dir = exe_path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "app exe has no parent directory")
    })?;
    let sidecar_path = exe_dir.join("forscribe-sidecar.exe");

    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new(sidecar_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

// --- Rollback safety net -----------------------------------------------------
//
// Tauri's updater has no built-in automatic rollback: if a bad update ships,
// there's no OS-level "revert to the last known-good version". The mitigation
// here is lightweight by design (see the PRD's Risks section): count launches
// that never reach a confirmed-healthy state, and if that streak crosses a
// threshold, tell the user in plain terms so they can grab the previous
// version from GitHub Releases themselves - rather than silently failing
// update after update with no explanation. Rust just tracks and exposes
// the raw streak; the frontend (src/pages/Dashboard.tsx) owns the actual
// threshold so the warning copy and the number live in one place.

fn launch_health_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("no app data dir available");
    let _ = fs::create_dir_all(&dir);
    dir.join("launch_health.txt")
}

/// Reads the current unhealthy-streak count, then immediately increments and
/// persists it - so an unclean exit (crash, force-kill) before the frontend
/// ever calls `mark_launch_healthy` leaves the counter incremented for next
/// time. Returns the count as it was *before* this launch's increment, i.e.
/// how many consecutive prior launches never confirmed healthy.
fn read_and_increment_launch_health(app: &tauri::AppHandle) -> u32 {
    let path = launch_health_path(app);
    let count: u32 = fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    let _ = fs::write(&path, (count + 1).to_string());
    count
}

struct LaunchHealth(u32);

#[tauri::command]
fn get_unhealthy_launch_count(state: tauri::State<LaunchHealth>) -> u32 {
    state.0
}

#[tauri::command]
fn mark_launch_healthy(app: tauri::AppHandle) {
    let _ = fs::write(launch_health_path(&app), "0");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SidecarProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_unhealthy_launch_count,
            mark_launch_healthy
        ])
        .setup(|app| {
            let unhealthy_count = read_and_increment_launch_health(&app.handle());
            app.manage(LaunchHealth(unhealthy_count));

            let child = spawn_sidecar().expect(
                "failed to start the python sidecar - is python-sidecar/.venv set up? \
                 see python-sidecar/requirements.txt",
            );
            let state = app.state::<SidecarProcess>();
            *state.0.lock().unwrap() = Some(child);
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Kill the sidecar when the app is about to fully exit, so we
            // never leave a stray python.exe running after you close the app.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<SidecarProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                }
            }
        });
}
