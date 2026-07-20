import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ConversationStartRequest,
  LaneOpenResponse,
  FinishWorkAssessment,
  FinishWorkRequest,
  LaneSummary,
  RepoSnapshot,
  StudioActionRequest,
  StudioEvent,
  StudioSnapshot
} from "@srgical/studio-core";
import { STUDIO_THEMES } from "@srgical/studio-shared";
import type { AgentEvent, AgentSessionRecord, ConnectorRecord, ConnectorRegistrySnapshot, McpServerDefinition, McpTransport, SkillRecord, StudioAuthOptionId, StudioAuthOptionStatus } from "@srgical/studio-shared";

declare global {
  interface Window {
    __SRGICAL_TOKEN__?: string;
  }
}

const query = new URLSearchParams(window.location.search);
const dashboardToken = window.__SRGICAL_TOKEN__ || query.get("token") || "";
const studioToken = query.get("studioToken") || "";

export function App() {
  return studioToken
    ? <Studio token={studioToken} dashboardToken={dashboardToken} />
    : <RepositoryHome token={dashboardToken} />;
}

function RepositoryHome({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isolation, setIsolation] = useState<"repository" | "worktree">("repository");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState<"active" | "archived" | "all">("active");
  const [finishAssessment, setFinishAssessment] = useState<FinishWorkAssessment | null>(null);
  const [finishConfirmation, setFinishConfirmation] = useState("");
  const [removeAfterFinish, setRemoveAfterFinish] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = async () => setSnapshot(await getJson<RepoSnapshot>(`/api/repo?token=${encodeURIComponent(token)}`));
  useEffect(() => {
    void refresh().then(() => undefined).catch((reason) => setError(errorText(reason)));
  }, [token]);
  const startConversation = async () => {
    const message = prompt.trim();
    if (!message) return;
    setBusy(true);
    setError(null);
    try {
      const opened = await postJson<LaneOpenResponse, ConversationStartRequest>("/api/conversations/start", token, {
        message,
        isolation
      });
      storeInitialMessage(opened.studioToken, message);
      window.location.assign(opened.url);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  const openLane = async (lane: LaneSummary) => {
    if (lane.lifecycle === "missing" || lane.lifecycle === "prunable") return;
    setBusy(true);
    setError(null);
    try {
      const opened = await postJson<LaneOpenResponse, { laneId: string; mode: "prepare" | "operate" }>(
        "/api/lanes/open",
        token,
        { laneId: lane.laneId, mode: lane.lastMode ?? "prepare" }
      );
      window.location.assign(opened.url);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  const mutateLane = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      await postJson(path, token, body);
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const openSession = async (sessionId: string) => {
    setBusy(true);
    setError(null);
    try {
      const opened = await postJson<LaneOpenResponse, { sessionId: string }>("/api/sessions/open", token, { sessionId });
      window.location.assign(opened.url);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  const forkSessionIntoWorktree = async (sessionId: string) => {
    setBusy(true);
    setError(null);
    try {
      const opened = await postJson<LaneOpenResponse, { sessionId: string }>("/api/sessions/fork-worktree", token, { sessionId });
      window.location.assign(opened.url);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  const mutateSession = async (sessionId: string, action: "pin" | "unpin" | "archive" | "restore" | "delete") => {
    if (action === "delete" && !window.confirm("Remove this session from history? Its event files remain on disk as recoverable state.")) return;
    await mutateLane("/api/sessions/update", { sessionId, action });
  };

  const selectAuthOption = async (authOptionId: StudioAuthOptionId) => {
    setBusy(true);
    setError(null);
    try {
      const next = await postJson<RepoSnapshot, { authOptionId: StudioAuthOptionId }>("/api/settings/provider", token, { authOptionId });
      setSnapshot(next);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const mutateConnector = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    try {
      const next = await postJson<RepoSnapshot, object>(path, token, body);
      setSnapshot(next);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const beginFinish = async (laneId: string) => {
    setBusy(true);
    setError(null);
    try {
      const assessment = await getJson<FinishWorkAssessment>(`/api/lanes/finish?token=${encodeURIComponent(token)}&laneId=${encodeURIComponent(laneId)}`);
      setFinishAssessment(assessment);
      setFinishConfirmation("");
      setRemoveAfterFinish(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const finishWork = async () => {
    if (!finishAssessment) return;
    setBusy(true);
    setError(null);
    try {
      await postJson<unknown, FinishWorkRequest>("/api/lanes/finish", token, {
        laneId: finishAssessment.laneId,
        archiveSessions: true,
        removeWorktree: removeAfterFinish,
        confirmation: finishConfirmation
      });
      setFinishAssessment(null);
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot) return <Loading label="Opening repository" />;
  const liveLanes = snapshot.lanes.filter((lane) => !lane.removed);
  const isolatedLanes = liveLanes.filter((lane) => !lane.isCurrentCheckout);
  const visibleSessions = snapshot.sessions
    .filter((session) => sessionFilter === "all" || session.lifecycle === sessionFilter)
    .filter((session) => {
      const haystack = [session.title, session.lastMessagePreview, session.planId, session.laneId, session.providerId].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(sessionQuery.trim().toLowerCase());
    })
    .sort((left, right) => Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt)) || right.updatedAt.localeCompare(left.updatedAt));

  return (
    <div className="home-page">
      <header className="home-header">
        <Brand />
        <div className="home-header-actions"><div className="repo-path" title={snapshot.repoRoot}>{snapshot.repoRoot}</div><button className="quiet settings-trigger" onClick={() => setSettingsOpen(true)}>Settings</button></div>
      </header>
      <main className="home-main">
        <section className="home-intro">
          <div>
            <div className="overline">Repository workspace</div>
            <h1>{snapshot.repoLabel}</h1>
            <p>Start with a conversation. When the work needs file changes, move it into an isolated worktree without losing context.</p>
          </div>
          <div className="repo-stats">
            <Stat value={String(isolatedLanes.length)} label="worktrees" />
            <Stat value={String(snapshot.sessions.length)} label="sessions" />
            <Stat value={String(isolatedLanes.filter((lane) => lane.dirty).length)} label="in progress" />
            <Stat value={String(isolatedLanes.filter((lane) => lane.conflictCount > 0).length)} label="conflicted" />
          </div>
        </section>

        <section className="conversation-starter">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void startConversation();
              }
            }}
            placeholder="What do you want to work on?"
            rows={3}
            autoFocus
          />
          <div className="conversation-starter-footer">
            <label className="isolation-choice"><input type="checkbox" checked={isolation === "worktree"} onChange={(event) => setIsolation(event.target.checked ? "worktree" : "repository")} /><span><strong>Start in a worktree</strong><small>Optional. You can move the conversation later when it needs to change files.</small></span></label>
            <button className="primary starter-send" disabled={busy || !prompt.trim()} onClick={() => void startConversation()}>{busy ? "Starting..." : "Start conversation"}</button>
          </div>
        </section>
        {error ? <div className="error-banner">{error}</div> : null}

        <div className="section-heading session-heading">
          <div><h2>Conversations</h2><p>Pick up any discussion, whether it is exploratory or already isolated for implementation.</p></div>
          <div className="session-filters">
            <input value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} placeholder="Search sessions…" />
            <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value as typeof sessionFilter)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
        <section className="session-library">
          {groupSessions(visibleSessions).map(([label, group]) => (
            <div className="session-group" key={label}>
              <div className="session-group-label">{label}<span>{group.length}</span></div>
              {group.map((session) => (
                <SessionLibraryRow
                  session={session}
                  busy={busy}
                  key={session.sessionId}
                  onOpen={() => void openSession(session.sessionId)}
                  onFork={() => void forkSessionIntoWorktree(session.sessionId)}
                  onPin={() => void mutateSession(session.sessionId, session.pinnedAt ? "unpin" : "pin")}
                  onArchive={() => void mutateSession(session.sessionId, session.lifecycle === "archived" ? "restore" : "archive")}
                  onDelete={() => void mutateSession(session.sessionId, "delete")}
                />
              ))}
            </div>
          ))}
          {visibleSessions.length === 0 ? <EmptyState title="No matching conversations" body="Start by asking a question above, or change the search and lifecycle filters." /> : null}
        </section>

        <div className="section-heading">
          <div><h2>Worktrees</h2><p>Git state and agent context, reconciled on every refresh.</p></div>
          <button className="quiet" onClick={() => void refresh()}>Refresh</button>
        </div>
        <section className="lane-list">
          {isolatedLanes.map((lane) => (
            <LaneRow
              lane={lane}
              busy={busy}
              key={lane.laneId}
              onOpen={() => void openLane(lane)}
              onArchive={() => void mutateLane("/api/lanes/archive", { laneId: lane.laneId })}
              onFinish={() => void beginFinish(lane.laneId)}
              onLock={() => void mutateLane("/api/lanes/lock", { laneId: lane.laneId, deleteLocked: !lane.deleteLocked })}
              onRemove={() => {
                const phrase = window.prompt(`Type ${lane.laneId} to remove this worktree${lane.dirty ? " and its uncommitted changes" : ""}.`);
                if (phrase === lane.laneId) void mutateLane("/api/lanes/remove", { laneId: lane.laneId });
              }}
            />
          ))}
          {isolatedLanes.length === 0 ? <EmptyState title="No isolated worktrees" body="Keep talking in repository context, or start a worktree when a conversation is ready for file changes." /> : null}
        </section>
      </main>
      {finishAssessment ? (
        <FinishWorkDialog
          assessment={finishAssessment}
          confirmation={finishConfirmation}
          removeWorktree={removeAfterFinish}
          busy={busy}
          onConfirmation={setFinishConfirmation}
          onRemoveWorktree={setRemoveAfterFinish}
          onClose={() => setFinishAssessment(null)}
          onFinish={() => void finishWork()}
        />
      ) : null}
      {settingsOpen ? <SettingsDialog
        authOptions={snapshot.authOptions}
        connectors={snapshot.connectors}
        busy={busy}
        onSelect={selectAuthOption}
        onInstallConnector={(presetId) => mutateConnector("/api/settings/connectors/install", { presetId })}
        onToggleConnector={(connectorId, enabled) => mutateConnector("/api/settings/connectors/toggle", { connectorId, enabled })}
        onRemoveConnector={(connectorId) => mutateConnector("/api/settings/connectors/remove", { connectorId })}
        onClose={() => setSettingsOpen(false)}
      /> : null}
    </div>
  );
}

function LaneRow(props: {
  lane: LaneSummary;
  busy: boolean;
  onOpen(): void;
  onArchive(): void;
  onFinish(): void;
  onLock(): void;
  onRemove(): void;
}) {
  const { lane } = props;
  const changed = lane.stagedCount + lane.unstagedCount + lane.untrackedCount;
  return (
    <article className="lane-row">
      <button className="lane-open" disabled={props.busy || lane.lifecycle === "missing" || lane.lifecycle === "prunable"} onClick={props.onOpen}>
        <span className={`lane-dot ${lane.lifecycle}`} />
        <span className="lane-primary"><strong>{lane.planId ?? lane.laneId}</strong><small>{lane.branchName ?? "detached"}</small></span>
      </button>
      <div className="lane-metrics">
        <Metric label="state" value={lane.lifecycle} />
        <Metric label="changes" value={String(changed)} />
        <Metric label="ahead / behind" value={`${lane.aheadCount} / ${lane.behindCount}`} />
        <Metric label="skills context" value={lane.lastMode ?? "not opened"} />
      </div>
      <div className="lane-guidance"><strong>{lane.nextAction}</strong><span>{lane.worktreePath}</span></div>
      <details className="row-menu">
        <summary>•••</summary>
        <div>
          {lane.source === "managed" ? <button onClick={props.onFinish} disabled={props.busy}>Finish work…</button> : null}
          <button onClick={props.onArchive} disabled={props.busy || lane.archived}>Archive</button>
          {!lane.isCurrentCheckout ? <button onClick={props.onLock}>{lane.deleteLocked ? "Unlock removal" : "Lock removal"}</button> : null}
          {!lane.isCurrentCheckout ? <button className="danger" onClick={props.onRemove} disabled={!lane.canRemove}>Remove worktree</button> : null}
        </div>
      </details>
    </article>
  );
}

function SessionLibraryRow(props: {
  session: AgentSessionRecord;
  busy: boolean;
  onOpen(): void;
  onFork(): void;
  onPin(): void;
  onArchive(): void;
  onDelete(): void;
}) {
  const { session } = props;
  const binding = [...session.workspaceBindings].reverse().find((item) => !item.retiredAt) ?? session.workspaceBindings.at(-1);
  const resumable = Boolean(binding && !binding.retiredAt && session.lifecycle === "active");
  return (
    <article className={`library-session ${session.lifecycle}`}>
      <button className="library-session-main" disabled={props.busy || !resumable} onClick={props.onOpen}>
        <span className={`session-state ${session.status}`} />
        <span className="library-session-copy">
          <strong>{session.pinnedAt ? "◆ " : ""}{session.title}</strong>
          <small>{session.lastMessagePreview ?? "No conversation preview yet."}</small>
        </span>
      </button>
      <div className="session-context">
        <span>{(binding?.laneId ?? session.laneId) === "current" ? "repository chat" : binding?.laneId ?? session.laneId}</span>
        <span>{(binding?.laneId ?? session.laneId) === "current" ? "primary checkout protected" : binding?.branchName ?? "branch unknown"}</span>
        {session.parentSessionId ? <span>fork</span> : null}
        {binding?.retiredAt ? <span className="retired">worktree retired</span> : null}
      </div>
      <time>{formatRelativeTime(session.updatedAt)}</time>
      <details className="row-menu session-menu"><summary>•••</summary><div>
        <button onClick={props.onPin}>{session.pinnedAt ? "Unpin" : "Pin"}</button>
        {binding?.retiredAt || binding?.laneId === "current" ? <button onClick={props.onFork}>{binding?.laneId === "current" ? "Continue in a worktree" : "Fork into new worktree"}</button> : null}
        <button onClick={props.onArchive}>{session.lifecycle === "archived" ? "Restore to history" : "Archive"}</button>
        <button className="danger" onClick={props.onDelete}>Remove from history</button>
      </div></details>
    </article>
  );
}

function FinishWorkDialog(props: {
  assessment: FinishWorkAssessment;
  confirmation: string;
  removeWorktree: boolean;
  busy: boolean;
  onConfirmation(value: string): void;
  onRemoveWorktree(value: boolean): void;
  onClose(): void;
  onFinish(): void;
}) {
  const { assessment } = props;
  const removalBlocked = !assessment.canRemoveWorktree;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="finish-dialog" role="dialog" aria-modal="true" aria-labelledby="finish-title">
        <header><div><div className="overline">Post-operation cleanup</div><h2 id="finish-title">Finish {assessment.planId ?? assessment.laneId}</h2><p>Archive the work without coupling session retention to worktree removal.</p></div><button className="quiet" onClick={props.onClose}>Close</button></header>
        <div className="finish-summary">
          <Metric label="sessions" value={String(assessment.sessionCount)} />
          <Metric label="changes" value={String(assessment.changedFileCount)} />
          <Metric label="ahead / behind" value={`${assessment.aheadCount} / ${assessment.behindCount}`} />
          <Metric label="conflicts" value={String(assessment.conflictCount)} />
        </div>
        {assessment.blockers.length ? <Notice tone="danger" title="Finish is blocked" items={assessment.blockers} /> : null}
        {assessment.warnings.length ? <Notice tone="warning" title="Review before finishing" items={assessment.warnings} /> : null}
        <Notice tone="safe" title="Srgical will preserve" items={assessment.preserved} />
        <label className={`finish-option ${removalBlocked ? "disabled" : ""}`}><input type="checkbox" checked={props.removeWorktree} disabled={removalBlocked} onChange={(event) => props.onRemoveWorktree(event.target.checked)} /><span><strong>Remove the worktree after archiving</strong><small>The Git branch is retained. This is available only when the worktree is clean, unlocked, and conflict-free.</small></span></label>
        {removalBlocked && assessment.removalBlockers.length ? <Notice tone="neutral" title="Worktree removal unavailable" items={assessment.removalBlockers} /> : null}
        <label className="confirmation-field"><span>Type <strong>{assessment.laneId}</strong> to confirm</span><input value={props.confirmation} onChange={(event) => props.onConfirmation(event.target.value)} /></label>
        <footer><button onClick={props.onClose}>Cancel</button><button className="primary" disabled={props.busy || !assessment.canArchive || props.confirmation !== assessment.laneId} onClick={props.onFinish}>{props.removeWorktree ? "Archive sessions & remove worktree" : "Archive sessions & finish"}</button></footer>
      </section>
    </div>
  );
}

function Notice({ tone, title, items }: { tone: "danger" | "warning" | "safe" | "neutral"; title: string; items: string[] }) {
  return <div className={`finish-notice ${tone}`}><strong>{title}</strong><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function Studio({ token, dashboardToken: homeToken }: { token: string; dashboardToken: string }) {
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [inspector, setInspector] = useState<"worktree" | "connectors" | "skills" | "plan" | "settings">("worktree");
  const transcriptScroll = useRef<HTMLElement>(null);
  const stickTranscriptToBottom = useRef(true);

  useEffect(() => {
    void getJson<StudioSnapshot>(`/api/studio/session?token=${encodeURIComponent(token)}`).then((next) => {
      setSnapshot(next);
      const initialMessage = takeInitialMessage(token);
      if (!initialMessage) return;
      setSending(true);
      void postJson("/api/studio/input", token, { text: initialMessage }).catch((reason) => {
        storeInitialMessage(token, initialMessage);
        window.alert(errorText(reason));
      }).finally(() => setSending(false));
    });
    const stream = new EventSource(`/api/studio/events?token=${encodeURIComponent(token)}`);
    stream.onmessage = (raw) => {
      const event = JSON.parse(raw.data) as StudioEvent;
      if (event.type === "snapshot" || event.type === "action") setSnapshot(event.snapshot);
      if (event.type === "agent") {
        setSnapshot((current) => current ? {
          ...current,
          recentAgentEvents: [...current.recentAgentEvents, event.event].slice(-250),
          agentSession: { ...current.agentSession, lastEventSequence: event.event.sequence }
        } : current);
      }
    };
    return () => stream.close();
  }, [token]);

  useEffect(() => {
    const scrollRegion = transcriptScroll.current;
    if (!scrollRegion || !stickTranscriptToBottom.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollRegion.scrollTop = scrollRegion.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [snapshot?.messages.length, snapshot?.messages.at(-1)?.content.length, snapshot?.recentAgentEvents.length]);

  const action = async (request: StudioActionRequest) => {
    await postJson("/api/studio/action", token, request);
  };
  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      await postJson("/api/studio/input", token, { text });
    } finally {
      setSending(false);
    }
  };
  const promoteToWorktree = async () => {
    if (!snapshot || snapshot.laneId !== "current" || promoting) return;
    setPromoting(true);
    try {
      const opened = await postJson<LaneOpenResponse, { sessionId: string }>("/api/sessions/fork-worktree", homeToken, { sessionId: snapshot.agentSession.sessionId });
      window.location.assign(opened.url);
    } catch (reason) {
      window.alert(errorText(reason));
      setPromoting(false);
    }
  };

  if (!snapshot) return <Loading label="Resuming conversation" />;
  const pendingPermissions = unresolvedEvents(snapshot.recentAgentEvents, "permission.requested", "permission.resolved");
  const pendingQuestions = unresolvedEvents(snapshot.recentAgentEvents, "question.requested", "question.resolved");
  const activity = latestActivity(snapshot.recentAgentEvents);
  const displayMessages = snapshot.messages;

  return (
    <div className="studio-layout">
      <aside className="session-rail">
        <Brand compact />
        <button className="back-link" onClick={() => window.location.assign(`/?token=${encodeURIComponent(homeToken)}`)}>← All conversations</button>
        <div className="rail-section-label">Workspace</div>
        <div className="rail-lane"><span className="lane-dot current" /><div><strong>{snapshot.laneId === "current" ? "Repository chat" : "Isolated worktree"}</strong><small>{snapshot.branchName ?? "detached"}</small></div></div>
        <div className="rail-section-label">Conversation</div>
        <button className="new-session" onClick={() => void action({ type: "session-create" })}>＋ New conversation</button>
        {snapshot.agentSessions.map((session) => <button className={`session-item ${session.sessionId === snapshot.agentSession.sessionId ? "active" : ""}`} onClick={() => void action({ type: "session-switch", sessionId: session.sessionId })} key={session.sessionId}><span>{session.pinnedAt ? "◆" : session.parentSessionId ? "⑂" : "◌"}</span><div><strong>{session.title}</strong><small>{session.lifecycle} · {session.status} · {new Date(session.updatedAt).toLocaleDateString()}</small></div></button>)}
        <div className="rail-spacer" />
        <div className="provider-card">
          <span className={`provider-light ${snapshot.agentProvider.authenticated === false ? "off" : ""}`} />
          <div><strong>{snapshot.agentProvider.label}</strong><small>{snapshot.agentProvider.detail ?? "Provider ready"}</small></div>
        </div>
      </aside>

      <main className="conversation-pane">
        <header className="conversation-header">
          <div><strong>{snapshot.agentSession.title}</strong><span>{snapshot.workspaceLabel} · {snapshot.laneId === "current" ? "repository chat · planning permissions" : `${snapshot.mode} · ${snapshot.agentSession.permissionMode} permissions`}</span></div>
          <div className="header-actions">
            {snapshot.busy ? <button className="stop" onClick={() => void action({ type: "interrupt-agent" })}>■ Stop</button> : null}
            <button className="quiet" onClick={() => void action({ type: "session-pin", pinned: !snapshot.agentSession.pinnedAt })}>{snapshot.agentSession.pinnedAt ? "Unpin" : "Pin"}</button>
            <button className="quiet" onClick={() => void action({ type: "session-archive" })}>Archive</button>
            <button className="quiet" onClick={() => void action({ type: "session-fork" })}>Fork</button>
            <button className="quiet" onClick={() => { const title = window.prompt("Conversation title", snapshot.agentSession.title); if (title?.trim()) void action({ type: "session-rename", title }); }}>Rename</button>
            {snapshot.laneId === "current" ? <button className="primary promote-worktree" disabled={snapshot.busy || promoting} onClick={() => void promoteToWorktree()}>{promoting ? "Creating..." : "Create worktree"}</button> : <button className="quiet" onClick={() => void action({ type: "switch-mode", mode: snapshot.mode === "prepare" ? "operate" : "prepare" })}>
              {snapshot.mode === "prepare" ? "Switch to operate" : "Return to prepare"}
            </button>}
          </div>
        </header>

        <section
          className="conversation-scroll"
          ref={transcriptScroll}
          tabIndex={0}
          aria-label="Conversation transcript"
          onScroll={(event) => {
            const region = event.currentTarget;
            stickTranscriptToBottom.current = region.scrollHeight - region.scrollTop - region.clientHeight < 96;
          }}
        >
          <div className="conversation-inner">
            <div className="conversation-context">
              <div className="context-pills">
                <span>{snapshot.skills.effectiveSkillHashes.length} skills</span>
                <span>{snapshot.agentProvider.label}</span>
                <span>{snapshot.laneId === "current" ? "repository context" : snapshot.branchName ?? "detached"}</span>
              </div>
              <p>{snapshot.laneId === "current" ? "Primary checkout is protected. Create a worktree when the conversation is ready for file changes." : snapshot.prepareClarity?.coachHeadline ?? snapshot.state.nextAction}</p>
            </div>

            {displayMessages.map((message, index) => (
              <article className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
                <div className="avatar">{message.role === "user" ? "Y" : message.role === "assistant" ? "S" : "i"}</div>
                <div><div className="message-author">{message.role === "user" ? "You" : message.role === "assistant" ? snapshot.agentLabel : "Srgical"}</div><MessageContent role={message.role} content={message.content} /></div>
              </article>
            ))}

            {activity.map((event) => <Activity event={event} key={event.eventId} />)}
            {pendingPermissions.map((event) => <PermissionPrompt event={event} action={action} key={event.eventId} />)}
            {pendingQuestions.map((event) => <QuestionPrompt event={event} action={action} key={event.eventId} />)}
          </div>
        </section>

        <section className="composer-wrap">
          <div className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={snapshot.laneId === "current" ? "Ask about the repository, explore an idea, or describe a change…" : snapshot.mode === "prepare" ? "Ask Srgical to explore, plan, or implement…" : "Describe the next change or use an action…"}
              rows={2}
            />
            <div className="composer-footer"><span>{snapshot.laneId === "current" ? "Primary checkout protected · create a worktree to edit" : `${snapshot.skills.effectiveSkillHashes.length} effective skills · Enter to send`}</span><button className="send-button" disabled={!input.trim() || sending} onClick={() => void send()}>↑</button></div>
          </div>
        </section>
      </main>

      <aside className="inspector-pane">
        <div className="inspector-tabs">
          {(["worktree", "connectors", "skills", "plan", "settings"] as const).map((tab) => <button className={inspector === tab ? "active" : ""} onClick={() => setInspector(tab)} key={tab}>{tab === "connectors" ? "MCP" : tab}</button>)}
        </div>
        <div className="inspector-body">
          {inspector === "worktree" ? <WorktreeInspector snapshot={snapshot} /> : null}
          {inspector === "connectors" ? <ConnectorsInspector snapshot={snapshot} action={action} /> : null}
          {inspector === "skills" ? <SkillsInspector snapshot={snapshot} action={action} /> : null}
          {inspector === "plan" ? <PlanInspector snapshot={snapshot} action={action} /> : null}
          {inspector === "settings" ? <SettingsInspector snapshot={snapshot} action={action} /> : null}
        </div>
      </aside>
    </div>
  );
}

function SettingsDialog(props: {
  authOptions: StudioAuthOptionStatus[];
  connectors: ConnectorRegistrySnapshot;
  busy: boolean;
  onSelect(authOptionId: StudioAuthOptionId): Promise<void>;
  onInstallConnector(presetId: string): Promise<void>;
  onToggleConnector(connectorId: string, enabled: boolean): Promise<void>;
  onRemoveConnector(connectorId: string): Promise<void>;
  onClose(): void;
}) {
  const [section, setSection] = useState<"providers" | "connectors">("providers");
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><div className="overline">Studio settings</div><h2 id="settings-title">Settings</h2><p>Choose how Studio talks to models and which workspace services agents may access.</p></div><button className="quiet" onClick={props.onClose}>Close</button></header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <button className={section === "providers" ? "active" : ""} onClick={() => setSection("providers")}><strong>Models</strong><small>Providers and billing</small></button>
          <button className={section === "connectors" ? "active" : ""} onClick={() => setSection("connectors")}><strong>Connectors</strong><small>Slack, Linear, Notion</small></button>
        </nav>
        <div className="settings-content">
          {section === "providers" ? <>
            <div className="settings-page-heading"><h3>Provider & billing path</h3><p>Choose the authenticated route new conversations will use. Existing conversations keep the route they started with.</p></div>
            <ProviderOptions authOptions={props.authOptions} busy={props.busy} onSelect={props.onSelect} />
          </> : <>
            <div className="settings-page-heading"><h3>Connected services</h3><p>Add trusted MCP services to this repository. OAuth opens when the selected agent first uses a configured service.</p></div>
            <ConnectorSettings
              connectors={props.connectors}
              busy={props.busy}
              onInstall={props.onInstallConnector}
              onToggle={props.onToggleConnector}
              onRemove={props.onRemoveConnector}
            />
          </>}
        </div>
      </div>
    </section>
  </div>;
}

function SettingsInspector({ snapshot, action }: { snapshot: StudioSnapshot; action(request: StudioActionRequest): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (request: StudioActionRequest) => {
    setBusy(true);
    setError(null);
    try {
      await action(request);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <InspectorTitle title="Settings" subtitle="Global Studio preferences" />
    <div className="settings-section">
      <div className="settings-section-heading"><strong>Provider & billing path</strong><p>Selection applies to new conversations. This conversation remains on <b>{snapshot.agentProvider.label}</b>.</p></div>
      {error ? <div className="inline-error">{error}</div> : null}
      <ProviderOptions
        authOptions={snapshot.authOptions}
        currentProviderId={snapshot.agentProvider.providerId}
        busy={busy}
        compact
        onSelect={(authOptionId) => run({ type: "provider-auth-select", authOptionId })}
      />
    </div>
    <div className="settings-section">
      <div className="settings-section-heading"><strong>Connected services</strong><p>Repository-scoped MCP access. Authentication completes when the agent first connects.</p></div>
      <ConnectorSettings
        connectors={snapshot.connectors}
        busy={busy}
        compact
        onInstall={(presetId) => run({ type: "connector-install", presetId })}
        onToggle={(connectorId, enabled) => run({ type: "connector-toggle", connectorId, selected: enabled })}
        onRemove={(connectorId) => run({ type: "connector-remove", connectorId })}
      />
    </div>
    <div className="settings-section">
      <div className="settings-section-heading"><strong>Theme</strong><p>Applied immediately across Studio.</p></div>
      <div className="theme-options">{STUDIO_THEMES.map((theme) => <button className={snapshot.settings.themeId === theme.id ? "selected" : ""} disabled={busy} onClick={() => void run({ type: "theme", themeId: theme.id, announce: false })} key={theme.id}><strong>{theme.label}</strong><small>{theme.description}</small></button>)}</div>
    </div>
  </>;
}

const FEATURED_CONNECTOR_IDS = ["slack", "linear", "notion"];

function ConnectorSettings(props: {
  connectors: ConnectorRegistrySnapshot;
  busy: boolean;
  compact?: boolean;
  onInstall(presetId: string): Promise<void>;
  onToggle(connectorId: string, enabled: boolean): Promise<void>;
  onRemove(connectorId: string): Promise<void>;
}) {
  const presets = FEATURED_CONNECTOR_IDS.flatMap((presetId) => {
    const preset = props.connectors.catalog.find((item) => item.presetId === presetId);
    return preset ? [preset] : [];
  });
  return <div className={`settings-connectors ${props.compact ? "compact" : ""}`}>
    {presets.map((preset) => {
      const connector = props.connectors.connectors.find((item) => item.presetId === preset.presetId);
      const connected = connector?.status === "connected";
      const configured = Boolean(connector?.enabled && ["ready", "needs-auth", "pending"].includes(connector.status));
      const state = connected ? "Connected" : configured ? "Configured" : connector?.enabled === false ? "Disabled" : connector ? "Needs attention" : "Not connected";
      return <article className={`settings-connector ${connected ? "connected" : configured ? "configured" : "offline"}`} key={preset.presetId}>
        <div className="settings-connector-heading"><span className="connector-brand-mark">{preset.label.slice(0, 1)}</span><div><strong>{preset.label}</strong><small>{preset.category}</small></div><span className="settings-connector-state"><i />{state}</span></div>
        <p>{preset.description}</p>
        <small>{connected ? connector?.statusDetail ?? "Authenticated and available to the current provider." : connector ? connector.statusDetail ?? "The OAuth window will open on the next agent turn that connects to this service." : preset.authDescription}</small>
        <footer>
          <a href={preset.setupUrl} target="_blank" rel="noreferrer">Setup guide</a>
          <div>{connector ? <><button disabled={props.busy} onClick={() => void props.onToggle(connector.connectorId, !connector.enabled)}>{connector.enabled ? "Disable" : "Enable"}</button><button className="quiet" disabled={props.busy} onClick={() => void props.onRemove(connector.connectorId)}>Remove</button></> : <button className="primary" disabled={props.busy} onClick={() => void props.onInstall(preset.presetId)}>Connect</button>}</div>
        </footer>
      </article>;
    })}
    <p className="connector-privacy-note">Connector definitions are stored outside the repository. OAuth credentials remain in the selected provider's credential store.</p>
  </div>;
}

function ProviderOptions(props: {
  authOptions: StudioAuthOptionStatus[];
  currentProviderId?: string;
  busy: boolean;
  compact?: boolean;
  onSelect(authOptionId: StudioAuthOptionId): Promise<void>;
}) {
  const groups = ["Codex", "Claude"].map((provider) => ({
    provider,
    options: props.authOptions.filter((option) => option.providerLabel === provider)
  }));
  return <div className={`provider-options ${props.compact ? "compact" : ""}`}>
    {groups.map((group) => <section className="provider-option-group" key={group.provider}>
      <div className="provider-group-heading"><strong>{group.provider}</strong><span>{group.options.filter((option) => option.authenticated).length} live</span></div>
      {group.options.map((option) => {
        const current = props.currentProviderId === option.providerId;
        return <button
          className={`provider-option ${option.authenticated ? "live" : "offline"} ${option.selected ? "selected" : ""} ${current ? "current" : ""}`}
          disabled={props.busy || !option.authenticated || option.selected}
          onClick={() => void props.onSelect(option.id)}
          key={option.id}
        >
          <span className="provider-option-light" aria-hidden="true" />
          <span className="provider-option-copy"><span><strong>{option.label}</strong><em>{option.authenticationType.replace("-", " ")}</em></span><small>{option.description}</small><small className="provider-option-detail">{option.authenticated ? option.detail : option.setupHint}</small></span>
          <span className="provider-option-state">{current ? "Current session" : option.selected ? option.authenticated ? "Selected" : "Selected · offline" : option.authenticated ? "Use" : "Not connected"}</span>
        </button>;
      })}
      {group.provider === "Claude" ? <p className="provider-auth-note">Claude subscription OAuth is not exposed by the native Agent SDK. Console API key and supported cloud-provider routes are shown instead.</p> : null}
    </section>)}
  </div>;
}

function Activity({ event }: { event: AgentEvent }) {
  if (event.kind.startsWith("tool.")) {
    const payload = event.payload as { toolName?: string; message?: string; toolUseId: string };
    return <div className="activity-card"><span className="activity-icon">⌘</span><div><strong>{payload.toolName ?? "Tool activity"}</strong><small>{event.kind.replace("tool.", "")} {payload.message ?? ""}</small></div></div>;
  }
  if (event.kind.startsWith("task.")) {
    const payload = event.payload as { subject: string; status?: string; summary?: string };
    return <div className="activity-card"><span className="activity-icon">✓</span><div><strong>{payload.subject}</strong><small>{payload.status ?? event.kind.replace("task.", "")} {payload.summary ?? ""}</small></div></div>;
  }
  if (event.kind === "session.failed") return <div className="inline-error">{event.payload.message}</div>;
  return null;
}

function PermissionPrompt({ event, action }: { event: AgentEvent; action(request: StudioActionRequest): Promise<void> }) {
  if (event.kind !== "permission.requested") return null;
  return (
    <article className="decision-card">
      <div className="decision-heading"><span>Permission requested</span><strong>{event.payload.title ?? event.payload.toolName}</strong></div>
      <p>{event.payload.description ?? `Claude wants to use ${event.payload.toolName}.`}</p>
      <pre>{JSON.stringify(event.payload.input, null, 2)}</pre>
      <div className="decision-actions"><button className="primary" onClick={() => void action({ type: "permission-resolve", requestId: event.payload.requestId, behavior: "allow", updatedInput: event.payload.input })}>Allow once</button><button onClick={() => void action({ type: "permission-resolve", requestId: event.payload.requestId, behavior: "deny", message: "Denied by user" })}>Deny</button></div>
    </article>
  );
}

function QuestionPrompt({ event, action }: { event: AgentEvent; action(request: StudioActionRequest): Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (event.kind !== "question.requested") return null;
  return (
    <article className="decision-card question-card">
      <div className="decision-heading"><span>Claude needs your input</span><strong>Choose how to continue</strong></div>
      {event.payload.questions.map((question) => (
        <fieldset key={question.question}><legend>{question.question}</legend>{question.options.map((option) => <label className={answers[question.question] === option.label ? "selected" : ""} key={option.label}><input type="radio" name={question.question} onChange={() => setAnswers((current) => ({ ...current, [question.question]: option.label }))} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>
      ))}
      <button className="primary" disabled={Object.keys(answers).length < event.payload.questions.length} onClick={() => void action({ type: "question-resolve", requestId: event.payload.requestId, answers })}>Continue</button>
    </article>
  );
}

function WorktreeInspector({ snapshot }: { snapshot: StudioSnapshot }) {
  const repositoryChat = snapshot.laneId === "current";
  return <><InspectorTitle title={repositoryChat ? "Repository context" : "Worktree"} subtitle={snapshot.workspace} /><InfoRow label="Branch" value={snapshot.branchName ?? "detached"} /><InfoRow label="Workspace" value={repositoryChat ? "Primary checkout (protected)" : snapshot.laneId} /><InfoRow label="Session" value={snapshot.agentSession.status} /><InfoRow label="Provider session" value={snapshot.agentSession.providerSessionId?.slice(0, 12) ?? "not started"} /><div className="inspector-note"><strong>{repositoryChat ? "Conversation first" : "Isolation boundary"}</strong><p>{repositoryChat ? "This conversation can inspect and plan against the repository. Promote it to a worktree before making file changes." : "This lane owns its worktree, branch, plan, durable agent session, and effective skill hashes."}</p></div></>;
}

function ConnectorsInspector({ snapshot, action }: { snapshot: StudioSnapshot; action(request: StudioActionRequest): Promise<void> }) {
  const [panel, setPanel] = useState<"catalog" | "custom" | "import">("catalog");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("http");
  const [endpoint, setEndpoint] = useState("");
  const [args, setArgs] = useState("");
  const [environment, setEnvironment] = useState("");
  const [authMode, setAuthMode] = useState<"none" | "bearer" | "oauth">("none");
  const [tokenEnv, setTokenEnv] = useState("");
  const [clientIdEnv, setClientIdEnv] = useState("");
  const [clientSecretEnv, setClientSecretEnv] = useState("");
  const [rawConfig, setRawConfig] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const installedPresets = new Set(snapshot.connectors.connectors.map((connector) => connector.presetId));

  const run = async (request: StudioActionRequest, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action(request);
      done?.();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const addCustom = () => {
    const definition: McpServerDefinition = transport === "stdio"
      ? {
          transport,
          command: endpoint.trim(),
          args: args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          env: parseKeyValueLines(environment)
        }
      : {
          transport,
          url: endpoint.trim(),
          headers: authMode === "bearer" && tokenEnv.trim()
            ? { Authorization: `Bearer \${${normalizeEnvName(tokenEnv)}}` }
            : undefined,
          oauth: authMode === "oauth" ? {
            clientId: clientIdEnv.trim() ? `\${${normalizeEnvName(clientIdEnv)}}` : undefined,
            clientSecret: clientSecretEnv.trim() ? `\${${normalizeEnvName(clientSecretEnv)}}` : undefined
          } : undefined
        };
    void run({
      type: "connector-upsert",
      connectorId: editingId ?? undefined,
      connectorLabel: name.trim(),
      connectorDescription: "Custom MCP server",
      connectorDefinition: definition
    }, () => {
      setName("");
      setEndpoint("");
      setArgs("");
      setEnvironment("");
      setTokenEnv("");
      setClientIdEnv("");
      setClientSecretEnv("");
      setEditingId(null);
      setPanel("catalog");
    });
  };

  return <>
    <InspectorTitle title="Connectors" subtitle={`${snapshot.connectors.readyCount} ready / ${snapshot.connectors.enabledCount} enabled`} />
    <div className="connector-summary">
      <span>Repository-scoped MCP access</span>
      <code title={snapshot.connectors.configPath}>{snapshot.connectors.configPath}</code>
      <p>Changes apply on the next agent turn. Secrets can stay in your environment by using <code>{"${ENV_VAR}"}</code>.</p>
    </div>
    {!snapshot.agentProvider.capabilities.includes("mcp") ? <div className="connector-provider-note">Saved connectors need the native Codex or Claude provider for managed loading. The current fallback may use only its own MCP configuration.</div> : null}
    {error ? <div className="inline-error connector-error">{error}</div> : null}
    {snapshot.connectors.connectors.length > 0
      ? <div className="connector-list">{snapshot.connectors.connectors.map((connector) => <ConnectorRow connector={connector} busy={busy} run={run} onEdit={() => {
        setEditingId(connector.connectorId);
        setName(connector.label);
        setTransport(connector.definition.transport);
        setEndpoint(connector.definition.transport === "stdio" ? connector.definition.command ?? "" : connector.definition.url ?? "");
        setArgs((connector.definition.args ?? []).join("\n"));
        setEnvironment(Object.entries(connector.definition.env ?? {}).map(([key, value]) => `${key}=${value}`).join("\n"));
        const authorization = connector.definition.headers?.Authorization ?? connector.definition.headers?.authorization;
        const bearerReference = authorization?.match(/^Bearer \$\{([^}]+)\}$/)?.[1] ?? "";
        const oauthIdReference = connector.definition.oauth?.clientId?.match(/^\$\{([^}]+)\}$/)?.[1] ?? "";
        const oauthSecretReference = connector.definition.oauth?.clientSecret?.match(/^\$\{([^}]+)\}$/)?.[1] ?? "";
        setAuthMode(bearerReference ? "bearer" : connector.definition.oauth ? "oauth" : "none");
        setTokenEnv(bearerReference);
        setClientIdEnv(oauthIdReference);
        setClientSecretEnv(oauthSecretReference);
        setPanel("custom");
      }} key={connector.connectorId} />)}</div>
      : <EmptyState title="No MCP servers installed" body="Choose a verified connector or add a custom MCP server below." />}
    <div className="connector-mode-tabs">
      {(["catalog", "custom", "import"] as const).map((item) => <button className={panel === item ? "active" : ""} onClick={() => setPanel(item)} key={item}>{item}</button>)}
    </div>
    {panel === "catalog" ? <div className="connector-catalog">{snapshot.connectors.catalog.map((preset) => {
      const installed = installedPresets.has(preset.presetId);
      return <article className="connector-preset" key={preset.presetId}>
        <div><strong>{preset.label}</strong><span>{preset.category}</span></div>
        <p>{preset.description}</p>
        <small>{preset.authDescription}</small>
        <div><a href={preset.setupUrl} target="_blank" rel="noreferrer">Setup guide</a><button disabled={busy || installed} onClick={() => void run({ type: "connector-install", presetId: preset.presetId })}>{installed ? "Installed" : "Install"}</button></div>
      </article>;
    })}</div> : null}
    {panel === "custom" ? <div className="connector-form">
      <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="My MCP server" /></label>
      <label><span>Transport</span><select value={transport} onChange={(event) => setTransport(event.target.value as McpTransport)}><option value="http">Streamable HTTP</option><option value="sse">SSE</option><option value="stdio">Local process (stdio)</option></select></label>
      <label><span>{transport === "stdio" ? "Command" : "Server URL"}</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={transport === "stdio" ? "npx" : "https://mcp.example.com/mcp"} /></label>
      {transport === "stdio" ? <><label><span>Arguments (one per line)</span><textarea rows={4} value={args} onChange={(event) => setArgs(event.target.value)} placeholder={"-y\n@vendor/mcp-server"} /></label><label><span>Environment (KEY=value, one per line)</span><textarea rows={3} value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder={"API_TOKEN=${MY_MCP_TOKEN}"} /></label></> : <>
        <label><span>Authentication</span><select value={authMode} onChange={(event) => setAuthMode(event.target.value as typeof authMode)}><option value="none">None / server-managed OAuth</option><option value="bearer">Bearer token from environment</option><option value="oauth">OAuth client from environment</option></select></label>
        {authMode === "bearer" ? <label><span>Token environment variable</span><input value={tokenEnv} onChange={(event) => setTokenEnv(event.target.value)} placeholder="MY_MCP_TOKEN" /></label> : null}
        {authMode === "oauth" ? <><label><span>Client ID environment variable</span><input value={clientIdEnv} onChange={(event) => setClientIdEnv(event.target.value)} placeholder="MY_MCP_CLIENT_ID" /></label><label><span>Client secret environment variable</span><input value={clientSecretEnv} onChange={(event) => setClientSecretEnv(event.target.value)} placeholder="MY_MCP_CLIENT_SECRET" /></label></> : null}
      </>}
      <button className="primary" disabled={busy || !name.trim() || !endpoint.trim() || (authMode === "bearer" && !tokenEnv.trim())} onClick={addCustom}>{editingId ? "Save changes" : "Add MCP server"}</button>
    </div> : null}
    {panel === "import" ? <div className="connector-form connector-import">
      <p>Paste a Claude-style <code>mcpServers</code> object. HTTP, SSE, stdio, headers, environment, OAuth metadata, timeout, and always-load settings are supported.</p>
      <textarea rows={11} value={rawConfig} onChange={(event) => setRawConfig(event.target.value)} spellCheck={false} placeholder={'{\n  "mcpServers": {\n    "example": {\n      "type": "http",\n      "url": "https://mcp.example.com/mcp"\n    }\n  }\n}'} />
      <button className="primary" disabled={busy || !rawConfig.trim()} onClick={() => void run({ type: "connector-import", rawConfig }, () => { setRawConfig(""); setPanel("catalog"); })}>Import configuration</button>
    </div> : null}
  </>;
}

function ConnectorRow({ connector, busy, run, onEdit }: { connector: ConnectorRecord; busy: boolean; run(request: StudioActionRequest): Promise<void>; onEdit(): void }) {
  const statusLabel = connector.status.replace("-", " ");
  return <article className={`connector-row ${connector.status}`}>
    <div className="connector-heading"><span className={`connector-light ${connector.status}`} /><div><strong>{connector.label}</strong><small>{connector.definition.transport} · {statusLabel}</small></div></div>
    <p>{connector.description}</p>
    {connector.statusDetail ? <div className="connector-detail">{connector.statusDetail}</div> : null}
    {connector.missingEnvironmentVariables.length > 0 ? <div className="connector-env">Missing: {connector.missingEnvironmentVariables.map((name) => <code key={name}>{name}</code>)}</div> : null}
    {connector.tools.length > 0 ? <details className="connector-tools"><summary>{connector.tools.length} tools</summary>{connector.tools.map((tool) => <div key={tool.name}><code>{tool.name}</code>{tool.destructive ? <span>destructive</span> : tool.readOnly ? <span>read only</span> : null}</div>)}</details> : null}
    <div className="connector-actions"><button disabled={busy} onClick={() => void run({ type: "connector-toggle", connectorId: connector.connectorId, selected: !connector.enabled })}>{connector.enabled ? "Disable" : "Enable"}</button>{connector.presetId ? null : <button disabled={busy} onClick={onEdit}>Edit</button>}<button className="danger" disabled={busy} onClick={() => { if (window.confirm(`Remove ${connector.label}?`)) void run({ type: "connector-remove", connectorId: connector.connectorId }); }}>Remove</button></div>
  </article>;
}

function normalizeEnvName(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function parseKeyValueLines(value: string): Record<string, string> | undefined {
  const entries = value.split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const : null;
  }).filter((entry): entry is readonly [string, string] => Boolean(entry?.[0]));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function SkillsInspector({ snapshot, action }: { snapshot: StudioSnapshot; action(request: StudioActionRequest): Promise<void> }) {
  const [directory, setDirectory] = useState("");
  return <><InspectorTitle title="Skills" subtitle={`${snapshot.skills.skills.filter((skill) => skill.effective).length} effective · ${snapshot.skills.conflicts.length} conflicts`} /><div className="global-skill-path"><span>Global directory (created automatically)</span><code>{snapshot.skills.globalSkillsDirectory}</code></div><div className="skill-directory-add"><input value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="Additional skills directory" /><button disabled={!directory.trim()} onClick={() => { void action({ type: "skill-directory-add", directoryPath: directory.trim() }); setDirectory(""); }}>Add</button></div>{snapshot.skills.configuredDirectories.map((item) => <div className="configured-directory" key={item}><code>{item}</code><button onClick={() => void action({ type: "skill-directory-remove", directoryPath: item })}>Remove</button></div>)}{snapshot.skills.skills.length ? snapshot.skills.skills.map((skill) => <SkillRow skill={skill} action={action} key={`${skill.id}-${skill.source}`} />) : <EmptyState title="No skills found" body="Add a SKILL.md under the global directory or a project/provider skills directory." />}</>;
}

function SkillRow({ skill, action }: { skill: SkillRecord; action(request: StudioActionRequest): Promise<void> }) {
  return <article className={`skill-row ${skill.effective ? "effective" : ""}`}><div><strong>{skill.name}</strong><span>{skill.scope}</span></div><p>{skill.description}</p><small title={skill.source}>{skill.effective ? "Active for this session" : skill.shadowedBy ? "Shadowed by a higher-precedence skill" : "Inactive"}</small><div className="skill-controls"><button onClick={() => void action({ type: "skill-toggle", skillSource: skill.source, selected: !skill.enabled })}>{skill.enabled ? "Disable" : "Enable"}</button><select value={skill.trust} onChange={(event) => void action({ type: "skill-trust", skillSource: skill.source, trust: event.target.value as SkillRecord["trust"] })}><option value="trusted">Trusted</option><option value="review">Review</option><option value="blocked">Blocked</option></select></div></article>;
}

function PlanInspector({ snapshot, action }: { snapshot: StudioSnapshot; action(request: StudioActionRequest): Promise<void> }) {
  const actions: Array<{ label: string; request: StudioActionRequest }> = snapshot.mode === "prepare"
    ? [{ label: "Gather context", request: { type: "gather" } }, { label: "Build draft", request: { type: "build" } }, { label: "Slice plan", request: { type: "slice" } }, { label: "Approve", request: { type: "approve" } }]
    : [{ label: "Run next", request: { type: "run" } }, { label: "Auto continue", request: { type: "auto" } }, { label: "Checkpoint", request: { type: "checkpoint" } }, { label: "Review", request: { type: "review" } }];
  return <><InspectorTitle title="Plan" subtitle={snapshot.state.mode} /><div className="readiness"><span>Readiness</span><strong>{snapshot.state.readiness.score}/{snapshot.state.readiness.total}</strong><div><i style={{ width: `${snapshot.state.readiness.score / Math.max(1, snapshot.state.readiness.total) * 100}%` }} /></div></div><div className="next-action"><span>Recommended next move</span><p>{snapshot.state.nextAction}</p></div><div className="plan-actions">{actions.map(({ label, request }) => <button disabled={snapshot.busy || !snapshot.actions[request.type].enabled} title={snapshot.actions[request.type].blockedReason ?? undefined} onClick={() => void action(request)} key={label}>{label}</button>)}</div></>;
}

function unresolvedEvents(events: AgentEvent[], requested: "permission.requested" | "question.requested", resolved: "permission.resolved" | "question.resolved"): AgentEvent[] {
  const resolvedIds = new Set(events.filter((event) => event.kind === resolved).map((event) => (event.payload as { requestId: string }).requestId));
  return events.filter((event) => event.kind === requested && !resolvedIds.has((event.payload as { requestId: string }).requestId));
}

function latestActivity(events: AgentEvent[]): AgentEvent[] {
  const useful = events.filter((event) => event.kind.startsWith("tool.") || event.kind.startsWith("task.") || event.kind === "session.failed");
  const seen = new Set<string>();
  return useful.reverse().filter((event) => {
    const payload = event.payload as { toolUseId?: string; taskId?: string };
    const id = payload.toolUseId ?? payload.taskId ?? event.eventId;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 8).reverse();
}

function groupSessions(sessions: AgentSessionRecord[]): Array<[string, AgentSessionRecord[]]> {
  const groups = new Map<string, AgentSessionRecord[]>();
  for (const session of sessions) {
    const label = session.pinnedAt ? "Pinned" : dateGroup(session.updatedAt);
    groups.set(label, [...(groups.get(label) ?? []), session]);
  }
  const order = ["Pinned", "Today", "Yesterday", "Last 7 days", "Older"];
  return order.flatMap((label) => groups.has(label) ? [[label, groups.get(label)!] as [string, AgentSessionRecord[]]] : []);
}

function dateGroup(timestamp: string): string {
  const elapsed = Date.now() - new Date(timestamp).getTime();
  const days = Math.floor(elapsed / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Last 7 days";
  return "Older";
}

function formatRelativeTime(timestamp: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function MessageContent({ role, content }: { role: "user" | "assistant" | "system"; content: string }) {
  if (role !== "assistant") return <div className="message-plain">{content}</div>;
  return <div className="message-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>
  }}>{content}</ReactMarkdown></div>;
}

function Brand({ compact = false }: { compact?: boolean }) { return <div className={`brand ${compact ? "compact" : ""}`}><span>S</span><strong>srgical</strong></div>; }
function Loading({ label }: { label: string }) { return <div className="loading"><Brand /><span>{label}…</span></div>; }
function Stat({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function Metric({ value, label }: { value: string; label: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="info-row"><span>{label}</span><strong title={value}>{value}</strong></div>; }
function InspectorTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="inspector-title"><h2>{title}</h2><p>{subtitle}</p></div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>; }

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<T>;
}

async function postJson<TResponse = { ok: boolean }, TBody = unknown>(url: string, token: string, body: TBody): Promise<TResponse> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-srgical-token": token }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json() as Promise<TResponse>;
}

async function responseError(response: Response): Promise<string> {
  try { return ((await response.json()) as { error?: string }).error ?? `Request failed (${response.status})`; } catch { return `Request failed (${response.status})`; }
}
function errorText(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

function storeInitialMessage(token: string, message: string): void {
  window.sessionStorage.setItem(`srgical.initial-message.${token}`, message);
}

function takeInitialMessage(token: string): string | null {
  const key = `srgical.initial-message.${token}`;
  const message = window.sessionStorage.getItem(key);
  if (message) window.sessionStorage.removeItem(key);
  return message;
}
