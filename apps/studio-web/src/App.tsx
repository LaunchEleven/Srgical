import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LaneCreateRequest,
  LaneOpenResponse,
  FinishWorkAssessment,
  FinishWorkRequest,
  LaneSummary,
  RepoSnapshot,
  StudioActionRequest,
  StudioEvent,
  StudioSnapshot
} from "@srgical/studio-core";
import type { AgentEvent, AgentSessionRecord, SkillRecord } from "@srgical/studio-shared";

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
  const [planId, setPlanId] = useState("");
  const [mode, setMode] = useState<"prepare" | "operate">("prepare");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionFilter, setSessionFilter] = useState<"active" | "archived" | "all">("active");
  const [finishAssessment, setFinishAssessment] = useState<FinishWorkAssessment | null>(null);
  const [finishConfirmation, setFinishConfirmation] = useState("");
  const [removeAfterFinish, setRemoveAfterFinish] = useState(false);

  const refresh = async () => setSnapshot(await getJson<RepoSnapshot>(`/api/repo?token=${encodeURIComponent(token)}`));
  useEffect(() => {
    void refresh().then(() => undefined).catch((reason) => setError(errorText(reason)));
  }, [token]);
  useEffect(() => {
    if (!snapshot) return;
    setPlanId((current) => current || snapshot.requestedPlanId || "");
    setMode(snapshot.requestedMode ?? "prepare");
  }, [snapshot?.repoRoot]);

  const createLane = async () => {
    if (!planId.trim()) return setError("Name the plan before creating its isolated worktree.");
    setBusy(true);
    setError(null);
    try {
      const opened = await postJson<LaneOpenResponse, LaneCreateRequest>("/api/lanes/create", token, {
        planId: planId.trim(),
        mode
      });
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
        <div className="repo-path" title={snapshot.repoRoot}>{snapshot.repoRoot}</div>
      </header>
      <main className="home-main">
        <section className="home-intro">
          <div>
            <div className="overline">Repository workspace</div>
            <h1>{snapshot.repoLabel}</h1>
            <p>Each conversation lives in an isolated Git worktree, with its own plan, agent session, and effective skills.</p>
          </div>
          <div className="repo-stats">
            <Stat value={String(liveLanes.length)} label="worktrees" />
            <Stat value={String(snapshot.sessions.length)} label="sessions" />
            <Stat value={String(liveLanes.filter((lane) => lane.dirty).length)} label="in progress" />
            <Stat value={String(liveLanes.filter((lane) => lane.conflictCount > 0).length)} label="conflicted" />
          </div>
        </section>

        <section className="new-work-card">
          <div>
            <strong>Start isolated work</strong>
            <span>Srgical creates a branch, worktree, plan, and durable conversation together.</span>
          </div>
          <input value={planId} onChange={(event) => setPlanId(event.target.value)} placeholder="Plan name, e.g. native-agent-ux" />
          <select value={mode} onChange={(event) => setMode(event.target.value as "prepare" | "operate")}>
            <option value="prepare">Prepare first</option>
            <option value="operate">Operate</option>
          </select>
          <button className="primary" disabled={busy} onClick={() => void createLane()}>{busy ? "Working…" : "Create worktree"}</button>
        </section>
        {error ? <div className="error-banner">{error}</div> : null}

        <div className="section-heading session-heading">
          <div><h2>Sessions</h2><p>Durable conversations across every worktree in this repository.</p></div>
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
          {visibleSessions.length === 0 ? <EmptyState title="No matching sessions" body="Start a worktree conversation or change the search and lifecycle filters." /> : null}
        </section>

        <div className="section-heading">
          <div><h2>Worktrees</h2><p>Git state and agent context, reconciled on every refresh.</p></div>
          <button className="quiet" onClick={() => void refresh()}>Refresh</button>
        </div>
        <section className="lane-list">
          {liveLanes.map((lane) => (
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
    </div>
  );
}

function LaneRow(props: {
  lane: LaneSummary;
  busy: boolean;
  onOpen(): void;
  onFork(): void;
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
        <span>{binding?.laneId ?? session.laneId}</span>
        <span>{binding?.branchName ?? "branch unknown"}</span>
        {session.parentSessionId ? <span>fork</span> : null}
        {binding?.retiredAt ? <span className="retired">worktree retired</span> : null}
      </div>
      <time>{formatRelativeTime(session.updatedAt)}</time>
      <details className="row-menu session-menu"><summary>•••</summary><div>
        <button onClick={props.onPin}>{session.pinnedAt ? "Unpin" : "Pin"}</button>
        {binding?.retiredAt ? <button onClick={props.onFork}>Fork into new worktree</button> : null}
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
  const [inspector, setInspector] = useState<"worktree" | "skills" | "plan">("worktree");
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getJson<StudioSnapshot>(`/api/studio/session?token=${encodeURIComponent(token)}`).then(setSnapshot);
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
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [snapshot?.messages.length, snapshot?.recentAgentEvents.length]);

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

  if (!snapshot) return <Loading label="Resuming conversation" />;
  const pendingPermissions = unresolvedEvents(snapshot.recentAgentEvents, "permission.requested", "permission.resolved");
  const pendingQuestions = unresolvedEvents(snapshot.recentAgentEvents, "question.requested", "question.resolved");
  const activity = latestActivity(snapshot.recentAgentEvents);
  const displayMessages = structuredConversation(snapshot);

  return (
    <div className="studio-layout">
      <aside className="session-rail">
        <Brand compact />
        <button className="back-link" onClick={() => window.location.assign(`/?token=${encodeURIComponent(homeToken)}`)}>← All worktrees</button>
        <div className="rail-section-label">Current worktree</div>
        <div className="rail-lane"><span className="lane-dot current" /><div><strong>{snapshot.planId}</strong><small>{snapshot.branchName ?? "detached"}</small></div></div>
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
          <div><strong>{snapshot.workspaceLabel}</strong><span>{snapshot.mode} · {snapshot.agentSession.permissionMode} permissions</span></div>
          <div className="header-actions">
            {snapshot.busy ? <button className="stop" onClick={() => void action({ type: "interrupt-agent" })}>■ Stop</button> : null}
            <button className="quiet" onClick={() => void action({ type: "session-pin", pinned: !snapshot.agentSession.pinnedAt })}>{snapshot.agentSession.pinnedAt ? "Unpin" : "Pin"}</button>
            <button className="quiet" onClick={() => void action({ type: "session-archive" })}>Archive</button>
            <button className="quiet" onClick={() => void action({ type: "session-fork" })}>Fork</button>
            <button className="quiet" onClick={() => { const title = window.prompt("Conversation title", snapshot.agentSession.title); if (title?.trim()) void action({ type: "session-rename", title }); }}>Rename</button>
            <button className="quiet" onClick={() => void action({ type: "switch-mode", mode: snapshot.mode === "prepare" ? "operate" : "prepare" })}>
              {snapshot.mode === "prepare" ? "Switch to operate" : "Return to prepare"}
            </button>
          </div>
        </header>

        <section className="conversation-scroll">
          <div className="conversation-inner">
            <div className="conversation-intro">
              <div className="claude-mark">S</div>
              <h1>{snapshot.planId}</h1>
              <p>{snapshot.prepareClarity?.coachHeadline ?? snapshot.state.nextAction}</p>
              <div className="context-pills">
                <span>{snapshot.skills.effectiveSkillHashes.length} skills</span>
                <span>{snapshot.agentProvider.label}</span>
                <span>{snapshot.branchName ?? "detached"}</span>
              </div>
            </div>

            {displayMessages.map((message, index) => (
              <article className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
                <div className="avatar">{message.role === "user" ? "Y" : message.role === "assistant" ? "S" : "i"}</div>
                <div><div className="message-author">{message.role === "user" ? "You" : message.role === "assistant" ? snapshot.agentLabel : "Srgical"}</div><pre>{message.content}</pre></div>
              </article>
            ))}

            {activity.map((event) => <Activity event={event} key={event.eventId} />)}
            {pendingPermissions.map((event) => <PermissionPrompt event={event} action={action} key={event.eventId} />)}
            {pendingQuestions.map((event) => <QuestionPrompt event={event} action={action} key={event.eventId} />)}
            <div ref={transcriptEnd} />
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
              placeholder={snapshot.mode === "prepare" ? "Ask Srgical to explore, plan, or implement…" : "Describe the next change or use an action…"}
              rows={2}
            />
            <div className="composer-footer"><span>{snapshot.skills.effectiveSkillHashes.length} effective skills · Enter to send</span><button className="send-button" disabled={!input.trim() || sending} onClick={() => void send()}>↑</button></div>
          </div>
        </section>
      </main>

      <aside className="inspector-pane">
        <div className="inspector-tabs">
          {(["worktree", "skills", "plan"] as const).map((tab) => <button className={inspector === tab ? "active" : ""} onClick={() => setInspector(tab)} key={tab}>{tab}</button>)}
        </div>
        <div className="inspector-body">
          {inspector === "worktree" ? <WorktreeInspector snapshot={snapshot} /> : null}
          {inspector === "skills" ? <SkillsInspector snapshot={snapshot} action={action} /> : null}
          {inspector === "plan" ? <PlanInspector snapshot={snapshot} action={action} /> : null}
        </div>
      </aside>
    </div>
  );
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
  return <><InspectorTitle title="Worktree" subtitle={snapshot.workspace} /><InfoRow label="Branch" value={snapshot.branchName ?? "detached"} /><InfoRow label="Lane" value={snapshot.laneId} /><InfoRow label="Session" value={snapshot.agentSession.status} /><InfoRow label="Provider session" value={snapshot.agentSession.providerSessionId?.slice(0, 12) ?? "not started"} /><div className="inspector-note"><strong>Isolation boundary</strong><p>This lane owns its worktree, branch, plan, durable agent session, and effective skill hashes.</p></div></>;
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

function structuredConversation(snapshot: StudioSnapshot): StudioSnapshot["messages"] {
  const roles = new Map(snapshot.recentAgentEvents.filter((event) => event.kind === "message.started").map((event) => [event.payload.messageId, event.payload.role]));
  const completed = snapshot.recentAgentEvents.filter((event) => event.kind === "message.completed").map((event) => ({
    role: roles.get(event.payload.messageId) ?? "assistant",
    content: event.payload.text
  }));
  return completed.length > 0 ? completed : snapshot.messages;
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
