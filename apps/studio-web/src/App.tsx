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

  const theme = useMemo<StudioTheme>(() => {
    if (!snapshot) {
      return getStudioTheme("neon-command");
    }
    return snapshot.theme;
  }, [snapshot]);

  const sendAction = async (request: StudioActionRequest) => {
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
    await postJson("/api/studio/settings", props.token, { themeId });
  };

  if (!snapshot) {
    return <div className="app loading">Launching Studio...</div>;
  }

  return (
    <div className="app" style={buildThemeVars(theme)}>
      <div className="backdrop" />
      <main className="shell">
        <section className="panel transcript-panel">
          <header className="panel-header">
            <span>{snapshot.mode === "prepare" ? "Prepare Transcript" : "Operate Transcript"}</span>
            <strong>{snapshot.workspaceLabel}</strong>
          </header>
          <div className="studio-identity">
            <span>Lane {snapshot.laneId}</span>
            <span>Branch {snapshot.branchName ?? "detached"}</span>
            <span>Plan {snapshot.planId}</span>
          </div>
          <div className="transcript-body">
            {snapshot.messages.map((message, index) => (
              <article className={`message ${message.role}`} key={`${index}-${message.role}`}>
                <div className="message-role">{message.role === "assistant" ? "AI" : message.role === "system" ? "SYSTEM" : "YOU"}</div>
                <pre>{message.content}</pre>
              </article>
            ))}
          </div>
        </section>

        <aside className="panel control-panel">
          <header className="panel-header">
            <span>{snapshot.mode === "prepare" ? "Prepare Control" : "Operate Control"}</span>
            <strong>{snapshot.busy ? snapshot.busyStatus : "ready"}</strong>
          </header>

          <ControlBlock title="Overview">
            <Detail label="Stage" value={snapshot.state.mode} chip />
            <Detail label="Next Action" value={snapshot.state.nextAction} />
            <Detail label="Next Step" value={snapshot.state.currentPosition.nextRecommended ?? "none"} chip />
            <Detail label="Approval" value={snapshot.state.approvalStatus} chip />
          </ControlBlock>

          <ControlBlock title="Evidence">
            {snapshot.state.evidence.length > 0 ? snapshot.state.evidence.slice(0, 5).map((item) => <ListRow key={item} value={item} />) : <ListRow value="none yet" />}
          </ControlBlock>

          <ControlBlock title="Unknowns">
            {snapshot.state.unknowns.length > 0 ? snapshot.state.unknowns.slice(0, 5).map((item) => <ListRow key={item} value={item} />) : <ListRow value="none recorded" />}
          </ControlBlock>

          <ControlBlock title="Last Change">
            <ListRow value={snapshot.state.manifest?.lastChangeSummary ?? "none yet"} />
          </ControlBlock>

          <ControlBlock title="Runtime">
            <Detail label="Agent" value={snapshot.agentLabel} />
            <Detail label="Theme" value={snapshot.theme.label} chip />
            <Detail label="Wheel" value={`${snapshot.uiConfig.wheelSensitivity}/10`} />
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
                    { key: "F5", label: "Prepare", action: { type: "switch-mode" as const, mode: "prepare" as const } },
                    { key: "F6", label: "Review", action: { type: "review" as const } },
                    { key: "F7", label: "Unblock", action: { type: "unblock" as const } }
                  ]).map((item) => (
                <button className="action-button" key={item.key + item.label} onClick={() => void sendAction(item.action)}>
                  <span>{item.key}</span>
                  <strong>{item.label}</strong>
                </button>
              ))}
            </div>
          </ControlBlock>
        </aside>

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
