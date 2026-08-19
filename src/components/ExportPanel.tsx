import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Download, FileText, FileArchive, FileType } from "lucide-react";
import {
  exportCombined,
  type ExportBlock,
  type CombinedFormat,
  type ExportVariant,
} from "../lib/export";
import "./ExportPanel.css";

interface ExportPanelProps {
  blocks: ExportBlock[];
  itemCount: number;
  defaultTitle: string;
  defaultVariant?: ExportVariant;
  triggerLabel?: string;
}

const FORMAT_OPTIONS: { value: CombinedFormat; label: string; ext: string; icon: typeof FileText }[] = [
  { value: "md", label: "Markdown (one file)", ext: "md", icon: FileText },
  { value: "docx", label: "Word (one file)", ext: "docx", icon: FileType },
  { value: "zip", label: "ZIP (individual files)", ext: "zip", icon: FileArchive },
];

export function ExportPanel({
  blocks,
  itemCount,
  defaultTitle,
  defaultVariant = "cleaned",
  triggerLabel = "Export selected",
}: ExportPanelProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<CombinedFormat>("md");
  const [variant, setVariant] = useState<ExportVariant>(defaultVariant);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleExport() {
    const ext = FORMAT_OPTIONS.find((f) => f.value === format)!.ext;
    const destPath = await save({
      defaultPath: `${defaultTitle}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (!destPath) return;

    setExporting(true);
    setStatus(null);
    try {
      const result = await exportCombined({
        blocks,
        overall_title: defaultTitle,
        variant,
        format,
        include_metadata: includeMetadata,
        dest_path: destPath,
      });
      setStatus(`Exported ${result.item_count} item${result.item_count === 1 ? "" : "s"} to ${destPath}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  if (itemCount === 0) return null;

  return (
    <div className="export-panel">
      <button className="btn-secondary" onClick={() => setOpen((o) => !o)}>
        <Download size={14} />
        {triggerLabel} ({itemCount})
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="export-options"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="export-options-inner">
              <div className="export-field">
                <span className="export-field-label">Format</span>
                <div className="export-format-choices">
                  {FORMAT_OPTIONS.map((f) => (
                    <button
                      key={f.value}
                      className={`format-chip${format === f.value ? " active" : ""}`}
                      onClick={() => setFormat(f.value)}
                    >
                      <f.icon size={13} />
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="export-field">
                <span className="export-field-label">Text</span>
                <div className="export-format-choices">
                  <button
                    className={`format-chip${variant === "cleaned" ? " active" : ""}`}
                    onClick={() => setVariant("cleaned")}
                  >
                    Cleaned (falls back to raw if not run)
                  </button>
                  <button
                    className={`format-chip${variant === "raw" ? " active" : ""}`}
                    onClick={() => setVariant("raw")}
                  >
                    Raw
                  </button>
                </div>
              </div>

              <label className="export-checkbox">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                />
                Include date/duration under each title (uncheck for a clean manuscript)
              </label>

              <button className="btn-primary" onClick={handleExport} disabled={exporting}>
                {exporting ? "Exporting…" : "Choose destination & export"}
              </button>

              {status && <p className="panel-hint">{status}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
