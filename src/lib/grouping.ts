// API client for Feature 2 (Auto-grouping) routes on the sidecar.
import { SIDECAR_URL } from "./sidecar";

export interface DocumentSummary {
  id: number;
  source_type: string;
  original_filename: string;
  file_format: string;
  uploaded_at: string;
  promoted_transcript_id: number | null;
}

export type WorkingSetItemType = "transcript" | "document";

export interface WorkingSetItem {
  item_type: WorkingSetItemType;
  item_id: number;
  title: string;
  preview: string;
}

export interface GroupMember {
  membership_id: number;
  item_type: WorkingSetItemType;
  item_id: number;
  title: string;
  preview: string;
}

export interface Group {
  id: number;
  grouping_session_id: number;
  name: string;
  auto_label_keyphrases: string | null;
  created_at: string;
  members: GroupMember[];
}

export interface GroupingSession {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  granularity_setting: number;
  groups: Group[];
}

export interface GroupingSessionSummary {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  granularity_setting: number;
}

async function asJson<T>(res: Response): Promise<T> {
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

export async function uploadDocument(filePath: string, sourceType = "grouping_upload"): Promise<DocumentSummary> {
  return asJson(
    await fetch(`${SIDECAR_URL}/documents/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_path: filePath, source_type: sourceType }),
    }),
  );
}

export async function listDocuments(sourceType?: string): Promise<{ documents: DocumentSummary[] }> {
  const url = new URL(`${SIDECAR_URL}/documents`);
  if (sourceType) url.searchParams.set("source_type", sourceType);
  return asJson(await fetch(url));
}

export async function createGroupingSession(
  name: string,
  items: { item_type: WorkingSetItemType; item_id: number }[],
  granularity: number,
): Promise<GroupingSession> {
  return asJson(
    await fetch(`${SIDECAR_URL}/grouping/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, items, granularity }),
    }),
  );
}

export async function listGroupingSessions(): Promise<{ sessions: GroupingSessionSummary[] }> {
  return asJson(await fetch(`${SIDECAR_URL}/grouping/sessions`));
}

export async function getGroupingSession(id: number): Promise<GroupingSession> {
  return asJson(await fetch(`${SIDECAR_URL}/grouping/sessions/${id}`));
}

export async function regroupSession(id: number, granularity: number): Promise<GroupingSession> {
  return asJson(
    await fetch(`${SIDECAR_URL}/grouping/sessions/${id}/regroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ granularity }),
    }),
  );
}

export async function deleteGroupingSession(id: number): Promise<void> {
  await asJson(await fetch(`${SIDECAR_URL}/grouping/sessions/${id}`, { method: "DELETE" }));
}

export async function renameGroup(groupId: number, name: string): Promise<void> {
  await asJson(
    await fetch(`${SIDECAR_URL}/grouping/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function moveMember(membershipId: number, targetGroupId: number): Promise<void> {
  await asJson(
    await fetch(`${SIDECAR_URL}/grouping/groups/move-member`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membership_id: membershipId, target_group_id: targetGroupId }),
    }),
  );
}

export async function removeMember(membershipId: number): Promise<void> {
  await asJson(await fetch(`${SIDECAR_URL}/grouping/members/${membershipId}`, { method: "DELETE" }));
}

export async function mergeGroups(sourceGroupId: number, targetGroupId: number): Promise<void> {
  await asJson(
    await fetch(`${SIDECAR_URL}/grouping/groups/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_group_id: sourceGroupId, target_group_id: targetGroupId }),
    }),
  );
}

export async function splitGroup(groupId: number): Promise<GroupingSession> {
  return asJson(
    await fetch(`${SIDECAR_URL}/grouping/groups/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId }),
    }),
  );
}
