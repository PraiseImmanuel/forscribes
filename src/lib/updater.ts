// Wraps @tauri-apps/plugin-updater. This is the ONLY code in the app that
// ever reaches the internet - everything else stays fully offline.
//
// Design: `check()` is cheap (just fetches latest.json and compares
// versions) and safe to run silently in the background. Actually applying
// an update - download + install + relaunch - is bundled into one
// user-triggered action instead of being split across time, since Tauri's
// documented pattern calls them back-to-back and Windows can be picky about
// swapping files out from under a still-running process if you delay
// between install() and relaunch().
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateProgress = { downloaded: number; total: number | null };

export async function checkForUpdate(): Promise<Update | null> {
  return check();
}

export async function installUpdateAndRestart(
  update: Update,
  onProgress?: (p: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.({ downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded: total ?? downloaded, total });
        break;
    }
  });

  await relaunch();
}
