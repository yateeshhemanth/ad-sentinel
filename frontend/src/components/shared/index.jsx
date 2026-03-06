import { THEME as T, STATUS_BADGE, SEV_COLORS, SCORE_COLOR } from "../../constants/theme";

// ── GlowCircle ──────────────────────────────────────────────────────
export const GlowCircle = ({ value, size = 80 }) => {
  const col  = SCORE_COLOR(value);
  const r    = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width={size} height={size} style={{ filter: `drop-shadow(0 0 6px ${col}88)` }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={T.colors.dim} strokeWidth={6} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2+5} textAnchor="middle" fill={col}
        style={{ fontSize: size * 0.17, fontWeight: 700, fontFamily: T.fonts.mono }}>{value}</text>
    </svg>
  );
};

// ── MetricCard ──────────────────────────────────────────────────────
export const MetricCard = ({ label, value, sub, color = T.colors.accent, icon, onClick, viewLabel }) => (
  <div onClick={onClick} style={{
    background: T.colors.card, border: `1px solid ${T.colors.border}`, borderRadius: T.radius.lg,
    padding: "16px 20px", position: "relative", overflow: "hidden",
    cursor: onClick ? "pointer" : "default",
    transition: "border-color 0.15s",
  }}
    onMouseEnter={onClick ? e => e.currentTarget.style.borderColor = color : undefined}
    onMouseLeave={onClick ? e => e.currentTarget.style.borderColor = T.colors.border : undefined}
  >
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color }} />
    <div style={{ fontSize: 10, color: T.colors.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>{icon && <span style={{ marginRight: 6 }}>{icon}</span>}{label}</span>
      {onClick && <span style={{ fontSize: 9, color: color, opacity: 0.7 }}>{viewLabel || "VIEW DATA ›"}</span>}
    </div>
    <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: T.fonts.mono }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: T.colors.muted, marginTop: 2 }}>{sub}</div>}
  </div>
);

// ── RawDataModal — generic drill-down for any MetricCard ─────────────
export const RawDataModal = ({ isOpen, onClose, title, color = T.colors.accent, headers, rows, emptyMsg }) => {
  if (!isOpen) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width={720}>
      {!rows || rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: T.colors.muted, fontSize: 13 }}>
          {emptyMsg || "No data available. Run a scan to populate this view."}
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12, fontSize: 11, color: T.colors.muted }}>
            Showing {rows.length} record{rows.length !== 1 ? "s" : ""}
          </div>
          <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, background: T.colors.surface }}>
                <tr>
                  {headers.map(h => (
                    <th key={h.key || h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, color: T.colors.muted, fontWeight: 700, borderBottom: `1px solid ${T.colors.border}`, whiteSpace: "nowrap" }}>
                      {h.label || h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.colors.border}22`, background: i % 2 ? "#0c1222" : "transparent" }}>
                    {headers.map(h => {
                      const key = h.key || h;
                      const val = row[key];
                      const isStatus = h.type === "severity" || h.type === "status";
                      const badgeColor = h.type === "severity"
                        ? ({ critical: T.colors.danger, high: T.colors.warn, medium: T.colors.accent, low: T.colors.purple }[val] || T.colors.muted)
                        : color;
                      return (
                        <td key={key} style={{ padding: "8px 12px", fontFamily: h.mono ? T.fonts.mono : T.fonts.sans, color: T.colors.text }}>
                          {isStatus
                            ? <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 3, background: `${badgeColor}22`, color: badgeColor }}>{String(val || "—").toUpperCase()}</span>
                            : <span style={{ color: h.muted ? T.colors.muted : T.colors.text }}>{val ?? "—"}</span>
                          }
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
};

// ── Badge ────────────────────────────────────────────────────────────
export const Badge = ({ status }) => {
  const b = STATUS_BADGE[status] || { bg: T.colors.dim, fg: T.colors.muted, label: status.toUpperCase() };
  return (
    <span style={{
      background: b.bg, color: b.fg, fontSize: 10, fontWeight: 700,
      padding: "2px 8px", borderRadius: T.radius.sm, letterSpacing: "0.06em", fontFamily: T.fonts.mono,
    }}>{b.label}</span>
  );
};

// ── SevDot ───────────────────────────────────────────────────────────
export const SevDot = ({ sev }) => (
  <span style={{
    display: "inline-block", width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
    background: SEV_COLORS[sev] || T.colors.muted,
    boxShadow: `0 0 5px ${SEV_COLORS[sev] || T.colors.muted}`,
    marginRight: 6,
  }} />
);

// ── SevBadge ─────────────────────────────────────────────────────────
export const SevBadge = ({ sev }) => {
  const c = SEV_COLORS[sev] || T.colors.muted;
  return (
    <span style={{
      background: `${c}22`, color: c, fontSize: 10, fontWeight: 700,
      padding: "2px 8px", borderRadius: T.radius.sm, letterSpacing: "0.06em", fontFamily: T.fonts.mono,
    }}>{sev.toUpperCase()}</span>
  );
};

// ── Button ───────────────────────────────────────────────────────────
export const Btn = ({ children, onClick, variant = "primary", size = "md", disabled, style = {}, ...props }) => {
  const styles = {
    primary:   { bg: T.colors.accent,        color: "#000",          border: "none"                       },
    secondary: { bg: T.colors.accentGl,      color: T.colors.accent, border: `1px solid ${T.colors.accent}44` },
    danger:    { bg: "rgba(239,68,68,0.12)", color: T.colors.danger, border: `1px solid ${T.colors.danger}44` },
    ghost:     { bg: "transparent",          color: T.colors.muted,  border: `1px solid ${T.colors.border}`  },
    ok:        { bg: "rgba(34,197,94,0.12)", color: T.colors.ok,     border: `1px solid ${T.colors.ok}44`    },
  };
  const sz = { sm: "4px 10px", md: "8px 18px", lg: "10px 24px" };
  const { bg, color, border } = styles[variant] || styles.primary;
  return (
    <button onClick={onClick} disabled={disabled} {...props} style={{
      background: bg, color, border, padding: sz[size],
      borderRadius: T.radius.md, fontSize: size === "sm" ? 11 : 12, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      transition: "all 0.15s", fontFamily: T.fonts.sans, letterSpacing: "0.03em",
      ...style,
    }}>
      {children}
    </button>
  );
};

// ── Input ────────────────────────────────────────────────────────────
export const Input = ({ label, error, ...props }) => (
  <div>
    {label && <label style={{ display: "block", fontSize: 11, color: T.colors.muted, marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
    <input {...props} style={{
      width: "100%", background: T.colors.surface, border: `1px solid ${error ? T.colors.danger : T.colors.border}`,
      borderRadius: T.radius.md, padding: "9px 12px", color: T.colors.text, fontSize: 13,
      outline: "none", boxSizing: "border-box", fontFamily: T.fonts.sans,
      transition: "border-color 0.15s", ...props.style,
    }}
    onFocus={(e) => { e.target.style.borderColor = T.colors.accent; }}
    onBlur={(e)  => { e.target.style.borderColor = error ? T.colors.danger : T.colors.border; }}
    />
    {error && <div style={{ fontSize: 11, color: T.colors.danger, marginTop: 4 }}>{error}</div>}
  </div>
);

// ── Select ───────────────────────────────────────────────────────────
export const Select = ({ label, options = [], ...props }) => (
  <div>
    {label && <label style={{ display: "block", fontSize: 11, color: T.colors.muted, marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
    <select {...props} style={{
      width: "100%", background: T.colors.surface, border: `1px solid ${T.colors.border}`,
      borderRadius: T.radius.md, padding: "9px 12px", color: T.colors.text, fontSize: 13,
      outline: "none", boxSizing: "border-box", fontFamily: T.fonts.sans, cursor: "pointer",
    }}>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

// ── Modal ────────────────────────────────────────────────────────────
export const Modal = ({ isOpen, onClose, title, children, width = 560 }) => {
  if (!isOpen) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: T.colors.card, border: `1px solid ${T.colors.border}`,
        borderRadius: T.radius.xl, width: "100%", maxWidth: width, maxHeight: "90vh",
        overflow: "hidden", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          padding: "16px 24px", borderBottom: `1px solid ${T.colors.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: T.colors.surface,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: T.colors.muted,
            fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "2px 6px",
          }}>✕</button>
        </div>
        <div style={{ padding: 24, overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
};

// ── Table ────────────────────────────────────────────────────────────
export const Table = ({ headers, children, actions }) => (
  <div style={{ background: T.colors.card, border: `1px solid ${T.colors.border}`, borderRadius: T.radius.lg, overflow: "hidden" }}>
    {actions && (
      <div style={{ padding: "12px 20px", borderBottom: `1px solid ${T.colors.border}`, display: "flex", gap: 10, alignItems: "center" }}>
        {actions}
      </div>
    )}
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: T.colors.surface }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 10, color: T.colors.muted, letterSpacing: "0.08em", borderBottom: `1px solid ${T.colors.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  </div>
);

export const TR = ({ children, onClick, idx = 0, highlight }) => (
  <tr onClick={onClick} style={{
    borderBottom: `1px solid ${T.colors.border}22`,
    background: highlight ? `${highlight}08` : idx % 2 === 0 ? "transparent" : "#0c1222",
    cursor: onClick ? "pointer" : "default",
    transition: "background 0.12s",
  }}
    onMouseEnter={onClick ? (e) => (e.currentTarget.style.background = T.colors.accentGl) : undefined}
    onMouseLeave={onClick ? (e) => (e.currentTarget.style.background = highlight ? `${highlight}08` : idx % 2 === 0 ? "transparent" : "#0c1222") : undefined}
  >
    {children}
  </tr>
);

export const TD = ({ children, mono, muted, color, style = {} }) => (
  <td style={{
    padding: "10px 14px", fontSize: 12,
    fontFamily: mono ? T.fonts.mono : T.fonts.sans,
    color: color || (muted ? T.colors.muted : T.colors.text),
    ...style,
  }}>{children}</td>
);

// ── Page header ──────────────────────────────────────────────────────
export const PageHeader = ({ title, sub, children }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
    <div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h2>
      {sub && <p style={{ margin: "4px 0 0", fontSize: 12, color: T.colors.muted }}>{sub}</p>}
    </div>
    {children && <div style={{ display: "flex", gap: 10 }}>{children}</div>}
  </div>
);

// ── Spinner ──────────────────────────────────────────────────────────
export const Spinner = ({ size = 24 }) => (
  <div style={{
    width: size, height: size, border: `2px solid ${T.colors.border}`,
    borderTopColor: T.colors.accent, borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
  }} />
);

// ── Toast placeholder (can hook into a real toast lib) ───────────────
export const useToast = () => ({
  success: (msg) => console.log("✅", msg),
  error:   (msg) => console.error("❌", msg),
  info:    (msg) => console.info("ℹ️",  msg),
});
