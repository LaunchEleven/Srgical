export type StudioMode = "prepare" | "operate";

export type ThemeChrome = {
  appBackground: string;
  vignette: string;
  grid: string;
  panelSurface: string;
  panelSurfaceAlt: string;
  panelBorder: string;
  panelGlow: string;
  commandSurface: string;
  footerSurface: string;
  textPrimary: string;
  textMuted: string;
  textStrong: string;
  accent: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
};

export type ThemeTypography = {
  display: string;
  body: string;
  mono: string;
  headingTransform: "uppercase" | "none";
  headingLetterSpacing: string;
};

export type ThemeMotion = {
  panelTransitionMs: number;
  glowStrength: number;
};

export type StudioTheme = {
  id: string;
  label: string;
  description: string;
  chrome: ThemeChrome;
  typography: ThemeTypography;
  motion: ThemeMotion;
};

export type StudioSettings = {
  themeId: string;
  updatedAt: string;
};

export const DEFAULT_STUDIO_THEME_ID = "neon-command";

export const STUDIO_THEMES: StudioTheme[] = [
  {
    id: "neon-command",
    label: "Neon Command",
    description: "Deep violet control-room panels with bright cyan accents.",
    chrome: {
      appBackground: "radial-gradient(circle at 50% 40%, rgba(96,37,170,0.45), rgba(15,6,31,0.96) 54%, rgba(6,5,16,1) 100%)",
      vignette: "radial-gradient(circle at center, rgba(255,255,255,0.06), rgba(5,3,12,0.88) 70%)",
      grid: "rgba(165, 95, 255, 0.18)",
      panelSurface: "rgba(20, 10, 40, 0.78)",
      panelSurfaceAlt: "rgba(24, 12, 46, 0.88)",
      panelBorder: "rgba(203, 132, 255, 0.72)",
      panelGlow: "rgba(191, 90, 242, 0.28)",
      commandSurface: "rgba(37, 14, 63, 0.9)",
      footerSurface: "rgba(14, 10, 31, 0.88)",
      textPrimary: "#f4f6ff",
      textMuted: "#b8c3df",
      textStrong: "#f9fbff",
      accent: "#5de6ff",
      accentSoft: "#c28bff",
      success: "#59db76",
      warning: "#ffce5b",
      danger: "#ff6f76",
      info: "#7ab7ff"
    },
    typography: {
      display: "\"Rajdhani\", \"Aldrich\", sans-serif",
      body: "\"Share Tech Mono\", \"Consolas\", monospace",
      mono: "\"Share Tech Mono\", \"Consolas\", monospace",
      headingTransform: "uppercase",
      headingLetterSpacing: "0.12em"
    },
    motion: {
      panelTransitionMs: 180,
      glowStrength: 22
    }
  },
  {
    id: "amber-grid",
    label: "Amber Grid",
    description: "Warm amber instrumentation over a midnight shell.",
    chrome: {
      appBackground: "radial-gradient(circle at 50% 35%, rgba(181,102,21,0.25), rgba(17,10,5,0.95) 58%, rgba(8,7,6,1) 100%)",
      vignette: "radial-gradient(circle at center, rgba(255,255,255,0.04), rgba(6,4,2,0.92) 70%)",
      grid: "rgba(247, 169, 54, 0.18)",
      panelSurface: "rgba(24, 16, 8, 0.78)",
      panelSurfaceAlt: "rgba(30, 20, 10, 0.88)",
      panelBorder: "rgba(247, 182, 72, 0.76)",
      panelGlow: "rgba(224, 154, 39, 0.24)",
      commandSurface: "rgba(34, 20, 8, 0.92)",
      footerSurface: "rgba(18, 12, 7, 0.9)",
      textPrimary: "#fff7eb",
      textMuted: "#e0d0bd",
      textStrong: "#fffaf2",
      accent: "#ffdf87",
      accentSoft: "#ffb44f",
      success: "#87da7b",
      warning: "#ffd36b",
      danger: "#ff7f69",
      info: "#9fd2ff"
    },
    typography: {
      display: "\"Rajdhani\", \"Aldrich\", sans-serif",
      body: "\"Share Tech Mono\", \"Consolas\", monospace",
      mono: "\"Share Tech Mono\", \"Consolas\", monospace",
      headingTransform: "uppercase",
      headingLetterSpacing: "0.14em"
    },
    motion: {
      panelTransitionMs: 180,
      glowStrength: 18
    }
  }
];

export function getStudioTheme(themeId: string | null | undefined): StudioTheme {
  return STUDIO_THEMES.find((theme) => theme.id === themeId) ?? STUDIO_THEMES[0];
}

export function createDefaultStudioSettings(now = new Date().toISOString()): StudioSettings {
  return {
    themeId: DEFAULT_STUDIO_THEME_ID,
    updatedAt: now
  };
}
