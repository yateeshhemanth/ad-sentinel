import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { THEME as T } from "./constants/theme";

// ── Pages / Panels ─────────────────────────────────────────────────
import Login                  from "./components/Auth/Login";
import { ForgotPassword,
         ResetPassword }      from "./components/Auth/PasswordReset";
import Topbar                 from "./components/Layout/Topbar";
import GlobalDashboard        from "./components/Dashboard/GlobalDashboard";
import AlertsPanel            from "./components/Alerts/AlertsPanel";
import TicketsPanel           from "./components/Tickets/TicketsPanel";
import ReportsPanel           from "./components/Reports/ReportsPanel";
import ConnectionManager      from "./components/Settings/ConnectionManager";
import AuditLogPanel          from "./components/AuditLog/AuditLogPanel";
import OffboardingPanel        from "./components/Offboarding/OffboardingPanel";

// ── Auth Guard ──────────────────────────────────────────────────────
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!user)   return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

// ── Shell (with topbar) ─────────────────────────────────────────────
function AppShell({ children, alertCount }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: T.colors.bg, color: T.colors.text, fontFamily: T.fonts.sans }}>
      <Topbar alertCount={alertCount} />
      <main style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
        {children}
      </main>
      <div style={{
        background: T.colors.surface, borderTop: `1px solid ${T.colors.border}`,
        padding: "4px 24px", display: "flex", fontSize: 10, color: T.colors.muted,
        gap: 20, flexShrink: 0,
      }}>
        <span>● Multi-Tenant AD Portal</span>
        <span>● ADSentinel Enterprise v2.0</span>
        <span style={{ marginLeft: "auto" }}>© 2025 ADSentinel</span>
      </div>
    </div>
  );
}

// ── App root ────────────────────────────────────────────────────────
function SettingsPage() {
  const { logoUrl, refreshLogo, refreshBranding } = useAuth();
  return <ConnectionManager logoUrl={logoUrl} refreshLogo={refreshLogo} refreshBranding={refreshBranding} />;
}

function AppRoutes() {
  const [alertCount, setAlertCount] = useState(3); // replace with live count

  return (
    <Routes>
      {/* Public */}
      <Route path="/login"          element={<Login />} />
      <Route path="/forgot-password"element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Protected */}
      <Route path="/" element={
        <RequireAuth>
          <AppShell alertCount={alertCount}>
            <GlobalDashboard />
          </AppShell>
        </RequireAuth>
      } />
      <Route path="/alerts" element={
        <RequireAuth>
          <AppShell alertCount={alertCount}>
            <AlertsPanel />
          </AppShell>
        </RequireAuth>
      } />
      <Route path="/tickets" element={
        <RequireAuth>
          <AppShell alertCount={alertCount}>
            <TicketsPanel />
          </AppShell>
        </RequireAuth>
      } />
      <Route path="/reports" element={
        <RequireAuth>
          <AppShell alertCount={alertCount}>
            <ReportsPanel />
          </AppShell>
        </RequireAuth>
      } />
      <Route path="/audit-log" element={
        <RequireAuth>
          <AppShell alertCount={alertCount}>
            <AuditLogPanel />
          </AppShell>
        </RequireAuth>
      } />
      <Route path="/settings" element={
        <RequireAuth>
          <AppShell alertCount={alertCount}>
            <SettingsPage />
          </AppShell>
        </RequireAuth>
      } />

      <Route path="/offboarding" element={
        <RequireAuth>
          <AppShell alertCount={alertCount}>
            <OffboardingPanel />
          </AppShell>
        </RequireAuth>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ── Loading screen ──────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{
      minHeight: "100vh", background: T.colors.bg, display: "flex",
      alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16,
    }}>
      <div style={{ width: 40, height: 40, background: T.colors.accent, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#000" }}>AD</div>
      <div style={{ fontSize: 13, color: T.colors.muted }}>Loading ADSentinel...</div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: ${T.colors.bg}; color: ${T.colors.text}; font-family: ${T.fonts.sans}; }
          ::-webkit-scrollbar { width: 4px; height: 4px; }
          ::-webkit-scrollbar-track { background: ${T.colors.bg}; }
          ::-webkit-scrollbar-thumb { background: ${T.colors.border}; border-radius: 2px; }
          input::placeholder, textarea::placeholder { color: ${T.colors.dim}; }
        `}</style>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
