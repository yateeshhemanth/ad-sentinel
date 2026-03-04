// ── ADSentinel Design System ─────────────────────────────────────
export const THEME = {
  colors: {
    bg:        "#0a0e1a",
    surface:   "#0f1629",
    card:      "#141c35",
    border:    "#1e2d52",
    accent:    "#0ea5e9",
    accentGl:  "rgba(14,165,233,0.12)",
    danger:    "#ef4444",
    warn:      "#f59e0b",
    ok:        "#22c55e",
    purple:    "#a78bfa",
    orange:    "#f97316",
    text:      "#e2e8f0",
    muted:     "#64748b",
    dim:       "#334155",
  },
  fonts: {
    mono: "'Space Mono', 'Courier New', 'Consolas', 'Liberation Mono', monospace",
    sans: "'DM Sans', 'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif",
  },
  radius: { sm: 4, md: 6, lg: 8, xl: 12 },
  shadow: {
    card: "0 4px 24px rgba(0,0,0,0.4)",
    glow: (color) => `0 0 12px ${color}66`,
  },
};

export const SEV_COLORS = {
  critical: THEME.colors.danger,
  high:     THEME.colors.warn,
  medium:   THEME.colors.purple,
  info:     THEME.colors.accent,
  warning:  THEME.colors.orange,
};

export const STATUS_BADGE = {
  ok:         { bg: "#14532d", fg: THEME.colors.ok,     label: "OK"          },
  compromised:{ bg: "#450a0a", fg: THEME.colors.danger, label: "COMPROMISED" },
  expired:    { bg: "#451a03", fg: THEME.colors.warn,   label: "EXPIRED"     },
  blank:      { bg: "#450a0a", fg: THEME.colors.danger, label: "BLANK PWD"   },
  weak:       { bg: "#451a03", fg: THEME.colors.warn,   label: "WEAK"        },
  stale:      { bg: "#312e81", fg: THEME.colors.purple, label: "STALE"       },
  noExpiry:   { bg: "#1c1917", fg: "#a8a29e",           label: "NO EXPIRY"   },
};

export const SCORE_COLOR = (s) =>
  s >= 80 ? THEME.colors.ok : s >= 60 ? THEME.colors.warn : THEME.colors.danger;
