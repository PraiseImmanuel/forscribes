import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Scissors, X, Trash2 } from "lucide-react";
import {
  getGroupingSession,
  regroupSession,
  renameGroup,
  moveMember,
  removeMember,
  mergeGroups,
  splitGroup,
  deleteGroupingSession,
  type GroupingSession,
} from "../lib/grouping";
import { ExportPanel } from "../components/ExportPanel";
import type { ExportBlock } from "../lib/export";
import "./Transcribe.css";
import "./GroupingSessionDetail.css";

export function GroupingSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();

  const [session, setSession] = useState<GroupingSession | null>(null);
  const [granularity, setGranularity] = useState(0.5);
  const [regrouping, setRegrouping] = useState(false);
  const [busyGroupId, setBusyGroupId] = useState<number | null>(null);
  const regroupTimer = useRef<number | null>(null);

  async function load() {
    const s = await getGroupingSession(sessionId);
    setSession(s);
    setGranularity(s.granularity_setting);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function onGranularityChange(value: number) {
    setGranularity(value);
    if (regroupTimer.current) window.clearTimeout(regroupTimer.current);
    regroupTimer.current = window.setTimeout(async () => {
      setRegrouping(true);
      try {
        const s = await regroupSession(sessionId, value);
        setSession(s);
      } finally {
        setRegrouping(false);
      }
    }, 500);
  }

  async function handleRename(groupId: number, name: string) {
    await renameGroup(groupId, name);
    setSession((prev) =>
      prev
        ? { ...prev, groups: prev.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) }
        : prev,
    );
  }

  async function handleMoveMember(membershipId: number, targetGroupId: number) {
    await moveMember(membershipId, targetGroupId);
    await load();
  }

  async function handleRemoveMember(membershipId: number) {
    await removeMember(membershipId);
    await load();
  }

  async function handleMerge(sourceGroupId: number, targetGroupId: number) {
    if (sourceGroupId === targetGroupId) return;
    setBusyGroupId(sourceGroupId);
    try {
      await mergeGroups(sourceGroupId, targetGroupId);
      await load();
    } finally {
      setBusyGroupId(null);
    }
  }

  async function handleSplit(groupId: number) {
    setBusyGroupId(groupId);
    try {
      const s = await splitGroup(groupId);
      setSession(s);
    } finally {
      setBusyGroupId(null);
    }
  }

  async function handleDeleteSession() {
    await deleteGroupingSession(sessionId);
    navigate("/group");
  }

  if (!session) {
    return (
      <section className="screen">
        <p className="panel-hint">Loading…</p>
      </section>
    );
  }

  const exportBlocks: ExportBlock[] = session.groups.flatMap((group) => [
    { type: "divider", text: group.name },
    ...group.members.map(
      (m): ExportBlock => ({
        type: "content",
        item_type: m.item_type,
        item_id: m.item_id,
        title_override: m.title,
      }),
    ),
  ]);
  const totalItems = session.groups.reduce((n, g) => n + g.members.length, 0);

  return (
    <section className="screen">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Link to="/group" className="back-link">
          <ArrowLeft size={14} /> Back to sessions
        </Link>
        <h1 className="screen-title">{session.name}</h1>
        <p className="screen-subtitle">
          {session.groups.length} group{session.groups.length === 1 ? "" : "s"} ·{" "}
          {totalItems} items
        </p>
      </motion.div>

      <ExportPanel
        blocks={exportBlocks}
        itemCount={totalItems}
        defaultTitle={session.name}
        triggerLabel="Export whole session"
      />

      <div className="panel">
        <div className="panel-row">
          <h3 className="panel-title" style={{ flex: 1 }}>Granularity</h3>
          {regrouping && <span className="panel-hint">Regrouping…</span>}
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={granularity}
          onChange={(e) => onGranularityChange(Number(e.target.value))}
        />
      </div>

      <div className="group-grid">
        {session.groups.map((group) => (
          <motion.div
            key={group.id}
            className="group-card"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="group-card-header">
              <input
                className="group-name-input"
                defaultValue={group.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== group.name) {
                    handleRename(group.id, e.target.value.trim());
                  }
                }}
              />
              <span className="group-count">{group.members.length}</span>
            </div>

            <ul className="group-member-list">
              {group.members.map((m) => (
                <li key={m.membership_id} className="group-member">
                  <span className="group-member-title" title={m.preview}>
                    {m.item_type === "document" ? "📄 " : ""}
                    {m.title}
                  </span>
                  <div className="group-member-actions">
                    <select
                      className="move-select"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleMoveMember(m.membership_id, Number(e.target.value));
                      }}
                    >
                      <option value="">Move to…</option>
                      {session.groups
                        .filter((g) => g.id !== group.id)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                    <button
                      className="icon-btn"
                      onClick={() => handleRemoveMember(m.membership_id)}
                      aria-label="Remove from working set"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="group-card-footer">
              <button
                className="btn-secondary small"
                onClick={() => handleSplit(group.id)}
                disabled={group.members.length < 2 || busyGroupId === group.id}
              >
                <Scissors size={13} /> Split
              </button>
              <select
                className="move-select"
                value=""
                onChange={(e) => {
                  if (e.target.value) handleMerge(group.id, Number(e.target.value));
                }}
                disabled={session.groups.length < 2 || busyGroupId === group.id}
              >
                <option value="">Merge into…</option>
                {session.groups
                  .filter((g) => g.id !== group.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      Merge into {g.name}
                    </option>
                  ))}
              </select>
            </div>
          </motion.div>
        ))}
      </div>

      <button className="btn-secondary danger" onClick={handleDeleteSession}>
        <Trash2 size={14} /> Delete this session
      </button>
    </section>
  );
}
