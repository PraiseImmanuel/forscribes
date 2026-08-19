// Talks to the two Rust commands backing the update-rollback safety net.
// See src-tauri/src/lib.rs for the actual counter logic.
import { invoke } from "@tauri-apps/api/core";

export async function getUnhealthyLaunchCount(): Promise<number> {
  return invoke<number>("get_unhealthy_launch_count");
}

export async function markLaunchHealthy(): Promise<void> {
  await invoke("mark_launch_healthy");
}
