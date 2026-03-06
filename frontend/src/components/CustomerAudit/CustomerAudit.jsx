import { useState, useEffect } from "react";
import { THEME as T, SCORE_COLOR } from "../../constants/theme";
import { GlowCircle, MetricCard, Btn, Modal, Input, Table, TR, TD, RawDataModal } from "../shared";
import { alertsApi, scanApi, settingsApi, customersApi, reportsApi, downloadReport } from "../../utils/api";
import ADUsersDashboard from "../Users/ADUsersDashboard";
import { useAuth } from "../../context/AuthContext";

// ── Param definitions (mirrors Settings exactly) ───────────────────
const PARAM_DEFS = [
  { key:"maxPasswordAge",               label:"Max Password Age",                type:"number",unit:"days",     default:90,  category:"Password",      finding:"AD-PWD-004" },
  { key:"minPasswordLength",            label:"Min Password Length",             type:"number",unit:"chars",    default:12,  category:"Password",      finding:"AD-GPO-001" },
  { key:"passwordHistoryCount",         label:"Password History",                type:"number",unit:"passwords",default:24,  category:"Password",      finding:"AD-GPO-010" },
  { key:"lockoutThreshold",             label:"Lockout Threshold",               type:"number",unit:"attempts", default:5,   category:"Password",      finding:"AD-GPO-002" },
  { key:"enablePasswdNotReqdCheck",     label:"Password Not Required",           type:"toggle",unit:"",         default:true,category:"Password",      finding:"AD-PWD-003" },
  { key:"enableNonExpiringCheck",       label:"Non-Expiring Passwords",          type:"toggle",unit:"",         default:true,category:"Password",      finding:"AD-PWD-001" },
  { key:"enableBlankPasswordCheck",     label:"Blank Passwords",                 type:"toggle",unit:"",         default:true,category:"Password",      finding:"AD-PWD-002" },
  { key:"enableReversibleEncCheck",     label:"Reversible Encryption",           type:"toggle",unit:"",         default:true,category:"Password",      finding:"AD-PWD-005" },
  { key:"enableComplexityCheck",        label:"Complexity Enforcement",          type:"toggle",unit:"",         default:true,category:"Password",      finding:"AD-GPO-003" },
  { key:"staleAccountDays",             label:"Stale Account Threshold",         type:"number",unit:"days",     default:90,  category:"Account",       finding:"AD-ACCT-001" },
  { key:"neverLoggedInDays",            label:"Never Logged In Alert",           type:"number",unit:"days",     default:30,  category:"Account",       finding:"AD-ACCT-002" },
  { key:"enableDisabledPrivGroupCheck", label:"Disabled in Priv Groups",         type:"toggle",unit:"",         default:true,category:"Account",       finding:"AD-ACCT-003" },
  { key:"enableSharedAccountCheck",     label:"Shared/Generic Accounts",         type:"toggle",unit:"",         default:true,category:"Account",       finding:"AD-ACCT-004" },
  { key:"enableSidHistoryCheck",        label:"SID History",                     type:"toggle",unit:"",         default:true,category:"Account",       finding:"AD-ACCT-005" },
  { key:"maxDomainAdmins",              label:"Max Domain Admins",               type:"number",unit:"accounts", default:5,   category:"Privilege",     finding:"AD-PRIV-001" },
  { key:"enableKerberoastCheck",        label:"Kerberoastable Accounts",         type:"toggle",unit:"",         default:true,category:"Privilege",     finding:"AD-PRIV-002" },
  { key:"enableAsrepCheck",             label:"AS-REP Roasting",                 type:"toggle",unit:"",         default:true,category:"Privilege",     finding:"AD-PRIV-003" },
  { key:"enableAdminCountCheck",        label:"AdminCount Attribute",            type:"toggle",unit:"",         default:true,category:"Privilege",     finding:"AD-PRIV-004" },
  { key:"enableUnconstrainedDelegCheck",label:"Unconstrained Delegation",        type:"toggle",unit:"",         default:true,category:"Privilege",     finding:"AD-PRIV-005" },
  { key:"enableConstrainedDelegCheck",  label:"Constrained Delegation",          type:"toggle",unit:"",         default:true,category:"Privilege",     finding:"AD-PRIV-006" },
  { key:"kerbTicketMaxHours",           label:"Kerberos Ticket Lifetime",        type:"number",unit:"hours",    default:10,  category:"GPO",           finding:"AD-GPO-006" },
  { key:"enableLapsCheck",              label:"LAPS Deployment",                 type:"toggle",unit:"",         default:true,category:"GPO",           finding:"AD-GPO-004" },
  { key:"enableDomainReversibleEncCheck",label:"Domain Reversible Enc",          type:"toggle",unit:"",         default:true,category:"GPO",           finding:"AD-GPO-005" },
  { key:"enableAuditPolicyCheck",       label:"Audit Policy",                    type:"toggle",unit:"",         default:true,category:"GPO",           finding:"AD-GPO-007" },
  { key:"enableProtectedUsersCheck",    label:"Protected Users Group",           type:"toggle",unit:"",         default:true,category:"GPO",           finding:"AD-GPO-008" },
  { key:"enableFGPPCheck",              label:"Fine-Grained Password Policy",    type:"toggle",unit:"",         default:true,category:"GPO",           finding:"AD-GPO-009" },
  { key:"enableSidFilteringCheck",      label:"SID Filtering",                   type:"toggle",unit:"",         default:true,category:"Trust",         finding:"AD-TRUST-001" },
  { key:"enableBiDirTrustCheck",        label:"Bidirectional Trust",             type:"toggle",unit:"",         default:true,category:"Trust",         finding:"AD-TRUST-002" },
  { key:"enableOutdatedOsCheck",        label:"Outdated DC OS",                  type:"toggle",unit:"",         default:true,category:"Infrastructure",finding:"AD-DC-001" },
  { key:"krbtgtRotationDays",           label:"krbtgt Password Age",             type:"number",unit:"days",     default:180, category:"Infrastructure",finding:"AD-DC-002" },
  { key:"enableRodcCheck",              label:"RODC Deployment",                 type:"toggle",unit:"",         default:false,category:"Infrastructure",finding:"AD-DC-003" },
  { key:"scanIntervalHours",            label:"Scan Interval",                   type:"number",unit:"hours",    default:6,   category:"Scan",          finding:null },
  { key:"retentionDays",                label:"Data Retention",                  type:"number",unit:"days",     default:365, category:"Scan",          finding:null },
];

const SEV_C = { critical:T.colors.danger, high:T.colors.warn, medium:T.colors.accent, low:T.colors.purple };
const SEV_O = { critical:0, high:1, medium:2, low:3 };

const TABS = [
  { id:"overview",  label:"Overview"         },
  { id:"users",     label:"👤 Users & Groups" },
  { id:"findings",  label:"Findings"         },
  { id:"gpo",       label:"GPO / Policy"     },
  { id:"params",    label:"Audit Params"     },
  { id:"reports",   label:"Reports"          },
];

export default function CustomerAudit({ customer, onBack }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [tab,       setTab]      = useState("overview");
  const [alerts,    setAlerts]   = useState([]);
  const [loading,   setLoading]  = useState(true);
  const [scanning,  setScanning] = useState(false);

  // Filters
  const [filterSev, setFilterSev] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const [expanded,  setExpanded]  = useState(null);

  // Params
  const [paramValues,  setParamValues]  = useState(Object.fromEntries(PARAM_DEFS.map(p=>[p.key,p.default])));
  const [customParams, setCustomParams] = useState([]);
  const [savingParams, setSavingParams] = useState(false);
  const [paramSaved,   setParamSaved]   = useState(false);
  const [addParamModal,setAddParamModal]= useState(false);
  const [newParam,     setNewParam]     = useState({ key:"",label:"",type:"number",unit:"",default:"",category:"Custom",hint:"",finding:"" });

  // Raw data modals — one per card
  const [rawModal, setRawModal] = useState(null); // { title, headers, rows, color }
  const [reportBusy, setReportBusy] = useState(null);

  const openRaw = (title, color, headers, rows) =>
    setRawModal({ title, color, headers, rows });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      alertsApi.list({ customer_id: customer.id, is_acked: false }),
      settingsApi.get(),
    ]).then(([a, p, s]) => {
      setAlerts(Array.isArray(a) ? a : []);
      if (s?.audit_params) {
        try {
          const saved = JSON.parse(s.audit_params);
          if (saved.standard) setParamValues(x=>({...x,...saved.standard}));
          if (saved.custom)   setCustomParams(saved.custom);
        } catch {}
      }
    }).catch(()=>{}).finally(()=>setLoading(false));
  }, [customer.id]);

  const triggerScan = async () => {
    setScanning(true);
    try {
      await scanApi.trigger(customer.id);
      const a = await alertsApi.list({ customer_id: customer.id, is_acked: false });
      setAlerts(Array.isArray(a) ? a : []);
    } catch(e){ alert(e.message); }
    setScanning(false);
  };

  const saveParams = async () => {
    setSavingParams(true);
    try {
      await settingsApi.save({ audit_params: JSON.stringify({ standard:paramValues, custom:customParams }) });
      setParamSaved(true); setTimeout(()=>setParamSaved(false),3000);
    } catch(e){ alert(e.message); }
    setSavingParams(false);
  };

  const generateReport = async (type, format) => {
    const k = `${type}_${format}`;
    setReportBusy(k);
    try {
      const result = await reportsApi.generate({
        type,
        format,
        customer_id: customer.id,
        customer_name: customer.name,
      });
      if (result?.download_url) {
        await downloadReport(result.download_url, result.filename || `${type}.${format}`);
      }
    } catch (e) {
      alert(`Report download failed: ${e.message}`);
    }
    setReportBusy(null);
  };

  const addCustomParam = () => {
    if (!newParam.key||!newParam.label) return;
    const def = newParam.type==="toggle" ? false : Number(newParam.default)||0;
    setCustomParams(p=>[...p,{...newParam,default:def}]);
    setParamValues(p=>({...p,[newParam.key]:def}));
    setNewParam({key:"",label:"",type:"number",unit:"",default:"",category:"Custom",hint:"",finding:""});
    setAddParamModal(false);
  };

  // Derived stats
  const crit   = alerts.filter(a=>a.severity==="critical").length;
  const high   = alerts.filter(a=>a.severity==="high").length;
  const med    = alerts.filter(a=>a.severity==="medium").length;
  const low    = alerts.filter(a=>a.severity==="low").length;
  const score  = Math.max(0, Math.min(100, 100 - crit*12 - high*4 - med*1));
  const cats   = [...new Set(alerts.filter(a=>a.details?.category).map(a=>a.details.category))];

  const findings = alerts
    .filter(a => a.details?.finding_id)
    .filter(a => filterSev==="all" || a.severity===filterSev)
    .filter(a => filterCat==="all" || a.details?.category===filterCat)
    .sort((a,b)=>(SEV_O[a.severity]||3)-(SEV_O[b.severity]||3));

  const gpoAlerts = alerts.filter(a=>a.details?.category==="gpo")
    .sort((a,b)=>(SEV_O[a.severity]||3)-(SEV_O[b.severity]||3));

  // Raw data helpers
  const findingRows = (cat) => alerts
    .filter(a => !cat || a.details?.category===cat)
    .filter(a => a.details?.finding_id)
    .flatMap(a => (a.details.affected_users||[]).map(u=>({
      username: u,
      finding:  a.details.finding_id,
      severity: a.severity,
      category: a.details.category||"—",
    })));

  const allParams = [...PARAM_DEFS, ...customParams.map(p=>({...p,custom:true}))];
  const allCats   = [...new Set(allParams.map(p=>p.category))];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── Header bar ── */}
      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <Btn variant="ghost" onClick={onBack}>← Back</Btn>
        <div style={{ flex:1 }}>
          <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>{customer.name}</h2>
          <div style={{ fontSize:11, color:T.colors.muted, fontFamily:T.fonts.mono }}>{customer.domain}</div>
        </div>
        <GlowCircle value={score} size={60} />
        <div>
          <div style={{ fontSize:10, color:T.colors.muted }}>Security Score</div>
          <div style={{ fontSize:11, fontWeight:700, color:SCORE_COLOR(score) }}>
            {score>=80?"GOOD":score>=60?"AT RISK":"CRITICAL"}
          </div>
        </div>
        <Btn variant="secondary" onClick={triggerScan} disabled={scanning}>
          {scanning?"⟳ Scanning...":"⟳ Scan Now"}
        </Btn>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:4, borderRadius:8, border:`1px solid ${T.colors.border}`, flexWrap:"wrap" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1, minWidth:80, padding:"8px 6px",
            background:tab===t.id?T.colors.card:"transparent",
            border:tab===t.id?`1px solid ${T.colors.border}`:"1px solid transparent",
            color:tab===t.id?T.colors.text:T.colors.muted,
            borderRadius:6, cursor:"pointer", fontSize:11,
            fontWeight:tab===t.id?700:400, fontFamily:T.fonts.sans,
          }}>{t.label}</button>
        ))}
      </div>

      {loading && <div style={{ padding:40, textAlign:"center", color:T.colors.muted }}>Loading...</div>}

      {/* ════ OVERVIEW ════ */}
      {!loading && tab==="overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Clickable KPI cards — all open raw data */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
            <MetricCard label="Critical" value={crit} sub="Click to view accounts" color={T.colors.danger} icon="🔴"
              onClick={()=>openRaw("Critical Findings — Affected Accounts", T.colors.danger,
                [{key:"username",label:"Account"},{key:"finding",label:"Finding ID",mono:true},{key:"category",label:"Category"},{key:"severity",label:"Severity",type:"severity"}],
                findingRows(null).filter(r=>r.severity==="critical"))} />
            <MetricCard label="High" value={high} sub="Click to view accounts" color={T.colors.warn} icon="🟠"
              onClick={()=>openRaw("High Severity — Affected Accounts", T.colors.warn,
                [{key:"username",label:"Account"},{key:"finding",label:"Finding ID",mono:true},{key:"category",label:"Category"},{key:"severity",label:"Severity",type:"severity"}],
                findingRows(null).filter(r=>r.severity==="high"))} />
            <MetricCard label="Medium" value={med} sub="Click to view accounts" color={T.colors.accent} icon="🟡"
              onClick={()=>openRaw("Medium Severity — Affected Accounts", T.colors.accent,
                [{key:"username",label:"Account"},{key:"finding",label:"Finding ID",mono:true},{key:"category",label:"Category"},{key:"severity",label:"Severity",type:"severity"}],
                findingRows(null).filter(r=>r.severity==="medium"))} />
            <MetricCard label="Total Findings" value={alerts.length} sub="All open findings" color={T.colors.purple} icon="📊"
              onClick={()=>openRaw("All Open Findings", T.colors.purple,
                [{key:"finding",label:"Finding ID",mono:true},{key:"severity",label:"Severity",type:"severity"},{key:"category",label:"Category"},{key:"username",label:"Affected Account"}],
                findingRows(null))} />
          </div>

          {/* Category bar chart — each bar clickable */}
          {alerts.length > 0 && (
            <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:20 }}>
              <div style={{ fontSize:12, fontWeight:700, marginBottom:14 }}>FINDINGS BY CATEGORY
                <span style={{ fontSize:10, fontWeight:400, color:T.colors.muted, marginLeft:8 }}>click bar to view accounts</span>
              </div>
              {cats.map(cat=>{
                const ca = alerts.filter(a=>a.details?.category===cat);
                const maxC = Math.max(...cats.map(c2=>alerts.filter(a=>a.details?.category===c2).length),1);
                const hasCrit = ca.some(a=>a.severity==="critical");
                const color = hasCrit?T.colors.danger:ca.some(a=>a.severity==="high")?T.colors.warn:T.colors.accent;
                return (
                  <div key={cat} style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10, cursor:"pointer" }}
                    onClick={()=>openRaw(`${cat.charAt(0).toUpperCase()+cat.slice(1)} — Affected Accounts`, color,
                      [{key:"username",label:"Account"},{key:"finding",label:"Finding",mono:true},{key:"severity",label:"Severity",type:"severity"}],
                      findingRows(cat))}>
                    <div style={{ width:120, fontSize:12, color:T.colors.muted, textTransform:"capitalize", textAlign:"right", flexShrink:0 }}>{cat}</div>
                    <div style={{ flex:1, height:20, background:T.colors.dim, borderRadius:3, overflow:"hidden", transition:"opacity 0.15s" }}
                      onMouseEnter={e=>e.currentTarget.style.opacity="0.8"}
                      onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                      <div style={{ height:"100%", width:`${(ca.length/maxC)*100}%`, background:color, borderRadius:3, display:"flex", alignItems:"center", paddingLeft:8 }}>
                        <span style={{ fontSize:10, fontWeight:700, color:"#fff" }}>{ca.length}</span>
                      </div>
                    </div>
                    <span style={{ fontSize:11, color, fontWeight:700, width:20 }}>{ca.length}</span>
                  </div>
                );
              })}
            </div>
          )}

          {alerts.length === 0 && (
            <Empty icon="✅" title="No open findings" sub="Run a scan to check for issues.">
              <Btn onClick={triggerScan} disabled={scanning}>{scanning?"Scanning...":"Run First Scan"}</Btn>
            </Empty>
          )}
        </div>
      )}

      {/* ════ USERS & GROUPS ════ */}
      {!loading && tab==="users" && (
        <ADUsersDashboard customerId={customer.id} customerName={customer.name} />
      )}

      {/* ════ FINDINGS ════ */}
      {!loading && tab==="findings" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {/* Filter bar */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11, color:T.colors.muted }}>Severity:</span>
            {["all","critical","high","medium","low"].map(s=>{
              const c = SEV_C[s];
              return (
                <button key={s} onClick={()=>setFilterSev(s)} style={{
                  padding:"4px 12px", borderRadius:4, fontSize:11, fontWeight:filterSev===s?700:400, cursor:"pointer",
                  background:filterSev===s?(s==="all"?T.colors.accent+"22":`${c}22`):"transparent",
                  color:filterSev===s?(s==="all"?T.colors.accent:c):T.colors.muted,
                  border:`1px solid ${filterSev===s?(s==="all"?T.colors.accent:c):T.colors.border}`,
                }}>{s.toUpperCase()}</button>
              );
            })}
            <span style={{ fontSize:11, color:T.colors.muted, marginLeft:8 }}>Category:</span>
            {["all",...cats].map(c=>(
              <button key={c} onClick={()=>setFilterCat(c)} style={{
                padding:"4px 12px", borderRadius:4, fontSize:11, cursor:"pointer",
                fontWeight:filterCat===c?700:400,
                background:filterCat===c?T.colors.accent+"22":"transparent",
                color:filterCat===c?T.colors.accent:T.colors.muted,
                border:`1px solid ${filterCat===c?T.colors.accent:T.colors.border}`,
              }}>{c}</button>
            ))}
            <span style={{ marginLeft:"auto", fontSize:11, color:T.colors.muted }}>{findings.length} findings</span>
          </div>

          {findings.length===0
            ? <Empty icon="🔍" title="No findings match filter" sub="Try changing the severity or category filter." />
            : findings.map(a=>{
                const sc  = SEV_C[a.severity]||T.colors.muted;
                const det = a.details||{};
                const isExp = expanded===a.id;
                const comp  = det.compliance||{};
                const users = det.affected_users||[];
                return (
                  <div key={a.id} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden", transition:"border-color 0.15s" }}>
                    <div onClick={()=>setExpanded(isExp?null:a.id)}
                      style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}
                      onMouseEnter={e=>e.currentTarget.parentElement.style.borderColor=sc}
                      onMouseLeave={e=>e.currentTarget.parentElement.style.borderColor=T.colors.border}>
                      <span style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:3,
                        background:`${sc}22`, color:sc, fontFamily:T.fonts.mono, minWidth:68, textAlign:"center" }}>
                        {a.severity.toUpperCase()}
                      </span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{a.message}</div>
                        <div style={{ fontSize:10, color:T.colors.muted, fontFamily:T.fonts.mono }}>
                          {det.finding_id} · {det.category} · {det.affected_count} affected · Risk {det.risk_score}
                        </div>
                      </div>
                      {users.length>0 && (
                        <Btn variant="ghost" size="sm"
                          onClick={e=>{e.stopPropagation();openRaw(`${det.finding_id} — Affected Accounts`, sc,
                            [{key:"username",label:"Account",mono:true}],
                            users.map(u=>({username:u})));}}
                        >View {users.length} accounts</Btn>
                      )}
                      <span style={{ color:T.colors.muted }}>{isExp?"▲":"▼"}</span>
                    </div>
                    {isExp && (
                      <div style={{ borderTop:`1px solid ${T.colors.border}`, padding:"14px 16px", display:"flex", flexDirection:"column", gap:12 }}>
                        {det.description&&<div style={{ fontSize:12, color:T.colors.muted, lineHeight:1.6 }}>{det.description}</div>}
                        {det.remediation&&(
                          <div style={{ background:T.colors.surface, borderRadius:6, padding:"10px 14px" }}>
                            <div style={{ fontSize:10, fontWeight:700, color:T.colors.muted, marginBottom:6 }}>REMEDIATION</div>
                            <div style={{ fontSize:12, lineHeight:1.6 }}>{det.remediation}</div>
                          </div>
                        )}
                        {(comp.cis_v8||comp.nist_800_53||comp.iso_27001||comp.soc2||comp.mitre)&&(
                          <div style={{ background:T.colors.surface, borderRadius:6, padding:"10px 14px" }}>
                            <div style={{ fontSize:10, fontWeight:700, color:T.colors.muted, marginBottom:8 }}>COMPLIANCE MAPPING</div>
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:6 }}>
                              {[
                                {label:"CIS v8",       val:(comp.cis_v8||[]).join(", "),                  color:"#3b82f6"},
                                {label:"NIST 800-53",  val:(comp.nist_800_53||[]).join(", "),             color:"#8b5cf6"},
                                {label:"ISO 27001",    val:(comp.iso_27001||[]).join(", "),               color:"#10b981"},
                                {label:"SOC 2",        val:(comp.soc2||[]).join(", "),                    color:"#f59e0b"},
                                {label:"MITRE ATT&CK", val:(comp.mitre||[]).map(m=>m.id).join(", "),     color:"#ef4444"},
                              ].filter(m=>m.val).map(m=>(
                                <div key={m.label} style={{ background:T.colors.bg, borderRadius:4, padding:"6px 10px", borderLeft:`3px solid ${m.color}` }}>
                                  <div style={{ fontSize:9, fontWeight:700, color:T.colors.muted, marginBottom:2 }}>{m.label}</div>
                                  <div style={{ fontSize:11, fontFamily:T.fonts.mono, color:m.color, fontWeight:600 }}>{m.val}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div style={{ display:"flex", gap:8 }}>
                          <Btn variant="danger" size="sm">Create Ticket</Btn>
                          <Btn variant="secondary" size="sm">Acknowledge</Btn>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ════ GPO / POLICY ════ */}
      {!loading && tab==="gpo" && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
            <MetricCard label="GPO Findings" value={gpoAlerts.length} sub="Click to view" color={T.colors.danger} icon="📋"
              onClick={()=>openRaw("GPO / Policy Findings", T.colors.danger,
                [{key:"username",label:"Account",mono:true},{key:"finding",label:"Finding",mono:true},{key:"severity",label:"Severity",type:"severity"}],
                findingRows("gpo"))} />
            <MetricCard label="Critical GPO" value={gpoAlerts.filter(a=>a.severity==="critical").length} sub="Immediate risk" color={T.colors.danger} icon="🔴" />
            <MetricCard label="High GPO"     value={gpoAlerts.filter(a=>a.severity==="high").length}     sub="Action needed"  color={T.colors.warn}   icon="🟠" />
          </div>
          <div style={{ background:"rgba(14,165,233,0.06)", border:`1px solid ${T.colors.accent}33`, borderRadius:8, padding:"10px 16px", fontSize:12, color:T.colors.accent }}>
            ℹ️ GPO findings are derived from LDAP-readable domain attributes. Full SYSVOL GPO parsing requires a Windows-side agent.
          </div>
          {gpoAlerts.length===0
            ? <Empty icon="📋" title="No GPO findings" sub="Run a scan to check policy settings.">
                <Btn onClick={triggerScan} disabled={scanning}>{scanning?"Scanning...":"Run Scan"}</Btn>
              </Empty>
            : gpoAlerts.map((a,i)=>{
                const sc  = SEV_C[a.severity]||T.colors.muted;
                const det = a.details||{};
                const users = det.affected_users||[];
                return (
                  <div key={a.id} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"12px 16px",
                    display:"grid", gridTemplateColumns:"80px 1fr auto auto", gap:12, alignItems:"start" }}>
                    <span style={{ fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:3,
                      background:`${sc}22`, color:sc, fontFamily:T.fonts.mono, textAlign:"center" }}>
                      {a.severity.toUpperCase()}
                    </span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600 }}>{a.message}</div>
                      <div style={{ fontSize:10, color:T.colors.muted, fontFamily:T.fonts.mono, marginTop:3 }}>{det.finding_id}</div>
                      {det.remediation&&<div style={{ fontSize:11, color:T.colors.muted, marginTop:6 }}>{det.remediation}</div>}
                    </div>
                    <div style={{ fontSize:11, fontFamily:T.fonts.mono, color:sc, fontWeight:700, whiteSpace:"nowrap" }}>Risk {det.risk_score}</div>
                    {users.length>0&&(
                      <Btn variant="ghost" size="sm"
                        onClick={()=>openRaw(`${det.finding_id} — Affected Accounts`, sc,
                          [{key:"username",label:"Account",mono:true}],
                          users.map(u=>({username:u})))}>
                        {users.length} accounts
                      </Btn>
                    )}
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ════ AUDIT PARAMETERS ════ */}
      {!loading && tab==="params" && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>Audit Parameters</div>
              <div style={{ fontSize:11, color:T.colors.muted, marginTop:4 }}>
                Global thresholds applied to all scans. Changes saved here affect all customers.
                {!isAdmin&&<span style={{ color:T.colors.warn }}> · Read-only</span>}
              </div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              {paramSaved&&<span style={{ fontSize:12, color:T.colors.ok }}>✅ Saved</span>}
              {isAdmin&&<Btn variant="secondary" size="sm" onClick={()=>setAddParamModal(true)}>+ Add Parameter</Btn>}
              {isAdmin&&<Btn onClick={saveParams} disabled={savingParams}>{savingParams?"Saving...":"Save All"}</Btn>}
            </div>
          </div>
          {allCats.map(cat=>{
            const cp = allParams.filter(p=>p.category===cat);
            return (
              <div key={cat} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
                <div style={{ padding:"10px 16px", background:T.colors.surface, borderBottom:`1px solid ${T.colors.border}`, display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:T.colors.muted }}>{cat.toUpperCase()}</span>
                  <span style={{ fontSize:10, color:T.colors.dim }}>{cp.length} param{cp.length!==1?"s":""}</span>
                </div>
                <div style={{ padding:"8px 16px" }}>
                  {cp.map((p,pi)=>(
                    <div key={p.key} style={{ display:"flex", alignItems:"center", gap:16, padding:"9px 0", borderBottom:pi<cp.length-1?`1px solid ${T.colors.border}22`:"none" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <span style={{ fontSize:12, fontWeight:600, color:p.custom?T.colors.purple:T.colors.text }}>{p.label}</span>
                          {p.finding&&<span style={{ fontSize:9, fontFamily:T.fonts.mono, color:T.colors.dim }}>{p.finding}</span>}
                          {p.custom&&<span style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:3, background:"rgba(167,139,250,0.15)", color:T.colors.purple }}>CUSTOM</span>}
                        </div>
                        {p.hint&&<div style={{ fontSize:10, color:T.colors.dim, marginTop:2 }}>{p.hint}</div>}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                        {p.type==="toggle"
                          ? <MiniToggle value={!!paramValues[p.key]} disabled={!isAdmin} onChange={v=>setParamValues(x=>({...x,[p.key]:v}))} />
                          : <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              <input type="number" value={paramValues[p.key]??p.default} disabled={!isAdmin}
                                onChange={e=>setParamValues(x=>({...x,[p.key]:Number(e.target.value)}))}
                                style={{ width:80, textAlign:"right", background:isAdmin?T.colors.bg:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:4, color:T.colors.text, padding:"5px 8px", fontSize:12, fontFamily:T.fonts.mono }} />
                              <span style={{ fontSize:11, color:T.colors.muted, minWidth:50 }}>{p.unit}</span>
                            </div>
                        }
                        {isAdmin&&p.custom&&(
                          <button onClick={()=>{setCustomParams(x=>x.filter(c=>c.key!==p.key));setParamValues(x=>{const n={...x};delete n[p.key];return n;})}}
                            style={{ background:"none",border:"none",color:T.colors.danger,cursor:"pointer",fontSize:14 }}>✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════ REPORTS ════ */}
      {!loading && tab==="reports" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
          {[
            { type:"executive_summary", title:"Executive Summary",        icon:"📊", color:T.colors.accent },
            { type:"password_vulnerability", title:"Password Vulnerabilities", icon:"🔐", color:T.colors.danger },
            { type:"policy_compliance", title:"Policy Compliance",        icon:"📋", color:T.colors.warn },
            { type:"privileged_accounts", title:"Privileged Accounts",      icon:"👑", color:T.colors.warn },
            { type:"compliance_mapping", title:"Compliance Mapping",       icon:"🗂️", color:T.colors.accent },
            { type:"kerberos_risks", title:"Kerberos Attack Surface",  icon:"🎫", color:T.colors.danger },
          ].map(r=>{
            const pdfKey = `${r.type}_pdf`;
            const csvKey = `${r.type}_csv`;
            return (
              <div key={r.title} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:18, display:"flex", gap:14, transition:"border-color 0.2s" }}
                onMouseEnter={e=>e.currentTarget.style.borderColor=r.color}
                onMouseLeave={e=>e.currentTarget.style.borderColor=T.colors.border}>
                <span style={{ fontSize:24 }}>{r.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:13, marginBottom:10 }}>{r.title}</div>
                  <div style={{ display:"flex", gap:8 }}>
                    <Btn variant="danger" size="sm" disabled={!!reportBusy} onClick={()=>generateReport(r.type, "pdf")}>{reportBusy===pdfKey?"Generating…":"⬇ PDF"}</Btn>
                    <Btn variant="secondary" size="sm" disabled={!!reportBusy} onClick={()=>generateReport(r.type, "csv")}>{reportBusy===csvKey?"Generating…":"⬇ CSV"}</Btn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Generic Raw Data Modal ── */}
      {rawModal && (
        <RawDataModal
          isOpen={!!rawModal}
          onClose={()=>setRawModal(null)}
          title={rawModal.title}
          color={rawModal.color}
          headers={rawModal.headers}
          rows={rawModal.rows}
          emptyMsg="No affected accounts found for this filter. Run a scan to generate data."
        />
      )}

      {/* ── Add Custom Parameter Modal ── */}
      <Modal isOpen={addParamModal} onClose={()=>setAddParamModal(false)} title="+ Add Custom Parameter" width={480}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Key *" placeholder="myCheck" value={newParam.key} onChange={e=>setNewParam(p=>({...p,key:e.target.value.replace(/\s/g,"")}))} />
            <Input label="Label *" placeholder="My Check" value={newParam.label} onChange={e=>setNewParam(p=>({...p,label:e.target.value}))} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <label style={{ fontSize:11,fontWeight:700,color:T.colors.muted,display:"block",marginBottom:6 }}>TYPE</label>
              <select value={newParam.type} onChange={e=>setNewParam(p=>({...p,type:e.target.value}))}
                style={{ width:"100%",background:T.colors.surface,border:`1px solid ${T.colors.border}`,borderRadius:6,color:T.colors.text,padding:"9px 12px",fontSize:13 }}>
                <option value="number">Number (threshold)</option>
                <option value="toggle">Toggle (on/off)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:11,fontWeight:700,color:T.colors.muted,display:"block",marginBottom:6 }}>CATEGORY</label>
              <select value={newParam.category} onChange={e=>setNewParam(p=>({...p,category:e.target.value}))}
                style={{ width:"100%",background:T.colors.surface,border:`1px solid ${T.colors.border}`,borderRadius:6,color:T.colors.text,padding:"9px 12px",fontSize:13 }}>
                {["Password","Account","Privilege","GPO","Trust","Infrastructure","Scan","Custom"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Default" placeholder="e.g. 30" value={newParam.default} onChange={e=>setNewParam(p=>({...p,default:e.target.value}))} />
            <Input label="Unit" placeholder="days / accounts" value={newParam.unit} onChange={e=>setNewParam(p=>({...p,unit:e.target.value}))} />
          </div>
          <Input label="Description" placeholder="What does this control?" value={newParam.hint} onChange={e=>setNewParam(p=>({...p,hint:e.target.value}))} />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={()=>setAddParamModal(false)}>Cancel</Btn>
            <Btn onClick={addCustomParam} disabled={!newParam.key||!newParam.label}>Add Parameter</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Empty({ icon, title, sub, children }) {
  return (
    <div style={{ textAlign:"center", padding:"50px 20px", background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8 }}>
      <div style={{ fontSize:36, marginBottom:12 }}>{icon}</div>
      <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:12, color:T.colors.muted, marginBottom:children?16:0 }}>{sub}</div>
      {children}
    </div>
  );
}

function MiniToggle({ value, onChange, disabled }) {
  return (
    <div onClick={()=>{ if(!disabled&&onChange) onChange(!value); }}
      style={{ width:38, height:21, borderRadius:11, background:value?T.colors.accent:T.colors.dim, cursor:disabled?"not-allowed":"pointer", position:"relative", transition:"background 0.2s", opacity:disabled?0.5:1, flexShrink:0 }}>
      <div style={{ position:"absolute", top:2.5, left:value?19:2.5, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
    </div>
  );
}
