import { useState } from "react";
import { ticketsApi } from "../../utils/api";
import { THEME as T } from "../../constants/theme";
import { Modal, Input, Select, Btn } from "../shared";

const PRIORITY_OPTS = [
  { value: "low",      label: "🟢 Low"      },
  { value: "medium",   label: "🟡 Medium"   },
  { value: "high",     label: "🟠 High"     },
  { value: "critical", label: "🔴 Critical" },
];

const SEV_TO_PRIORITY = {
  critical: "critical",
  high:     "high",
  medium:   "medium",
  info:     "low",
  warning:  "medium",
};

export default function CreateTicketModal({ isOpen, onClose, alert, onCreated }) {
  const [form, setForm] = useState({
    title:       alert ? `[${alert.severity.toUpperCase()}] ${alert.message}` : "",
    description: alert ? `Alert from ${alert.customer_name || alert.cust} at ${alert.ts || new Date().toLocaleString()}.\n\nPlease investigate and remediate.` : "",
    priority:    alert ? SEV_TO_PRIORITY[alert.severity] || "medium" : "medium",
    assignee_id: "",
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required"); return; }
    setLoading(true);
    setError("");
    try {
      const ticket = await ticketsApi.create({
        title:         form.title,
        description:   form.description,
        priority:      form.priority,
        customer_name: alert?.customer_name || alert?.cust || null,
        alert_id:      alert?.id || null,
      });
      onCreated?.(ticket);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const f = (key) => (e) => setForm(p => ({ ...p, [key]: e.target.value }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🎫 Create Ticket" width={560}>
      {alert && (
        <div style={{
          background: "rgba(14,165,233,0.08)", border: `1px solid ${T.colors.accent}33`,
          borderRadius: T.radius.md, padding: "10px 14px", marginBottom: 18,
          fontSize: 12, color: T.colors.muted,
        }}>
          <span style={{ color: T.colors.accent, fontWeight: 700 }}>Linked Alert: </span>
          {alert.message} · <span style={{ color: T.colors.text }}>{alert.customer_name || alert.cust}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Input
          label="Ticket Title *"
          placeholder="Describe the issue..."
          value={form.title}
          onChange={f("title")}
          required
        />

        <div>
          <label style={{ display: "block", fontSize: 11, color: T.colors.muted, marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Description</label>
          <textarea
            rows={4}
            placeholder="Detailed description, steps to reproduce, affected systems..."
            value={form.description}
            onChange={f("description")}
            style={{
              width: "100%", background: T.colors.surface, border: `1px solid ${T.colors.border}`,
              borderRadius: T.radius.md, padding: "9px 12px", color: T.colors.text,
              fontSize: 13, outline: "none", resize: "vertical", fontFamily: T.fonts.sans,
              boxSizing: "border-box",
            }}
            onFocus={(e)  => (e.target.style.borderColor = T.colors.accent)}
            onBlur={(e)   => (e.target.style.borderColor = T.colors.border)}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Select
            label="Priority"
            value={form.priority}
            onChange={f("priority")}
            options={PRIORITY_OPTS}
          />
          <Input
            label="Customer"
            value={alert?.customer_name || alert?.cust || ""}
            disabled
            style={{ opacity: 0.6 }}
          />
        </div>

        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)", border: `1px solid ${T.colors.danger}44`,
            borderRadius: T.radius.md, padding: "8px 12px", fontSize: 12, color: T.colors.danger,
          }}>⚠️ {error}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 4 }}>
          <Btn variant="ghost" onClick={onClose} type="button">Cancel</Btn>
          <Btn type="submit" disabled={loading}>
            {loading ? "Creating..." : "🎫 Create Ticket"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
