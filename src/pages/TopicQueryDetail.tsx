import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronDown, RefreshCw, Trash2, SlidersHorizontal } from "lucide-react";
import {
  getTopicQuery,
  updateRubric,
  updateThreshold,
  rerunTopicQuery,
  deleteTopicQuery,
  type RubricConfig,
  type RubricWeights,
  type RankedResult,
} from "../lib/topics";
import { ExportPanel } from "../components/ExportPanel";
import type { ExportBlock } from "../lib/export";
import "./Transcribe.css";
import "./TopicQueryDetail.css";

const WEIGHT_LABELS: Record<keyof RubricWeights, string> = {
  relevance: "Relevance",
  depth: "Depth",
  quotability: "Quotability",
  coherence: "Coherence",
  uniqueness: "Uniqueness",
  length_fit: "Length fit",
};

export function TopicQueryDetail() {
  const { id } = useParams<{ id: string }>();
  const queryId = Number(id);
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [results, setResults] = useState<RankedResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [countAbove, setCountAbove] = useState(0);
  const [threshold, setThreshold] = useState(4);
  const [rubric, setRubric] = useState<RubricConfig | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showRubric, setShowRubric] = useState(false);
  const [busy, setBusy] = useState(false);
  const weightTimer = useRef<number | null>(null);
  const thresholdTimer = useRef<number | null>(null);

  async function load() {
    const data = await getTopicQuery(queryId);
    setName(data.query.name || "Untitled topic query");
    setResults(data.results);
    setTotalCount(data.total_count);
    setCountAbove(data.count_above_threshold);
    setThreshold(data.relevance_threshold);
    setRubric(data.query.rubric_config);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId]);

  function onWeightChange(key: keyof RubricWeights, value: number) {
    if (!rubric) return;
    const next = { ...rubric, weights: { ...rubric.weights, [key]: value } };
    setRubric(next);
    if (weightTimer.current) window.clearTimeout(weightTimer.current);
    weightTimer.current = window.setTimeout(async () => {
      const data = await updateRubric(queryId, next);
      setResults(data.results);
      setCountAbove(data.count_above_threshold);
    }, 400);
  }

  function onThresholdChange(value: number) {
    setThreshold(value);
    if (thresholdTimer.current) window.clearTimeout(thresholdTimer.current);
    thresholdTimer.current = window.setTimeout(async () => {
      const data = await updateThreshold(queryId, value);
      setResults(data.results);
      setCountAbove(data.count_above_threshold);
    }, 400);
  }

  async function handleRerun() {
    setBusy(true);
    try {
      await rerunTopicQuery(queryId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    await deleteTopicQuery(queryId);
    navigate("/topics");
  }

  const weightSum = rubric ? Object.values(rubric.weights).reduce((a, b) => a + b, 0) : 1;

  const exportBlocks: ExportBlock[] = results
    .filter((r) => r.above_threshold)
    .map(
      (r): ExportBlock => ({
        type: "content",
        item_type: r.item_type,
        item_id: r.item_id,
        title_override: `#${r.rank} · ${r.title} (${r.relevance_score.toFixed(1)}/10)`,
      }),
    );

  return (
    <section className="screen">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Link to="/topics" className="back-link">
          <ArrowLeft size={14} /> Back to topic queries
        </Link>
        <h1 className="screen-title">{name}</h1>
      </motion.div>

      <div className="summary-banner">
        <span className="summary-count">{countAbove}</span>
        <span>
          of {totalCount} transcript{totalCount === 1 ? "" : "s"} relate to this topic
          (score ≥ {threshold})
        </span>
      </div>

      <ExportPanel
        blocks={exportBlocks}
        itemCount={exportBlocks.length}
        defaultTitle={name}
        triggerLabel="Export related results"
      />

      <div className="panel">
        <div className="panel-row">
          <h3 className="panel-title" style={{ flex: 1 }}>Relevance threshold</h3>
          <span className="panel-hint">{threshold} / 10</span>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={threshold}
          onChange={(e) => onThresholdChange(Number(e.target.value))}
        />
      </div>

      <div className="panel">
        <button className="panel-row rubric-toggle" onClick={() => setShowRubric((v) => !v)}>
          <SlidersHorizontal size={15} />
          <h3 className="panel-title" style={{ flex: 1 }}>Rubric weights</h3>
          <ChevronDown size={15} className={showRubric ? "rotate" : ""} />
        </button>
        {showRubric && rubric && (
          <div className="rubric-editor">
            <p className="panel-hint">
              Weights are relative — they're renormalized to add up to 100%. Changes recompute
              scores instantly from cached sub-scores, no re-embedding.
            </p>
            {(Object.keys(rubric.weights) as (keyof RubricWeights)[]).map((key) => (
              <div key={key} className="weight-row">
                <span className="weight-label">{WEIGHT_LABELS[key]}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={rubric.weights[key]}
                  onChange={(e) => onWeightChange(key, Number(e.target.value))}
                />
                <span className="weight-value">
                  {Math.round((rubric.weights[key] / weightSum) * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel-row">
        <button className="btn-secondary" onClick={handleRerun} disabled={busy}>
          <RefreshCw size={14} /> {busy ? "Re-running…" : "Re-run against current corpus"}
        </button>
      </div>

      <ol className="result-list">
        {results.map((r) => (
          <li key={`${r.item_type}-${r.item_id}`} className={`result-row${r.above_threshold ? "" : " below-threshold"}`}>
            <div className="result-main" onClick={() => setExpanded(expanded === r.item_id ? null : r.item_id)}>
              <span className="result-rank">#{r.rank}</span>
              <div className="result-copy">
                <h3>
                  {r.item_type === "document" ? "📄 " : ""}
                  {r.title}
                </h3>
                <p>{r.preview}</p>
              </div>
              <span className={`result-score${r.above_threshold ? " match" : ""}`}>
                {r.relevance_score.toFixed(1)}
              </span>
              <ChevronDown size={16} className={expanded === r.item_id ? "rotate" : ""} />
            </div>

            {expanded === r.item_id && (
              <div className="sub-score-grid">
                {(Object.keys(r.sub_scores) as (keyof typeof r.sub_scores)[]).map((key) => (
                  <div key={key} className="sub-score-item">
                    <span className="sub-score-label">{WEIGHT_LABELS[key]}</span>
                    <div className="sub-score-bar-track">
                      <div className="sub-score-bar-fill" style={{ width: `${r.sub_scores[key] * 10}%` }} />
                    </div>
                    <span className="sub-score-value">{r.sub_scores[key].toFixed(1)}</span>
                  </div>
                ))}
                {r.item_type === "transcript" && (
                  <Link to={`/library/${r.item_id}`} className="progress-link">
                    Open in Library →
                  </Link>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <button className="btn-secondary danger" onClick={handleDelete}>
        <Trash2 size={14} /> Delete this query
      </button>
    </section>
  );
}
