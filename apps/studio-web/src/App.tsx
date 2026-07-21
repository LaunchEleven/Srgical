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
import type { AgentEvent, AgentSessionRecord, ConnectorPreset, ConnectorRecord, ConnectorRegistrySnapshot, HookDefinition, HookTrigger, McpServerDefinition, McpTransport, SkillRecord, StudioAuthOptionId, StudioAuthOptionStatus } from "@srgical/studio-shared";

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
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const installApp = useInstallApp();

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

  const selectRepository = async (repositoryPath: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await postJson<RepoSnapshot, { path: string }>("/api/workspaces/select", token, { path: repositoryPath });
      setSnapshot(next);
      setRepositoryPickerOpen(false);
      setPrompt("");
      setSessionQuery("");
      setIsolation("repository");
    } catch (reason) {
      setError(errorText(reason));
      throw reason;
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

  if (!snapshot) return <Loading label="Opening workspace" />;
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
        <div className="home-header-actions">
          <div className="repo-path" title={snapshot.currentWorkspace}>{snapshot.currentWorkspace}</div>
          {installApp ? <button className="quiet settings-trigger" onClick={() => void installApp()}>Install app</button> : null}
          <button className="quiet settings-trigger" onClick={() => setRepositoryPickerOpen(true)}>Switch workspace</button>
          <button className="quiet settings-trigger" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>
      <main className="home-main">
        <section className="home-intro">
          <div>
            <div className="overline">{snapshot.isGitRepository ? "Git repository" : "Working directory"}</div>
            <h1>{snapshot.repoLabel}</h1>
            <p>{snapshot.isGitRepository ? "Start with a conversation. When the work needs file changes, move it into an isolated worktree without losing context." : "Start a conversation with this folder as the session's working directory. Srgical can inspect and change its files without requiring Git."}</p>
          </div>
          <div className="repo-stats">
            {snapshot.isGitRepository ? <Stat value={String(isolatedLanes.length)} label="worktrees" /> : <Stat value="Folder" label="workspace type" />}
            <Stat value={String(snapshot.sessions.length)} label="sessions" />
            {snapshot.isGitRepository ? <Stat value={String(isolatedLanes.filter((lane) => lane.dirty).length)} label="in progress" /> : <Stat value={String(snapshot.repositories.length)} label="recent" />}
            {snapshot.isGitRepository ? <Stat value={String(isolatedLanes.filter((lane) => lane.conflictCount > 0).length)} label="conflicted" /> : null}
          </div>
        </section>

        <section className="conversation-starter">
          <WorkspaceSelector
            currentPath={snapshot.currentWorkspace}
            label={snapshot.repoLabel}
            isGitRepository={snapshot.isGitRepository}
            recent={snapshot.repositories}
            busy={busy}
            onChoose={() => setRepositoryPickerOpen(true)}
            onSelect={selectRepository}
          />
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
            <label className={`isolation-choice ${snapshot.isGitRepository ? "" : "disabled"}`}><input type="checkbox" checked={isolation === "worktree"} disabled={!snapshot.isGitRepository} onChange={(event) => setIsolation(event.target.checked ? "worktree" : "repository")} /><span><strong>Start in a worktree</strong><small>{snapshot.isGitRepository ? "Optional. You can move the conversation later when it needs to change files." : "Worktrees are available when the selected folder is a Git repository."}</small></span></label>
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
                  canUseWorktrees={snapshot.isGitRepository}
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

        {snapshot.isGitRepository ? <>
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
        </> : null}
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
      {repositoryPickerOpen ? <WorkspacePickerDialog
        repositories={snapshot.repositories}
        currentPath={snapshot.currentWorkspace}
        busy={busy}
        onSelect={selectRepository}
        onClose={() => setRepositoryPickerOpen(false)}
      /> : null}
    </div>
  );
}

function WorkspaceSelector(props: {
  currentPath: string;
  label: string;
  isGitRepository: boolean;
  recent: RepoSnapshot["repositories"];
  busy: boolean;
  onChoose(): void;
  onSelect(path: string): Promise<void>;
}) {
  const alternatives = props.recent.filter((item) => !item.selected).slice(0, 3);
  return (
    <div className="workspace-selector">
      <button className="workspace-selector-current" type="button" disabled={props.busy} onClick={props.onChoose}>
        <span className="workspace-selector-icon" aria-hidden="true">{props.isGitRepository ? "⑂" : "▰"}</span>
        <span className="workspace-selector-copy"><small>Working directory</small><strong>{props.label}</strong><code>{props.currentPath}</code></span>
        <span className="workspace-selector-change">Change</span>
      </button>
      {alternatives.length > 0 ? <div className="workspace-quick-picks"><span>Recent</span>{alternatives.map((item) => <button type="button" disabled={props.busy} title={item.path} onClick={() => void props.onSelect(item.path)} key={item.path}>{item.label}</button>)}</div> : null}
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
  canUseWorktrees: boolean;
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
        <span>{(binding?.laneId ?? session.laneId) === "current" ? (props.canUseWorktrees ? "repository chat" : "folder session") : binding?.laneId ?? session.laneId}</span>
        <span>{(binding?.laneId ?? session.laneId) === "current" ? (props.canUseWorktrees ? "primary checkout protected" : "working directory") : binding?.branchName ?? "branch unknown"}</span>
        {session.parentSessionId ? <span>fork</span> : null}
        {binding?.retiredAt ? <span className="retired">worktree retired</span> : null}
      </div>
      <time>{formatRelativeTime(session.updatedAt)}</time>
      <details className="row-menu session-menu"><summary>•••</summary><div>
        <button onClick={props.onPin}>{session.pinnedAt ? "Unpin" : "Pin"}</button>
        {props.canUseWorktrees && (binding?.retiredAt || binding?.laneId === "current") ? <button onClick={props.onFork}>{binding?.laneId === "current" ? "Continue in a worktree" : "Fork into new worktree"}</button> : null}
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

function WorkspacePickerDialog(props: {
  repositories: RepoSnapshot["repositories"];
  currentPath: string;
  busy: boolean;
  onSelect(path: string): Promise<void>;
  onClose(): void;
}) {
  const [repositoryPath, setRepositoryPath] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const choose = async (candidate: string) => {
    const nextPath = candidate.trim();
    if (!nextPath || props.busy) return;
    setLocalError(null);
    try {
      await props.onSelect(nextPath);
    } catch (reason) {
      setLocalError(errorText(reason));
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="repository-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <header>
          <div><div className="overline">Working directory</div><h2 id="workspace-dialog-title">Choose where Srgical works</h2><p>Choose a Git repository or any folder. It becomes the working directory for new sessions; switching closes live local sessions and loads that workspace's conversations and settings.</p></div>
          <button className="quiet" onClick={props.onClose}>Close</button>
        </header>
        <div className="repository-current"><span>Current</span><code>{props.currentPath}</code></div>
        <form className="repository-path-form" onSubmit={(event) => { event.preventDefault(); void choose(repositoryPath); }}>
          <label><span>Folder path</span><input value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} placeholder="C:\\code\\my-project" autoFocus /></label>
          <button className="primary" disabled={props.busy || !repositoryPath.trim()}>{props.busy ? "Opening..." : "Open workspace"}</button>
        </form>
        {localError ? <div className="error-banner">{localError}</div> : null}
        <div className="repository-recents-heading">Recent workspaces</div>
        <div className="repository-recents">
          {props.repositories.map((repository) => (
            <button className={repository.selected ? "selected" : ""} disabled={props.busy || repository.selected} onClick={() => void choose(repository.path)} key={repository.path}>
              <span><strong>{repository.label}</strong><code>{repository.path}</code></span>
              <small>{repository.selected ? "Open" : "Switch"}</small>
            </button>
          ))}
        </div>
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
  const [inspector, setInspector] = useState<"worktree" | "connectors" | "hooks" | "skills" | "plan" | "settings">("worktree");
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const composerInput = useRef<HTMLTextAreaElement>(null);
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
    setSkillMenuDismissed(false);
    setSkillMenuIndex(0);
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
  const effectiveSkills = snapshot.skills.skills.filter((skill) => skill.effective);
  const skillQuery = skillMenuDismissed ? null : parseSkillMenuQuery(input);
  const skillMenuItems = skillQuery === null ? [] : filterSkillMenuItems(effectiveSkills, skillQuery);
  const activeSkillMenuIndex = skillMenuItems.length ? Math.min(skillMenuIndex, skillMenuItems.length - 1) : 0;
  const invokedSkill = resolveComposedSkill(input, effectiveSkills);
  const defaultModel = snapshot.agentModels.models.find((model) => model.id === snapshot.agentModels.defaultModelId);
  const selectedModel = snapshot.agentSession.model
    ? snapshot.agentModels.models.find((model) => model.id === snapshot.agentSession.model || model.resolvedId === snapshot.agentSession.model)
    : defaultModel;
  const chooseSkill = (skill: SkillRecord) => {
    setInput(`/${skill.id} `);
    setSkillMenuDismissed(true);
    setSkillMenuIndex(0);
    window.requestAnimationFrame(() => composerInput.current?.focus());
  };

  return (
    <div className="studio-layout">
      <aside className="session-rail">
        <Brand compact />
        <button className="back-link" onClick={() => window.location.assign(`/?token=${encodeURIComponent(homeToken)}`)}>← All conversations</button>
        <div className="rail-section-label">Workspace</div>
        <div className="rail-lane"><span className="lane-dot current" /><div><strong>{!snapshot.isGitRepository ? "Working directory" : snapshot.laneId === "current" ? "Repository chat" : "Isolated worktree"}</strong><small>{snapshot.isGitRepository ? snapshot.branchName ?? "detached" : snapshot.workspace}</small></div></div>
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
          <div><strong>{snapshot.agentSession.title}</strong><span>{snapshot.workspaceLabel} · {!snapshot.isGitRepository ? `working directory · ${snapshot.agentSession.permissionMode} permissions` : snapshot.laneId === "current" ? "repository chat · planning permissions" : `isolated worktree · ${snapshot.agentSession.permissionMode} permissions`}</span></div>
          <div className="header-actions">
            <label className="model-selector" title={snapshot.agentModels.detail ?? "Choose the model for this conversation."}>
              <span>Model</span>
              <select
                aria-label="Conversation model"
                value={snapshot.agentSession.model ?? ""}
                disabled={snapshot.busy || (snapshot.agentModels.models.length === 0 && !snapshot.agentSession.model)}
                onChange={(event) => void action({ type: "model-select", modelId: event.target.value || null })}
              >
                <option value="">{defaultModel ? `Auto · ${defaultModel.label}` : "Provider default"}</option>
                {snapshot.agentSession.model && !snapshot.agentModels.models.some((model) => model.id === snapshot.agentSession.model)
                  ? <option value={snapshot.agentSession.model}>{selectedModel?.label ?? snapshot.agentSession.model} · current</option>
                  : null}
                {snapshot.agentModels.models.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}
              </select>
            </label>
            {snapshot.busy ? <button className="stop" onClick={() => void action({ type: "interrupt-agent" })}>■ Stop</button> : null}
            <button className="quiet" onClick={() => void action({ type: "session-pin", pinned: !snapshot.agentSession.pinnedAt })}>{snapshot.agentSession.pinnedAt ? "Unpin" : "Pin"}</button>
            <button className="quiet" onClick={() => void action({ type: "session-archive" })}>Archive</button>
            <button className="quiet" onClick={() => void action({ type: "session-fork" })}>Fork</button>
            <button className="quiet" onClick={() => { const title = window.prompt("Conversation title", snapshot.agentSession.title); if (title?.trim()) void action({ type: "session-rename", title }); }}>Rename</button>
            {snapshot.isGitRepository && snapshot.laneId === "current" ? <button className="primary promote-worktree" disabled={snapshot.busy || promoting} onClick={() => void promoteToWorktree()}>{promoting ? "Creating..." : "Create worktree"}</button> : <button className="quiet" onClick={() => setInspector("plan")}>Planning tools</button>}
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
                <span>{selectedModel?.label ?? snapshot.agentSession.model ?? snapshot.agentProvider.label}</span>
                <span>{!snapshot.isGitRepository ? "working directory" : snapshot.laneId === "current" ? "repository context" : snapshot.branchName ?? "detached"}</span>
              </div>
              <p>{!snapshot.isGitRepository ? "This folder is the session's working directory. Srgical can inspect and modify files here." : snapshot.laneId === "current" ? "Primary checkout is protected. Create a worktree when the conversation is ready for file changes." : snapshot.prepareClarity?.coachHeadline ?? snapshot.state.nextAction}</p>
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
          <PromptActionBar snapshot={snapshot} action={action} />
          <div className="composer">
            {skillQuery !== null ? <SkillSlashMenu
              skills={skillMenuItems}
              activeIndex={activeSkillMenuIndex}
              query={skillQuery}
              onChoose={chooseSkill}
            /> : null}
            <textarea
              ref={composerInput}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setSkillMenuDismissed(false);
                setSkillMenuIndex(0);
              }}
              onKeyDown={(event) => {
                if (skillQuery !== null) {
                  if (event.key === "ArrowDown" && skillMenuItems.length) {
                    event.preventDefault();
                    setSkillMenuIndex((activeSkillMenuIndex + 1) % skillMenuItems.length);
                    return;
                  }
                  if (event.key === "ArrowUp" && skillMenuItems.length) {
                    event.preventDefault();
                    setSkillMenuIndex((activeSkillMenuIndex - 1 + skillMenuItems.length) % skillMenuItems.length);
                    return;
                  }
                  if ((event.key === "Enter" || event.key === "Tab") && skillMenuItems[activeSkillMenuIndex]) {
                    event.preventDefault();
                    chooseSkill(skillMenuItems[activeSkillMenuIndex]);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSkillMenuDismissed(true);
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={!snapshot.isGitRepository ? "Ask about this folder or describe a change…" : snapshot.laneId === "current" ? "Ask about the repository, explore an idea, or describe a change…" : "Ask Srgical to explore, plan, or implement a change…"}
              rows={2}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={skillQuery !== null}
              aria-controls={skillQuery !== null ? "skill-slash-menu" : undefined}
              aria-activedescendant={skillQuery !== null && skillMenuItems.length ? `skill-slash-option-${activeSkillMenuIndex}` : undefined}
            />
            <div className="composer-footer"><span>{skillQuery !== null ? "Choose a skill · ↑↓ navigate · Enter select · Esc close" : invokedSkill ? `${invokedSkill.name} active for this turn` : !snapshot.isGitRepository ? `Working directory enabled · ${snapshot.skills.effectiveSkillHashes.length} effective skills · type / for skills` : snapshot.laneId === "current" ? "Primary checkout protected · type / for skills" : `${snapshot.skills.effectiveSkillHashes.length} effective skills · type / for skills`}</span><button className="send-button" disabled={!input.trim() || sending} onClick={() => void send()}>↑</button></div>
          </div>
        </section>
      </main>

      <aside className="inspector-pane">
        <div className="inspector-tabs">
          {(["worktree", "connectors", "hooks", "skills", "plan", "settings"] as const).map((tab) => <button className={inspector === tab ? "active" : ""} onClick={() => setInspector(tab)} key={tab}>{tab === "connectors" ? "MCP" : tab}</button>)}
        </div>
        <div className="inspector-body">
          {inspector === "worktree" ? <WorktreeInspector snapshot={snapshot} action={action} /> : null}
          {inspector === "connectors" ? <ConnectorsInspector snapshot={snapshot} action={action} /> : null}
          {inspector === "hooks" ? <HooksInspector snapshot={snapshot} action={action} /> : null}
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
          <button className={section === "connectors" ? "active" : ""} onClick={() => setSection("connectors")}><strong>Connectors</strong><small>GitHub, Slack, Linear and more</small></button>
        </nav>
        <div className="settings-content">
          {section === "providers" ? <>
            <div className="settings-page-heading"><h3>Provider & billing path</h3><p>Choose the authenticated route new conversations will use. Existing conversations keep the route they started with.</p></div>
            <ProviderOptions authOptions={props.authOptions} busy={props.busy} onSelect={props.onSelect} />
          </> : <>
            <div className="settings-page-heading"><h3>Connected services</h3><p>Choose a service and Srgical will guide you through its secure setup. Access is scoped to this repository.</p></div>
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
  const [promptSkillId, setPromptSkillId] = useState("");
  const [promptLabel, setPromptLabel] = useState("");
  const [promptText, setPromptText] = useState("");
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
  const effectiveSkills = snapshot.skills.skills.filter((skill) => skill.effective);
  const addPromptButton = async () => {
    await run({
      type: "prompt-action-upsert",
      promptActionLabel: promptLabel,
      promptActionPrompt: promptText,
      promptActionSkillId: promptSkillId
    }, () => {
      setPromptSkillId("");
      setPromptLabel("");
      setPromptText("");
    });
  };
  return <>
    <InspectorTitle title="Settings" subtitle="Provider, connector, and repository preferences" />
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
      <div className="settings-section-heading"><strong>Connected services</strong><p>Repository-scoped MCP access with guided authorization.</p></div>
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
      <div className="settings-section-heading"><strong>Prompt buttons</strong><p>Turn an effective skill into a reusable action beside the chat composer. Buttons submit prompts; they never run shell commands directly.</p></div>
      <div className="prompt-action-form">
        <label><span>Skill</span><select value={promptSkillId} onChange={(event) => setPromptSkillId(event.target.value)}><option value="">Choose a skill</option>{effectiveSkills.map((skill) => <option value={skill.id} key={skill.id}>{skill.name}</option>)}</select></label>
        <label><span>Button label</span><input value={promptLabel} maxLength={48} onChange={(event) => setPromptLabel(event.target.value)} placeholder="Review accessibility" /></label>
        <label><span>Prompt</span><textarea rows={3} value={promptText} onChange={(event) => setPromptText(event.target.value)} placeholder="Review the current changes and fix clear accessibility problems." /></label>
        <button className="primary" disabled={busy || !promptSkillId || !promptLabel.trim() || !promptText.trim()} onClick={() => void addPromptButton()}>Add prompt button</button>
      </div>
      {snapshot.skills.promptActions.length ? <div className="prompt-action-config-list">{snapshot.skills.promptActions.map((item) => <article key={item.actionId}><div><strong>{item.label}</strong><small>{item.skillId}</small></div><p>{item.prompt}</p><button className="danger" disabled={busy} onClick={() => void run({ type: "prompt-action-remove", promptActionId: item.actionId })}>Remove</button></article>)}</div> : <p className="settings-empty-note">No custom prompt buttons yet.</p>}
    </div>
    <div className="settings-section">
      <div className="settings-section-heading"><strong>Theme</strong><p>Applied immediately across Studio.</p></div>
      <div className="theme-options">{STUDIO_THEMES.map((theme) => <button className={snapshot.settings.themeId === theme.id ? "selected" : ""} disabled={busy} onClick={() => void run({ type: "theme", themeId: theme.id, announce: false })} key={theme.id}><strong>{theme.label}</strong><small>{theme.description}</small></button>)}</div>
    </div>
  </>;
}

const FEATURED_CONNECTOR_IDS = ["github", "linear", "slack", "notion", "google-drive"];

function ConnectorSettings(props: {
  connectors: ConnectorRegistrySnapshot;
  busy: boolean;
  compact?: boolean;
  onInstall(presetId: string): Promise<void>;
  onToggle(connectorId: string, enabled: boolean): Promise<void>;
  onRemove(connectorId: string): Promise<void>;
}) {
  const [activePreset, setActivePreset] = useState<ConnectorPreset | null>(null);
  const presets = FEATURED_CONNECTOR_IDS.flatMap((presetId) => {
    const preset = props.connectors.catalog.find((item) => item.presetId === presetId);
    return preset ? [preset] : [];
  });
  return <div className={`settings-connectors ${props.compact ? "compact" : ""}`}>
    {presets.map((preset) => {
      const connector = props.connectors.connectors.find((item) => item.presetId === preset.presetId);
      const connected = connector?.status === "connected";
      const configured = Boolean(connector?.enabled && ["ready", "needs-auth", "pending"].includes(connector.status));
      const awaitingOAuth = configured && preset.authorization.method === "hosted-oauth";
      const state = connected ? "Connected" : awaitingOAuth ? "Sign-in pending" : configured ? "Ready" : connector?.enabled === false ? "Disabled" : connector ? "Needs attention" : "Not connected";
      return <article className={`settings-connector ${connected ? "connected" : configured ? "configured" : "offline"}`} key={preset.presetId}>
        <div className="settings-connector-heading"><span className="connector-brand-mark">{preset.label.slice(0, 1)}</span><div><strong>{preset.label}</strong><small>{preset.category}</small></div><span className="settings-connector-state"><i />{state}</span></div>
        <p>{preset.description}</p>
        <small>{connected ? connector?.statusDetail ?? "Authenticated and available to the current provider." : connector?.statusDetail ?? preset.authDescription}</small>
        <footer>
          <a href={preset.setupUrl} target="_blank" rel="noreferrer">Setup guide</a>
          <div>{connector ? <><button className={!connected && connector.enabled ? "primary" : ""} disabled={props.busy} onClick={() => setActivePreset(preset)}>{connected ? "Details" : "Finish setup"}</button><button disabled={props.busy} onClick={() => void props.onToggle(connector.connectorId, !connector.enabled)}>{connector.enabled ? "Disable" : "Enable"}</button><button className="quiet" disabled={props.busy} onClick={() => void props.onRemove(connector.connectorId)}>Remove</button></> : <button className="primary" disabled={props.busy} onClick={() => setActivePreset(preset)}>Connect</button>}</div>
        </footer>
      </article>;
    })}
    <p className="connector-privacy-note">Connector definitions are stored outside the repository. OAuth credentials remain in the selected provider's credential store.</p>
    {activePreset ? <ConnectorAuthorizationDialog
      preset={activePreset}
      connector={props.connectors.connectors.find((item) => item.presetId === activePreset.presetId) ?? null}
      busy={props.busy}
      onInstall={props.onInstall}
      onClose={() => setActivePreset(null)}
    /> : null}
  </div>;
}

function ConnectorAuthorizationDialog(props: {
  preset: ConnectorPreset;
  connector: ConnectorRecord | null;
  busy: boolean;
  onInstall(presetId: string): Promise<void>;
  onClose(): void;
}) {
  const [stage, setStage] = useState<"review" | "complete">(props.connector ? "complete" : "review");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authLabel = props.preset.authorization.method === "hosted-oauth"
    ? "Hosted OAuth"
    : props.preset.authorization.method === "personal-token"
      ? "Personal access token"
      : "OAuth client credentials";
  const startConnection = async () => {
    setWorking(true);
    setError(null);
    const setupWindow = window.open(props.preset.setupUrl, "_blank", "noopener,noreferrer");
    try {
      await props.onInstall(props.preset.presetId);
      setStage("complete");
    } catch (reason) {
      setupWindow?.close();
      setError(errorText(reason));
    } finally {
      setWorking(false);
    }
  };
  const statusCopy = props.preset.authorization.method === "hosted-oauth"
    ? "The connector is installed. Your selected agent provider will open the secure consent screen the first time it contacts this service."
    : props.preset.authorization.method === "personal-token"
      ? "The connector is installed. Set the token environment variable shown below and restart Srgical to make it available."
      : "The connector is installed. Set both OAuth environment variables shown below and restart Srgical; provider consent follows on first use.";

  return <div className="connector-auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) props.onClose(); }}>
    <section className="connector-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="connector-auth-title">
      <header>
        <span className="connector-auth-mark">{props.preset.label.slice(0, 1)}</span>
        <div><span className="connector-auth-method">{authLabel}</span><h3 id="connector-auth-title">Connect {props.preset.label}</h3><p>{props.preset.description}</p></div>
        <button className="quiet" disabled={working} onClick={props.onClose} aria-label="Close connector setup">Close</button>
      </header>
      {stage === "review" ? <>
        <div className="connector-auth-summary"><strong>What happens next</strong><ol>{props.preset.authorization.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
        {props.preset.authorization.environmentVariables?.length ? <ConnectorEnvironmentVariables names={props.preset.authorization.environmentVariables} /> : null}
        <div className="connector-auth-privacy"><strong>Your credentials stay private</strong><p>Srgical stores the connector definition outside the repository. OAuth tokens stay in the selected model provider's credential store; environment variable values are never written to connector configuration.</p></div>
        {error ? <div className="inline-error">{error}</div> : null}
        <footer><button disabled={working} onClick={props.onClose}>Cancel</button><button className="primary" disabled={props.busy || working} onClick={() => void startConnection()}>{working ? "Adding connector…" : props.preset.authorization.actionLabel}</button></footer>
      </> : <>
        <div className="connector-auth-complete"><span aria-hidden="true">✓</span><div><strong>{props.preset.label} is added</strong><p>{statusCopy}</p></div></div>
        {props.preset.authorization.environmentVariables?.length ? <ConnectorEnvironmentVariables names={props.preset.authorization.environmentVariables} /> : null}
        <div className="connector-auth-next"><strong>{props.preset.authorization.method === "hosted-oauth" ? "Authorization handoff" : "Finish setup"}</strong><p>{props.preset.authorization.method === "hosted-oauth" ? `Ask the agent to use ${props.preset.label}. The browser authorization window will open automatically and this card will update after the provider connects.` : "After restarting Srgical, return here and check that the connector reports Ready."}</p></div>
        <footer><a href={props.preset.setupUrl} target="_blank" rel="noreferrer">Open setup guide</a><button className="primary" onClick={props.onClose}>Done</button></footer>
      </>}
    </section>
  </div>;
}

function ConnectorEnvironmentVariables({ names }: { names: string[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(name);
      window.setTimeout(() => setCopied((current) => current === name ? null : current), 1500);
    } catch {
      setCopied(null);
    }
  };
  return <div className="connector-auth-environment"><strong>Required environment {names.length === 1 ? "variable" : "variables"}</strong>{names.map((name) => <button title={`Copy ${name}`} onClick={() => void copy(name)} key={name}><code>{name}</code><span>{copied === name ? "Copied" : "Copy"}</span></button>)}</div>;
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

function SkillSlashMenu(props: {
  skills: SkillRecord[];
  activeIndex: number;
  query: string;
  onChoose(skill: SkillRecord): void;
}) {
  return <div className="skill-slash-menu" id="skill-slash-menu" role="listbox" aria-label="Available skills">
    <div className="skill-slash-heading"><div><strong>Activate a skill</strong><span>{props.query ? `Matching “${props.query}”` : "Effective skills for this workspace"}</span></div><kbd>/</kbd></div>
    {props.skills.length ? <div className="skill-slash-options">{props.skills.map((skill, index) => <button
      id={`skill-slash-option-${index}`}
      className={index === props.activeIndex ? "active" : ""}
      type="button"
      role="option"
      aria-selected={index === props.activeIndex}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => props.onChoose(skill)}
      key={`${skill.id}-${skill.source}`}
    ><span className="skill-slash-mark">S</span><span><strong>/{skill.id}</strong><small>{skill.name} · {skill.scope}</small><p>{skill.description}</p></span><em>Use</em></button>)}</div> : <div className="skill-slash-empty"><strong>{props.query ? "No matching active skills" : "No active skills yet"}</strong><span>{props.query ? "Try another name or press Escape." : "Enable a trusted skill in the Skills inspector, then type / again."}</span></div>}
  </div>;
}

function parseSkillMenuQuery(value: string): string | null {
  const match = value.match(/^\/([^\s/]*)$/);
  return match ? match[1].toLowerCase() : null;
}

function filterSkillMenuItems(skills: SkillRecord[], query: string): SkillRecord[] {
  const needle = query.trim().toLowerCase();
  return [...skills]
    .filter((skill) => !needle || [skill.id, skill.name, skill.description].some((value) => value.toLowerCase().includes(needle)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 8);
}

function resolveComposedSkill(value: string, skills: SkillRecord[]): SkillRecord | null {
  const match = value.match(/^\/([^\s/]+)(?:\s|$)/);
  if (!match) return null;
  return skills.find((skill) => skill.id.toLowerCase() === match[1].toLowerCase()) ?? null;
}

function Activity({ event }: { event: AgentEvent }) {
  if (event.kind.startsWith("hook.")) {
    const payload = event.payload as { label: string; summary?: string; message?: string; trigger: string };
    const failed = event.kind === "hook.failed";
    return <div className={`activity-card hook-activity ${failed ? "failed" : ""}`}><span className="activity-icon">↪</span><div><strong>{payload.label}</strong><small>{failed ? payload.message : payload.summary ?? `${payload.trigger.replace(".", " ")} hook running`}</small></div></div>;
  }
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

function PromptActionBar({ snapshot, action }: { snapshot: StudioSnapshot; action(request: StudioActionRequest): Promise<void> }) {
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = snapshot.promptActions.filter((item) => item.enabled || item.kind === "skill");
  if (visible.length === 0) return null;
  const run = async (actionId: string) => {
    setRunning(actionId);
    setError(null);
    try {
      await action({ type: "prompt-action-run", promptActionId: actionId });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setRunning(null);
    }
  };
  return <div className="prompt-action-bar">
    <div><strong>{snapshot.worktreeDiagnostics.conflictCount > 0 ? `${snapshot.worktreeDiagnostics.conflictCount} conflicted file${snapshot.worktreeDiagnostics.conflictCount === 1 ? "" : "s"}` : "Quick actions"}</strong><span>Skill-backed prompts</span></div>
    <div className="prompt-action-buttons">{visible.map((item) => <button className={item.emphasis === "warning" ? "warning" : ""} disabled={snapshot.busy || running !== null || !item.enabled} title={item.blockedReason ?? item.description} onClick={() => void run(item.actionId)} key={item.actionId}>{running === item.actionId ? "Running…" : item.label}{item.kind === "skill" ? <small>skill</small> : null}</button>)}</div>
    {error ? <div className="inline-error">{error}</div> : null}
  </div>;
}

function WorktreeInspector({ snapshot, action }: { snapshot: StudioSnapshot; action(request: StudioActionRequest): Promise<void> }) {
  if (!snapshot.isGitRepository) {
    return <><InspectorTitle title="Working directory" subtitle={snapshot.workspace} /><InfoRow label="Workspace" value="Folder" /><InfoRow label="Access" value="File changes enabled" /><InfoRow label="Session" value={snapshot.agentSession.status} /><InfoRow label="Provider session" value={snapshot.agentSession.providerSessionId?.slice(0, 12) ?? "not started"} /><div className="inspector-note"><strong>Folder-scoped session</strong><p>Srgical runs the agent in this directory. Git worktrees, branch diagnostics, and merge-conflict actions are unavailable unless you select a Git repository.</p></div></>;
  }
  const repositoryChat = snapshot.laneId === "current";
  const diagnostics = snapshot.worktreeDiagnostics;
  const conflictActions = snapshot.promptActions.filter((item) => item.kind === "built-in" && (item.enabled || item.actionId.includes("conflict")));
  return <><InspectorTitle title={repositoryChat ? "Repository context" : "Worktree"} subtitle={snapshot.workspace} /><InfoRow label="Branch" value={snapshot.branchName ?? "detached"} /><InfoRow label="Workspace" value={repositoryChat ? "Primary checkout (protected)" : snapshot.laneId} /><InfoRow label="Base" value={diagnostics.baseRef ?? "not detected"} /><InfoRow label="Divergence" value={`${diagnostics.aheadCount} ahead · ${diagnostics.behindCount} behind`} /><InfoRow label="Conflicts" value={String(diagnostics.conflictCount)} /><InfoRow label="Changes" value={`${diagnostics.stagedCount} staged · ${diagnostics.unstagedCount} unstaged · ${diagnostics.untrackedCount} untracked`} /><InfoRow label="Session" value={snapshot.agentSession.status} /><InfoRow label="Provider session" value={snapshot.agentSession.providerSessionId?.slice(0, 12) ?? "not started"} />{diagnostics.conflictCount > 0 ? <div className="worktree-conflict-alert"><strong>Merge conflicts need attention</strong><p>Inspect both sides before resolving. Srgical will not reset, abort, rebase, or commit as part of the built-in flow.</p><div>{conflictActions.map((item) => <button className={item.emphasis === "warning" ? "warning" : ""} disabled={snapshot.busy || !item.enabled} title={item.blockedReason ?? item.description} onClick={() => void action({ type: "prompt-action-run", promptActionId: item.actionId })} key={item.actionId}>{item.label}</button>)}</div></div> : <div className="inspector-note"><strong>{repositoryChat ? "Conversation first" : "Isolation boundary"}</strong><p>{repositoryChat ? "This conversation can inspect and plan against the repository. Promote it to a worktree before making file changes." : "This lane owns its worktree, branch, plan, durable agent session, and effective skill hashes."}</p></div>}</>;
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

function HooksInspector({ snapshot, action }: { snapshot: StudioSnapshot; action(request: StudioActionRequest): Promise<void> }) {
  const effectiveSkills = snapshot.skills.skills.filter((skill) => skill.effective);
  const enabledConnectors = snapshot.connectors.connectors.filter((connector) => connector.enabled);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState<HookTrigger>("turn.received");
  const [handlerType, setHandlerType] = useState<"skill" | "mcp">("skill");
  const [skillId, setSkillId] = useState("");
  const [connectorId, setConnectorId] = useState("");
  const [toolName, setToolName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [priority, setPriority] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEditingId(null);
    setLabel("");
    setDescription("");
    setTrigger("turn.received");
    setHandlerType("skill");
    setSkillId("");
    setConnectorId("");
    setToolName("");
    setInstruction("");
    setBlocking(false);
    setPriority(100);
  };
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
  const edit = (hook: HookDefinition) => {
    setEditingId(hook.hookId);
    setLabel(hook.label);
    setDescription(hook.description);
    setTrigger(hook.trigger);
    setHandlerType(hook.handler.type);
    setSkillId(hook.handler.type === "skill" ? hook.handler.skillId : "");
    setConnectorId(hook.handler.type === "mcp" ? hook.handler.connectorId : "");
    setToolName(hook.handler.type === "mcp" ? hook.handler.toolName : "");
    setInstruction(hook.instruction);
    setBlocking(hook.blocking);
    setPriority(hook.priority);
  };
  const save = () => {
    const hookHandler = handlerType === "skill"
      ? { type: "skill" as const, skillId }
      : { type: "mcp" as const, connectorId, toolName };
    void run({
      type: "hook-upsert",
      hookId: editingId ?? undefined,
      hookLabel: label,
      hookDescription: description,
      hookTrigger: trigger,
      hookHandler,
      hookInstruction: instruction,
      hookBlocking: blocking,
      hookPriority: priority
    }, reset);
  };
  const selectedConnector = enabledConnectors.find((connector) => connector.connectorId === connectorId);
  const formReady = Boolean(label.trim() && instruction.trim() && (handlerType === "skill" ? skillId : connectorId && toolName.trim()));

  return <>
    <InspectorTitle title="Hooks" subtitle={`${snapshot.hooks.hooks.filter((hook) => hook.enabled).length} active · conversation lifecycle`} />
    <div className="hooks-intro"><strong>Conversation hooks</strong><p>Automatically enrich or observe each turn with an effective skill or an MCP tool. Every execution appears in the transcript.</p></div>
    {error ? <div className="inline-error">{error}</div> : null}
    {snapshot.hooks.hooks.length ? <div className="hook-list">{snapshot.hooks.hooks.map((hook) => <HookRow hook={hook} busy={busy} run={run} onEdit={() => edit(hook)} key={hook.hookId} />)}</div> : <EmptyState title="No hooks configured" body="Add a context, policy, or knowledge-graph hook below." />}
    <div className="hook-recipes"><span>Quick starts</span><button onClick={() => { reset(); setHandlerType("mcp"); setTrigger("turn.received"); setLabel("Retrieve graph context"); setDescription("Retrieve related project knowledge before each response."); setInstruction("Find the most relevant nodes, relationships, decisions, and provenance for this request. Return concise cited context for the agent."); }}>Graph retrieval</button><button onClick={() => { reset(); setHandlerType("mcp"); setTrigger("turn.completed"); setLabel("Capture graph knowledge"); setDescription("Store durable knowledge discovered during the turn."); setInstruction("Extract only durable decisions, entities, artifacts, and relationships from this turn. Upsert them with session and message provenance; do not store secrets."); }}>Graph capture</button></div>
    <div className="hook-form">
      <div className="hook-form-heading"><strong>{editingId ? "Edit hook" : "Add hook"}</strong>{editingId ? <button className="quiet" onClick={reset}>Cancel</button> : null}</div>
      <label><span>Label</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Retrieve product context" /></label>
      <label><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What teammates should know about this hook" /></label>
      <div className="hook-form-split"><label><span>When</span><select value={trigger} onChange={(event) => setTrigger(event.target.value as HookTrigger)}><option value="turn.received">Before answering</option><option value="turn.completed">Before final response</option></select></label><label><span>Handler</span><select value={handlerType} onChange={(event) => setHandlerType(event.target.value as "skill" | "mcp")}><option value="skill">Effective skill</option><option value="mcp">MCP tool</option></select></label></div>
      {handlerType === "skill" ? <label><span>Skill</span><select value={skillId} onChange={(event) => setSkillId(event.target.value)}><option value="">Choose a skill</option>{effectiveSkills.map((skill) => <option value={skill.id} key={`${skill.id}-${skill.source}`}>{skill.name}</option>)}</select></label> : <><label><span>Connector</span><select value={connectorId} onChange={(event) => { setConnectorId(event.target.value); setToolName(""); }}><option value="">Choose a connector</option>{enabledConnectors.map((connector) => <option value={connector.connectorId} key={connector.connectorId}>{connector.label}</option>)}</select></label><label><span>Tool name</span>{selectedConnector?.tools.length ? <select value={toolName} onChange={(event) => setToolName(event.target.value)}><option value="">Choose a tool</option>{selectedConnector.tools.map((tool) => <option value={tool.name} key={tool.name}>{tool.name}</option>)}</select> : <input value={toolName} onChange={(event) => setToolName(event.target.value)} placeholder="query_knowledge_graph" />}</label></>}
      <label><span>Instruction</span><textarea rows={4} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Explain exactly what this hook contributes to the turn." /></label>
      <div className="hook-form-split hook-form-options"><label><span>Priority</span><input type="number" min={0} max={10000} value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label><label className="hook-blocking"><input type="checkbox" checked={blocking} onChange={(event) => setBlocking(event.target.checked)} /><span><strong>Blocking</strong><small>Stop the turn if this hook cannot run.</small></span></label></div>
      <button className="primary" disabled={busy || !formReady} onClick={save}>{busy ? "Saving…" : editingId ? "Save hook" : "Add hook"}</button>
    </div>
  </>;
}

function HookRow(props: { hook: HookDefinition; busy: boolean; run(request: StudioActionRequest): Promise<void>; onEdit(): void }) {
  const { hook } = props;
  const handler = hook.handler.type === "skill" ? `/${hook.handler.skillId}` : `${hook.handler.connectorId}.${hook.handler.toolName}`;
  return <article className={`hook-row ${hook.enabled ? "enabled" : ""}`}><div className="hook-row-heading"><span className="hook-status" /><div><strong>{hook.label}</strong><small>{hook.trigger === "turn.received" ? "Before answering" : "Before final response"} · {handler}</small></div></div><p>{hook.description || hook.instruction}</p><div className="hook-row-meta"><span>priority {hook.priority}</span>{hook.blocking ? <span>blocking</span> : <span>observational</span>}</div><div className="hook-row-actions"><button disabled={props.busy} onClick={() => void props.run({ type: "hook-test", hookId: hook.hookId })}>Test</button><button disabled={props.busy} onClick={props.onEdit}>Edit</button><button disabled={props.busy} onClick={() => void props.run({ type: "hook-toggle", hookId: hook.hookId, selected: !hook.enabled })}>{hook.enabled ? "Disable" : "Enable"}</button><button className="danger" disabled={props.busy} onClick={() => { if (window.confirm(`Remove ${hook.label}?`)) void props.run({ type: "hook-remove", hookId: hook.hookId }); }}>Remove</button></div></article>;
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
  return <><InspectorTitle title="Planning workflow" subtitle={`${snapshot.mode === "prepare" ? "Shape the work when useful" : "Execution actions"} · ${snapshot.state.mode}`} /><div className="inspector-note"><strong>Optional structure</strong><p>Chat remains available in either posture. Use these tools when the work benefits from an explicit plan, approval, or execution sequence.</p></div><div className="readiness"><span>Readiness</span><strong>{snapshot.state.readiness.score}/{snapshot.state.readiness.total}</strong><div><i style={{ width: `${snapshot.state.readiness.score / Math.max(1, snapshot.state.readiness.total) * 100}%` }} /></div></div><div className="next-action"><span>Recommended next move</span><p>{snapshot.state.nextAction}</p></div><div className="plan-actions">{actions.map(({ label, request }) => <button disabled={snapshot.busy || !snapshot.actions[request.type].enabled} title={snapshot.actions[request.type].blockedReason ?? undefined} onClick={() => void action(request)} key={label}>{label}</button>)}<button className="quiet" disabled={snapshot.busy || (snapshot.isGitRepository && snapshot.laneId === "current" && snapshot.mode === "prepare")} title={snapshot.isGitRepository && snapshot.laneId === "current" && snapshot.mode === "prepare" ? "Create a worktree before enabling execution actions." : undefined} onClick={() => void action({ type: "switch-mode", mode: snapshot.mode === "prepare" ? "operate" : "prepare" })}>{snapshot.mode === "prepare" ? "Enable execution actions" : "Return to planning actions"}</button></div></>;
}

function unresolvedEvents(events: AgentEvent[], requested: "permission.requested" | "question.requested", resolved: "permission.resolved" | "question.resolved"): AgentEvent[] {
  const resolvedIds = new Set(events.filter((event) => event.kind === resolved).map((event) => (event.payload as { requestId: string }).requestId));
  return events.filter((event) => event.kind === requested && !resolvedIds.has((event.payload as { requestId: string }).requestId));
}

function latestActivity(events: AgentEvent[]): AgentEvent[] {
  const useful = events.filter((event) => event.kind.startsWith("tool.") || event.kind.startsWith("task.") || event.kind.startsWith("hook.") || event.kind === "session.failed");
  const seen = new Set<string>();
  return useful.reverse().filter((event) => {
    const payload = event.payload as { toolUseId?: string; taskId?: string; executionId?: string };
    const id = payload.toolUseId ?? payload.taskId ?? payload.executionId ?? event.eventId;
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

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function useInstallApp(): (() => Promise<void>) | null {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    return () => window.removeEventListener("beforeinstallprompt", capturePrompt);
  }, []);
  if (!installPrompt) return null;
  return async () => {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };
}

function storeInitialMessage(token: string, message: string): void {
  window.sessionStorage.setItem(`srgical.initial-message.${token}`, message);
}

function takeInitialMessage(token: string): string | null {
  const key = `srgical.initial-message.${token}`;
  const message = window.sessionStorage.getItem(key);
  if (message) window.sessionStorage.removeItem(key);
  return message;
}
