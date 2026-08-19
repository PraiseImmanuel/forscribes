import { useState } from "react";
import { ClipboardCopy, Check } from "lucide-react";
import { readSidecarLog } from "../lib/launchHealth";

// The one thing that turns "it doesn't connect" into something fixable:
// lets whoever hits a connection error hand over what the sidecar actually
// printed, entirely on their own call - nothing here is sent anywhere
// automatically.
export function CopyDiagnosticsButton({ context }: { context: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const log = await readSidecarLog().catch(
      (e) => `(failed to read sidecar log: ${e instanceof Error ? e.message : String(e)})`,
    );
    const report = `ForScribe diagnostics\nContext: ${context}\n\nSidecar log:\n${log}`;
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button className="diagnostics-btn" onClick={handleCopy}>
      {copied ? (
        <>
          <Check size={13} /> Copied
        </>
      ) : (
        <>
          <ClipboardCopy size={13} /> Copy diagnostics
        </>
      )}
    </button>
  );
}
