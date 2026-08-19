// API client for Feature 1 (Transcription) routes on the sidecar.
// Field names deliberately mirror the FastAPI/Python response shapes
// (snake_case) rather than being remapped - one less layer to keep in sync.
import { SIDECAR_URL } from "./sidecar";

export interface HardwareInfo {
  cpu_count: number;
  logical_cpu_count: number;
  total_ram_gb: number;
  has_gpu: boolean;
  cuda_device_count: number;
  recommended_model: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  params: string;
  approx_download_mb: number;
  speed: string;
  accuracy: string;
}

export type FileStatus = "queued" | "transcribing" | "done" | "error";
export type ModelStatus = "checking" | "downloading" | "loading" | "ready";

export interface Progress {
  percent: number | null;
  detail?: string | null;
  downloaded_mb?: number;
  total_mb?: number | null;
}

export interface JobFile {
  path: string;
  filename: string;
  status: FileStatus;
  progress: Progress | null;
  transcript_id: number | null;
  error: string | null;
}

export interface Job {
  id: string;
  model: string;
  status: "running" | "done" | "error";
  model_status: ModelStatus;
  model_progress: Progress | null;
  created_at: string;
  files: JobFile[];
}

export interface TranscriptSummary {
  id: number;
  title: string;
  preview: string;
  language: string | null;
  model_used: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
  file_path: string;
  original_filename: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptDetail extends Omit<TranscriptSummary, "preview"> {
  raw_text: string;
  cleaned_text: string | null;
  segments: TranscriptSegment[] | null;
  audio_file_id: number;
  has_embedding: boolean;
  embedding_model: string | null;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // response wasn't JSON - fall back to statusText
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function getHardware(): Promise<HardwareInfo> {
  return asJson(await fetch(`${SIDECAR_URL}/transcription/hardware`));
}

export async function getModels(): Promise<{ models: ModelInfo[] }> {
  return asJson(await fetch(`${SIDECAR_URL}/transcription/models`));
}

export async function startJob(filePaths: string[], modelId: string): Promise<{ job_id: string }> {
  return asJson(
    await fetch(`${SIDECAR_URL}/transcription/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_paths: filePaths, model_id: modelId }),
    }),
  );
}

export async function getJob(jobId: string): Promise<Job> {
  return asJson(await fetch(`${SIDECAR_URL}/transcription/jobs/${jobId}`));
}

export async function listTranscripts(search?: string): Promise<{ transcripts: TranscriptSummary[] }> {
  const url = new URL(`${SIDECAR_URL}/transcripts`);
  if (search) url.searchParams.set("search", search);
  return asJson(await fetch(url));
}

export async function getTranscript(id: number): Promise<TranscriptDetail> {
  return asJson(await fetch(`${SIDECAR_URL}/transcripts/${id}`));
}

export async function updateTranscript(
  id: number,
  fields: { title?: string; cleaned_text?: string },
): Promise<TranscriptDetail> {
  return asJson(
    await fetch(`${SIDECAR_URL}/transcripts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }),
  );
}

export async function cleanupTranscript(id: number): Promise<TranscriptDetail> {
  return asJson(await fetch(`${SIDECAR_URL}/transcripts/${id}/cleanup`, { method: "POST" }));
}

export async function deleteTranscript(id: number): Promise<void> {
  await asJson(await fetch(`${SIDECAR_URL}/transcripts/${id}`, { method: "DELETE" }));
}

export type ExportVariant = "raw" | "cleaned";
export type ExportFormat = "txt" | "md" | "docx";

export async function exportTranscript(
  id: number,
  variant: ExportVariant,
  format: ExportFormat,
  destPath: string,
): Promise<{ exported_to: string }> {
  return asJson(
    await fetch(`${SIDECAR_URL}/transcripts/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant, format, dest_path: destPath }),
    }),
  );
}
