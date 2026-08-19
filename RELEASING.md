# Cutting a ForScribe release

This is the exact, repeatable process for shipping a new version. Auto-update
only works once there's at least one real GitHub Release published at
`PraiseImmanuel/forscribes` with the right files attached - this doc is what
makes that happen.

**How the pieces fit together:** the app checks
`https://github.com/PraiseImmanuel/forscribes/releases/latest/download/latest.json`
for updates. `tauri build` generates that `latest.json` automatically
(because `createUpdaterArtifacts: true` is set in `tauri.conf.json`) and
signs the installer with the private key you generated back in Phase F
(`src-tauri/forscribe-updater.key`) - never lose that file or its password,
they're both gitignored on purpose and live only on this machine.

## 0. One-time setup (only needed once, or on a new machine)

If this is the very first release, the project needs to actually become a
git repo and get pushed to GitHub first:

```powershell
cd "C:\Users\Favour Uche\OneDrive\Documents\2025Projects\forscribe"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/PraiseImmanuel/forscribes.git
git push -u origin main
```

Confirm the private key exists (should already be there from Phase F setup):

```powershell
Test-Path "src-tauri\forscribe-updater.key"
Test-Path "src-tauri\UPDATER_KEY_PASSWORD.txt"
```

If either is missing, **stop** - regenerating the key means every previously
shipped install can no longer verify new updates as authentic, and they'd
need to be manually reinstalled. Don't regenerate unless you've genuinely
lost the old one.

## 1. Bump the version

Update the version number in **three** places (they need to match):

- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`
- `package.json` → `"version"`

Use [semver](https://semver.org/): `0.1.0` → `0.1.1` for a fix, `0.2.0` for
a new feature, `1.0.0` when it's ready to call done.

## 2. Rebuild the Python sidecar bundle

The sidecar exe has to be rebuilt from current source before every release -
it's not automatic.

```powershell
cd "C:\Users\Favour Uche\OneDrive\Documents\2025Projects\forscribe\python-sidecar"
.\.venv\Scripts\python.exe build_sidecar.py
```

Confirm it worked and check the size looks reasonable (~150MB):

```powershell
Get-Item "..\src-tauri\binaries\forscribe-sidecar-x86_64-pc-windows-msvc.exe" | Select-Object Length
```

## 3. Build and sign the app

From the project root, with the signing key wired in via environment
variables for this one command:

```powershell
cd "C:\Users\Favour Uche\OneDrive\Documents\2025Projects\forscribe"
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "src-tauri\forscribe-updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content "src-tauri\UPDATER_KEY_PASSWORD.txt" -Raw
npm run tauri build
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

This takes a while on this machine (expect 10-20+ minutes) - it's compiling
the full release build, not the faster dev build. The `Remove-Item` lines at
the end clear the key out of your shell session; don't skip them.

**Output lands in** `src-tauri\target\release\bundle\`:
- `nsis\ForScribe_<version>_x64-setup.exe` - the installer people download and run
- `nsis\ForScribe_<version>_x64-setup.exe.sig` - its signature
- `latest.json` - the update manifest the running app checks against

Sanity-check the manifest was actually generated:

```powershell
Get-Content "src-tauri\target\release\bundle\latest.json"
```

## 4. Create the GitHub Release

Using the [`gh` CLI](https://cli.github.com/) (install once with
`winget install GitHub.cli`, then `gh auth login`):

```powershell
cd "C:\Users\Favour Uche\OneDrive\Documents\2025Projects\forscribe"
git add -A
git commit -m "Release v<version>"
git push
git tag "v<version>"
git push origin "v<version>"

gh release create "v<version>" `
  "src-tauri\target\release\bundle\nsis\ForScribe_<version>_x64-setup.exe" `
  "src-tauri\target\release\bundle\nsis\ForScribe_<version>_x64-setup.exe.sig" `
  "src-tauri\target\release\bundle\latest.json" `
  --title "ForScribe v<version>" `
  --notes "What changed in this release."
```

Replace every `<version>` with the actual version number (e.g. `0.1.1`), and
write real release notes - they're not just decoration, they're what a user
sees before deciding to update.

No `gh` CLI? Use the GitHub website instead: **Releases → Draft a new
release**, create tag `v<version>`, and drag in those same three files.

## 5. Verify the update actually works

Don't trust it blindly - confirm an already-installed older version can
actually find and apply this release:

1. Install the *previous* version's installer (or just run the app if it's
   already the previous version).
2. Open ForScribe, click **Check for updates** in the dashboard footer.
3. It should show the new version is available. Click **Restart & update**.
4. After it relaunches, check the footer shows the new version number.

If step 2 shows "up to date" when it shouldn't, the most common cause is the
version in `tauri.conf.json` not actually matching what you tagged - go back
and check.

## Rollback (if a release turns out to be broken)

Tauri's updater has no automatic rollback - see the PRD's Risks section for
why, and what the app does about it (the "hasn't started cleanly" warning
banner). Manual rollback is: point people at the *previous* release's page
on GitHub Releases and have them download and run that installer directly
over the current install. This is exactly why old releases and their
installers should never be deleted from GitHub - each one is the rollback
path for the version after it.
