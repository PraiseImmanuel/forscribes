// API client for Feature 4 (Export) - one generic endpoint used by Library,
// Grouping, and Topic results alike.
import { SIDECAR_URL } from "./sidecar";

export type ExportItemType = "transcript" | "document";
export type CombinedFormat = "md" | "docx" | "zip";
export type ExportVariant = "raw" | "cleaned";

export interface ExportBlock {
  type: "divider" | "content";
  text?: string; // divider label
  item_type?: ExportItemType;
  item_id?: number;
  title_override?: string;
}

export interface CombinedExportRequest {
  blocks: ExportBlock[];
  overall_title?: string;
  variant: ExportVariant;
  format: CombinedFormat;
  include_metadata: boolean;
  dest_path: string;
}

export async function exportCombined(
  req: CombinedExportRequest,
): Promise<{ exported_to: string; item_count: number }> {
  const res = await fetch(`${SIDECAR_URL}/export/combined`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // not JSON
    }
    throw new Error(detail);
  }
  return res.json();
}
