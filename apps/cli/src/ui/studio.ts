import blessed from "blessed";
import {
  createStudioController,
  getScrollableWheelStep,
  limitStudioSnippet,
  normalizeStudioStreamChunk,
  planStudioProgressiveReveal,
  renderCommandSyntaxHelpText,
  renderGatherFollowUp,
  renderOperateHelpText,
  renderPlanningAdviceTranscript,
  renderPrepareHelpText,
  selectAutoGatherFiles
} from "@srgical/studio-core";
import type { StudioSnapshot } from "@srgical/studio-core";
import type { StudioEvent } from "@srgical/studio-core";
import type { StudioMode } from "@srgical/studio-shared";

type ScrollableElement = Pick<
  blessed.Widgets.ScrollableBoxElement,
  "height" | "iheight" | "getScroll" | "getScrollHeight" | "getScrollPerc" | "setScroll" | "setScrollPerc" | "scroll"
>;
type PositionedElement = { lpos?: { xi: number; xl: number; yi: number; yl: number } };
type StudioMouseOptions = { vt200Mouse: boolean; allMotion: boolean; sgrMouse: boolean; sendFocus: boolean };
type CursorOffset = { rowOffset: number; colOffset: number };
type StudioPalette = {
  headerFg: string;
  headerBg: string;
  panelBg: string;
  sidePanelBg: string;
  inputBg: string;
  footerFg: string;
  accent: string;
  transcriptBorder: string;
  scrollbarTrack: string;
  sidebarBorder: string;
  inputBorder: string;
  transcriptLabel: string;
  sidebarLabel: string;
  inputLabel: string;
};

const STUDIO_THEME = {
  headerFg: "#ecfeff",
  transcriptText: "#edf8ff",
  sidebarText: "#d8f3ff",
  userLabel: "#4ade80",
  aiLabel: "#fde047",
  systemLabel: "#60a5fa"
} as const;
const ESC = (blessed as typeof blessed & { helpers: { escape(text: string): string } }).helpers.escape;

export async function launchStudio(options: { workspace?: string; planId?: string | null; mode?: StudioMode } = {}): Promise<void> {
  let inputValue = "";
  let transcriptWheelHandled = false;
  let lastTranscriptContent: string | null = null;
  let snapshot = {
    mode: options.mode === "operate" ? "operate" : "prepare"
  } as StudioSnapshot;

  const controller = await createStudioController(options);
  snapshot = controller.getSnapshot();
  const initialPalette = getStudioPalette(snapshot.mode);

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    mouse: true,
    sendFocus: true,
    title: snapshot.mode === "prepare" ? "srgical prepare" : "srgical operate"
  });
  const header = blessed.box({ top: 0, left: 0, width: "100%", height: 3, tags: true, style: { fg: STUDIO_THEME.headerFg, bg: initialPalette.headerBg } });
  const transcript = blessed.box({
    top: 3,
    left: 0,
    width: "68%",
    height: "100%-10",
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    clickable: true,
    input: true,
    padding: { top: 1, right: 1, bottom: 1, left: 1 },
    border: { type: "line" },
    label: initialPalette.transcriptLabel,
    scrollbar: { ch: " ", track: { bg: initialPalette.scrollbarTrack }, style: { bg: initialPalette.transcriptBorder } },
    style: { fg: STUDIO_THEME.transcriptText, bg: initialPalette.panelBg, border: { fg: initialPalette.transcriptBorder } }
  });
  const sidebar = blessed.box({
    top: 3,
    left: "68%",
    width: "32%",
    height: "100%-10",
    tags: true,
    padding: { top: 1, right: 1, bottom: 1, left: 1 },
    border: { type: "line" },
    label: initialPalette.sidebarLabel,
    style: { fg: STUDIO_THEME.sidebarText, bg: initialPalette.sidePanelBg, border: { fg: initialPalette.sidebarBorder } }
  });
  const input = blessed.box({
    bottom: 1,
    left: 0,
    width: "100%",
    height: 6,
    tags: true,
    mouse: true,
    clickable: true,
    padding: { top: 0, right: 1, bottom: 0, left: 1 },
    border: { type: "line" },
    label: initialPalette.inputLabel,
    style: { fg: STUDIO_THEME.transcriptText, bg: initialPalette.inputBg, border: { fg: initialPalette.inputBorder } }
  });
  const footer = blessed.box({ bottom: 0, left: 0, width: "100%", height: 1, tags: true, style: { fg: initialPalette.footerFg, bg: initialPalette.headerBg } });
  screen.append(header);
  screen.append(transcript);
  screen.append(sidebar);
  screen.append(input);
  screen.append(footer);
  screen.enableMouse(transcript);
  screen.enableMouse(input);
  screen.program.setMouse(getPreferredStudioMouseOptions(), true);

  const render = () => {
    const palette = getStudioPalette(snapshot.mode);
    const transcriptContent = renderStudioTranscript(snapshot.messages);
    const shouldStickTranscript = shouldStickScrollableToBottom(transcript);
    const transcriptScroll = transcript.getScroll();
    const transcriptChanged = transcriptContent !== lastTranscriptContent;
    const transcriptScrollbar = (transcript as blessed.Widgets.BoxElement & {
      scrollbar?: { track?: { bg?: string }; style?: { bg?: string } };
    }).scrollbar;

    screen.title = snapshot.mode === "prepare" ? "srgical prepare" : "srgical operate";
    header.style.bg = palette.headerBg;
    transcript.style.bg = palette.panelBg;
    transcript.style.border.fg = palette.transcriptBorder;
    if (transcriptScrollbar) {
      transcriptScrollbar.track = transcriptScrollbar.track ?? {};
      transcriptScrollbar.track.bg = palette.scrollbarTrack;
      transcriptScrollbar.style = transcriptScrollbar.style ?? {};
      transcriptScrollbar.style.bg = palette.transcriptBorder;
    }
    sidebar.style.bg = palette.sidePanelBg;
    sidebar.style.border.fg = palette.sidebarBorder;
    input.style.bg = palette.inputBg;
    input.style.border.fg = palette.inputBorder;
    footer.style.bg = palette.headerBg;
    footer.style.fg = palette.footerFg;
    transcript.setLabel(palette.transcriptLabel);
    sidebar.setLabel(palette.sidebarLabel);
    input.setLabel(palette.inputLabel);

    header.setContent(
      ` {bold}SRGICAL ${snapshot.mode.toUpperCase()}{/bold}   ${snapshot.workspaceLabel}   {${palette.accent}-fg}PLAN ${snapshot.planId.toUpperCase()} | ${snapshot.state.mode.toUpperCase()}{/}`
    );
    if (transcriptChanged) {
      transcript.setContent(transcriptContent);
      lastTranscriptContent = transcriptContent;
      if (!shouldStickTranscript) {
        transcript.setScroll(clampScrollableScrollPosition(transcriptScroll, transcript.getScrollHeight(), getScrollableViewportHeight(transcript)));
      }
    }
    sidebar.setContent(
      [
        "{bold}Overview{/bold}",
        `stage: ${snapshot.state.mode}`,
        `next action: ${snapshot.state.nextAction}`,
        `next step: ${snapshot.state.currentPosition.nextRecommended ?? "none"}`,
        `approval: ${snapshot.state.approvalStatus}`,
        "",
        "{bold}Evidence{/bold}",
        ...(snapshot.state.evidence.length > 0 ? snapshot.state.evidence.slice(0, 5).map((item: string) => `- ${item}`) : ["- none yet"]),
        "",
        "{bold}Unknowns{/bold}",
        ...(snapshot.state.unknowns.length > 0 ? snapshot.state.unknowns.slice(0, 5).map((item: string) => `- ${item}`) : ["- none recorded"]),
        "",
        "{bold}Last Change{/bold}",
        snapshot.state.manifest?.lastChangeSummary ?? "none yet",
        "",
        "{bold}Runtime{/bold}",
        `agent: ${snapshot.agentLabel}`,
        `theme: ${snapshot.theme.label}`,
        `wheel: ${snapshot.uiConfig.wheelSensitivity}/10 (${getScrollableWheelStep(snapshot.uiConfig.wheelSensitivity)} line${getScrollableWheelStep(snapshot.uiConfig.wheelSensitivity) === 1 ? "" : "s"}/notch)`,
        `status: ${snapshot.busyStatus}`,
        "",
        "{bold}Actions{/bold}",
        ...(snapshot.mode === "prepare"
          ? ["F2 Gather More", "F3 Build Draft", "F4 Slice Plan", "F5 Review Changes", "F6 Approve Ready", "F7 Open Operate"]
          : ["F2 Run Next Step", "F3 Auto Continue", "F4 PR Checkpoints", "F5 Refine Plan", "F6 Review Last Change", "F7 Resolve Blocker"])
      ].join("\n")
    );
    input.setContent(renderStudioInputContent(inputValue));
    footer.setContent(` ${snapshot.footerText} `);
    const pinnedBeforeRender = transcriptChanged && shouldStickTranscript && tryStickScrollableToBottom(transcript);
    screen.render();
    if (transcriptChanged && shouldStickTranscript && !pinnedBeforeRender) {
      transcript.setScrollPerc(100);
      screen.render();
    }
    focusStudioInput(screen, input);
  };

  const unsubscribe = controller.subscribe((event: StudioEvent) => {
    if (event.type === "snapshot") {
      snapshot = event.snapshot;
      render();
    }
  });

  const scrollTranscriptBy = (offset: number) => {
    transcript.scroll(offset);
    screen.render();
  };
  const scrollTranscriptByPage = (direction: -1 | 1) => {
    scrollTranscriptBy(direction * getScrollablePageStep(transcript));
  };
  const scrollTranscriptTo = (target: "top" | "bottom") => {
    transcript.setScrollPerc(target === "top" ? 0 : 100);
    screen.render();
  };

  const submit = async () => {
    const text = inputValue.trim();
    inputValue = "";
    render();
    if (!text) {
      return;
    }
    if (text === ":quit" || text === ":q") {
      unsubscribe();
      await controller.close();
      screen.destroy();
      return;
    }
    await controller.submitInput(text);
  };

  screen.key(["C-c"], async () => {
    unsubscribe();
    await controller.close();
    screen.destroy();
  });
  screen.key(["f1"], async () => {
    await controller.submitInput(":help");
  });
  screen.key(["f2"], async () => {
    await controller.dispatch({ type: snapshot.mode === "prepare" ? "gather" : "run" });
  });
  screen.key(["f3"], async () => {
    await controller.dispatch({ type: snapshot.mode === "prepare" ? "build" : "auto" });
  });
  screen.key(["f4"], async () => {
    await controller.dispatch({ type: snapshot.mode === "prepare" ? "slice" : "checkpoint" });
  });
  screen.key(["f5"], async () => {
    if (snapshot.mode === "prepare") {
      await controller.dispatch({ type: "review" });
      return;
    }
    await controller.dispatch({ type: "switch-mode", mode: "prepare" });
  });
  screen.key(["f6"], async () => {
    await controller.dispatch({ type: snapshot.mode === "prepare" ? "approve" : "review" });
  });
  screen.key(["f7"], async () => {
    if (snapshot.mode === "prepare") {
      await controller.dispatch({ type: "switch-mode", mode: "operate" });
      return;
    }
    await controller.dispatch({ type: "unblock" });
  });
  transcript.on("wheelup", () => {
    transcriptWheelHandled = true;
  });
  transcript.on("wheeldown", () => {
    transcriptWheelHandled = true;
  });
  screen.on("wheelup", (data) => {
    if (!isMouseWithinElement(transcript, data)) {
      return;
    }
    if (transcriptWheelHandled) {
      transcriptWheelHandled = false;
      return;
    }
    scrollTranscriptBy(-getScrollableWheelStep(snapshot.uiConfig.wheelSensitivity));
  });
  screen.on("wheeldown", (data) => {
    if (!isMouseWithinElement(transcript, data)) {
      return;
    }
    if (transcriptWheelHandled) {
      transcriptWheelHandled = false;
      return;
    }
    scrollTranscriptBy(getScrollableWheelStep(snapshot.uiConfig.wheelSensitivity));
  });
  transcript.on("click", () => {
    focusStudioInput(screen, input);
  });
  input.on("click", () => {
    focusStudioInput(screen, input);
  });
  transcript.on("keypress", (_ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    handleTranscriptNavigationKey(key, scrollTranscriptByPage, scrollTranscriptTo);
  });
  input.on("keypress", async (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
    if (handleTranscriptNavigationKey(key, scrollTranscriptByPage, scrollTranscriptTo)) {
      return;
    }
    if (key.name === "enter") {
      await submit();
      return;
    }
    if (key.name === "backspace") {
      inputValue = inputValue.slice(0, -1);
      render();
      return;
    }
    if (key.name === "escape") {
      inputValue = "";
      render();
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      inputValue += ch;
      render();
    }
  });

  render();
  await controller.start();
  focusStudioInput(screen, input);
}

export function renderStudioInputContent(value: string): string {
  return ESC(value).replace(/ /g, "\u00a0");
}

export function renderStudioTranscript(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>): string {
  return messages
    .map((message) => `${message.role === "user" ? `{${STUDIO_THEME.userLabel}-fg}YOU{/}` : message.role === "assistant" ? `{${STUDIO_THEME.aiLabel}-fg}AI{/}` : `{${STUDIO_THEME.systemLabel}-fg}SYSTEM{/}`}\n${ESC(message.content)}`)
    .join("\n\n");
}

export function resolveStudioInputCursor(
  clines: string[],
  visibleRows: number,
  visibleCols: number,
  measureWidth: (line: string) => number = (line) => line.length
): CursorOffset {
  const lines = clines.length > 0 ? clines : [""];
  const safeRows = Math.max(visibleRows, 1);
  const safeCols = Math.max(visibleCols, 1);
  const rowOffset = Math.max(0, Math.min(lines.length - 1, safeRows - 1));
  const colOffset = Math.max(0, Math.min(measureWidth(lines[rowOffset] ?? ""), safeCols - 1));
  return { rowOffset, colOffset };
}

export function shouldStickScrollableToBottom(element: Pick<ScrollableElement, "height" | "iheight" | "getScrollHeight" | "getScrollPerc">): boolean {
  const viewportHeight = getScrollableViewportHeight(element);
  if (viewportHeight <= 0) {
    return true;
  }
  if (element.getScrollHeight() <= viewportHeight) {
    return true;
  }
  return element.getScrollPerc() >= 99;
}

export function getScrollablePageStep(element: Pick<ScrollableElement, "height" | "iheight">): number {
  return Math.max(getScrollableViewportHeight(element) - 1, 1);
}

export function getPreferredStudioMouseOptions(): StudioMouseOptions {
  return {
    vt200Mouse: true,
    allMotion: true,
    sgrMouse: true,
    sendFocus: true
  };
}

export function getStudioPalette(mode: StudioMode): StudioPalette {
  return mode === "prepare"
    ? {
        headerFg: STUDIO_THEME.headerFg,
        headerBg: "#061711",
        panelBg: "#07140f",
        sidePanelBg: "#0b1d16",
        inputBg: "#0f2119",
        footerFg: "#99f6e4",
        accent: "#2dd4bf",
        transcriptBorder: "#14b8a6",
        scrollbarTrack: "#10261f",
        sidebarBorder: "#22c55e",
        inputBorder: "#5eead4",
        transcriptLabel: " Prepare Transcript ",
        sidebarLabel: " Prepare Control ",
        inputLabel: " Plan Message or :command "
      }
    : {
        headerFg: STUDIO_THEME.headerFg,
        headerBg: "#081424",
        panelBg: "#081220",
        sidePanelBg: "#0c1829",
        inputBg: "#101d31",
        footerFg: "#93c5fd",
        accent: "#60a5fa",
        transcriptBorder: "#3b82f6",
        scrollbarTrack: "#13243b",
        sidebarBorder: "#38bdf8",
        inputBorder: "#60a5fa",
        transcriptLabel: " Operate Transcript ",
        sidebarLabel: " Operate Control ",
        inputLabel: " Operate Commands (:help) "
      };
}

export function clampScrollableScrollPosition(scroll: number, scrollHeight: number, viewportHeight: number): number {
  const maxScrollTop = Math.max(scrollHeight - Math.max(viewportHeight, 0), 0);
  return Math.max(0, Math.min(scroll, maxScrollTop));
}

export function handleTranscriptNavigationKey(
  key: Pick<blessed.Widgets.Events.IKeyEventArg, "name">,
  scrollByPage: (direction: -1 | 1) => void,
  scrollTo: (target: "top" | "bottom") => void
): boolean {
  if (key.name === "pageup") {
    scrollByPage(-1);
    return true;
  }
  if (key.name === "pagedown") {
    scrollByPage(1);
    return true;
  }
  if (key.name === "home") {
    scrollTo("top");
    return true;
  }
  if (key.name === "end") {
    scrollTo("bottom");
    return true;
  }
  return false;
}

function tryStickScrollableToBottom(element: ScrollableElement): boolean {
  const viewportHeight = getScrollableViewportHeight(element);
  if (viewportHeight <= 0) {
    return false;
  }
  element.setScrollPerc(100);
  return true;
}

function getScrollableViewportHeight(element: Pick<ScrollableElement, "height" | "iheight">): number {
  const height = typeof element.height === "number" ? element.height : Number(element.height);
  const innerHeight = typeof element.iheight === "number" ? element.iheight : Number(element.iheight);
  if (!Number.isFinite(height) || !Number.isFinite(innerHeight)) {
    return 0;
  }
  return Math.max(height - innerHeight, 0);
}

function isMouseWithinElement(element: blessed.Widgets.BoxElement, data: blessed.Widgets.Events.IMouseEventArg): boolean {
  const pos = (element as blessed.Widgets.BoxElement & PositionedElement).lpos;
  if (!pos) {
    return false;
  }
  return data.x >= pos.xi && data.x < pos.xl && data.y >= pos.yi && data.y < pos.yl;
}

function focusStudioInput(screen: blessed.Widgets.Screen, input: blessed.Widgets.BoxElement): void {
  if (screen.focused !== input) {
    input.focus();
  }
  placeStudioInputCursor(screen, input);
}

function placeStudioInputCursor(screen: blessed.Widgets.Screen, input: blessed.Widgets.BoxElement): void {
  const target = input as blessed.Widgets.BoxElement & PositionedElement & {
    ileft: number;
    itop: number;
    iwidth: number;
    iheight: number;
    _clines?: string[];
    strWidth?: (text: string) => number;
  };
  const pos = target.lpos;
  if (!pos) {
    return;
  }

  const innerWidth = Math.max(pos.xl - pos.xi - target.iwidth, 1);
  const innerHeight = Math.max(pos.yl - pos.yi - target.iheight, 1);
  const { rowOffset, colOffset } = resolveStudioInputCursor(
    target._clines ?? [""],
    innerHeight,
    innerWidth,
    (line) => {
      const measured = target.strWidth ? target.strWidth(line) : line.length;
      return typeof measured === "number" ? measured : line.length;
    }
  );

  screen.program.cup(pos.yi + target.itop + rowOffset, pos.xi + target.ileft + colOffset);
  screen.program.showCursor();
}

export {
  getScrollableWheelStep,
  limitStudioSnippet,
  normalizeStudioStreamChunk,
  planStudioProgressiveReveal,
  renderCommandSyntaxHelpText,
  renderGatherFollowUp,
  renderOperateHelpText,
  renderPlanningAdviceTranscript,
  renderPrepareHelpText,
  selectAutoGatherFiles
};
