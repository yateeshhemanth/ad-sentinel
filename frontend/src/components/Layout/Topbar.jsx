import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { THEME as T } from "../../constants/theme";
import { Modal } from "../shared";
import { ChangePasswordModal } from "../Auth/PasswordReset";
import { logoApi } from "../../utils/api";

const NAV = [
  { path: "/",             label: "Dashboard"      },
  { path: "/alerts",       label: "Alerts"         },
  { path: "/tickets",      label: "Tickets"        },
  { path: "/offboarding",  label: "🚪 Offboarding" },
  { path: "/reports",      label: "Reports"        },
  { path: "/audit-log",    label: "Audit Log"      },
  { path: "/settings",     label: "AD Connections" },
];

export default function Topbar({ alertCount = 0 }) {
  const { user, logoUrl, logout, refreshLogo, portalTitle, primaryColor } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwdModal, setPwdModal] = useState(false);
  const [time,     setTime]     = useState(new Date());
  const [uploading, setUploading] = useState(false);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { logoUrl: url } = await logoApi.upload(file);
      refreshLogo(url);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div style={{
        background: T.colors.surface, borderBottom: `1px solid ${T.colors.border}`,
        height: 52, display: "flex", alignItems: "center", gap: 12,
        padding: "0 20px", flexShrink: 0, position: "sticky", top: 0, zIndex: 100,
      }}>
        {/* Logo / brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 180 }}>
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" style={{ maxHeight: 32, maxWidth: 120, objectFit: "contain" }} />
          ) : (
            <>
              <div style={{
                width: 28, height: 28, background: primaryColor || T.colors.accent, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: "#000",
              }}>AD</div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{portalTitle || "ADSentinel"}</span>
              <span style={{ fontSize: 9, color: T.colors.muted, background: T.colors.card, padding: "1px 6px", borderRadius: 3, border: `1px solid ${T.colors.border}` }}>ENTERPRISE</span>
            </>
          )}
        </div>

        <div style={{ width: 1, height: 24, background: T.colors.border }} />

        {/* Nav */}
        <nav style={{ display: "flex", gap: 2, flex: 1 }}>
          {NAV.map(n => {
            const active = n.path === "/" ? location.pathname === "/" : location.pathname.startsWith(n.path);
            return (
              <button key={n.path} onClick={() => navigate(n.path)} style={{
                background: active ? T.colors.accentGl : "transparent",
                border: active ? `1px solid ${T.colors.accent}44` : "1px solid transparent",
                color: active ? T.colors.accent : T.colors.muted,
                padding: "5px 12px", borderRadius: T.radius.md, cursor: "pointer",
                fontSize: 12, fontWeight: active ? 700 : 400, transition: "all 0.15s",
                fontFamily: T.fonts.sans, position: "relative",
              }}>
                {n.label}
                {n.path === "/alerts" && alertCount > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -4, background: T.colors.danger,
                    color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px",
                    borderRadius: 8, lineHeight: "14px", minWidth: 16, textAlign: "center",
                  }}>{alertCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right side */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Live indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: T.colors.ok,
              boxShadow: `0 0 8px ${T.colors.ok}`,
              animation: "adsPulse 2s infinite ease-in-out",
              display: "inline-block",
            }} />
            <span style={{ fontSize: 10, color: T.colors.muted }}>Live</span>
          </div>

          <span style={{ fontFamily: T.fonts.mono, fontSize: 11, color: T.colors.muted }}>
            {time.toLocaleTimeString()}
          </span>

          {/* User menu */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenuOpen(o => !o)} style={{
              display: "flex", alignItems: "center", gap: 8, background: "transparent",
              border: `1px solid ${T.colors.border}`, borderRadius: T.radius.md,
              padding: "4px 10px", cursor: "pointer", color: T.colors.text,
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%", background: T.colors.accent,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "#000",
              }}>
                {user?.name?.[0]?.toUpperCase() || "U"}
              </div>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{user?.name || "User"}</span>
              <span style={{ fontSize: 9, color: T.colors.muted }}>▾</span>
            </button>

            {menuOpen && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)",
                background: T.colors.card, border: `1px solid ${T.colors.border}`,
                borderRadius: T.radius.lg, minWidth: 200, overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zIndex: 200,
              }} onClick={() => setMenuOpen(false)}>
                <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.colors.border}`, background: T.colors.surface }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
                  <div style={{ fontSize: 11, color: T.colors.muted }}>{user?.email}</div>
                  <span style={{ fontSize: 10, color: T.colors.accent, background: T.colors.accentGl, padding: "1px 8px", borderRadius: 3, marginTop: 4, display: "inline-block" }}>{user?.role?.toUpperCase()}</span>
                </div>

                <MenuItem icon="🔑" onClick={() => { setMenuOpen(false); setPwdModal(true); }}>Change Password</MenuItem>

                {user?.role === "admin" && (
                  <label style={{ display: "block", cursor: "pointer" }}>
                    <MenuItem icon={uploading ? "⏳" : "🖼️"}>
                      {uploading ? "Uploading..." : "Upload Logo"}
                    </MenuItem>
                    <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" style={{ display: "none" }} onChange={handleLogoUpload} />
                  </label>
                )}

                <div style={{ borderTop: `1px solid ${T.colors.border}` }}>
                  <MenuItem icon="🚪" onClick={logout} color={T.colors.danger}>Sign Out</MenuItem>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Keyframe for pulse */}
      <style>{`
        @keyframes adsPulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Change password modal */}
      <Modal isOpen={pwdModal} onClose={() => setPwdModal(false)} title="Change Password" width={440}>
        <ChangePasswordModal onClose={() => setPwdModal(false)} />
      </Modal>
    </>
  );
}

function MenuItem({ icon, children, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%",
      background: "transparent", border: "none", padding: "10px 16px",
      color: color || T.colors.text, cursor: "pointer", fontSize: 13,
      fontFamily: T.fonts.sans, textAlign: "left",
      transition: "background 0.1s",
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = T.colors.accentGl}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <span style={{ width: 18 }}>{icon}</span>{children}
    </button>
  );
}
