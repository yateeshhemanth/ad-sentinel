import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { THEME as T, SCORE_COLOR } from "../../constants/theme";
import { GlowCircle, PageHeader, Btn, SevDot, RawDataModal } from "../shared";
import { customersApi, alertsApi, auditLogApi } from "../../utils/api";
import ADUsersDashboard from "../Users/ADUsersDashboard";
import { exportCSV } from "../../utils/exportUtils";
import CustomerAudit from "../CustomerAudit/CustomerAudit";

const TABS = [
  { id:"overview",  label:"📊 Overview"          },
  { id:"users",     label:"👤 Users & Groups"     },
];

export default function GlobalDashboard() {
  const [tab,       setTab]       = useState("overview");
  const [selected,  setSelected]  = useState(null);
  const [customers, setCustomers] = useState([]);
  const [alerts,    setAlerts]    = useState([]);
  const [auditLog,  setAuditLog]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [rawModal,  setRawModal]  = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      customersApi.list(),
      alertsApi.list({ is_acked: false }),
      auditLogApi.list({ limit: 12 }),
    ]).then(([c, a, l]) => {
      setCustomers(Array.isArray(c) ? c : []);
      setAlerts(Array.isArray(a)    ? a : []);
      setAuditLog(Array.isArray(l)  ? l : []);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);



  if (selected) return <CustomerAudit customer={selected} onBack={() => setSelected(null)} />;
  if (loading)  return <Skeleton />;
  if (error)    return <ErrBox msg={error} />;

  // ── Derived ─────────────────────────────────────────────────────────
  const custAlerts = (id) => alerts.filter(a => a.customer_id === id);
  const statusOf   = (c) => {
    const ca = custAlerts(c.id);
    return ca.some(a=>a.severity==="critical") ? "critical"
         : ca.some(a=>a.severity==="high")     ? "warning" : "ok";
  };
  const critical = alerts.filter(a=>a.severity==="critical").length;
  const high     = alerts.filter(a=>a.severity==="high").length;
  const medium   = alerts.filter(a=>a.severity==="medium").length;
  const platformScore = customers.length === 0 ? 0
    : Math.max(0, Math.min(100, 100 - critical*12 - high*4 - medium*1));

  const allDetails    = alerts.map(a => a.details || {});
  const totalAffected = allDetails.reduce((s,d) => s+(d.affected_count||0), 0);

  const blankPwdCount = alerts.filter(a=>a.details?.finding_id==="AD-PWD-002").reduce((s,a)=>s+(a.details?.affected_count||0),0);
  const noExpCount    = alerts.filter(a=>a.details?.finding_id==="AD-PWD-001").reduce((s,a)=>s+(a.details?.affected_count||0),0);
  const staleCount    = alerts.filter(a=>a.details?.finding_id==="AD-ACCT-001").reduce((s,a)=>s+(a.details?.affected_count||0),0);
  const adminCount    = alerts.filter(a=>a.details?.finding_id==="AD-PRIV-001").reduce((s,a)=>s+(a.details?.affected_count||0),0);

  const openRaw = (title, color, headers, rows) => setRawModal({ title, color, headers, rows });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <PageHeader title="Security Dashboard" sub="Multi-tenant Active Directory audit overview">
        <Btn variant="secondary" size="sm" onClick={() => navigate("/reports")}>⬇ Export Report</Btn>
      </PageHeader>

      {/* ── Tab bar ── */}
      <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:4, borderRadius:8, border:`1px solid ${T.colors.border}`, alignSelf:"flex-start" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:"8px 22px", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:tab===t.id?700:400,
            background:tab===t.id?T.colors.card:"transparent",
            border:tab===t.id?`1px solid ${T.colors.border}`:"1px solid transparent",
            color:tab===t.id?T.colors.text:T.colors.muted, fontFamily:T.fonts.sans,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ═══════════ OVERVIEW TAB ═══════════ */}
      {tab === "overview" && (
        <>
          {/* KPI row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
            <KpiCard label="Connected Domains" value={customers.length} sub="Active AD connections"    color={T.colors.accent} icon="🏢" />
            <KpiCard label="Total Affected"    value={totalAffected}    sub="Accounts across findings" color={T.colors.purple} icon="👤"
              onClick={() => openRaw("All Affected Accounts", T.colors.purple,
                [{key:"account",label:"Account",mono:true},{key:"finding",label:"Finding",mono:true},{key:"severity",label:"Severity",type:"severity"},{key:"customer",label:"Customer"}],
                alerts.filter(a=>a.details?.affected_users?.length).flatMap(a=>(a.details.affected_users||[]).map(u=>({account:u,finding:a.details.finding_id||"",severity:a.severity,customer:a.customer_name}))))} />
            <KpiCard label="Critical Alerts"   value={critical}          sub="Require immediate action" color={T.colors.danger} icon="🚨"
              onClick={() => openRaw("Critical Alerts — Affected Accounts", T.colors.danger,
                [{key:"account",label:"Account",mono:true},{key:"finding",label:"Finding",mono:true},{key:"customer",label:"Customer"}],
                alerts.filter(a=>a.severity==="critical"&&a.details?.affected_users?.length).flatMap(a=>(a.details.affected_users||[]).map(u=>({account:u,finding:a.details.finding_id||"",customer:a.customer_name}))))} />
            <KpiCard label="Open Alerts"       value={alerts.length}     sub={`${high} high · ${medium} medium`} color={T.colors.warn} icon="⚠️" />
          </div>

          {/* User insights */}
          {alerts.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
              {[
                { label:"Blank Passwords",          value:blankPwdCount, icon:"🔓", color:T.colors.danger, fid:"AD-PWD-002" },
                { label:"Non-Expiring Passwords",   value:noExpCount,    icon:"♾️", color:T.colors.warn,   fid:"AD-PWD-001" },
                { label:"Stale Accounts",           value:staleCount,    icon:"💤", color:T.colors.purple, fid:"AD-ACCT-001"},
                { label:"Privileged Anomalies",     value:adminCount,    icon:"👑", color:T.colors.warn,   fid:"AD-PRIV-001"},
              ].map(({ label, value, icon, color, fid }) => (
                <InsightCard key={label} label={label} value={value} icon={icon} color={color}
                  onClick={value > 0 ? () => {
                    const a = alerts.find(x=>x.details?.finding_id===fid);
                    const users = a?.details?.affected_users||[];
                    openRaw(`${label} — Affected Accounts`, color,
                      [{key:"account",label:"Account",mono:true},{key:"customer",label:"Customer"}],
                      users.map(u=>({account:u,customer:a.customer_name})));
                  } : undefined} />
              ))}
            </div>
          )}

          {customers.length === 0 ? (
            <Empty icon="🔌" title="No AD domains connected" sub="Go to Settings → AD Connections to add your first domain.">
              <Btn onClick={() => navigate("/settings")}>Go to Settings</Btn>
            </Empty>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:16 }}>

              {/* Customer table */}
              <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
                <div style={{ padding:"12px 18px", borderBottom:`1px solid ${T.colors.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontWeight:700, fontSize:13 }}>CUSTOMER AD DOMAINS</span>
                  <span style={{ fontSize:11, color:T.colors.muted }}>Click row to audit</span>
                </div>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ background:T.colors.surface }}>
                      {["Customer","Domain","Open Alerts","Score","Status",""].map(h => (
                        <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:10, color:T.colors.muted, fontWeight:600, borderBottom:`1px solid ${T.colors.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c, i) => {
                      const ca     = custAlerts(c.id);
                      const status = statusOf(c);
                      const crit   = ca.filter(a=>a.severity==="critical").length;
                      const hi     = ca.filter(a=>a.severity==="high").length;
                      const med    = ca.filter(a=>a.severity==="medium").length;
                      const cScore = Math.max(0, Math.min(100, 100-crit*12-hi*4-med*1));
                      const sc     = SCORE_COLOR(cScore);
                      const stC    = status==="critical"?T.colors.danger:status==="warning"?T.colors.warn:T.colors.ok;
                      return (
                        <tr key={c.id} onClick={() => setSelected(c)}
                          style={{ cursor:"pointer", borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent" }}
                          onMouseEnter={e => e.currentTarget.style.background = T.colors.accentGl}
                          onMouseLeave={e => e.currentTarget.style.background = i%2?"#0c1222":"transparent"}>
                          <td style={{ padding:"10px 12px", fontWeight:700 }}>{c.name}</td>
                          <td style={{ padding:"10px 12px", fontFamily:T.fonts.mono, fontSize:11, color:T.colors.muted }}>{c.domain}</td>
                          <td style={{ padding:"10px 12px" }}>
                            <span style={{ fontFamily:T.fonts.mono, fontWeight:700, fontSize:13,
                              color:crit>0?T.colors.danger:hi>0?T.colors.warn:ca.length>0?T.colors.accent:T.colors.ok }}>
                              {ca.length||"✓"}
                            </span>
                            {ca.length>0&&<span style={{ fontSize:10,color:T.colors.dim,marginLeft:6 }}>{[crit&&`${crit}C`,hi&&`${hi}H`,med&&`${med}M`].filter(Boolean).join(" ")}</span>}
                          </td>
                          <td style={{ padding:"10px 12px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div style={{ width:48, height:4, background:T.colors.dim, borderRadius:2, overflow:"hidden" }}>
                                <div style={{ width:`${cScore}%`, height:"100%", background:sc, borderRadius:2 }} />
                              </div>
                              <span style={{ fontSize:12, color:sc, fontFamily:T.fonts.mono, fontWeight:700 }}>{cScore}</span>
                            </div>
                          </td>
                          <td style={{ padding:"10px 12px" }}>
                            <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:4,
                              background:status==="ok"?"#14532d":status==="warning"?"#451a03":"#450a0a", color:stC }}>
                              {status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding:"10px 12px" }}><Btn variant="secondary" size="sm">Audit →</Btn></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Right panel */}
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {/* Score ring */}
                <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:20, textAlign:"center" }}>
                  <div style={{ fontSize:10, color:T.colors.muted, marginBottom:10, letterSpacing:"0.06em" }}>PLATFORM SECURITY SCORE</div>
                  <GlowCircle value={platformScore} size={100} />
                  <div style={{ fontSize:10, color:T.colors.muted, marginTop:8 }}>
                    {alerts.length} open finding{alerts.length!==1?"s":""} · {customers.length} domain{customers.length!==1?"s":""}
                  </div>
                  <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:12 }}>
                    {[["Critical",customers.filter(c=>statusOf(c)==="critical").length,T.colors.danger],
                      ["At Risk",customers.filter(c=>statusOf(c)==="warning").length,T.colors.warn],
                      ["Secure",customers.filter(c=>statusOf(c)==="ok").length,T.colors.ok]].map(([l,v,c])=>(
                      <div key={l} style={{ textAlign:"center" }}>
                        <div style={{ fontSize:18, fontWeight:700, color:c, fontFamily:T.fonts.mono }}>{v}</div>
                        <div style={{ fontSize:10, color:T.colors.muted }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Risk by category */}
                {alerts.length > 0 && (
                  <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
                    <div style={{ padding:"10px 14px", borderBottom:`1px solid ${T.colors.border}`, fontSize:11, fontWeight:700 }}>📊 RISK BY CATEGORY</div>
                    <div style={{ padding:"10px 14px" }}>
                      {[
                        {cat:"password",color:"#ef4444"},{cat:"privilege",color:"#f59e0b"},
                        {cat:"account",color:"#a78bfa"},{cat:"gpo",color:"#0ea5e9"},
                        {cat:"infrastructure",color:"#22c55e"},{cat:"trust",color:"#64748b"},
                      ].map(({cat,color})=>{
                        const count = alerts.filter(a=>a.details?.category===cat).length;
                        const max = Math.max(...["password","privilege","account","gpo","infrastructure","trust"].map(cc=>alerts.filter(a=>a.details?.category===cc).length),1);
                        return (
                          <div key={cat} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, cursor:count>0?"pointer":"default" }}
                            onClick={() => count>0 && openRaw(`${cat} — Affected Accounts`, color,
                              [{key:"account",label:"Account",mono:true},{key:"finding",label:"Finding",mono:true},{key:"customer",label:"Customer"}],
                              alerts.filter(a=>a.details?.category===cat&&a.details?.affected_users?.length).flatMap(a=>(a.details.affected_users||[]).map(u=>({account:u,finding:a.details.finding_id,customer:a.customer_name}))))}>
                            <span style={{ fontSize:10, color:T.colors.muted, width:80, textAlign:"right", flexShrink:0, textTransform:"capitalize" }}>{cat}</span>
                            <div style={{ flex:1, height:10, background:T.colors.dim, borderRadius:2, overflow:"hidden" }}>
                              <div style={{ height:"100%", width:`${count?((count/max)*100):0}%`, background:color, borderRadius:2 }} />
                            </div>
                            <span style={{ fontSize:10, fontFamily:T.fonts.mono, fontWeight:700, color:count>0?color:T.colors.dim, width:20 }}>{count||"—"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Recent activity */}
                <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
                  <div style={{ padding:"10px 14px", borderBottom:`1px solid ${T.colors.border}`, fontSize:11, fontWeight:700 }}>📋 RECENT ACTIVITY</div>
                  {auditLog.length===0
                    ? <div style={{ padding:24, textAlign:"center", fontSize:12, color:T.colors.muted }}>No activity yet</div>
                    : <div style={{ overflowY:"auto", maxHeight:260 }}>
                        {auditLog.map((l,i) => (
                          <div key={l.id||i} style={{ padding:"8px 14px", borderBottom:`1px solid ${T.colors.border}22`, display:"flex", gap:8 }}>
                            <SevDot sev={l.severity||"info"} />
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:11, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.action}</div>
                              <div style={{ fontSize:10, color:T.colors.muted }}>{l.customer_name||"System"} · {new Date(l.created_at).toLocaleTimeString()}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                  }
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════ USERS & GROUPS TAB ═══════════ */}
      {tab === "users" && (
        <ADUsersDashboard />
      )}

      {rawModal && (
        <RawDataModal isOpen={!!rawModal} onClose={() => setRawModal(null)}
          title={rawModal.title} color={rawModal.color}
          headers={rawModal.headers} rows={rawModal.rows}
          emptyMsg="No data. Run scans to generate findings." />
      )}
    </div>
  );
}

// ── Enterprise User Posture subview ───────────────────────────────────
function EnterpriseUserPosture({ posture, openRaw, doExport }) {
  const [search, setSearch] = useState("");
  const s = posture.stats || {};
  const SEV_ORDER = { critical:0, high:1, medium:2, low:3 };
  const SEV_C = { critical:"#ef4444", high:"#f59e0b", medium:"#0ea5e9", low:"#a78bfa" };

  const filteredUsers = (posture.users||[]).filter(u =>
    !search || u.username?.toLowerCase().includes(search.toLowerCase()) ||
               u.customers?.join(" ").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Top KPIs — clickable */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[
          { label:"Total Affected",   value:posture.total_affected,   color:"#0ea5e9", icon:"👤",
            onClick:()=>openRaw("All Affected Accounts","#0ea5e9",
              [{key:"username",label:"Account",mono:true},{key:"worst",label:"Worst Sev",type:"severity"},{key:"findings",label:"Findings"}],
              (posture.users||[]).map(u=>({...u,findings:u.findings.length}))) },
          { label:"Critical Risk",    value:posture.critical_users,   color:"#ef4444", icon:"🔴",
            onClick:()=>openRaw("Critical Risk Accounts","#ef4444",
              [{key:"username",label:"Account",mono:true},{key:"findings",label:"Finding Count"},{key:"customers",label:"Customers"}],
              (posture.users||[]).filter(u=>u.worst==="critical").map(u=>({...u,findings:u.findings.length,customers:(u.customers||[]).join(", ")}))) },
          { label:"High Risk",        value:posture.high_users,       color:"#f59e0b", icon:"🟠",
            onClick:()=>openRaw("High Risk Accounts","#f59e0b",
              [{key:"username",label:"Account",mono:true},{key:"findings",label:"Findings"},{key:"customers",label:"Customers"}],
              (posture.users||[]).filter(u=>u.worst==="high").map(u=>({...u,findings:u.findings.length,customers:(u.customers||[]).join(", ")}))) },
          { label:"Domains Affected", value:(posture.perCustomer||[]).filter(c=>c.total>0).length, color:"#a78bfa", icon:"🏢" },
        ].map(({ label, value, color, icon, onClick }) => (
          <div key={label} onClick={onClick}
            style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"14px 18px",
              cursor:onClick?"pointer":"default", borderTop:`2px solid ${color}`, transition:"border-color 0.15s" }}
            onMouseEnter={e => onClick && (e.currentTarget.style.borderColor=color)}
            onMouseLeave={e => { e.currentTarget.style.borderColor=T.colors.border; e.currentTarget.style.borderTop=`2px solid ${color}`; }}>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <div style={{ fontSize:9, fontWeight:700, color:T.colors.muted, letterSpacing:"0.05em" }}>{label.toUpperCase()}</div>
              <span style={{ fontSize:18 }}>{icon}</span>
            </div>
            <div style={{ fontSize:28, fontWeight:700, color, fontFamily:T.fonts.mono, lineHeight:1.1, marginTop:6 }}>{value}</div>
            {onClick && <div style={{ fontSize:9, color:color, marginTop:4 }}>VIEW ACCOUNTS ›</div>}
          </div>
        ))}
      </div>

      {/* Insight cards */}
      {s.blank_passwords!==undefined && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {[
            { label:"Blank Passwords",        value:s.blank_passwords,  color:"#ef4444" },
            { label:"Non-Expiring Passwords",  value:s.no_expiry,        color:"#f59e0b" },
            { label:"Stale Accounts",          value:s.stale_accounts,   color:"#a78bfa" },
            { label:"Privileged Anomalies",    value:s.priv_anomalies,   color:"#f59e0b" },
            { label:"Kerberoastable Accounts", value:s.kerberoastable,   color:"#ef4444" },
            { label:"AS-REP Roastable",        value:s.asrep_roastable,  color:"#ef4444" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"12px 16px", display:"flex", gap:12, alignItems:"center" }}>
              <div style={{ fontSize:22, fontWeight:700, color:value>0?color:T.colors.ok, fontFamily:T.fonts.mono, minWidth:40 }}>{value}</div>
              <div style={{ fontSize:11, color:T.colors.muted }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {posture.byCategory && Object.keys(posture.byCategory).length > 0 && (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:16 }}>
          <div style={{ fontSize:12, fontWeight:700, marginBottom:14 }}>AFFECTED ACCOUNTS BY FINDING CATEGORY</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:10 }}>
            {Object.entries(posture.byCategory).sort((a,b)=>b[1]-a[1]).map(([cat,count]) => {
              const color = cat==="password"?"#ef4444":cat==="privilege"?"#f59e0b":cat==="account"?"#a78bfa":cat==="gpo"?"#0ea5e9":"#22c55e";
              return (
                <div key={cat} style={{ background:T.colors.surface, borderRadius:6, padding:"10px 12px", borderLeft:`3px solid ${color}` }}>
                  <div style={{ fontSize:18, fontWeight:700, color, fontFamily:T.fonts.mono }}>{count}</div>
                  <div style={{ fontSize:10, color:T.colors.muted, marginTop:2, textTransform:"capitalize" }}>{cat}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-customer breakdown */}
      {(posture.perCustomer||[]).length > 0 && (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.colors.border}`, fontSize:12, fontWeight:700 }}>PER-DOMAIN RISK SUMMARY</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:T.colors.surface }}>
                {["Domain","Critical","High","Medium","Low","Total"].map(h => (
                  <th key={h} style={{ padding:"8px 14px", textAlign:"left", fontSize:10, color:T.colors.muted, fontWeight:700, borderBottom:`1px solid ${T.colors.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posture.perCustomer.filter(c=>c.total>0).map((c,i) => (
                <tr key={c.name} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent" }}>
                  <td style={{ padding:"9px 14px", fontWeight:600 }}>{c.name}</td>
                  <td style={{ padding:"9px 14px", fontFamily:T.fonts.mono, fontWeight:700, color:c.critical>0?"#ef4444":T.colors.ok }}>{c.critical||"—"}</td>
                  <td style={{ padding:"9px 14px", fontFamily:T.fonts.mono, color:c.high>0?"#f59e0b":T.colors.dim }}>{c.high||"—"}</td>
                  <td style={{ padding:"9px 14px", fontFamily:T.fonts.mono, color:c.medium>0?"#0ea5e9":T.colors.dim }}>{c.medium||"—"}</td>
                  <td style={{ padding:"9px 14px", fontFamily:T.fonts.mono, color:T.colors.dim }}>{c.low||"—"}</td>
                  <td style={{ padding:"9px 14px", fontFamily:T.fonts.mono, fontWeight:700 }}>{c.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Top Findings */}
      {(posture.topFindings||[]).length > 0 && (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.colors.border}`, display:"flex", justifyContent:"space-between" }}>
            <span style={{ fontSize:12, fontWeight:700 }}>TOP FINDINGS BY AFFECTED ACCOUNTS</span>
            <span style={{ fontSize:11, color:T.colors.muted }}>Most impactful</span>
          </div>
          {posture.topFindings.map((f,i) => {
            const color = SEV_C[f.severity]||"#64748b";
            return (
              <div key={f.finding_id} style={{ padding:"10px 16px", borderBottom:`1px solid ${T.colors.border}22`, display:"flex", alignItems:"center", gap:14, background:i%2?"#0c1222":"transparent" }}>
                <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:`${color}22`, color, fontFamily:T.fonts.mono, minWidth:100, textAlign:"center" }}>
                  {f.finding_id}
                </span>
                <span style={{ flex:1, fontSize:12, fontWeight:500 }}>{f.finding_id}</span>
                <span style={{ fontSize:10, color:T.colors.muted }}>across {f.customers} domain{f.customers!==1?"s":""}</span>
                <span style={{ fontSize:14, fontWeight:700, color, fontFamily:T.fonts.mono }}>{f.affected}</span>
                <span style={{ fontSize:10, color:T.colors.muted }}>accounts</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Full user risk table */}
      {filteredUsers.length > 0 && (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.colors.border}`, display:"flex", gap:12, alignItems:"center" }}>
            <span style={{ fontWeight:700, fontSize:12, whiteSpace:"nowrap" }}>USER RISK TABLE</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍  Search username or domain…"
              style={{ flex:1, background:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:5, color:T.colors.text, padding:"5px 10px", fontSize:11 }} />
            <Btn variant="secondary" size="sm" onClick={() => doExport(filteredUsers.map(u=>({
              Username:u.username, WorstSeverity:u.worst, Findings:u.findings.join("|"), Customers:(u.customers||[]).join("|"),
            })))}>⬇ CSV</Btn>
            <span style={{ fontSize:11, color:T.colors.muted, whiteSpace:"nowrap" }}>{filteredUsers.length} accounts</span>
          </div>
          <div style={{ overflowY:"auto", maxHeight:500 }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:T.colors.surface, position:"sticky", top:0, zIndex:1 }}>
                  {["Account","Worst Sev","Findings","Affected By","Domains"].map(h => (
                    <th key={h} style={{ padding:"8px 14px", textAlign:"left", fontSize:10, color:T.colors.muted, fontWeight:700, borderBottom:`1px solid ${T.colors.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u,i) => {
                  const c = SEV_C[u.worst]||"#64748b";
                  return (
                    <tr key={u.username} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent" }}>
                      <td style={{ padding:"9px 14px", fontFamily:T.fonts.mono, fontWeight:600, fontSize:12 }}>{u.username}</td>
                      <td style={{ padding:"9px 14px" }}>
                        <span style={{ fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:3,background:`${c}22`,color:c,fontFamily:T.fonts.mono }}>{u.worst.toUpperCase()}</span>
                      </td>
                      <td style={{ padding:"9px 14px", fontFamily:T.fonts.mono, fontWeight:700, color:c }}>{u.findings.length}</td>
                      <td style={{ padding:"9px 14px", fontSize:11, color:T.colors.muted, maxWidth:220 }}>
                        {u.findings.slice(0,3).join(", ")}{u.findings.length>3&&` +${u.findings.length-3} more`}
                      </td>
                      <td style={{ padding:"9px 14px", fontSize:11, color:T.colors.muted }}>
                        {(u.customers||[]).join(", ")||"—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredUsers.length === 0 && (
        <Empty icon="👤" title="No affected users found" sub="Run scans on your AD domains to populate user risk data." />
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, icon, onClick }) {
  return (
    <div onClick={onClick}
      style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"16px 20px",
        borderTop:`2px solid ${color}`, cursor:onClick?"pointer":"default", transition:"border-color 0.15s" }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor=color)}
      onMouseLeave={e => { e.currentTarget.style.borderColor=T.colors.border; e.currentTarget.style.borderTop=`2px solid ${color}`; }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:T.colors.muted, letterSpacing:"0.06em", marginBottom:8 }}>{label.toUpperCase()}</div>
          <div style={{ fontSize:28, fontWeight:700, color, fontFamily:T.fonts.mono, lineHeight:1 }}>{value}</div>
          <div style={{ fontSize:11, color:T.colors.muted, marginTop:6 }}>{sub}</div>
        </div>
        <span style={{ fontSize:22 }}>{icon}</span>
      </div>
      {onClick && <div style={{ fontSize:9, color, marginTop:6 }}>VIEW DATA ›</div>}
    </div>
  );
}

function InsightCard({ label, value, icon, color, onClick }) {
  return (
    <div onClick={onClick}
      style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"12px 16px",
        display:"flex", alignItems:"center", gap:14, cursor:onClick?"pointer":"default", transition:"border-color 0.15s" }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor=color)}
      onMouseLeave={e => e.currentTarget.style.borderColor=T.colors.border}>
      <span style={{ fontSize:22 }}>{icon}</span>
      <div>
        <div style={{ fontSize:20, fontWeight:700, color:value>0?color:T.colors.ok, fontFamily:T.fonts.mono }}>{value}</div>
        <div style={{ fontSize:10, color:T.colors.muted }}>{label}</div>
        {onClick && value>0 && <div style={{ fontSize:9, color, marginTop:2 }}>VIEW ›</div>}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        {[1,2,3,4].map(i => <div key={i} style={{ height:90, background:T.colors.card, borderRadius:8, border:`1px solid ${T.colors.border}`, opacity:0.4 }} />)}
      </div>
      <div style={{ height:400, background:T.colors.card, borderRadius:8, border:`1px solid ${T.colors.border}`, opacity:0.4, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:13, color:T.colors.muted }}>Loading dashboard...</span>
      </div>
    </div>
  );
}
function ErrBox({ msg }) {
  return <div style={{ background:"rgba(239,68,68,0.08)", border:`1px solid #ef444444`, borderRadius:8, padding:40, textAlign:"center", color:"#ef4444" }}>{msg}</div>;
}
function Empty({ icon, title, sub, children }) {
  return (
    <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"60px 20px", textAlign:"center" }}>
      <div style={{ fontSize:40, marginBottom:12 }}>{icon}</div>
      <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:12, color:T.colors.muted, marginBottom:children?20:0 }}>{sub}</div>
      {children}
    </div>
  );
}
