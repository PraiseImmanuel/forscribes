import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { startJob as startJobApi, getJob, type Job } from "../lib/transcription";

// Owns the active transcription job's state and polling loop at a level
// above any single page (see App.tsx), so navigating away from /transcribe
// doesn't lose track of a batch still running in the sidecar. Before this,
// the poll interval lived inside Transcribe.tsx itself and got torn down
// the moment that component unmounted - the job kept running on the
// backend (it's a Python thread, independent of the frontend), but nothing
// in the UI could tell you that anymore.

interface TranscriptionJobContextValue {
  job: Job | null;
  starting: boolean;
  startError: string | null;
  startJob: (filePaths: string[], modelId: string) => Promise<void>;
  dismissJob: () => void;
}

const TranscriptionJobContext = createContext<TranscriptionJobContextValue | null>(null);

export function TranscriptionJobProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const startJob = useCallback(async (filePaths: string[], modelId: string) => {
    setStarting(true);
    setStartError(null);
    try {
      const { job_id } = await startJobApi(filePaths, modelId);
      const initial = await getJob(job_id);
      setJob(initial);
      pollRef.current = window.setInterval(async () => {
        const updated = await getJob(job_id);
        setJob(updated);
        if (updated.status !== "running" && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 1000);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  const dismissJob = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setJob(null);
    setStartError(null);
  }, []);

  return (
    <TranscriptionJobContext.Provider value={{ job, starting, startError, startJob, dismissJob }}>
      {children}
    </TranscriptionJobContext.Provider>
  );
}

export function useTranscriptionJob(): TranscriptionJobContextValue {
  const ctx = useContext(TranscriptionJobContext);
  if (!ctx) {
    throw new Error("useTranscriptionJob must be used within a TranscriptionJobProvider");
  }
  return ctx;
}
