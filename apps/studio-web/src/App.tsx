import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type {
  LaneCreateRequest,
  LaneOpenResponse,
  RepoSnapshot,
  StudioActionRequest,
  StudioEvent,
  StudioSnapshot
} from "@srgical/studio-core";
import { STUDIO_THEMES, getStudioTheme, type StudioTheme } from "@srgical/studio-shared";

declare global {
  interface Window {
    __SRGICAL_TOKEN__?: string;
  }
}

const query = new URLSearchParams(window.location.search);
const dashboardToken = window.__SRGICAL_TOKEN__ || query.get("token") || "";
const studioToken = query.get("studioToken") || "";

type DirectoryPickerState = {
  currentPath: string;
  parentPath: string | null;
  directories: Array<{ path: string; name: string }>;
};

export function App() {
  return studioToken ? <StudioShell token={studioToken} /> : <RepoDashboard token={dashboardToken} />;
}

function RepoDashboard(props: { token: string }) {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [planId, setPlanId] = useState("");
  const [mode, setMode] = useState<"prepare" | "operate">("prepare");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRepoSnapshot(props.token).then((next) => {
      setSnapshot(next);
      setPlanId(next.requestedPlanId ?? "");
      setMode(next.requestedMode ?? "prepare");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [props.token]);

  const visibleLanes = useMemo(
    () => snapshot?.lanes.filter((lane) => !lane.removed) ?? [],
    [snapshot]
  );

  const refresh = async () => {
    setSnapshot(await fetchRepoSnapshot(props.token));
  };

  const createLane = async () => {
    if (!planId.trim()) {
      setError("Enter a plan id before creating a new worktree lane.");
      return;
    }
    const childWindow = window.open("about:blank", "_blank");
    setBusy(true);
    setError(null);
    try {
      const response = await postJson<LaneOpenResponse, LaneCreateRequest>("/api/lanes/create", props.token, {
        planId: planId.trim(),
        mode
      });
      if (childWindow) {
        childWindow.location.replace(response.url);
      } else {
        window.open(response.url, "_blank");
      }
      await refresh();
    } catch (reason) {
      childWindow?.close();
      setError(extractErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openLane = async (laneId: string, laneMode: "prepare" | "operate") => {
    const childWindow = window.open("about:blank", "_blank");
    setBusy(true);
    setError(null);
    try {
      const response = await postJson<LaneOpenResponse, { laneId: string; mode: "prepare" | "operate" }>("/api/lanes/open", props.token, {
        laneId,
        mode: laneMode
      });
      if (childWindow) {
        childWindow.location.replace(response.url);
      } else {
        window.open(response.url, "_blank");
      }
      await refresh();
    } catch (reason) {
      childWindow?.close();
      setError(extractErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const archiveLane = async (laneId: string) => {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/lanes/archive", props.token, { laneId });
      await refresh();
    } catch (reason) {
      setError(extractErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const setLaneDeleteLock = async (laneId: string, deleteLocked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/lanes/lock", props.token, { laneId, deleteLocked });
      await refresh();
    } catch (reason) {
      setError(extractErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const removeLane = async (laneId: string, dirty: boolean) => {
    const confirmed = window.confirm(
      dirty
        ? `Delete worktree lane "${laneId}"? It is unlocked, so this will force-remove the dirty worktree.`
        : `Delete worktree lane "${laneId}"? It is unlocked and will be removed now.`
    );
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/lanes/remove", props.token, { laneId });
      await refresh();
    } catch (reason) {
      setError(extractErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!snapshot) {
    return <div className="app loading">Launching Repo Dashboard...</div>;
  }

  return (
    <div className="app dashboard-app">
      <div className="backdrop" />
      <main className="dashboard-shell">
        <section className="hero panel">
          <div>
            <div className="eyebrow">Same Repo Parallel Work</div>
            <h1>{snapshot.repoLabel}</h1>
            <p>Create a fresh worktree lane for each plan, then open each lane in its own browser tab.</p>
          </div>
          <div className="hero-meta">
            <div><span>Repo Root</span><strong>{snapshot.repoRoot}</strong></div>
            <div><span>Current Checkout</span><strong>{snapshot.currentWorkspace}</strong></div>
            <div><span>Lanes</span><strong>{visibleLanes.length}</strong></div>
          </div>
        </section>

        <section className="panel create-panel">
          <header className="panel-header">
            <span>Create Lane</span>
            <strong>{busy ? "working" : "ready"}</strong>
          </header>
          <div className="create-grid">
            <label>
              <span>Plan Id</span>
              <input value={planId} onChange={(event) => setPlanId(event.target.value)} placeholder="release-readiness" />
            </label>
            <label>
              <span>Mode</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as "prepare" | "operate")}>
                <option value="prepare">prepare</option>
                <option value="operate">operate</option>
              </select>
            </label>
            <button className="primary-button" onClick={() => void createLane()} disabled={busy}>Create And Open</button>
          </div>
          {error ? <div className="error-banner">{error}</div> : null}
        </section>

        <section className="lane-grid">
          {visibleLanes.map((lane) => (
            <article className={`panel lane-card ${lane.archived ? "archived" : ""}`} key={lane.laneId}>
              <header className="lane-header">
                <div>
                  <span className="lane-label">{lane.laneId}</span>
                  <strong>{lane.planId ?? "no plan yet"}</strong>
                </div>
                <span className={`status-chip ${lane.dirty ? "warn" : "ok"}`}>{lane.dirty ? "dirty" : "clean"}</span>
              </header>
              <div className="lane-meta">
                <div><span>Branch</span><strong>{lane.branchName ?? "detached"}</strong></div>
                <div><span>Path</span><strong>{lane.worktreePath}</strong></div>
                <div><span>Source</span><strong>{lane.source}</strong></div>
                <div><span>Delete Lock</span><strong>{lane.deleteLocked ? "locked" : "unlocked"}</strong></div>
                <div><span>Last Mode</span><strong>{lane.lastMode ?? "none"}</strong></div>
              </div>
              <div className="lane-flags">
                {lane.isCurrentCheckout ? <span className="chip">Current Checkout</span> : null}
                {lane.archived ? <span className="chip">Archived</span> : null}
                {lane.deleteLocked ? <span className="chip">Delete Locked</span> : <span className="chip chip-warn">Delete Unlocked</span>}
              </div>
              <div className="lane-actions">
                <button onClick={() => void openLane(lane.laneId, "prepare")} disabled={busy}>Open Prepare</button>
                <button onClick={() => void openLane(lane.laneId, "operate")} disabled={busy}>Open Operate</button>
                <button onClick={() => void archiveLane(lane.laneId)} disabled={busy || lane.archived}>Archive</button>
                <button
                  onClick={() => void setLaneDeleteLock(lane.laneId, !lane.deleteLocked)}
                  disabled={busy || lane.isCurrentCheckout}
                >
                  {lane.deleteLocked ? "Unlock Delete" : "Relock"}
                </button>
                <button onClick={() => void removeLane(lane.laneId, lane.dirty)} disabled={busy || !lane.canRemove}>Delete</button>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

function StudioShell(props: { token: string }) {
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("prepare");
  const [lastContentTab, setLastContentTab] = useState("prepare");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [referenceRootInput, setReferenceRootInput] = useState("");
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [directoryPicker, setDirectoryPicker] = useState<DirectoryPickerState | null>(null);

  useEffect(() => {
    void fetchStudioSnapshot(props.token).then(setSnapshot);
    const events = new EventSource(`/api/studio/events?token=${encodeURIComponent(props.token)}`);
    events.onmessage = (message) => {
      const event = JSON.parse(message.data) as StudioEvent;
      if (event.type === "snapshot") {
        setSnapshot(event.snapshot);
      }
      if (event.type === "action") {
        setSnapshot(event.snapshot);
      }
    };
    return () => events.close();
  }, [props.token]);

  useEffect(() => {
    setActiveTab((current) => {
      if (current === "docs") {
        return current;
      }
      if (snapshot?.mode === "operate") {
        return current === "prepare" || current === "context" || current === "references" ? "operate" : current;
      }
      return current === "operate" || current === "review" ? "prepare" : current;
    });
  }, [snapshot?.mode]);

  useEffect(() => {
    if (activeTab !== "docs") {
      setLastContentTab(activeTab);
    }
  }, [activeTab]);

  const theme = useMemo<StudioTheme>(() => {
    if (!snapshot) {
      return getStudioTheme("neon-command");
    }
    return snapshot.theme;
  }, [snapshot]);

  const sendAction = async (request: StudioActionRequest) => {
    if (request.type !== "theme" && request.type !== "switch-mode") {
      setActiveTab("transcript");
    }
    await postJson("/api/studio/action", props.token, request);
  };

  const sendInput = async () => {
    const text = input.trim();
    if (!text) {
      return;
    }
    setInput("");
    await postJson("/api/studio/input", props.token, { text });
  };

  const setTheme = async (themeId: string) => {
    await postJson("/api/studio/settings", props.token, { themeId, announce: false });
  };

  const loadDirectoryPicker = async (targetPath = "") => {
    setDirectoryPicker(await getJson<DirectoryPickerState>(`/api/studio/directories?token=${encodeURIComponent(props.token)}&path=${encodeURIComponent(targetPath)}`));
  };

  if (!snapshot) {
    return <div className="app loading">Launching Studio...</div>;
  }

  const tabs = snapshot.mode === "prepare"
    ? [
        { id: "prepare", label: "Prepare" },
        { id: "context", label: "Context" },
        { id: "references", label: "References" },
        { id: "transcript", label: "Transcript" }
      ]
    : [
        { id: "operate", label: "Operate" },
        { id: "review", label: "Review" },
        { id: "transcript", label: "Transcript" }
      ];

  const selectTab = (tabId: string) => {
    setActiveTab(tabId);
  };

  const openDocs = () => {
    setLastContentTab(activeTab === "docs" ? lastContentTab : activeTab);
    setActiveTab("docs");
  };

  return (
    <div className="app" style={buildThemeVars(theme)}>
      <div className="backdrop" />
      <main className="studio-shell">
        <header className="panel studio-topbar">
          <div className="studio-title">
            <div className="eyebrow">{snapshot.mode === "prepare" ? "Prepare Workspace" : "Operate Workspace"}</div>
            <h1>{snapshot.workspaceLabel}</h1>
            <div className="studio-identity">
              <span>Lane {snapshot.laneId}</span>
              <span>Branch {snapshot.branchName ?? "detached"}</span>
              <span>Plan {snapshot.planId}</span>
            </div>
          </div>
          <div className="studio-topbar-actions">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`shell-tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => selectTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <button className={`shell-tab ${activeTab === "docs" ? "active" : ""}`} onClick={openDocs}>
              Documentation
            </button>
            {snapshot.mode === "operate" ? (
              <button className="return-button" onClick={() => void sendAction({ type: "switch-mode", mode: "prepare" })}>
                Return To Prepare
              </button>
            ) : null}
            <button className="drawer-toggle" onClick={() => setDrawerOpen((current) => !current)}>
              {drawerOpen ? "Hide Drawer" : "Show Drawer"}
            </button>
          </div>
        </header>

        <aside className="panel studio-sidebar">
          <ControlBlock title="Readiness">
            <Detail label="Stage" value={snapshot.state.mode} chip />
            <Detail label="Approval" value={snapshot.state.approvalStatus} chip />
            <Detail label="Next Step" value={snapshot.state.currentPosition.nextRecommended ?? "none"} chip />
            <Detail label="Selected Refs" value={String(snapshot.references.selectedIds.length)} chip />
          </ControlBlock>
          <ControlBlock title="Next Move">
            <ListRow value={snapshot.state.nextAction} />
          </ControlBlock>
          <ControlBlock title="Open Questions">
            {snapshot.state.unknowns.length > 0 ? snapshot.state.unknowns.slice(0, 4).map((item) => <ListRow key={item} value={item} />) : <ListRow value="none recorded" />}
          </ControlBlock>
          <ControlBlock title="Evidence Signals">
            {snapshot.state.evidence.length > 0 ? snapshot.state.evidence.slice(0, 4).map((item) => <ListRow key={item} value={item} />) : <ListRow value="none yet" />}
          </ControlBlock>
        </aside>

        <section className="panel studio-main">
          {activeTab === "docs"
            ? <DocumentationPanel mode={snapshot.mode} returnTab={lastContentTab} onBack={() => setActiveTab(lastContentTab)} />
            : snapshot.mode === "prepare"
              ? renderPrepareTab(
                  activeTab,
                  snapshot,
                  sendAction,
                  referenceRootInput,
                  setReferenceRootInput,
                  async () => {
                    await loadDirectoryPicker("");
                    setDirectoryPickerOpen(true);
                  }
                )
              : renderOperateTab(activeTab, snapshot)}
        </section>

        {drawerOpen ? (
          <aside className="panel studio-drawer">
            <header className="panel-header">
              <span>{snapshot.mode === "prepare" ? "Prepare Actions" : "Operate Actions"}</span>
              <strong>{snapshot.busy ? snapshot.busyStatus : "ready"}</strong>
            </header>
            <ControlBlock title="Summary">
              <ListRow value={snapshot.prepareClarity?.coachHeadline ?? snapshot.state.nextAction} />
            </ControlBlock>
            <ControlBlock title="Settings">
              <label className="theme-select">
                <span>Theme</span>
                <select value={snapshot.settings.themeId} onChange={(event) => void setTheme(event.target.value)}>
                  {STUDIO_THEMES.map((themeOption) => (
                    <option key={themeOption.id} value={themeOption.id}>
                      {themeOption.label}
                    </option>
                  ))}
                </select>
              </label>
            </ControlBlock>
            <ControlBlock title="Actions">
              <div className="actions">
                {(snapshot.mode === "prepare"
                  ? [
                      { key: "F2", label: "Gather More", action: { type: "gather" as const } },
                      { key: "F3", label: "Build Draft", action: { type: "build" as const } },
                      { key: "F4", label: "Slice Plan", action: { type: "slice" as const } },
                      { key: "F5", label: "Review", action: { type: "review" as const } },
                      { key: "F6", label: "Approve", action: { type: "approve" as const } },
                      { key: "F7", label: "Operate", action: { type: "switch-mode" as const, mode: "operate" as const } }
                    ]
                  : [
                      { key: "F2", label: "Run Next", action: { type: "run" as const } },
                      { key: "F3", label: "Auto Continue", action: { type: "auto" as const } },
                      { key: "F4", label: "Checkpoint", action: { type: "checkpoint" as const } },
                      { key: "F6", label: "Review", action: { type: "review" as const } },
                      { key: "F7", label: "Unblock", action: { type: "unblock" as const } }
                    ]).map((item) => (
                  <button
                    className="action-button"
                    key={item.key + item.label}
                    onClick={() => void sendAction(item.action)}
                    disabled={snapshot.busy || !snapshot.actions[item.action.type].enabled}
                    title={snapshot.actions[item.action.type].blockedReason ?? undefined}
                  >
                    <span>{item.key}</span>
                    <strong>{item.label}</strong>
                  </button>
                ))}
              </div>
            </ControlBlock>
          </aside>
        ) : null}

        <section className="command-bar panel">
          <div className="command-label">{snapshot.mode === "prepare" ? "Plan Message Or :Command" : "Operate Command"}</div>
          <div className="command-input-row">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void sendInput();
                }
              }}
              placeholder={snapshot.mode === "prepare" ? "Type to chat or use :build / :slice / :theme..." : "Type an operate command like :run or :review"}
            />
            <button onClick={() => void sendInput()}>Send</button>
          </div>
        </section>

        <footer className="footer">
          <span>Theme: {snapshot.theme.label}</span>
          <span>Lane {snapshot.laneId} on {snapshot.branchName ?? "detached"} | {snapshot.footerText}</span>
        </footer>
      </main>
      {directoryPickerOpen ? (
        <div className="picker-overlay" onClick={() => setDirectoryPickerOpen(false)}>
          <div className="picker-modal panel" onClick={(event) => event.stopPropagation()}>
            <header className="panel-header">
              <span>Select Documentation Directory</span>
              <strong>{directoryPicker?.currentPath || "repo root"}</strong>
            </header>
            <div className="picker-actions">
              <button
                onClick={() => {
                  const selectedPath = directoryPicker?.currentPath ?? "";
                  if (!selectedPath) {
                    return;
                  }
                  void sendAction({ type: "reference-root-add", rootPath: selectedPath });
                  setDirectoryPickerOpen(false);
                }}
                disabled={!directoryPicker?.currentPath}
              >
                Use This Directory
              </button>
              <button
                onClick={() => {
                  if (directoryPicker?.parentPath === null) {
                    return;
                  }
                  void loadDirectoryPicker(directoryPicker.parentPath);
                }}
                disabled={directoryPicker?.parentPath === null}
              >
                Up One Level
              </button>
              <button onClick={() => setDirectoryPickerOpen(false)}>Close</button>
            </div>
            <div className="picker-list">
              {(directoryPicker?.directories ?? []).map((entry) => (
                <button
                  className="picker-row"
                  key={entry.path}
                  onClick={() => void loadDirectoryPicker(entry.path)}
                >
                  <span>{entry.name}</span>
                  <strong>{entry.path}</strong>
                </button>
              ))}
              {(directoryPicker?.directories.length ?? 0) === 0 ? (
                <div className="tab-summary">
                  <strong>No subdirectories here</strong>
                  <span>You can select this directory, go up one level, or close the picker.</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderPrepareTab(
  activeTab: string,
  snapshot: StudioSnapshot,
  sendAction: (request: StudioActionRequest) => Promise<void>,
  referenceRootInput: string,
  setReferenceRootInput: (value: string) => void,
  openDirectoryPicker: () => Promise<void>
) {
  if (activeTab === "context" && snapshot.prepareClarity) {
    return (
      <div className="tab-content">
        <div className="context-sections">
          <ContextExcerpt title="Repo Truth" value={snapshot.prepareClarity.repoTruth} empty="Repo truth has not been captured clearly yet." />
          <ContextExcerpt title="Evidence" value={snapshot.prepareClarity.evidenceSection} empty="Evidence still needs to be grounded in actual repo facts." />
          <ContextExcerpt title="Unknowns" value={snapshot.prepareClarity.unknownsSection} empty="Unknowns are not clearly surfaced yet." />
          <ContextExcerpt title="Working Agreements" value={snapshot.prepareClarity.workingAgreements} empty="Working agreements have not been made explicit yet." />
          <ContextExcerpt title="Selected Guidance" value={snapshot.prepareClarity.selectedGuidance} empty="No guidance documents are actively shaping the plan yet." />
        </div>
        <div className="context-document">
          <div className="context-document-label">context.md</div>
          <pre>{snapshot.prepareClarity.contextDocument || "# Context\n\nThe context document has not been shaped yet."}</pre>
        </div>
      </div>
    );
  }

  if (activeTab === "references") {
    return (
      <div className="tab-content">
        <div className="tab-summary">
          <strong>{snapshot.references.selectedIds.length} selected references</strong>
          <span>
            {snapshot.references.recommendedIds.length} suggested from the current plan signals. Keep this lean and only activate guidance that genuinely sharpens the plan.
          </span>
        </div>
        <div className="reference-toolbar">
          <button onClick={() => void sendAction({ type: "reference-autoselect" })}>
            Auto Select Relevant
          </button>
          <button onClick={() => void sendAction({ type: "reference-clear" })} disabled={snapshot.references.selectedIds.length === 0}>
            Clear Selected
          </button>
        </div>
        <section className="reference-roots">
          <div className="reference-roots-head">
            <strong>Documentation Search Roots</strong>
            <span>Add directories that should be scanned for context and guidance docs.</span>
          </div>
          <div className="reference-root-input">
            <input
              value={referenceRootInput}
              onChange={(event) => setReferenceRootInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && referenceRootInput.trim()) {
                  void sendAction({ type: "reference-root-add", rootPath: referenceRootInput.trim() });
                  setReferenceRootInput("");
                }
              }}
              placeholder="docs/playbooks or REFERENCE/company-standards"
            />
            <button
              onClick={() => {
                if (!referenceRootInput.trim()) {
                  return;
                }
                void sendAction({ type: "reference-root-add", rootPath: referenceRootInput.trim() });
                setReferenceRootInput("");
              }}
            >
              Add Directory
            </button>
            <button onClick={() => void openDirectoryPicker()}>
              Browse Directories
            </button>
          </div>
          <div className="reference-root-list">
            {snapshot.references.roots.length > 0 ? snapshot.references.roots.map((root) => (
              <div className="reference-root-chip" key={root}>
                <span>{root}</span>
                <button onClick={() => void sendAction({ type: "reference-root-remove", rootPath: root })}>Remove</button>
              </div>
            )) : <span className="reference-root-empty">Using built-in roots only: README.md, docs, REFERENCE.</span>}
          </div>
        </section>
        <div className="reference-grid">
          {snapshot.references.entries.map((entry) => (
            <article className="reference-card" key={entry.id}>
              <div className="reference-card-head">
                <strong>{entry.title}</strong>
                <div className="reference-statuses">
                  {entry.recommended ? <span className="status-chip">suggested</span> : null}
                  <span className={`status-chip ${entry.selected ? "ok" : ""}`}>{entry.selected ? "selected" : "available"}</span>
                </div>
              </div>
              <div className="reference-path">{entry.path}</div>
              <p>{entry.summary}</p>
              {entry.recommended && entry.recommendationReason ? <div className="reference-reason">{entry.recommendationReason}</div> : null}
              <div className="reference-tags">
                {entry.tags.map((tag) => (
                  <span className="chip" key={tag}>{tag}</span>
                ))}
              </div>
              <button onClick={() => void sendAction({ type: "reference-toggle", referenceId: entry.id, selected: !entry.selected })}>
                {entry.selected ? "Remove From Context Set" : "Use This Guidance"}
              </button>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === "transcript") {
    return <TranscriptPanel snapshot={snapshot} />;
  }

  return (
    <div className="tab-content">
      {snapshot.prepareClarity ? (
        <>
          <div className="clarity-hero">
            <h2>{snapshot.prepareClarity.coachHeadline}</h2>
            <p>{snapshot.prepareClarity.coachSummary}</p>
          </div>
          <div className="clarity-next-action">
            <span>Next deliberate move</span>
            <strong>{snapshot.state.nextAction}</strong>
          </div>
          <div className="clarity-checklist">
            {snapshot.prepareClarity.checks.map((check) => (
              <article className={`clarity-check ${check.passed ? "passed" : "missing"}`} key={check.id}>
                <div className="clarity-check-head">
                  <strong>{check.title}</strong>
                  <span className="status-chip">{check.passed ? "ready" : "missing"}</span>
                </div>
                <p>{check.whyItMatters}</p>
                <div className="clarity-next">{check.nextMove}</div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="tab-summary">
          <strong>Prepare clarity data is still loading.</strong>
        </div>
      )}
    </div>
  );
}

function renderOperateTab(activeTab: string, snapshot: StudioSnapshot) {
  if (activeTab === "transcript") {
    return <TranscriptPanel snapshot={snapshot} />;
  }

  if (activeTab === "review") {
    return (
      <div className="tab-content">
        <div className="tab-summary">
          <strong>Review before PR</strong>
          <span>This is the future home for PR readiness, selected guidance checks, and final change summaries.</span>
        </div>
        <div className="context-sections">
          <ContextExcerpt title="Current Step" value={snapshot.state.nextStepSummary ? `${snapshot.state.nextStepSummary.id}: ${snapshot.state.nextStepSummary.scope}` : null} empty="No current step is queued." />
          <ContextExcerpt title="Acceptance" value={snapshot.state.nextStepSummary?.acceptance ?? null} empty="Acceptance criteria are not available yet." />
          <ContextExcerpt title="Validation" value={snapshot.state.nextStepSummary?.validation ?? null} empty="Validation path is not available yet." />
          <ContextExcerpt title="Last Change" value={snapshot.state.manifest?.lastChangeSummary ?? null} empty="No visible change recorded yet." />
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="clarity-hero">
        <h2>Execution should stay explicit and reviewable.</h2>
        <p>Run the next safe step, keep checkpoints clear, and return to prepare whenever the plan needs judgment rather than momentum.</p>
      </div>
      <div className="context-sections">
        <ContextExcerpt title="Next Step" value={snapshot.state.nextStepSummary ? `${snapshot.state.nextStepSummary.id}: ${snapshot.state.nextStepSummary.scope}` : null} empty="No next step is queued." />
        <ContextExcerpt title="Acceptance" value={snapshot.state.nextStepSummary?.acceptance ?? null} empty="Acceptance criteria are not available yet." />
        <ContextExcerpt title="Validation" value={snapshot.state.nextStepSummary?.validation ?? null} empty="Validation path is not available yet." />
        <ContextExcerpt title="References In Effect" value={snapshot.references.selectedIds.join("\n") || null} empty="No references are currently selected." />
      </div>
    </div>
  );
}

function TranscriptPanel(props: { snapshot: StudioSnapshot }) {
  return (
    <div className="tab-content">
      <div className="tab-summary">
        <strong>Transcript and evidence trail</strong>
        <span>Use this when you need the full conversation. The main workspace stays summary-first on purpose.</span>
      </div>
      <div className="transcript-body">
        {props.snapshot.messages.map((message, index) => (
          <article className={`message ${message.role}`} key={`${index}-${message.role}`}>
            <div className="message-role">{message.role === "assistant" ? "AI" : message.role === "system" ? "SYSTEM" : "YOU"}</div>
            <pre>{message.content}</pre>
          </article>
        ))}
      </div>
    </div>
  );
}

function DocumentationPanel(props: { mode: "prepare" | "operate"; returnTab: string; onBack: () => void }) {
  return (
    <div className="tab-content">
      <div className="tab-summary">
        <strong>How srgical is meant to be used</strong>
        <span>Use prepare to shape context and judgment. Use operate to execute from an approved plan. Keep the human in charge of the decision quality.</span>
      </div>
      <div className="docs-grid">
        <section className="context-excerpt">
          <div className="context-excerpt-title">Core Flow</div>
          <pre>{[
            "1. Prepare",
            "- clarify the desired outcome",
            "- gather repo truth and imported evidence",
            "- select any rules, skills, or guidance that should shape the work",
            "- build and slice the draft until the next step is explicit",
            "",
            "2. Approve",
            "- the human deliberately confirms the plan is good enough to execute",
            "",
            "3. Operate",
            "- execute one step at a time or use auto-continue carefully",
            "- checkpoint when needed",
            "- return to prepare when judgment or reshaping is needed"
          ].join("\n")}</pre>
        </section>
        <section className="context-excerpt">
          <div className="context-excerpt-title">Working Philosophy</div>
          <pre>{[
            "- humans need to understand the fundamentals well enough to apply judgment",
            "- AI is strongest when the repo, tests, and seams are structured clearly",
            "- context.md is the living source of truth for what is actually known",
            "- references are guidance, not unquestioned truth",
            "- the goal is not maximum verbosity; it is deliberate clarity"
          ].join("\n")}</pre>
        </section>
        <section className="context-excerpt">
          <div className="context-excerpt-title">References And Documents</div>
          <pre>{[
            "- use the References tab to activate guidance that matters for the current plan",
            "- add extra documentation directories when company docs live outside the default roots",
            "- selected references are included in planning prompts and mirrored into context.md"
          ].join("\n")}</pre>
        </section>
        <section className="context-excerpt">
          <div className="context-excerpt-title">When To Return To Prepare</div>
          <pre>{[
            "- the next step is no longer clear",
            "- new evidence changes the approach",
            "- implementation exposed a missing decision or risky seam",
            "- the plan drifted away from the intended outcome"
          ].join("\n")}</pre>
        </section>
      </div>
      <div className="reference-toolbar">
        <button onClick={props.onBack}>Back To {props.mode === "prepare" ? "Prepare" : "Operate"}</button>
        <span className="reference-root-empty">Returning to: {props.returnTab}</span>
      </div>
    </div>
  );
}

function buildThemeVars(theme: StudioTheme) {
  return {
    ["--app-bg" as const]: theme.chrome.appBackground,
    ["--app-vignette" as const]: theme.chrome.vignette,
    ["--grid-color" as const]: theme.chrome.grid,
    ["--panel-surface" as const]: theme.chrome.panelSurface,
    ["--panel-surface-alt" as const]: theme.chrome.panelSurfaceAlt,
    ["--panel-border" as const]: theme.chrome.panelBorder,
    ["--panel-glow" as const]: theme.chrome.panelGlow,
    ["--command-surface" as const]: theme.chrome.commandSurface,
    ["--footer-surface" as const]: theme.chrome.footerSurface,
    ["--text-primary" as const]: theme.chrome.textPrimary,
    ["--text-muted" as const]: theme.chrome.textMuted,
    ["--text-strong" as const]: theme.chrome.textStrong,
    ["--accent" as const]: theme.chrome.accent,
    ["--accent-soft" as const]: theme.chrome.accentSoft,
    ["--success" as const]: theme.chrome.success,
    ["--warning" as const]: theme.chrome.warning,
    ["--danger" as const]: theme.chrome.danger,
    ["--info" as const]: theme.chrome.info,
    ["--display-font" as const]: theme.typography.display,
    ["--body-font" as const]: theme.typography.body,
    ["--mono-font" as const]: theme.typography.mono,
    ["--heading-transform" as const]: theme.typography.headingTransform,
    ["--heading-spacing" as const]: theme.typography.headingLetterSpacing
  } as CSSProperties;
}

function ControlBlock(props: { title: string; children: ReactNode }) {
  return (
    <section className="control-block">
      <h2>{props.title}</h2>
      <div className="control-content">{props.children}</div>
    </section>
  );
}

function Detail(props: { label: string; value: string; chip?: boolean }) {
  return (
    <div className="detail-row">
      <span>{props.label}</span>
      {props.chip ? <strong className="chip">{props.value}</strong> : <strong>{props.value}</strong>}
    </div>
  );
}

function ListRow(props: { value: string }) {
  return <div className="list-row">- {props.value}</div>;
}

function ContextExcerpt(props: { title: string; value: string | null; empty: string }) {
  return (
    <section className="context-excerpt">
      <div className="context-excerpt-title">{props.title}</div>
      <pre>{props.value?.trim() ? props.value : props.empty}</pre>
    </section>
  );
}

async function fetchRepoSnapshot(token: string): Promise<RepoSnapshot> {
  return getJson(`/api/repo?token=${encodeURIComponent(token)}`);
}

async function fetchStudioSnapshot(token: string): Promise<StudioSnapshot> {
  return getJson(`/api/studio/session?token=${encodeURIComponent(token)}`);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function postJson<T = { ok: boolean }, TBody = unknown>(url: string, token: string, body: TBody): Promise<T> {
  const response = await fetch(`${url}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-srgical-token": token },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

function extractErrorMessage(reason: unknown): string {
  const fallback = reason instanceof Error ? reason.message : String(reason);

  try {
    const parsed = JSON.parse(fallback) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return fallback;
  }
}
