import { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { THEME as T } from "../../constants/theme";
import { PageHeader, Btn, Table, TR, TD, RawDataModal } from "../shared";
import { alertsApi } from "../../utils/api";
import { exportCSV } from "../../utils/exportUtils";

const SEV_ORDER  = { critical:0, high:1, medium:2, low:3 };
const SEV_COLORS = {
  critical:{ bg:"rgba(239,68,68,0.12)",  text:"#ef4444" },
  high:    { bg:"rgba(245,158,11,0.12)", text:"#f59e0b" },
  medium:  { bg:"rgba(14,165,233,0.12)", text:"#0ea5e9" },
  low:     { bg:"rgba(167,139,250,0.12)",text:"#a78bfa" },
};

export default function AlertsPanel() {
  const location = useLocation();
  const [alerts,   setAlerts]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filterSev,setFilterSev]= useState("all");
  const [filterAck,setFilterAck]= useState("unacked");
  const [search,   setSearch]   = useState("");
  const [acking,   setAcking]   = useState(null);
  const [rawModal, setRawModal] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const qs = new URLSearchParams(location.search || "");
    const sev = qs.get("severity");
    const finding = qs.get("finding");
    if (sev && ["critical", "high", "medium", "low"].includes(sev)) setFilterSev(sev);
    if (finding) setSearch(finding);
    if (sev || finding) setFilterAck("all");
  }, [location.search]);

  const load = () => {
    setLoading(true);
    const params = {};
    if (filterAck !== "all") params.is_acked = filterAck === "acked" ? "true" : "false";
    if (filterSev !== "all") params.severity  = filterSev;
    alertsApi.list(params)
      .then(d => setAlerts(Array.isArray(d) ? d.sort((a,b) => SEV_ORDER[a.severity]-SEV_ORDER[b.severity]) : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filterSev, filterAck]); // eslint-disable-line

  const ack = async (id) => {
    setAcking(id);
    await alertsApi.ack(id).catch(() => {});
    setAlerts(p => p.filter(a => a.id !== id));
    setAcking(null);
  };
  const ackAll = async () => { await alertsApi.ackAll({}).catch(() => {}); load(); };

  // Summary stats
  const stats = useMemo(() => ({
    critical: alerts.filter(a=>a.severity==="critical").length,
    high:     alerts.filter(a=>a.severity==="high").length,
    medium:   alerts.filter(a=>a.severity==="medium").length,
    low:      alerts.filter(a=>a.severity==="low").length,
  }), [alerts]);

  // Filtered + searched
  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return alerts.filter(a =>
      !q || a.message?.toLowerCase().includes(q) ||
            a.customer_name?.toLowerCase().includes(q) ||
            a.details?.finding_id?.toLowerCase().includes(q)
    );
  }, [alerts, search]);

  // Raw data helpers
  const affectedRows = (sev) => alerts
    .filter(a => !sev || a.severity === sev)
    .filter(a => a.details?.affected_users?.length)
    .flatMap(a => (a.details.affected_users||[]).map(u => ({
      account:    u,
      finding:    a.details.finding_id || "—",
      severity:   a.severity,
      category:   a.details.category  || "—",
      customer:   a.customer_name,
    })));

  const openRaw = (title, color, sev) =>
    setRawModal({ title, color,
      headers: [
        { key:"account",  label:"Account",   mono:true },
        { key:"finding",  label:"Finding",   mono:true },
        { key:"severity", label:"Severity",  type:"severity" },
        { key:"category", label:"Category" },
        { key:"customer", label:"Customer" },
      ],
      rows: affectedRows(sev),
    });

  const doExportCSV = () => {
    exportCSV(visible.map(a => ({
      Customer:   a.customer_name,
      Severity:   a.severity,
      Message:    a.message,
      FindingID:  a.details?.finding_id || "",
      Category:   a.details?.category  || "",
      Affected:   a.details?.affected_count || 0,
      Time:       new Date(a.created_at).toLocaleString(),
      Acknowledged: a.is_acked ? "Yes" : "No",
    })), "alerts_export.csv");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <PageHeader title="Alerts" sub="Active Directory security alerts from all customers">
        <Btn variant="secondary" size="sm" onClick={doExportCSV}>⬇ Export CSV</Btn>
        {alerts.length > 0 && <Btn variant="secondary" size="sm" onClick={ackAll}>✓ Ack All</Btn>}
      </PageHeader>

      {/* ── Stats row — all clickable → raw data ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
        {[
          { sev:"critical", label:"Critical",    color:"#ef4444" },
          { sev:"high",     label:"High",         color:"#f59e0b" },
          { sev:"medium",   label:"Medium",       color:"#0ea5e9" },
          { sev:"low",      label:"Low",           color:"#a78bfa" },
        ].map(({ sev, label, color }) => (
          <div key={sev}
            onClick={() => openRaw(`${label} Alerts — Affected Accounts`, color, sev)}
            style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"12px 16px",
              cursor:"pointer", transition:"border-color 0.15s", borderTop:`2px solid ${color}` }}
            onMouseEnter={e => e.currentTarget.style.borderColor = color}
            onMouseLeave={e => e.currentTarget.style.borderTop   = `2px solid ${color}`}>
            <div style={{ fontSize:9, fontWeight:700, color:T.colors.muted, letterSpacing:"0.05em", marginBottom:6 }}>
              {label.toUpperCase()}
            </div>
            <div style={{ fontSize:26, fontWeight:700, color, fontFamily:T.fonts.mono, lineHeight:1 }}>
              {stats[sev]}
            </div>
            <div style={{ fontSize:10, color:T.colors.muted, marginTop:4 }}>
              {stats[sev] > 0 ? "VIEW ACCOUNTS ›" : "no alerts"}
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters + search ── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:3, borderRadius:6, border:`1px solid ${T.colors.border}` }}>
          {["all","critical","high","medium","low"].map(s => {
            const sc = SEV_COLORS[s];
            return (
              <button key={s} onClick={() => setFilterSev(s)} style={{
                padding:"5px 12px", borderRadius:4, cursor:"pointer", fontSize:11, fontWeight:filterSev===s?700:400,
                background:filterSev===s?(sc?.bg||T.colors.card):"transparent",
                color:filterSev===s?(sc?.text||T.colors.text):T.colors.muted,
                border:"none",
              }}>{s.charAt(0).toUpperCase()+s.slice(1)}</button>
            );
          })}
        </div>
        <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:3, borderRadius:6, border:`1px solid ${T.colors.border}` }}>
          {[["unacked","Open"],["acked","Acknowledged"],["all","All"]].map(([v,l]) => (
            <button key={v} onClick={() => setFilterAck(v)} style={{
              padding:"5px 12px", borderRadius:4, cursor:"pointer", fontSize:11,
              fontWeight:filterAck===v?700:400,
              background:filterAck===v?T.colors.card:"transparent",
              color:filterAck===v?T.colors.text:T.colors.muted, border:"none",
            }}>{l}</button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search alerts…"
          style={{ flex:1, minWidth:200, background:T.colors.surface, border:`1px solid ${T.colors.border}`,
            borderRadius:6, color:T.colors.text, padding:"7px 12px", fontSize:12 }} />
        <span style={{ fontSize:11, color:T.colors.muted }}>{visible.length} alert{visible.length!==1?"s":""}</span>
      </div>

      {error && <div style={{ background:"rgba(239,68,68,0.08)", border:`1px solid #ef444444`, borderRadius:6, padding:"10px 14px", fontSize:12, color:"#ef4444" }}>{error}</div>}

      {!loading && visible.length === 0 ? (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"60px 20px", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>No alerts</div>
          <div style={{ fontSize:12, color:T.colors.muted }}>All clear for the selected filter.</div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {visible.map((a, i) => {
            const sc   = SEV_COLORS[a.severity] || SEV_COLORS.low;
            const det  = a.details || {};
            const isEx = expanded === a.id;
            const users = det.affected_users || [];
            return (
              <div key={a.id} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden", transition:"border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = sc.text}
                onMouseLeave={e => e.currentTarget.style.borderColor = T.colors.border}>
                <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:3,
                    background:sc.bg, color:sc.text, fontFamily:T.fonts.mono, minWidth:64, textAlign:"center" }}>
                    {a.severity.toUpperCase()}
                  </span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {a.message}
                    </div>
                    <div style={{ fontSize:10, color:T.colors.muted, marginTop:2, fontFamily:T.fonts.mono }}>
                      {a.customer_name}
                      {det.finding_id && ` · ${det.finding_id}`}
                      {det.category   && ` · ${det.category}`}
                      {det.affected_count > 0 && ` · ${det.affected_count} affected`}
                      {` · ${new Date(a.created_at).toLocaleString()}`}
                    </div>
                  </div>
                  {users.length > 0 && (
                    <Btn variant="ghost" size="sm"
                      onClick={() => setRawModal({
                        title: `${det.finding_id || a.message} — Affected Accounts`,
                        color: sc.text,
                        headers:[{key:"account",label:"Account",mono:true},{key:"customer",label:"Customer"}],
                        rows: users.map(u=>({account:u,customer:a.customer_name})),
                      })}>
                      👤 {users.length}
                    </Btn>
                  )}
                  <button onClick={() => setExpanded(isEx ? null : a.id)}
                    style={{ background:"none", border:"none", color:T.colors.muted, cursor:"pointer", fontSize:12, padding:"4px 6px" }}>
                    {isEx ? "▲" : "▼"}
                  </button>
                  <Btn variant="secondary" size="sm" disabled={acking===a.id} onClick={() => ack(a.id)}>
                    {acking===a.id ? "…" : "✓ Ack"}
                  </Btn>
                </div>

                {isEx && (
                  <div style={{ borderTop:`1px solid ${T.colors.border}`, padding:"12px 16px", background:T.colors.surface }}>
                    {det.description && <div style={{ fontSize:12, color:T.colors.muted, marginBottom:10, lineHeight:1.6 }}>{det.description}</div>}
                    {det.remediation && (
                      <div style={{ background:T.colors.bg, borderRadius:6, padding:"8px 12px", marginBottom:10 }}>
                        <div style={{ fontSize:9, fontWeight:700, color:T.colors.muted, marginBottom:4 }}>REMEDIATION</div>
                        <div style={{ fontSize:12, lineHeight:1.6 }}>{det.remediation}</div>
                      </div>
                    )}
                    {det.compliance_summary && (
                      <div style={{ fontSize:10, color:T.colors.dim, fontFamily:T.fonts.mono }}>{det.compliance_summary}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rawModal && (
        <RawDataModal isOpen={!!rawModal} onClose={() => setRawModal(null)}
          title={rawModal.title} color={rawModal.color}
          headers={rawModal.headers} rows={rawModal.rows}
          emptyMsg="No affected accounts for this filter. Run a scan to generate data." />
      )}
    </div>
  );
}
