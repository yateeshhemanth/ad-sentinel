import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { THEME as T } from "../../constants/theme";
import { Input, Btn, Spinner } from "../shared";

export default function Login() {
  const { login, logoUrl } = useAuth();
  const navigate = useNavigate();
  const [form,    setForm]    = useState({ email: "", password: "" });
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate("/");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: T.colors.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: T.fonts.sans, padding: 20,
    }}>
      {/* Background grid */}
      <div style={{
        position: "fixed", inset: 0, opacity: 0.04,
        backgroundImage: "linear-gradient(rgba(14,165,233,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(14,165,233,0.5) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
        pointerEvents: "none",
      }} />

      <div style={{ width: "100%", maxWidth: 420, position: "relative" }}>
        {/* Card */}
        <div style={{
          background: T.colors.card, border: `1px solid ${T.colors.border}`,
          borderRadius: T.radius.xl, overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}>
          {/* Header */}
          <div style={{ background: T.colors.surface, padding: "28px 32px", borderBottom: `1px solid ${T.colors.border}`, textAlign: "center" }}>
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" style={{ maxHeight: 48, maxWidth: 180, objectFit: "contain", marginBottom: 12 }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
                <div style={{
                  width: 36, height: 36, background: T.colors.accent, borderRadius: 8,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, fontWeight: 700, color: "#000",
                }}>AD</div>
                <span style={{ fontSize: 20, fontWeight: 700, color: T.colors.text }}>ADSentinel</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: T.colors.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Enterprise Security Portal</div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
            <Input
              label="Email Address"
              type="email"
              placeholder="admin@company.com"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              required
              autoFocus
            />
            <div>
              <Input
                label="Password"
                type="password"
                placeholder="••••••••••••"
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                required
              />
              <div style={{ textAlign: "right", marginTop: 6 }}>
                <Link to="/forgot-password" style={{ fontSize: 11, color: T.colors.accent, textDecoration: "none" }}>
                  Forgot password?
                </Link>
              </div>
            </div>

            {error && (
              <div style={{
                background: "rgba(239,68,68,0.1)", border: `1px solid ${T.colors.danger}44`,
                borderRadius: T.radius.md, padding: "10px 14px",
                fontSize: 12, color: T.colors.danger,
              }}>⚠️ {error}</div>
            )}

            <Btn type="submit" disabled={loading} style={{ width: "100%", padding: "11px", fontSize: 14, justifyContent: "center" }}>
              {loading ? <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}><Spinner size={16} /> Signing in...</span> : "Sign In →"}
            </Btn>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: T.colors.muted }}>
          ADSentinel Enterprise v2.0 · © 2026 CTRLS DATACENTES LTD
        </div>
      </div>
    </div>
  );
}
