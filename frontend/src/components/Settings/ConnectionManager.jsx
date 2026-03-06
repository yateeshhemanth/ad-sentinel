import { useState, useEffect, useCallback } from "react";
import { THEME as T } from "../../constants/theme";
import { Btn, Modal, Input } from "../shared";
import { logoApi, customersApi, settingsApi, scanApi, usersApi } from "../../utils/api";
import { useAuth } from "../../context/AuthContext";

// ── Parameter definitions ─────────────────────────────────────────────
const PARAM_DEFINITIONS = [
  { key:"maxPasswordAge",               label:"Max Password Age",                type:"number",unit:"days",     default:90,   category:"Password",       finding:"AD-PWD-004" },
  { key:"minPasswordLength",            label:"Min Password Length",             type:"number",unit:"chars",    default:12,   category:"Password",       finding:"AD-GPO-001" },
  { key:"passwordHistoryCount",         label:"Password History",                type:"number",unit:"passwords",default:24,   category:"Password",       finding:"AD-GPO-010" },
  { key:"lockoutThreshold",             label:"Lockout Threshold",               type:"number",unit:"attempts", default:5,    category:"Password",       finding:"AD-GPO-002" },
  { key:"enablePasswdNotReqdCheck",     label:"Password Not Required",           type:"toggle",unit:"",         default:true, category:"Password",       finding:"AD-PWD-003" },
  { key:"enableNonExpiringCheck",       label:"Non-Expiring Passwords",          type:"toggle",unit:"",         default:true, category:"Password",       finding:"AD-PWD-001" },
  { key:"enableBlankPasswordCheck",     label:"Blank Passwords",                 type:"toggle",unit:"",         default:true, category:"Password",       finding:"AD-PWD-002" },
  { key:"enableReversibleEncCheck",     label:"Reversible Encryption",           type:"toggle",unit:"",         default:true, category:"Password",       finding:"AD-PWD-005" },
  { key:"enableComplexityCheck",        label:"Complexity Enforcement",          type:"toggle",unit:"",         default:true, category:"Password",       finding:"AD-GPO-003" },
  { key:"staleAccountDays",             label:"Stale Account Threshold",         type:"number",unit:"days",     default:90,   category:"Account",        finding:"AD-ACCT-001" },
  { key:"neverLoggedInDays",            label:"Never Logged In Alert",           type:"number",unit:"days",     default:30,   category:"Account",        finding:"AD-ACCT-002" },
  { key:"enableDisabledPrivGroupCheck", label:"Disabled in Priv Groups",         type:"toggle",unit:"",         default:true, category:"Account",        finding:"AD-ACCT-003" },
  { key:"enableSharedAccountCheck",     label:"Shared/Generic Accounts",         type:"toggle",unit:"",         default:true, category:"Account",        finding:"AD-ACCT-004" },
  { key:"enableSidHistoryCheck",        label:"SID History",                     type:"toggle",unit:"",         default:true, category:"Account",        finding:"AD-ACCT-005" },
  { key:"maxDomainAdmins",              label:"Max Domain Admins",               type:"number",unit:"accounts", default:5,    category:"Privilege",      finding:"AD-PRIV-001" },
  { key:"enableKerberoastCheck",        label:"Kerberoastable Accounts",         type:"toggle",unit:"",         default:true, category:"Privilege",      finding:"AD-PRIV-002" },
  { key:"enableAsrepCheck",             label:"AS-REP Roasting",                 type:"toggle",unit:"",         default:true, category:"Privilege",      finding:"AD-PRIV-003" },
  { key:"enableAdminCountCheck",        label:"AdminCount Attribute",            type:"toggle",unit:"",         default:true, category:"Privilege",      finding:"AD-PRIV-004" },
  { key:"enableUnconstrainedDelegCheck",label:"Unconstrained Delegation",        type:"toggle",unit:"",         default:true, category:"Privilege",      finding:"AD-PRIV-005" },
  { key:"enableConstrainedDelegCheck",  label:"Constrained Delegation",          type:"toggle",unit:"",         default:true, category:"Privilege",      finding:"AD-PRIV-006" },
  { key:"kerbTicketMaxHours",           label:"Kerberos Ticket Lifetime",        type:"number",unit:"hours",    default:10,   category:"GPO",            finding:"AD-GPO-006" },
  { key:"enableLapsCheck",              label:"LAPS Deployment",                 type:"toggle",unit:"",         default:true, category:"GPO",            finding:"AD-GPO-004" },
  { key:"enableDomainReversibleEncCheck",label:"Domain Reversible Enc",          type:"toggle",unit:"",         default:true, category:"GPO",            finding:"AD-GPO-005" },
  { key:"enableAuditPolicyCheck",       label:"Audit Policy",                    type:"toggle",unit:"",         default:true, category:"GPO",            finding:"AD-GPO-007" },
  { key:"enableProtectedUsersCheck",    label:"Protected Users Group",           type:"toggle",unit:"",         default:true, category:"GPO",            finding:"AD-GPO-008" },
  { key:"enableFGPPCheck",              label:"Fine-Grained Password Policy",    type:"toggle",unit:"",         default:true, category:"GPO",            finding:"AD-GPO-009" },
  { key:"enableSidFilteringCheck",      label:"SID Filtering",                   type:"toggle",unit:"",         default:true, category:"Trust",          finding:"AD-TRUST-001" },
  { key:"enableBiDirTrustCheck",        label:"Bidirectional Trust",             type:"toggle",unit:"",         default:true, category:"Trust",          finding:"AD-TRUST-002" },
  { key:"enableOutdatedOsCheck",        label:"Outdated DC OS",                  type:"toggle",unit:"",         default:true, category:"Infrastructure", finding:"AD-DC-001" },
  { key:"krbtgtRotationDays",           label:"krbtgt Password Age",             type:"number",unit:"days",     default:180,  category:"Infrastructure", finding:"AD-DC-002" },
  { key:"enableRodcCheck",              label:"RODC Deployment",                 type:"toggle",unit:"",         default:false,category:"Infrastructure", finding:"AD-DC-003" },
  { key:"scanIntervalHours",            label:"Scan Interval",                   type:"number",unit:"hours",    default:6,    category:"Scan",           finding:null },
  { key:"retentionDays",                label:"Data Retention",                  type:"number",unit:"days",     default:365,  category:"Scan",           finding:null },
];

const BLANK_CONN = { name:"", domain:"", dc_ip:"", ldap_port:"389", bind_dn:"", bind_password:"", hr_status_url:"", hr_status_token:"", allow_self_signed:false };
const BLANK_USER = { name:"", email:"", password:"", role:"analyst" };

const DEFAULT_NOTIFICATIONS = {
  emailEnabled:    false,
  alertEmail:      "",
  slackEnabled:    false,
  slackWebhook:    "",
  webhookEnabled:  false,
  webhookUrl:      "",
  pagerDutyEnabled:false,
  pagerDutyRoutingKey:"",
  notifyCritical:  true,
  notifyHigh:      true,
  notifyMedium:    false,
  notifyReports:   true,
};

const DEFAULT_BRANDING = {
  portal_title:    "ADSentinel",
  portal_subtitle: "Enterprise Active Directory Security",
  primary_color:   "#22c55e",
};

const BASE_PARAM_VALUES = Object.fromEntries(PARAM_DEFINITIONS.map(p => [p.key, p.default]));
const CATEGORY_SUGGESTIONS = [
  "Password", "Account", "Privilege", "GPO", "Trust", "Infrastructure", "Scan", "Custom",
  "Domain Controllers", "Replication", "FSMO", "DNS", "Authentication", "Sysvol", "Sites & Links",
];

function parseAuditParams(raw) {
  try {
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      standard: { ...BASE_PARAM_VALUES, ...(parsed.standard || {}) },
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      exceptions: Array.isArray(parsed.exceptions) ? parsed.exceptions : [],
    };
  } catch {
    return null;
  }
}

export default function ConnectionManager({ logoUrl, refreshLogo, refreshBranding }) {
  const { user } = useAuth();
  const isAdmin  = user?.role === "admin";

  const [activeTab,    setActiveTab]    = useState("connections");
  const [conns,        setConns]        = useState([]);
  const [portalUsers,  setPortalUsers]  = useState([]);
  const [paramValues,  setParamValues]  = useState(BASE_PARAM_VALUES);
  const [customParams, setCustomParams] = useState([]);
  const [paramScope, setParamScope] = useState("global");
  const [globalAuditState, setGlobalAuditState] = useState(null);
  const [exceptionText, setExceptionText] = useState("");
  const [notifications,setNotifications]= useState(DEFAULT_NOTIFICATIONS);
  const [branding,     setBranding]     = useState(DEFAULT_BRANDING);
  const [connLoad,     setConnLoad]     = useState(true);

  const [addConnModal, setAddConnModal] = useState(false);
  const [editingConn,  setEditingConn]  = useState(null); // customer object being edited
  const [addUserModal, setAddUserModal] = useState(false);
  const [addParamModal,setAddParamModal]= useState(false);
  const [connForm,     setConnForm]     = useState(BLANK_CONN);
  const [userForm,     setUserForm]     = useState(BLANK_USER);
  const [userFormErr,  setUserFormErr]  = useState({});
  const [newParam,     setNewParam]     = useState({ key:"",label:"",type:"number",unit:"",default:"",category:"Custom",hint:"",finding:"" });
  const [testing,      setTesting]      = useState(false);
  const [testResult,   setTestResult]   = useState(null);
  const [hrTestResult, setHrTestResult] = useState(null);
  const [hrTesting,    setHrTesting]    = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [savedMsg,     setSavedMsg]     = useState("");
  const [scanningId,   setScanningId]   = useState(null);
  const [logoUploading,setLogoUploading]= useState(false);

  const showSaved = (msg="✅ Saved") => { setSavedMsg(msg); setTimeout(() => setSavedMsg(""), 3500); };

  // ── Load all settings on mount ─────────────────────────────────────
  useEffect(() => {
    customersApi.list().then(d=>setConns(Array.isArray(d)?d:[])).catch(()=>setConns([])).finally(()=>setConnLoad(false));
    if (isAdmin) usersApi.list().then(d=>setPortalUsers(Array.isArray(d)?d:[])).catch(()=>{});

    settingsApi.get().then(s => {
      if (!s) return;
      // Audit params
      if (s.audit_params) {
        try {
          const p = JSON.parse(s.audit_params);
          const nextStandard = p.standard ? { ...BASE_PARAM_VALUES, ...p.standard } : BASE_PARAM_VALUES;
          const nextCustom = p.custom || [];
          setParamValues(nextStandard);
          setCustomParams(nextCustom);
          setExceptionText((p.exceptions || []).join("\n"));
          setGlobalAuditState({ standard: nextStandard, custom: nextCustom, exceptions: p.exceptions || [] });
        } catch {}
      }
      // Notifications
      if (s.notifications) {
        try { setNotifications(n => ({ ...n, ...JSON.parse(s.notifications) })); } catch {}
      }
      setNotifications(n => ({
        ...n,
        alertEmail: s.alert_email || n.alertEmail,
        slackWebhook: s.slack_webhook || n.slackWebhook,
        webhookUrl: s.webhook_url || n.webhookUrl,
        pagerDutyRoutingKey: s.pagerduty_routing_key || n.pagerDutyRoutingKey,
      }));
      // Branding — individual keys from settings
      setBranding(b => ({
        ...b,
        portal_title:    s.portal_title    || b.portal_title,
        portal_subtitle: s.portal_subtitle || b.portal_subtitle,
        primary_color:   s.primary_color   || b.primary_color,
      }));
    }).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (paramScope === "global") {
      const globalCfg = globalAuditState || { standard: BASE_PARAM_VALUES, custom: [], exceptions: [] };
      setParamValues(globalCfg.standard || BASE_PARAM_VALUES);
      setCustomParams(globalCfg.custom || []);
      setExceptionText((globalCfg.exceptions || []).join("\n"));
      return;
    }

    const customer = conns.find(c => c.id === paramScope);
    const scopedCfg = parseAuditParams(customer?.audit_params) || { standard: BASE_PARAM_VALUES, custom: [], exceptions: [] };
    setParamValues(scopedCfg.standard || BASE_PARAM_VALUES);
    setCustomParams(scopedCfg.custom || []);
    setExceptionText((scopedCfg.exceptions || []).join("\n"));
  }, [paramScope, conns, globalAuditState]);

  const cf = k => e => setConnForm(p => ({ ...p, [k]: e.target.value }));
  const uf = k => e => setUserForm(p => ({ ...p, [k]: e.target.value }));

  const testConn = async () => {
    if (!connForm.dc_ip) {
      setTestResult({ ok: false, message: "DC IP address is required.", steps: [] });
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const result = await scanApi.testConnection({
        dc_ip:             connForm.dc_ip,
        ldap_port:         parseInt(connForm.ldap_port) || 389,
        bind_dn:           connForm.bind_dn,
        bind_password:     connForm.bind_password,
        domain:            connForm.domain,
        allow_self_signed: !!connForm.allow_self_signed,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: err.message || "Test failed", steps: [] });
    }
    setTesting(false);
  };

  const testHrUrl = async () => {
    if (!connForm.hr_status_url) return;
    setHrTesting(true); setHrTestResult(null);
    try {
      const { offboardingApi } = await import("../../utils/api");
      const r = await offboardingApi.testUrl({
        url:   connForm.hr_status_url,
        token: connForm.hr_status_token,
      });
      setHrTestResult(r);
    } catch (err) {
      setHrTestResult({ ok: false, message: err.message });
    }
    setHrTesting(false);
  };

  const saveConn = async () => {
    setSaving(true);
    try {
      const payload = {
        ...connForm,
        ldap_port: parseInt(connForm.ldap_port)||389,
        allow_self_signed: !!connForm.allow_self_signed,
      };
      if (editingConn) {
        // UPDATE existing — always send all credential fields
        const updated = await customersApi.update(editingConn.id, payload);
        setConns(p => p.map(x => x.id === editingConn.id ? updated : x));
        showSaved("✅ Connection updated");
      } else {
        // CREATE new
        const c = await customersApi.create(payload);
        setConns(p => [...p, c]);
        showSaved("✅ Connection added");
      }
      setAddConnModal(false); setEditingConn(null); setConnForm(BLANK_CONN); setTestResult(null); setHrTestResult(null);
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const openEditConn = (c) => {
    setEditingConn(c);
    setConnForm({
      name:             c.name             || "",
      domain:           c.domain           || "",
      dc_ip:            c.dc_ip            || "",
      ldap_port:        String(c.ldap_port||389),
      bind_dn:          c.bind_dn          || "",
      bind_password:    "",  // never pre-fill password
      hr_status_url:    c.hr_status_url    || "",
      hr_status_token:  c.hr_status_token  || "",
      allow_self_signed: !!c.allow_self_signed,
    });
    setTestResult(null);
    setAddConnModal(true);
  };

  const triggerScan = async (customerId) => {
    setScanningId(customerId);
    try { await scanApi.trigger(customerId); showSaved("✅ Scan triggered"); }
    catch (err) { alert(err.message); }
    setScanningId(null);
  };

  const saveUser = async () => {
    const errs = {};
    if (!userForm.name)     errs.name     = "Required";
    if (!userForm.email)    errs.email    = "Required";
    if (!userForm.password) errs.password = "Required";
    if (Object.keys(errs).length) { setUserFormErr(errs); return; }
    setSaving(true);
    try {
      const u = await usersApi.create(userForm);
      setPortalUsers(p => [...p, u]);
      setAddUserModal(false); setUserForm(BLANK_USER); setUserFormErr({});
      showSaved("✅ User created");
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const saveParams = async () => {
    setSaving(true);
    try {
      const payload = {
        standard: paramValues,
        custom: customParams,
        exceptions: exceptionText.split(/\\r?\\n/).map(x => x.trim()).filter(Boolean),
      };

      if (paramScope === "global") {
        await settingsApi.save({ audit_params: JSON.stringify(payload) });
        setGlobalAuditState(payload);
      } else {
        const updated = await customersApi.update(paramScope, { audit_params: payload });
        setConns(list => list.map(c => c.id === updated.id ? updated : c));
        setParamScope(updated.id);
      }

      showSaved("✅ Audit parameters saved");
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const saveNotifications = async () => {
    setSaving(true);
    try {
      await settingsApi.save({
        notifications: JSON.stringify(notifications),
        alert_email: notifications.emailEnabled ? notifications.alertEmail : "",
        slack_webhook: notifications.slackEnabled ? notifications.slackWebhook : "",
        webhook_url: notifications.webhookEnabled ? notifications.webhookUrl : "",
        pagerduty_routing_key: notifications.pagerDutyEnabled ? notifications.pagerDutyRoutingKey : "",
      });
      showSaved("✅ Notification settings saved");
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const saveBranding = async () => {
    setSaving(true);
    try {
      // Save each branding key individually so the backend upserts them
      await settingsApi.save({
        portal_title:    branding.portal_title,
        portal_subtitle: branding.portal_subtitle,
        primary_color:   branding.primary_color,
      });
      if (refreshBranding) await refreshBranding();
      showSaved("✅ Branding saved");
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const r = await logoApi.upload(file);
      if (refreshLogo) refreshLogo(r.logoUrl);
      showSaved("✅ Logo updated");
    } catch (err) {
      alert(err.message || "Logo upload failed");
    } finally {
      setLogoUploading(false);
      e.target.value = "";
    }
  };

  const toggleUser = async (id, is_active) => {
    try {
      await usersApi.toggle(id, { is_active });
      setPortalUsers(p => p.map(u => u.id===id ? {...u,is_active} : u));
    } catch {}
  };

  const addCustomParam = () => {
    if (!newParam.key || !newParam.label) return;
    const def = newParam.type==="toggle" ? false : Number(newParam.default)||0;
    setCustomParams(p => [...p, {...newParam,default:def}]);
    setParamValues(p => ({ ...p, [newParam.key]: def }));
    setNewParam({ key:"",label:"",type:"number",unit:"",default:"",category:"Custom",hint:"",finding:"" });
    setAddParamModal(false);
  };

  const allParams  = [...PARAM_DEFINITIONS, ...customParams.map(p => ({...p,custom:true}))];
  const allCats    = [...new Set(allParams.map(p => p.category))];

  const TABS = [
    { id:"connections",  label:"🔌 AD Connections"      },
    { id:"params",       label:"⚙️ Audit Parameters"    },
    { id:"users",        label:"👥 Portal Users"         },
    { id:"branding",     label:"🎨 Branding"             },
    { id:"notifications",label:"🔔 Notifications"        },
  ].filter(t => t.id!=="users" || isAdmin);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:700 }}>Settings</h1>
          <div style={{ fontSize:12, color:T.colors.muted, marginTop:2 }}>Manage AD connections, audit parameters, users, and portal configuration</div>
        </div>
        {savedMsg && <span style={{ fontSize:13, color:T.colors.ok }}>{savedMsg}</span>}
      </div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:4, borderRadius:8, border:`1px solid ${T.colors.border}`, flexWrap:"wrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            flex:1, minWidth:120, padding:"9px 8px", borderRadius:6, cursor:"pointer", fontSize:11,
            fontWeight:activeTab===t.id?700:400, fontFamily:T.fonts.sans,
            background:activeTab===t.id?T.colors.card:"transparent",
            border:activeTab===t.id?`1px solid ${T.colors.border}`:"1px solid transparent",
            color:activeTab===t.id?T.colors.text:T.colors.muted,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─── AD Connections ─── */}
      {activeTab==="connections" && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>AD Domain Connections</div>
              <div style={{ fontSize:11, color:T.colors.muted, marginTop:3 }}>Manage LDAP/LDAPS connections to Active Directory domains</div>
            </div>
            {isAdmin && <Btn onClick={() => { setEditingConn(null); setConnForm(BLANK_CONN); setAddConnModal(true); }}>+ Add Domain</Btn>}
          </div>
          {connLoad ? (
            <div style={{ fontSize:12, color:T.colors.muted }}>Loading…</div>
          ) : conns.length===0 ? (
            <div style={{ background:T.colors.card, border:`2px dashed ${T.colors.border}`, borderRadius:8, padding:"50px 20px", textAlign:"center" }}>
              <div style={{ fontSize:36, marginBottom:12 }}>🔌</div>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>No AD domains configured</div>
              <div style={{ fontSize:12, color:T.colors.muted, marginBottom:20 }}>Add your first Active Directory domain to start auditing.</div>
              {isAdmin && <Btn onClick={() => { setEditingConn(null); setConnForm(BLANK_CONN); setAddConnModal(true); }}>+ Add First Domain</Btn>}
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {conns.map(c => (
                <div key={c.id} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:c.is_active?T.colors.ok:T.colors.muted, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:13 }}>{c.name}</div>
                    <div style={{ fontSize:11, color:T.colors.muted, fontFamily:T.fonts.mono }}>
                      {c.domain} · {c.dc_ip
                        ? <span style={{ color: T.colors.ok }}>{c.dc_ip}:{c.ldap_port||389}</span>
                        : <span style={{ color:"#ef4444" }}>⚠ DC IP not configured — click ✏ Edit</span>
                      }
                    </div>
                    <div style={{ fontSize:10, color:T.colors.dim, marginTop:1, fontFamily:T.fonts.mono }}>
                      Bind: {c.bind_dn
                        ? <span style={{ color: T.colors.ok }}>{c.bind_dn}</span>
                        : <span style={{ color:"#f59e0b" }}>anonymous (no bind DN set)</span>
                      }
                    </div>
                    {c.last_scan && <div style={{ fontSize:10, color:T.colors.dim, marginTop:2 }}>Last scan: {new Date(c.last_scan).toLocaleString()}</div>}
                    <div style={{ fontSize:10, color:T.colors.dim, marginTop:1, fontFamily:T.fonts.mono }}>
                      HR: {c.hr_status_url
                        ? <span style={{ color:T.colors.ok }}>✅ Status API configured</span>
                        : <span style={{ color:T.colors.dim }}>not configured (optional)</span>
                      }
                    </div>
                  </div>
                  <Btn variant="secondary" size="sm" disabled={scanningId===c.id} onClick={() => triggerScan(c.id)}>
                    {scanningId===c.id?"⟳ Scanning…":"⟳ Scan Now"}
                  </Btn>
                  {isAdmin && (
                    <Btn variant="secondary" size="sm" onClick={() => openEditConn(c)}>✏ Edit</Btn>
                  )}
                  {isAdmin && (
                    <Btn variant="danger" size="sm" onClick={async()=>{
                      if(!window.confirm("Remove this connection?"))return;
                      await customersApi.remove(c.id).catch(()=>{});
                      setConns(p=>p.filter(x=>x.id!==c.id));
                    }}>Remove</Btn>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Audit Parameters ─── */}
      {activeTab==="params" && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>Audit Parameters</div>
              <div style={{ fontSize:11, color:T.colors.muted, marginTop:4 }}>
                Configure global or per-customer AD parameters. Every parameter maps 1:1 to a finding in the library.
                {!isAdmin && <span style={{ color:T.colors.warn }}> · Read-only (admin only)</span>}
              </div>
              <div style={{ marginTop:10, display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontSize:11, color:T.colors.muted }}>Scope:</span>
                <select value={paramScope} onChange={e => setParamScope(e.target.value)}
                  style={{ background:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:6, color:T.colors.text, padding:"6px 10px", fontSize:12 }}>
                  <option value="global">Global (all customers)</option>
                  {conns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              {isAdmin && <Btn variant="secondary" size="sm" onClick={() => setAddParamModal(true)}>+ Add Parameter</Btn>}
              {isAdmin && <Btn onClick={saveParams} disabled={saving}>{saving?"Saving…":"Save All"}</Btn>}
            </div>
          </div>
          {allCats.map(cat => {
            const cp = allParams.filter(p => p.category===cat);
            return (
              <div key={cat} style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
                <div style={{ padding:"10px 16px", background:T.colors.surface, borderBottom:`1px solid ${T.colors.border}`, display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:T.colors.muted }}>{cat.toUpperCase()}</span>
                  <span style={{ fontSize:10, color:T.colors.dim }}>{cp.length} param{cp.length!==1?"s":""}</span>
                </div>
                <div style={{ padding:"8px 16px" }}>
                  {cp.map((p, pi) => (
                    <div key={p.key} style={{ display:"flex", alignItems:"center", gap:16, padding:"9px 0", borderBottom:pi<cp.length-1?`1px solid ${T.colors.border}22`:"none" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <span style={{ fontSize:12, fontWeight:600, color:p.custom?T.colors.purple:T.colors.text }}>{p.label}</span>
                          {p.finding && <span style={{ fontSize:9, fontFamily:T.fonts.mono, color:T.colors.dim }}>{p.finding}</span>}
                          {p.custom  && <span style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:3, background:"rgba(167,139,250,0.15)", color:T.colors.purple }}>CUSTOM</span>}
                        </div>
                        {p.hint && <div style={{ fontSize:10, color:T.colors.dim, marginTop:2 }}>{p.hint}</div>}
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                        {p.type==="toggle"
                          ? <MiniToggle value={!!paramValues[p.key]} disabled={!isAdmin} onChange={v => setParamValues(x=>({...x,[p.key]:v}))} />
                          : <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              <input type="number" value={paramValues[p.key]??p.default} disabled={!isAdmin}
                                onChange={e => setParamValues(x=>({...x,[p.key]:Number(e.target.value)}))}
                                style={{ width:80, textAlign:"right", background:isAdmin?T.colors.bg:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:4, color:T.colors.text, padding:"5px 8px", fontSize:12, fontFamily:T.fonts.mono }} />
                              <span style={{ fontSize:11, color:T.colors.muted, minWidth:50 }}>{p.unit}</span>
                            </div>
                        }
                        {isAdmin && p.custom && (
                          <button onClick={() => { setCustomParams(x=>x.filter(c=>c.key!==p.key)); setParamValues(x=>{const n={...x};delete n[p.key];return n;}); }}
                            style={{ background:"none", border:"none", color:T.colors.danger, cursor:"pointer", fontSize:14 }}>✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:14, maxWidth:700 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:6 }}>Exception Accounts</div>
            <div style={{ fontSize:11, color:T.colors.muted, marginBottom:8 }}>
              One account/computer name per line. These will be excluded from findings and reports for the selected scope.
            </div>
            <textarea
              value={exceptionText}
              disabled={!isAdmin}
              onChange={e => setExceptionText(e.target.value)}
              placeholder={"svc_backup\nsvc_sql\nDC01$"}
              style={{ width:"100%", minHeight:100, background:T.colors.surface, color:T.colors.text, border:`1px solid ${T.colors.border}`, borderRadius:6, padding:10, fontFamily:T.fonts.mono, fontSize:11 }}
            />
          </div>
        </div>
      )}

      {/* ─── Portal Users ─── */}
      {activeTab==="users" && isAdmin && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:13, fontWeight:700 }}>Portal Users</div>
              <div style={{ fontSize:11, color:T.colors.muted, marginTop:3 }}>Manage who can access ADSentinel and their permissions</div>
            </div>
            <Btn onClick={() => setAddUserModal(true)}>+ Add User</Btn>
          </div>
          <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:T.colors.surface }}>
                  {["Name","Email","Role","Status","Actions"].map(h => (
                    <th key={h} style={{ padding:"8px 14px", textAlign:"left", fontSize:10, color:T.colors.muted, fontWeight:700, borderBottom:`1px solid ${T.colors.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {portalUsers.map((u,i) => (
                  <tr key={u.id} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent" }}>
                    <td style={{ padding:"10px 14px", fontWeight:600 }}>{u.name}</td>
                    <td style={{ padding:"10px 14px", color:T.colors.muted, fontFamily:T.fonts.mono, fontSize:11 }}>{u.email}</td>
                    <td style={{ padding:"10px 14px" }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, fontFamily:T.fonts.mono,
                        background:u.role==="admin"?"rgba(239,68,68,0.12)":u.role==="engineer"?"rgba(14,165,233,0.12)":"rgba(167,139,250,0.12)",
                        color:u.role==="admin"?T.colors.danger:u.role==="engineer"?T.colors.accent:T.colors.purple,
                      }}>{u.role.toUpperCase()}</span>
                    </td>
                    <td style={{ padding:"10px 14px" }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3,
                        background:u.is_active?"rgba(34,197,94,0.12)":"rgba(100,116,139,0.12)",
                        color:u.is_active?T.colors.ok:T.colors.muted }}>
                        {u.is_active?"ACTIVE":"DISABLED"}
                      </span>
                    </td>
                    <td style={{ padding:"10px 14px" }}>
                      <div style={{ display:"flex", gap:6 }}>
                        <Btn variant="secondary" size="sm" onClick={() => toggleUser(u.id, !u.is_active)}>
                          {u.is_active?"Disable":"Enable"}
                        </Btn>
                        <Btn variant="danger" size="sm" onClick={async()=>{
                          if(!window.confirm("Remove user?"))return;
                          await usersApi.remove(u.id).catch(()=>{});
                          setPortalUsers(p=>p.filter(x=>x.id!==u.id));
                        }}>Remove</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ background:"rgba(14,165,233,0.06)", border:`1px solid ${T.colors.accent}33`, borderRadius:6, padding:"10px 14px", fontSize:11, color:T.colors.muted }}>
            <strong>Roles:</strong> <span style={{ color:T.colors.danger }}>Admin</span> — full access &nbsp;·&nbsp;
            <span style={{ color:T.colors.accent }}>Engineer</span> — scan + manage connections &nbsp;·&nbsp;
            <span style={{ color:T.colors.purple }}>Analyst</span> — read-only view
          </div>
        </div>
      )}

      {/* ─── Branding ─── */}
      {activeTab==="branding" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700 }}>Portal Branding</div>
            <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>Customize the portal title, colors, and logo</div>
          </div>

          {/* Logo upload */}
          <div style={{ background:"linear-gradient(180deg, rgba(34,197,94,0.08), rgba(20,28,53,1))", border:`1px solid ${T.colors.ok}55`, borderRadius:8, padding:20, maxWidth:520 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:14 }}>Portal Logo</div>
            <div style={{ background:T.colors.surface, border:`2px dashed ${T.colors.ok}66`, borderRadius:8, padding:24, minHeight:130, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center", marginBottom:14 }}>
              {logoUrl
                ? <img src={logoUrl} alt="Logo" style={{ maxHeight:72, maxWidth:280, objectFit:"contain", filter:"drop-shadow(0 0 10px rgba(34,197,94,0.22))" }} />
                : <div style={{ color:"#94a3b8", fontSize:13 }}><div style={{ fontSize:32, marginBottom:8 }}>🖼️</div>No logo uploaded</div>}
            </div>
            {isAdmin && (
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <label>
                  <Btn variant="secondary">{logoUploading?"Uploading…":"⬆ Upload Logo"}</Btn>
                  <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" style={{ display:"none" }} onChange={uploadLogo} />
                </label>
                {logoUrl && <Btn variant="danger" onClick={async () => { await logoApi.remove().catch(() => {}); if (refreshLogo) refreshLogo(null); showSaved("✅ Logo removed"); }}>Remove</Btn>}
              </div>
            )}
            <div style={{ marginTop:10, fontSize:11, color:T.colors.muted }}>PNG, JPG, SVG, WebP · Max 2MB · Transparent background recommended</div>
          </div>

          {/* Portal title + subtitle */}
          <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:20, maxWidth:480 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:14 }}>Portal Identity</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <Input label="Portal Title" value={branding.portal_title} disabled={!isAdmin}
                onChange={e => setBranding(b=>({...b,portal_title:e.target.value}))}
                placeholder="ADSentinel" />
              <Input label="Portal Subtitle" value={branding.portal_subtitle} disabled={!isAdmin}
                onChange={e => setBranding(b=>({...b,portal_subtitle:e.target.value}))}
                placeholder="Enterprise Active Directory Security" />
            </div>
          </div>

          {/* Color picker */}
          <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:20, maxWidth:480 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:14 }}>Primary Accent Color</div>
            <div style={{ display:"flex", alignItems:"center", gap:16 }}>
              <input type="color" value={branding.primary_color} disabled={!isAdmin}
                onChange={e => {
                  const c = e.target.value;
                  setBranding(b=>({...b,primary_color:c}));
                  // Live preview — apply immediately so user sees effect
                  document.documentElement.style.setProperty("--ads-accent", c);
                  document.documentElement.style.setProperty("--ads-accent-gl", c + "22");
                }}
                style={{ width:52, height:40, borderRadius:6, border:`1px solid ${T.colors.border}`, cursor:isAdmin?"pointer":"default", background:"none" }} />
              <div style={{ fontSize:13, fontFamily:T.fonts.mono, color:T.colors.text }}>{branding.primary_color}</div>
              <div style={{ fontSize:11, color:T.colors.muted }}>Used for accent, links, and chart colors</div>
            </div>
            {/* Preset swatches */}
            <div style={{ display:"flex", gap:10, marginTop:14, flexWrap:"wrap" }}>
              {["#0ea5e9","#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6"].map(c => (
                <div key={c} onClick={() => {
                    if (!isAdmin) return;
                    setBranding(b=>({...b,primary_color:c}));
                    document.documentElement.style.setProperty("--ads-accent", c);
                    document.documentElement.style.setProperty("--ads-accent-gl", c + "22");
                  }}
                  style={{ width:28, height:28, borderRadius:6, background:c, cursor:isAdmin?"pointer":"default",
                    border:branding.primary_color===c?"2px solid white":"2px solid transparent", transition:"transform 0.1s" }}
                  onMouseEnter={e => isAdmin && (e.currentTarget.style.transform="scale(1.15)")}
                  onMouseLeave={e => e.currentTarget.style.transform="scale(1)"} />
              ))}
            </div>
          </div>

          {isAdmin && (
            <div style={{ display:"flex", gap:12 }}>
              <Btn onClick={saveBranding} disabled={saving}>{saving?"Saving…":"Save Branding"}</Btn>
              <Btn variant="ghost" onClick={() => setBranding(DEFAULT_BRANDING)}>Reset Defaults</Btn>
            </div>
          )}
        </div>
      )}

      {/* ─── Notifications ─── */}
      {activeTab==="notifications" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700 }}>Notification Settings</div>
            <div style={{ fontSize:11, color:T.colors.muted, marginTop:3 }}>Configure email and Slack alerts for security findings</div>
          </div>

          <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:20, display:"flex", flexDirection:"column", gap:16, maxWidth:560 }}>
            <div style={{ fontSize:12, fontWeight:700 }}>Email Notifications</div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:12 }}>Enable email notifications</span>
              <MiniToggle value={notifications.emailEnabled} disabled={!isAdmin} onChange={v=>setNotifications(n=>({...n,emailEnabled:v}))} />
            </div>
            {notifications.emailEnabled && (
              <Input label="Alert Email Address" placeholder="security@company.com"
                value={notifications.alertEmail} disabled={!isAdmin}
                onChange={e=>setNotifications(n=>({...n,alertEmail:e.target.value}))} />
            )}

            <div style={{ borderTop:`1px solid ${T.colors.border}`, paddingTop:16, fontSize:12, fontWeight:700 }}>Slack Notifications</div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:12 }}>Enable Slack webhook</span>
              <MiniToggle value={notifications.slackEnabled} disabled={!isAdmin} onChange={v=>setNotifications(n=>({...n,slackEnabled:v}))} />
            </div>
            {notifications.slackEnabled && (
              <Input label="Slack Webhook URL" placeholder="https://hooks.slack.com/services/…"
                value={notifications.slackWebhook} disabled={!isAdmin}
                onChange={e=>setNotifications(n=>({...n,slackWebhook:e.target.value}))} />
            )}

            <div style={{ borderTop:`1px solid ${T.colors.border}`, paddingTop:16, fontSize:12, fontWeight:700 }}>Webhook Notifications</div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:12 }}>Enable generic webhook</span>
              <MiniToggle value={notifications.webhookEnabled} disabled={!isAdmin} onChange={v=>setNotifications(n=>({...n,webhookEnabled:v}))} />
            </div>
            {notifications.webhookEnabled && (
              <Input label="Webhook URL" placeholder="https://ops.company.com/hooks/adsentinel"
                value={notifications.webhookUrl} disabled={!isAdmin}
                onChange={e=>setNotifications(n=>({...n,webhookUrl:e.target.value}))} />
            )}

            <div style={{ borderTop:`1px solid ${T.colors.border}`, paddingTop:16, fontSize:12, fontWeight:700 }}>PagerDuty Notifications</div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:12 }}>Enable PagerDuty Events API v2</span>
              <MiniToggle value={notifications.pagerDutyEnabled} disabled={!isAdmin} onChange={v=>setNotifications(n=>({...n,pagerDutyEnabled:v}))} />
            </div>
            {notifications.pagerDutyEnabled && (
              <Input label="PagerDuty Routing Key" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={notifications.pagerDutyRoutingKey} disabled={!isAdmin}
                onChange={e=>setNotifications(n=>({...n,pagerDutyRoutingKey:e.target.value}))} />
            )}

            <div style={{ borderTop:`1px solid ${T.colors.border}`, paddingTop:16, fontSize:12, fontWeight:700 }}>Alert Thresholds</div>
            {[
              { key:"notifyCritical", label:"Notify on Critical findings" },
              { key:"notifyHigh",     label:"Notify on High findings" },
              { key:"notifyMedium",   label:"Notify on Medium findings" },
              { key:"notifyReports",  label:"Notify when reports are generated" },
            ].map(({ key, label }) => (
              <div key={key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:12, color:T.colors.text }}>{label}</span>
                <MiniToggle value={!!notifications[key]} disabled={!isAdmin} onChange={v=>setNotifications(n=>({...n,[key]:v}))} />
              </div>
            ))}
          </div>

          {isAdmin && <Btn onClick={saveNotifications} disabled={saving} style={{ alignSelf:"flex-start" }}>{saving?"Saving…":"Save Notifications"}</Btn>}
        </div>
      )}

      {/* ─── Add Connection Modal ─── */}
      <Modal isOpen={addConnModal} onClose={() => { setAddConnModal(false); setEditingConn(null); setConnForm(BLANK_CONN); setTestResult(null); setHrTestResult(null); }} title={editingConn ? `✏ Edit — ${editingConn.name}` : "+ Add AD Domain"} width={560}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Customer Name *" placeholder="Acme Corp"     value={connForm.name}      onChange={cf("name")}         />
            <Input label="Domain *"        placeholder="acme.local"     value={connForm.domain}    onChange={cf("domain")}       />
            <Input label="DC IP *"         placeholder="192.168.1.10"   value={connForm.dc_ip}     onChange={cf("dc_ip")}        />
            <Input label="LDAP Port"       placeholder="389 / 636"      value={connForm.ldap_port} onChange={cf("ldap_port")}    />
            <div style={{ gridColumn:"1/-1" }}>
              <Input label="Bind DN" placeholder="CN=svc-audit,CN=Users,DC=acme,DC=local" value={connForm.bind_dn} onChange={cf("bind_dn")} />
              <div style={{ fontSize:10, color:T.colors.muted, marginTop:-10, marginBottom:4 }}>
                Format: <span style={{ fontFamily:"monospace", color:T.colors.dim }}>CN=username,CN=Users,DC=domain,DC=local</span>
                &nbsp;— the <span style={{ fontFamily:"monospace", color:T.colors.dim }}>CN=Users</span> container is required for most accounts
              </div>
            </div>
            <div style={{ gridColumn:"1/-1" }}>
              <Input label="Bind Password" type="password" placeholder="••••••••" value={connForm.bind_password} onChange={cf("bind_password")} />
            </div>
            <div style={{ gridColumn:"1/-1" }}>
              <label style={{ display:"flex", gap:8, alignItems:"center", fontSize:12, color:T.colors.muted, cursor:"pointer" }}>
                <input
                  type="checkbox"
                  checked={!!connForm.allow_self_signed}
                  onChange={e => setConnForm(prev => ({ ...prev, allow_self_signed: e.target.checked }))}
                />
                Trust self-signed TLS certificates (LDAPS only)
              </label>
            </div>
          </div>

          {/* ── HR Integration (optional) ── */}
          <div style={{ borderTop:`1px solid ${T.colors.border}`, paddingTop:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:T.colors.muted, marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
              <span>👥 HR STATUS INTEGRATION</span>
              <span style={{ fontSize:9, background:"rgba(14,165,233,0.1)", color:T.colors.accent, padding:"1px 6px", borderRadius:3, border:`1px solid ${T.colors.accent}44` }}>OPTIONAL</span>
            </div>
            <div style={{ fontSize:11, color:T.colors.muted, marginBottom:12, lineHeight:1.7 }}>
              Provide an API URL that returns employee HR status. Your team implements this endpoint — the portal will fetch it to identify terminated employees whose AD accounts are still active.
              <br/>
              <span style={{ color:T.colors.dim, fontSize:10 }}>Expected response: <code style={{color:T.colors.accent}}>{"{ employees: [{ email, status, name }] }"}</code></span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <Input label="HR Status API URL" placeholder="https://hr.company.com/api/employees/status"
                value={connForm.hr_status_url} onChange={cf("hr_status_url")} />
              <Input label="Bearer Token (if required)" type="password" placeholder="Leave empty if no auth needed"
                value={connForm.hr_status_token} onChange={cf("hr_status_token")} />
              {connForm.hr_status_url && (
                <Btn variant="secondary" onClick={testHrUrl} disabled={hrTesting} style={{alignSelf:"flex-start"}}>
                  {hrTesting ? "Testing…" : "🔗 Test HR API"}
                </Btn>
              )}
              {hrTestResult && (
                <div style={{ padding:"10px 14px", borderRadius:6, fontSize:11,
                  background:hrTestResult.ok?"rgba(34,197,94,0.08)":"rgba(239,68,68,0.08)",
                  border:`1px solid ${hrTestResult.ok?"#22c55e":"#ef4444"}44`,
                  color:hrTestResult.ok?"#22c55e":"#ef4444" }}>
                  <div style={{ fontWeight:700 }}>{hrTestResult.ok?"✅":"❌"} {hrTestResult.message}</div>
                  {hrTestResult.ok && hrTestResult.employee_count !== undefined && (
                    <div style={{ color:T.colors.muted, marginTop:4 }}>
                      {hrTestResult.employee_count} employees in response
                      {hrTestResult.sample?.map(s => (
                        <span key={s.email} style={{ fontFamily:"monospace", marginLeft:8, fontSize:10 }}>
                          {s.email} → {s.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {testResult && (
            <div style={{ background:testResult.ok?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)", border:`1px solid ${testResult.ok?T.colors.ok:"#ef4444"}44`, borderRadius:6, padding:"12px 14px", fontSize:12 }}>
              <div style={{ fontWeight:700, color:testResult.ok?T.colors.ok:"#ef4444", marginBottom: testResult.steps?.length ? 8 : 0 }}>
                {testResult.ok ? "✅" : "❌"} {testResult.message}
              </div>
              {testResult.steps?.length > 0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:3, borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:8 }}>
                  {testResult.steps.map((s,i) => (
                    <div key={i} style={{ fontSize:11, color:"rgba(255,255,255,0.75)", fontFamily:"monospace" }}>{s}</div>
                  ))}
                </div>
              )}
              {testResult.hint && (
                <div style={{ marginTop:8, fontSize:11, color:"#f59e0b", borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:8 }}>
                  💡 {testResult.hint}
                </div>
              )}
            </div>
          )}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={() => { setAddConnModal(false); setEditingConn(null); setConnForm(BLANK_CONN); setTestResult(null); setHrTestResult(null); }}>Cancel</Btn>
            <Btn variant="secondary" onClick={testConn} disabled={testing}>{testing?"Testing…":"Test Connection"}</Btn>
            <Btn onClick={saveConn} disabled={saving||!connForm.name||!connForm.domain}>{saving ? "Saving…" : editingConn ? "Update Connection" : "Save & Connect"}</Btn>
          </div>
        </div>
      </Modal>

      {/* ─── Add User Modal ─── */}
      <Modal isOpen={addUserModal} onClose={() => { setAddUserModal(false); setUserForm(BLANK_USER); setUserFormErr({}); }} title="+ Add Portal User" width={480}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="Full Name *"    placeholder="Jane Smith"          value={userForm.name}     onChange={uf("name")}     error={userFormErr.name} />
          <Input label="Email *"        placeholder="jane@company.com"    value={userForm.email}    onChange={uf("email")}    error={userFormErr.email} />
          <Input label="Password *"     type="password" placeholder="••••••••" value={userForm.password} onChange={uf("password")} error={userFormErr.password} />
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:T.colors.muted, display:"block", marginBottom:6 }}>ROLE</label>
            <select value={userForm.role} onChange={uf("role")}
              style={{ width:"100%", background:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:6, color:T.colors.text, padding:"9px 12px", fontSize:13 }}>
              <option value="analyst">Analyst — read-only view</option>
              <option value="engineer">Engineer — scan + manage connections</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={() => { setAddUserModal(false); setUserForm(BLANK_USER); setUserFormErr({}); }}>Cancel</Btn>
            <Btn onClick={saveUser} disabled={saving}>{saving?"Creating…":"Create User"}</Btn>
          </div>
        </div>
      </Modal>

      {/* ─── Add Custom Parameter Modal ─── */}
      <Modal isOpen={addParamModal} onClose={() => setAddParamModal(false)} title="+ Add Custom Parameter" width={480}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Key *" placeholder="myCheck" value={newParam.key} onChange={e=>setNewParam(p=>({...p,key:e.target.value.replace(/\s/g,"")}))} />
            <Input label="Label *" placeholder="My Check" value={newParam.label} onChange={e=>setNewParam(p=>({...p,label:e.target.value}))} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:T.colors.muted, display:"block", marginBottom:6 }}>TYPE</label>
              <select value={newParam.type} onChange={e=>setNewParam(p=>({...p,type:e.target.value}))}
                style={{ width:"100%", background:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:6, color:T.colors.text, padding:"9px 12px", fontSize:13 }}>
                <option value="number">Number (threshold)</option>
                <option value="toggle">Toggle (on/off)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:T.colors.muted, display:"block", marginBottom:6 }}>CATEGORY</label>
              <input value={newParam.category} list="param-category-options" onChange={e=>setNewParam(p=>({...p,category:e.target.value}))}
                style={{ width:"100%", background:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:6, color:T.colors.text, padding:"9px 12px", fontSize:13 }} />
              <datalist id="param-category-options">
                {[...new Set([...CATEGORY_SUGGESTIONS, ...PARAM_DEFINITIONS.map(p => p.category)])].map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Default Value" placeholder="30" value={newParam.default} onChange={e=>setNewParam(p=>({...p,default:e.target.value}))} />
            <Input label="Unit" placeholder="days / accounts" value={newParam.unit} onChange={e=>setNewParam(p=>({...p,unit:e.target.value}))} />
          </div>
          <Input label="Description" placeholder="What does this control?" value={newParam.hint} onChange={e=>setNewParam(p=>({...p,hint:e.target.value}))} />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={() => setAddParamModal(false)}>Cancel</Btn>
            <Btn onClick={addCustomParam} disabled={!newParam.key||!newParam.label}>Add Parameter</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MiniToggle({ value, onChange, disabled }) {
  return (
    <div onClick={() => { if (!disabled && onChange) onChange(!value); }}
      style={{ width:38, height:21, borderRadius:11, background:value?T.colors.accent:T.colors.dim,
        cursor:disabled?"not-allowed":"pointer", position:"relative", transition:"background 0.2s",
        opacity:disabled?0.5:1, flexShrink:0 }}>
      <div style={{ position:"absolute", top:2.5, left:value?19:2.5, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s" }} />
    </div>
  );
}
