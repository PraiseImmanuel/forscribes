// This app keeps almost all logic in React (frontend) and Python (the
// "sidecar" process below). Rust's only job here is: start the Python
// sidecar when the app launches, stop it when the app quits, and track a
// small "did the last few launches actually work" counter for the update
// rollback safety net. The frontend talks to the sidecar directly over
// plain HTTP on localhost - it does NOT go through Tauri commands for
// that, which is what keeps this file small.
use std::fs::{self, File};
use std::path::Path;
use std::process::{Child, Command, Stdio};
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

/// Redirects a freshly-built (not yet spawned) Command's stdout/stderr to
/// `log_path`, truncating any previous run's log. Spawned with
/// CREATE_NO_WINDOW there's no console to see this in otherwise - without
/// this, a startup failure is completely invisible, which is exactly what
/// made the "empty model list" and "can't reach sidecar" reports so hard
/// to diagnose from the outside.
fn redirect_output_to_log(cmd: &mut Command, log_path: &Path) -> std::io::Result<()> {
    let log_file = File::create(log_path)?;
    let log_file_err = log_file.try_clone()?;
    cmd.stdout(Stdio::from(log_file));
    cmd.stderr(Stdio::from(log_file_err));
    Ok(())
}

#[cfg(debug_assertions)]
fn spawn_sidecar(log_path: &Path) -> std::io::Result<Child> {
    // Dev mode: run the sidecar straight out of its virtualenv, so editing
    // Python code doesn't require rebuilding a packaged binary. Production
    // builds instead spawn a PyInstaller-bundled sidecar exe shipped inside
    // the installer.
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let sidecar_dir = std::path::Path::new(manifest_dir).join("../python-sidecar");
    let python_exe = sidecar_dir.join(".venv/Scripts/python.exe");

    let mut cmd = Command::new(python_exe);
    cmd.arg("main.py").current_dir(sidecar_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    redirect_output_to_log(&mut cmd, log_path)?;
    cmd.spawn()
}

/// Confirmed (not assumed) via direct process-tree inspection: the
/// production sidecar is a PyInstaller onefile bundle, which runs as a
/// bootloader process that spawns a *separate child process* to actually
/// serve requests - the bootloader isn't the server, it's a launcher. The
/// `Child` handle this file tracks is the bootloader's PID. Windows does
/// NOT kill child processes when their parent dies unless something
/// explicitly groups them for cascading termination, which we don't do -
/// so `child.kill()` on app exit only ever kills the bootloader. The real
/// server process, the one actually holding port 17652, survives as an
/// orphan on *every* close, not just a forceful one. This is called both
/// before spawning (clear out anything left from a previous run) and from
/// the exit handler (clean up after ourselves properly, rather than
/// leaving that to the next launch).
#[cfg(not(debug_assertions))]
fn kill_stale_sidecar() {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut cmd = Command::new("taskkill");
    cmd.args(["/F", "/IM", "forscribe-sidecar.exe", "/T"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // Exits non-zero when there's nothing to kill, which is the normal
    // case on a clean launch - not an error worth surfacing.
    let _ = cmd.output();
}

#[cfg(not(debug_assertions))]
fn spawn_sidecar(log_path: &Path) -> std::io::Result<Child> {
    // Production: the sidecar is a PyInstaller-bundled exe (built by
    // python-sidecar/build_sidecar.py) that Tauri's `externalBin` bundling
    // copies into the same directory as the main app executable - so we
    // just find our own exe and look next to it. No Python install, no
    // venv, needed on the end user's machine.
    kill_stale_sidecar();

    let exe_path = std::env::current_exe()?;
    let exe_dir = exe_path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "app exe has no parent directory")
    })?;
    let sidecar_path = exe_dir.join("forscribe-sidecar.exe");

    let mut cmd = Command::new(sidecar_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    redirect_output_to_log(&mut cmd, log_path)?;
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

/// Where the sidecar's stdout/stderr for the current run gets captured.
/// Overwritten fresh on every launch - this is "what happened last time
/// the app started," not a growing history.
fn sidecar_log_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("no app data dir available");
    let _ = fs::create_dir_all(&dir);
    dir.join("sidecar.log")
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

/// Lets the frontend show what the sidecar actually printed on this run,
/// for a "copy diagnostics" affordance on the connection-error screens
/// instead of a dead end when something goes wrong.
#[tauri::command]
fn read_sidecar_log(app: tauri::AppHandle) -> String {
    fs::read_to_string(sidecar_log_path(&app)).unwrap_or_else(|e| format!("(no log yet: {e})"))
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
            mark_launch_healthy,
            read_sidecar_log
        ])
        .setup(|app| {
            let unhealthy_count = read_and_increment_launch_health(&app.handle());
            app.manage(LaunchHealth(unhealthy_count));

            let log_path = sidecar_log_path(&app.handle());
            let child = spawn_sidecar(&log_path).expect(
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
            // never leave a stray process running after you close the app.
            // child.kill() only reaches the bootloader PID we tracked - see
            // kill_stale_sidecar's doc comment for why that alone isn't
            // enough in production, where the real server is a separate
            // child process the bootloader spawned.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<SidecarProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                }
                #[cfg(not(debug_assertions))]
                kill_stale_sidecar();
            }
        });
}
