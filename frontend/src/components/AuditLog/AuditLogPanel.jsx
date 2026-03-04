import { useState, useEffect, useMemo } from "react";
import { THEME as T } from "../../constants/theme";
import { PageHeader, Btn, SevDot } from "../shared";
import { auditLogApi } from "../../utils/api";
import { exportCSV } from "../../utils/exportUtils";

const SEV_COLORS = {
  critical:{ bg:"rgba(239,68,68,0.12)",  text:"#ef4444" },
  warning: { bg:"rgba(245,158,11,0.12)", text:"#f59e0b" },
  high:    { bg:"rgba(245,158,11,0.12)", text:"#f59e0b" },
  medium:  { bg:"rgba(14,165,233,0.12)", text:"#0ea5e9" },
  info:    { bg:"rgba(34,197,94,0.08)",  text:"#22c55e" },
  error:   { bg:"rgba(239,68,68,0.08)",  text:"#ef4444" },
};

export default function AuditLogPanel() {
  const [logs,     setLogs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filterSev,setFilterSev]= useState("all");
  const [search,   setSearch]   = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    const params = { limit: 500 };
    if (filterSev !== "all") params.severity = filterSev;
    auditLogApi.list(params)
      .then(d => setLogs(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [filterSev]);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return logs.filter(l =>
      !q || l.action?.toLowerCase().includes(q) ||
            l.user_email?.toLowerCase().includes(q) ||
            l.customer_name?.toLowerCase().includes(q)
    );
  }, [logs, search]);

  // Stats
  const stats = useMemo(() => ({
    critical: logs.filter(l=>l.severity==="critical").length,
    warning:  logs.filter(l=>l.severity==="warning"||l.severity==="high").length,
    info:     logs.filter(l=>l.severity==="info").length,
    total:    logs.length,
  }), [logs]);

  // Action groupings for quick filter
  const actions = useMemo(() => [...new Set(logs.map(l=>l.action))].slice(0,8), [logs]);

  const doExport = () => {
    exportCSV(visible.map(l => ({
      Time:       new Date(l.created_at).toLocaleString(),
      Severity:   l.severity,
      Action:     l.action,
      User:       l.user_email || "—",
      Customer:   l.customer_name || "—",
      IP:         l.ip_address || "—",
    })), "audit_log_export.csv");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <PageHeader title="Audit Log" sub="Full audit trail of all portal and scan events">
        <Btn variant="secondary" size="sm" onClick={doExport}>⬇ Export CSV</Btn>
      </PageHeader>

      {/* ── Stats row ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
        {[
          { key:"total",    label:"Total Events",    color:T.colors.accent },
          { key:"critical", label:"Critical Events", color:"#ef4444" },
          { key:"warning",  label:"Warnings",        color:"#f59e0b" },
          { key:"info",     label:"Info",            color:"#22c55e" },
        ].map(({ key, label, color }) => (
          <div key={key}
            onClick={() => key !== "total" && setFilterSev(key === "warning" ? "warning" : key)}
            style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"12px 16px",
              cursor: key !== "total" ? "pointer" : "default", borderTop:`2px solid ${color}` }}>
            <div style={{ fontSize:9, fontWeight:700, color:T.colors.muted, letterSpacing:"0.05em", marginBottom:6 }}>{label.toUpperCase()}</div>
            <div style={{ fontSize:26, fontWeight:700, color, fontFamily:T.fonts.mono, lineHeight:1 }}>{stats[key]}</div>
          </div>
        ))}
      </div>

      {/* ── Filters + search ── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:3, borderRadius:6, border:`1px solid ${T.colors.border}` }}>
          {["all","critical","warning","info"].map(s => {
            const sc = SEV_COLORS[s];
            return (
              <button key={s} onClick={() => setFilterSev(s)} style={{
                padding:"5px 14px", borderRadius:4, cursor:"pointer", fontSize:11,
                fontWeight:filterSev===s?700:400,
                background:filterSev===s?(sc?.bg||T.colors.card):"transparent",
                color:filterSev===s?(sc?.text||T.colors.text):T.colors.muted,
                border:"none",
              }}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>
            );
          })}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search action, user, customer…"
          style={{ flex:1, minWidth:220, background:T.colors.surface, border:`1px solid ${T.colors.border}`,
            borderRadius:6, color:T.colors.text, padding:"7px 12px", fontSize:12 }} />
        <span style={{ fontSize:11, color:T.colors.muted }}>{visible.length} / {logs.length} entries</span>
      </div>

      {error && <div style={{ background:"rgba(239,68,68,0.08)", border:`1px solid #ef444444`, borderRadius:6, padding:"10px 14px", fontSize:12, color:"#ef4444" }}>{error}</div>}

      {!loading && visible.length === 0 ? (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"60px 20px", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>No audit log entries</div>
          <div style={{ fontSize:12, color:T.colors.muted }}>Events will appear here as users and scans interact with the platform.</div>
        </div>
      ) : (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ overflowY:"auto", maxHeight:"calc(100vh - 400px)" }}>
            {visible.map((l, i) => {
              const sc = SEV_COLORS[l.severity] || SEV_COLORS.info;
              const isEx = expanded === l.id;
              const hasDetails = l.details && Object.keys(l.details).length > 0;
              return (
                <div key={l.id||i} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2===0?"transparent":"#0c1222" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 16px",
                    cursor: hasDetails ? "pointer" : "default" }}
                    onClick={() => hasDetails && setExpanded(isEx ? null : l.id)}>
                    <SevDot sev={l.severity||"info"} />
                    <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:sc.bg, color:sc.text,
                      fontFamily:T.fonts.mono, minWidth:58, textAlign:"center", whiteSpace:"nowrap" }}>
                      {(l.severity||"info").toUpperCase()}
                    </span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                        <span style={{ fontSize:12, fontWeight:600 }}>{l.action}</span>
                        {l.customer_name && <span style={{ fontSize:10, color:T.colors.muted }}>· {l.customer_name}</span>}
                      </div>
                      <div style={{ fontSize:10, color:T.colors.dim, marginTop:1 }}>
                        {l.user_email || "System"}
                        {l.ip_address && ` · ${l.ip_address}`}
                      </div>
                    </div>
                    <span style={{ fontSize:10, color:T.colors.muted, fontFamily:T.fonts.mono, whiteSpace:"nowrap" }}>
                      {new Date(l.created_at).toLocaleString()}
                    </span>
                    {hasDetails && (
                      <span style={{ color:T.colors.muted, fontSize:11 }}>{isEx?"▲":"▼"}</span>
                    )}
                  </div>
                  {isEx && hasDetails && (
                    <div style={{ padding:"0 16px 12px 52px", background:T.colors.surface }}>
                      <pre style={{ fontSize:11, fontFamily:T.fonts.mono, color:T.colors.muted, margin:0, whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
                        {JSON.stringify(l.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
