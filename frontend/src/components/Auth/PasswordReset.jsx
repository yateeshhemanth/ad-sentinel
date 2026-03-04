import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { authApi } from "../../utils/api";
import { THEME as T } from "../../constants/theme";
import { Input, Btn, Spinner } from "../shared";

// ── Forgot Password ─────────────────────────────────────────────────
export function ForgotPassword() {
  const [email,   setEmail]   = useState("");
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await authApi.forgotPassword({ email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Reset Password" subtitle="Enter your email to receive a reset link">
      {sent ? (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Reset link sent!</div>
          <div style={{ fontSize: 12, color: T.colors.muted, marginBottom: 20 }}>
            If <strong>{email}</strong> exists, a reset link will arrive shortly. Check your spam folder.
          </div>
          <Link to="/login" style={{ color: T.colors.accent, fontSize: 12 }}>← Back to login</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input
            label="Email Address"
            type="email"
            placeholder="admin@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          {error && <ErrorBox>{error}</ErrorBox>}
          <Btn type="submit" disabled={loading} style={{ width: "100%", padding: "11px" }}>
            {loading ? <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}><Spinner size={16} /> Sending...</span> : "Send Reset Link"}
          </Btn>
          <div style={{ textAlign: "center" }}>
            <Link to="/login" style={{ fontSize: 12, color: T.colors.muted, textDecoration: "none" }}>← Back to login</Link>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

// ── Reset Password ──────────────────────────────────────────────────
export function ResetPassword() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const token      = params.get("token") || "";
  const [form,     setForm]    = useState({ password: "", confirm: "" });
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState("");
  const [success,  setSuccess] = useState(false);

  const valid = form.password.length >= 8
    && /[A-Z]/.test(form.password)
    && /[0-9]/.test(form.password)
    && /[!@#$%^&*]/.test(form.password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError("Passwords do not match"); return; }
    if (!valid) { setError("Password must be 8+ chars with uppercase, number, and special char"); return; }
    setLoading(true);
    setError("");
    try {
      await authApi.resetPassword({ token, password: form.password });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!token) return (
    <AuthCard title="Invalid Link" subtitle="">
      <div style={{ textAlign: "center", color: T.colors.danger }}>This reset link is invalid or has expired.</div>
      <div style={{ textAlign: "center", marginTop: 12 }}>
        <Link to="/forgot-password" style={{ color: T.colors.accent, fontSize: 12 }}>Request a new link</Link>
      </div>
    </AuthCard>
  );

  const rules = [
    { label: "8+ characters",                pass: form.password.length >= 8      },
    { label: "Uppercase letter",             pass: /[A-Z]/.test(form.password)   },
    { label: "Number",                       pass: /[0-9]/.test(form.password)   },
    { label: "Special char (!@#$%^&*)",     pass: /[!@#$%^&*]/.test(form.password) },
  ];

  return (
    <AuthCard title="Set New Password" subtitle="Enter and confirm your new password">
      {success ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Password updated! Redirecting...</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input label="New Password" type="password" placeholder="••••••••••••"
            value={form.password} onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))} required />
          <Input label="Confirm Password" type="password" placeholder="••••••••••••"
            value={form.confirm}   onChange={(e) => setForm(p => ({ ...p, confirm:  e.target.value }))} required />

          {/* Password strength rules */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {rules.map(r => (
              <span key={r.label} style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                background: r.pass ? "rgba(34,197,94,0.12)" : T.colors.surface,
                color: r.pass ? T.colors.ok : T.colors.muted,
                border: `1px solid ${r.pass ? T.colors.ok + "44" : T.colors.border}`,
              }}>
                {r.pass ? "✓" : "·"} {r.label}
              </span>
            ))}
          </div>

          {error && <ErrorBox>{error}</ErrorBox>}
          <Btn type="submit" disabled={loading || !valid} style={{ width: "100%", padding: "11px" }}>
            {loading ? "Updating..." : "Update Password"}
          </Btn>
        </form>
      )}
    </AuthCard>
  );
}

// ── Change Password (in-app modal) ──────────────────────────────────
export function ChangePasswordModal({ onClose }) {
  const [form,    setForm]    = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    setError("");
    try {
      await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {success && <div style={{ color: T.colors.ok, fontSize: 13, textAlign: "center" }}>✅ Password changed!</div>}
      <Input label="Current Password" type="password" value={form.currentPassword}
        onChange={(e) => setForm(p => ({ ...p, currentPassword: e.target.value }))} required />
      <Input label="New Password" type="password" value={form.newPassword}
        onChange={(e) => setForm(p => ({ ...p, newPassword: e.target.value }))} required />
      <Input label="Confirm New Password" type="password" value={form.confirm}
        onChange={(e) => setForm(p => ({ ...p, confirm: e.target.value }))} required />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onClose} type="button">Cancel</Btn>
        <Btn type="submit" disabled={loading}>{loading ? "Updating..." : "Update Password"}</Btn>
      </div>
    </form>
  );
}

// ── Shared Auth Card layout ──────────────────────────────────────────
function AuthCard({ title, subtitle, children }) {
  return (
    <div style={{
      minHeight: "100vh", background: T.colors.bg, display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: T.fonts.sans, padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: T.colors.card, border: `1px solid ${T.colors.border}`,
        borderRadius: T.radius.xl, overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        <div style={{ background: T.colors.surface, padding: "24px 32px", borderBottom: `1px solid ${T.colors.border}` }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: T.colors.muted, marginTop: 4 }}>{subtitle}</div>}
        </div>
        <div style={{ padding: "24px 32px" }}>{children}</div>
      </div>
    </div>
  );
}

function ErrorBox({ children }) {
  return (
    <div style={{
      background: "rgba(239,68,68,0.1)", border: `1px solid ${T.colors.danger}44`,
      borderRadius: T.radius.md, padding: "10px 14px", fontSize: 12, color: T.colors.danger,
    }}>⚠️ {children}</div>
  );
}
