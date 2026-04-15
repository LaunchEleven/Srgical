import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { StudioActionRequest, StudioEvent, StudioSnapshot } from "@srgical/studio-core";
import { STUDIO_THEMES, getStudioTheme, type StudioTheme } from "@srgical/studio-shared";

declare global {
  interface Window {
    __SRGICAL_TOKEN__?: string;
  }
}

const token = window.__SRGICAL_TOKEN__ || new URLSearchParams(window.location.search).get("token") || "";

export function App() {
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    void fetchSnapshot().then(setSnapshot);
    const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
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
  }, []);

  const theme = useMemo<StudioTheme>(() => {
    if (!snapshot) {
      return getStudioTheme("neon-command");
    }
    return snapshot.theme;
  }, [snapshot]);

  const sendAction = async (request: StudioActionRequest) => {
    await fetch(`/api/action?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-srgical-token": token },
      body: JSON.stringify(request)
    });
  };

  const sendInput = async () => {
    const text = input.trim();
    if (!text) {
      return;
    }
    setInput("");
    await fetch(`/api/input?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-srgical-token": token },
      body: JSON.stringify({ text })
    });
  };

  const setTheme = async (themeId: string) => {
    await fetch(`/api/settings?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-srgical-token": token },
      body: JSON.stringify({ themeId })
    });
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
                  ]
              ).map((item) => (
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
          <span>{snapshot.footerText}</span>
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

function ControlBlock(props: { title: string; children: React.ReactNode }) {
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

async function fetchSnapshot(): Promise<StudioSnapshot> {
  const response = await fetch(`/api/session?token=${encodeURIComponent(token)}`, {
    headers: { "x-srgical-token": token }
  });
  return (await response.json()) as StudioSnapshot;
}
