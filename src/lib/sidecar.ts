// Client for the local Python sidecar. It always runs on 127.0.0.1 on a
// fixed port and is never reachable from outside this machine.
export const SIDECAR_URL = "http://127.0.0.1:17652";

export interface HealthResponse {
  status: string;
  db_path: string;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${SIDECAR_URL}/health`);
  if (!res.ok) {
    throw new Error(`Sidecar health check failed: ${res.status}`);
  }
  return res.json();
}
