// API client for Feature 3 (Topic-relevance query & rating) routes.
import { SIDECAR_URL } from "./sidecar";

export interface RubricWeights {
  relevance: number;
  depth: number;
  quotability: number;
  coherence: number;
  uniqueness: number;
  length_fit: number;
}

export interface RubricConfig {
  weights: RubricWeights;
  relevance_floor: number;
  relevance_ceiling: number;
  length_fit_ideal_min: number;
  length_fit_ideal_max: number;
}

export const DEFAULT_RUBRIC_CONFIG: RubricConfig = {
  weights: {
    relevance: 0.4,
    depth: 0.15,
    quotability: 0.15,
    coherence: 0.1,
    uniqueness: 0.1,
    length_fit: 0.1,
  },
  relevance_floor: 0.25,
  relevance_ceiling: 0.8,
  length_fit_ideal_min: 300,
  length_fit_ideal_max: 3000,
};

export type CorpusItemType = "transcript" | "document";

export interface SubScores {
  relevance: number;
  depth: number;
  quotability: number;
  coherence: number;
  length_fit: number;
  uniqueness: number;
}

export interface RankedResult {
  item_type: CorpusItemType;
  item_id: number;
  title: string;
  preview: string;
  relevance_score: number;
  sub_scores: SubScores;
  rank: number;
  above_threshold: boolean;
}

export interface TopicQueryResult {
  query_id: number;
  total_count: number;
  count_above_threshold: number;
  relevance_threshold: number;
  results: RankedResult[];
}

export interface TopicQuerySummary {
  id: number;
  name: string | null;
  topic_source_type: "document" | "text";
  relevance_threshold: number;
  created_at: string;
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

export async function createTopicQuery(params: {
  name?: string;
  topic_source_type: "document" | "text";
  topic_document_id?: number;
  topic_text?: string;
  corpus: { item_type: CorpusItemType; item_id: number }[];
  rubric_config?: RubricConfig;
  relevance_threshold?: number;
}): Promise<TopicQueryResult> {
  return asJson(
    await fetch(`${SIDECAR_URL}/topics/queries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),
  );
}

export async function listTopicQueries(): Promise<{ queries: TopicQuerySummary[] }> {
  return asJson(await fetch(`${SIDECAR_URL}/topics/queries`));
}

export async function getTopicQuery(
  id: number,
): Promise<TopicQueryResult & { query: { rubric_config: RubricConfig; name: string | null } }> {
  return asJson(await fetch(`${SIDECAR_URL}/topics/queries/${id}`));
}

export async function updateRubric(
  id: number,
  rubricConfig: RubricConfig,
): Promise<TopicQueryResult & { query: { rubric_config: RubricConfig } }> {
  return asJson(
    await fetch(`${SIDECAR_URL}/topics/queries/${id}/rubric`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rubric_config: rubricConfig }),
    }),
  );
}

export async function updateThreshold(id: number, threshold: number): Promise<TopicQueryResult> {
  return asJson(
    await fetch(`${SIDECAR_URL}/topics/queries/${id}/threshold`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relevance_threshold: threshold }),
    }),
  );
}

export async function rerunTopicQuery(id: number): Promise<TopicQueryResult> {
  return asJson(await fetch(`${SIDECAR_URL}/topics/queries/${id}/rerun`, { method: "POST" }));
}

export async function deleteTopicQuery(id: number): Promise<void> {
  await asJson(await fetch(`${SIDECAR_URL}/topics/queries/${id}`, { method: "DELETE" }));
}
