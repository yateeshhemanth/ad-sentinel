import { useState, useEffect, useCallback } from "react";
import { THEME as T } from "../../constants/theme";
import { Btn } from "../shared";
import { offboardingApi, customersApi } from "../../utils/api";

const FLAG_CONFIG = {
  flagged:   { color:"#ef4444", bg:"rgba(239,68,68,0.1)",  label:"⚠ Active — needs action",   tip:"Terminated in HR but AD account is still enabled. IT team should disable this account." },
  resolved:  { color:"#22c55e", bg:"rgba(34,197,94,0.1)",  label:"✅ AD Disabled",             tip:"Terminated in HR and AD account is already disabled." },
  not_in_ad: { color:"#f59e0b", bg:"rgba(245,158,11,0.1)", label:"❓ Not found in AD",         tip:"Terminated in HR but no matching AD account found. May have already been removed, or the name/email doesn't match." },
  ok:        { color:T.colors.muted, bg:"transparent",     label:"Active",                     tip:"Currently active employee." },
};

function StatCard({ label, value, color, onClick, active }) {
  return (
    <div onClick={onClick} style={{
      background: T.colors.card,
      border: `1px solid ${active ? color : T.colors.border}`,
      borderTop: `2px solid ${color}`,
      borderRadius: 8, padding:"12px 16px",
      cursor: onClick ? "pointer" : "default",
      transition:"border-color 0.15s",
    }}>
      <div style={{ fontSize:9, fontWeight:700, color:T.colors.muted, marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:700, color, fontFamily:T.fonts.mono }}>{value}</div>
    </div>
  );
}

export default function OffboardingPanel() {
  const [customers,   setCustomers]   = useState([]);
  const [selectedId,  setSelectedId]  = useState("");
  const [overview,    setOverview]    = useState([]);
  const [syncResult,  setSyncResult]  = useState(null);
  const [xref,        setXref]        = useState(null);
  const [syncing,     setSyncing]     = useState(false);
  const [xrefLoading, setXrefLoading] = useState(false);
  const [search,      setSearch]      = useState("");
  const [filter,      setFilter]      = useState("all");
  const [tab,         setTab]         = useState("overview");

  useEffect(() => {
    customersApi.list().then(setCustomers).catch(() => {});
    offboardingApi.overview().then(setOverview).catch(() => {});
  }, []);

  const selectedCustomer = customers.find(c => c.id === selectedId);

  const loadCrossRef = useCallback(async (cid) => {
    if (!cid) return;
    setXrefLoading(true); setXref(null);
    try { setXref(await offboardingApi.crossReference(cid)); }
    catch (err) { setXref({ error: err.message }); }
    setXrefLoading(false);
  }, []);

  const handleCustomerSelect = (id) => {
    setSelectedId(id);
    setSyncResult(null);
    setSearch(""); setFilter("all");
    setTab("records");
    if (id) loadCrossRef(id);
  };

  const doSync = async () => {
    if (!selectedId) return;
    setSyncing(true); setSyncResult(null);
    try {
      const r = await offboardingApi.sync(selectedId);
      setSyncResult({ ok:true, ...r });
      // Reload cross-reference after sync
      await loadCrossRef(selectedId);
      // Refresh overview
      offboardingApi.overview().then(setOverview).catch(() => {});
    } catch (err) {
      setSyncResult({ ok:false, message: err.message, hint: err.hint });
    }
    setSyncing(false);
  };

  // Filtered records
  const allRecords = xref?.records || [];
  const terminated = allRecords.filter(r => r.is_terminated);
  const shown = allRecords.filter(r => {
    if (filter === "flagged"   && r.flag !== "flagged")   return false;
    if (filter === "resolved"  && r.flag !== "resolved")  return false;
    if (filter === "not_in_ad" && r.flag !== "not_in_ad") return false;
    if (filter === "active"    && r.is_terminated)        return false;
    if (search) {
      const q = search.toLowerCase();
      return r.name?.toLowerCase().includes(q) ||
             r.email?.toLowerCase().includes(q) ||
             r.ad_account?.toLowerCase().includes(q) ||
             r.department?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, padding:"20px 24px" }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700 }}>🚪 HR Offboarding Status</div>
          <div style={{ fontSize:12, color:T.colors.muted, marginTop:4, maxWidth:640, lineHeight:1.6 }}>
            Cross-references your HR system's employee status against Active Directory.
            Flags terminated employees with active AD accounts — <strong style={{color:T.colors.text}}>read-only, no AD changes are performed</strong>.
          </div>
        </div>
        {/* API contract link */}
        <Btn variant="ghost" onClick={async () => {
          const c = await offboardingApi.apiContract();
          alert("HR API Contract:\n\n" + JSON.stringify(c, null, 2));
        }} style={{ fontSize:11 }}>📄 View API Contract</Btn>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:1, background:T.colors.surface, padding:2, borderRadius:6, border:`1px solid ${T.colors.border}`, width:"fit-content" }}>
        {[
          ["overview", "📊 Overview"],
          ["records",  "🔍 Cross-Reference" + (selectedCustomer ? ` — ${selectedCustomer.name}` : "")],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:"6px 16px", borderRadius:4, cursor:"pointer", fontSize:12,
            fontWeight:tab===id?700:400, border:"none",
            background:tab===id?T.colors.card:"transparent",
            color:tab===id?T.colors.text:T.colors.muted,
          }}>{label}</button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === "overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ fontSize:12, color:T.colors.muted }}>
            HR integration status per AD domain. Configure the HR Status URL in <strong style={{color:T.colors.text}}>Settings → AD Connections → Edit</strong>.
          </div>
          {overview.length === 0 ? (
            <div style={{ padding:"40px 20px", textAlign:"center", background:T.colors.card, borderRadius:8, border:`1px solid ${T.colors.border}` }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🏢</div>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>No domains configured yet</div>
              <div style={{ fontSize:11, color:T.colors.muted }}>Add AD connections in Settings to get started</div>
            </div>
          ) : (
            <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:T.colors.surface }}>
                    {["Domain","HR Status","HR Records","AD Users","Action"].map(h => (
                      <th key={h} style={{ padding:"9px 16px", textAlign:"left", fontSize:9, color:T.colors.muted, fontWeight:700, borderBottom:`1px solid ${T.colors.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overview.map((o, i) => (
                    <tr key={o.customer_id} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent" }}>
                      <td style={{ padding:"12px 16px", fontWeight:600 }}>{o.customer_name}</td>
                      <td style={{ padding:"12px 16px" }}>
                        {o.hr_configured
                          ? <span style={{ fontSize:10, color:"#22c55e", background:"rgba(34,197,94,0.1)", padding:"2px 8px", borderRadius:3, fontWeight:700 }}>✅ Configured</span>
                          : <span style={{ fontSize:10, color:"#f59e0b", background:"rgba(245,158,11,0.1)", padding:"2px 8px", borderRadius:3, fontWeight:700 }}>⚙ Not configured</span>
                        }
                      </td>
                      <td style={{ padding:"12px 16px", fontFamily:T.fonts.mono, fontSize:12 }}>{o.hr_total || "—"}</td>
                      <td style={{ padding:"12px 16px", fontFamily:T.fonts.mono, fontSize:12 }}>{o.ad_users || "—"}</td>
                      <td style={{ padding:"12px 16px" }}>
                        {o.hr_configured ? (
                          <Btn size="sm" variant="secondary" onClick={() => handleCustomerSelect(o.customer_id)}>
                            View Cross-Reference →
                          </Btn>
                        ) : (
                          <span style={{ fontSize:10, color:T.colors.dim }}>
                            Add HR URL in Settings first
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Cross-Reference Tab ── */}
      {tab === "records" && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

          {/* Customer selector + sync */}
          <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
            <select value={selectedId} onChange={e => handleCustomerSelect(e.target.value)} style={{
              background:T.colors.surface, border:`1px solid ${T.colors.border}`,
              color:T.colors.text, borderRadius:5, padding:"6px 12px", fontSize:12, minWidth:240,
            }}>
              <option value="">— Select a domain —</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name} {!c.hr_status_url ? "(no HR URL)" : ""}</option>
              ))}
            </select>

            {selectedId && (
              <>
                <Btn onClick={doSync} disabled={syncing || !selectedCustomer?.hr_status_url}>
                  {syncing ? "⏳ Syncing…" : "🔄 Sync HR Status"}
                </Btn>
                {!selectedCustomer?.hr_status_url && (
                  <span style={{ fontSize:11, color:"#f59e0b" }}>
                    ⚠ No HR URL configured — go to Settings → Edit to add one
                  </span>
                )}
              </>
            )}
          </div>

          {/* Sync result toast */}
          {syncResult && (
            <div style={{
              padding:"10px 14px", borderRadius:6, fontSize:11,
              background: syncResult.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
              border:`1px solid ${syncResult.ok ? "#22c55e" : "#ef4444"}44`,
              color: syncResult.ok ? "#22c55e" : "#ef4444",
            }}>
              <strong>{syncResult.ok ? "✅" : "❌"} {syncResult.ok
                ? `Synced ${syncResult.total} employees from HR system — ${syncResult.cached} cached`
                : syncResult.message
              }</strong>
              {syncResult.hint && <div style={{ marginTop:4, color:"#f59e0b", fontSize:10 }}>💡 {syncResult.hint}</div>}
            </div>
          )}

          {/* No domain selected */}
          {!selectedId && (
            <div style={{ padding:"60px 20px", textAlign:"center", background:T.colors.card, borderRadius:8, border:`1px solid ${T.colors.border}` }}>
              <div style={{ fontSize:32, marginBottom:10 }}>👆</div>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>Select a domain above</div>
              <div style={{ fontSize:11, color:T.colors.muted }}>Choose an AD domain to view its HR cross-reference report</div>
            </div>
          )}

          {/* Loading */}
          {selectedId && xrefLoading && (
            <div style={{ padding:40, textAlign:"center", color:T.colors.muted, fontSize:12 }}>Loading cross-reference…</div>
          )}

          {/* Error */}
          {xref?.error && (
            <div style={{ padding:16, background:"rgba(239,68,68,0.08)", border:"1px solid #ef444444", borderRadius:6, color:"#ef4444", fontSize:12 }}>
              ❌ {xref.error}
            </div>
          )}

          {/* Not yet synced */}
          {xref && !xref.error && !xref.hr_synced && (
            <div style={{ padding:"40px 20px", textAlign:"center", background:T.colors.card, borderRadius:8, border:`1px solid ${T.colors.border}` }}>
              <div style={{ fontSize:32, marginBottom:10 }}>🔄</div>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>No HR data yet for {xref.customer}</div>
              {xref.hr_configured
                ? <><div style={{ fontSize:11, color:T.colors.muted, marginBottom:16 }}>HR URL is configured — click Sync HR Status to fetch employee data</div>
                    <Btn onClick={doSync} disabled={syncing}>{syncing?"Syncing…":"🔄 Sync Now"}</Btn></>
                : <div style={{ fontSize:11, color:"#f59e0b" }}>No HR URL configured for this domain. Add it in Settings → AD Connections → Edit.</div>
              }
            </div>
          )}

          {/* Results */}
          {xref && !xref.error && xref.hr_synced && (
            <>
              {/* Stats */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10 }}>
                <StatCard label="Total HR Records" value={xref.summary.total}      color="#0ea5e9"   onClick={() => setFilter("all")}      active={filter==="all"} />
                <StatCard label="Active Employees" value={xref.summary.active}     color="#6b7280"   onClick={() => setFilter("active")}   active={filter==="active"} />
                <StatCard label="Terminated"       value={xref.summary.terminated} color="#f59e0b"   onClick={() => setFilter("all")}      active={false} />
                <StatCard label="⚠ Needs Action"   value={xref.summary.flagged}    color="#ef4444"   onClick={() => setFilter("flagged")}  active={filter==="flagged"} />
                <StatCard label="✅ AD Disabled"    value={xref.summary.resolved}   color="#22c55e"   onClick={() => setFilter("resolved")} active={filter==="resolved"} />
              </div>

              {/* Last sync info */}
              <div style={{ fontSize:10, color:T.colors.dim }}>
                Last HR sync: {xref.last_fetched ? new Date(xref.last_fetched).toLocaleString() : "unknown"}
                &nbsp;·&nbsp;{xref.summary.not_in_ad} terminated employees not found in AD (may already be removed)
              </div>

              {/* Callout if flagged items exist */}
              {xref.summary.flagged > 0 && (
                <div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid #ef444433", borderRadius:8, padding:"12px 16px", display:"flex", gap:12, alignItems:"flex-start" }}>
                  <span style={{ fontSize:20 }}>⚠️</span>
                  <div>
                    <div style={{ fontWeight:700, color:"#ef4444", fontSize:13 }}>
                      {xref.summary.flagged} terminated employee{xref.summary.flagged > 1 ? "s" : ""} still have active AD accounts
                    </div>
                    <div style={{ fontSize:11, color:T.colors.muted, marginTop:3 }}>
                      These accounts should be reviewed and disabled by your IT / AD team.
                      This portal does not modify AD — please use your AD management tools or contact your domain administrator.
                    </div>
                  </div>
                </div>
              )}

              {/* Filter + Search bar */}
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ display:"flex", gap:1, background:T.colors.surface, padding:2, borderRadius:5, border:`1px solid ${T.colors.border}` }}>
                  {[
                    ["all",      `All (${allRecords.length})`],
                    ["flagged",  `⚠ Action (${xref.summary.flagged})`],
                    ["resolved", `✅ Done (${xref.summary.resolved})`],
                    ["not_in_ad","❓ Not in AD"],
                    ["active",   "Active Employees"],
                  ].map(([k, l]) => (
                    <button key={k} onClick={() => setFilter(k)} style={{
                      padding:"4px 12px", borderRadius:3, cursor:"pointer", fontSize:10,
                      fontWeight:filter===k?700:400, border:"none",
                      background:filter===k?T.colors.card:"transparent",
                      color:filter===k?T.colors.text:T.colors.muted,
                    }}>{l}</button>
                  ))}
                </div>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍  Search name, email, department…"
                  style={{ flex:1, minWidth:200, background:T.colors.surface, border:`1px solid ${T.colors.border}`,
                    borderRadius:5, color:T.colors.text, padding:"5px 10px", fontSize:11 }} />
                <span style={{ fontSize:11, color:T.colors.muted, whiteSpace:"nowrap" }}>{shown.length} records</span>
              </div>

              {/* Table */}
              <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", minWidth:860 }}>
                    <thead>
                      <tr style={{ background:T.colors.surface }}>
                        {["Employee","Email","Department","HR Status","AD Account","Last Logon","Flag"].map(h => (
                          <th key={h} style={{ padding:"8px 14px", textAlign:"left", fontSize:9, color:T.colors.muted, fontWeight:700, borderBottom:`1px solid ${T.colors.border}`, whiteSpace:"nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.length === 0 ? (
                        <tr><td colSpan={7} style={{ padding:40, textAlign:"center", color:T.colors.muted, fontSize:12 }}>No records match this filter</td></tr>
                      ) : shown.map((r, i) => {
                        const fc = FLAG_CONFIG[r.flag] || FLAG_CONFIG.ok;
                        return (
                          <tr key={r.email||i} title={fc.tip} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent", cursor:"help" }}>
                            <td style={{ padding:"10px 14px" }}>
                              <div style={{ fontWeight:600, fontSize:12 }}>{r.name || "—"}</div>
                              {r.title && <div style={{ fontSize:10, color:T.colors.muted }}>{r.title}</div>}
                            </td>
                            <td style={{ padding:"10px 14px", fontSize:11, color:T.colors.muted }}>{r.email || "—"}</td>
                            <td style={{ padding:"10px 14px", fontSize:11, color:T.colors.muted }}>{r.department || "—"}</td>
                            <td style={{ padding:"10px 14px" }}>
                              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                                <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:3,
                                  background: r.is_terminated ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.1)",
                                  color: r.is_terminated ? "#ef4444" : "#22c55e", display:"inline-block", width:"fit-content" }}>
                                  {r.hr_status || "—"}
                                </span>
                                {r.termination_date && (
                                  <span style={{ fontSize:9, color:T.colors.dim }}>
                                    Term: {new Date(r.termination_date).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding:"10px 14px" }}>
                              {r.ad_account ? (
                                <div>
                                  <div style={{ fontFamily:T.fonts.mono, fontSize:11, fontWeight:600 }}>{r.ad_account}</div>
                                  <div style={{ fontSize:9, color: r.ad_enabled ? "#22c55e" : "#6b7280" }}>
                                    {r.ad_enabled ? "● Enabled" : "● Disabled"}
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize:10, color:T.colors.dim }}>Not found</span>
                              )}
                            </td>
                            <td style={{ padding:"10px 14px", fontSize:10, color:T.colors.muted, fontFamily:T.fonts.mono }}>
                              {r.ad_last_logon ? new Date(r.ad_last_logon).toLocaleDateString() : "—"}
                            </td>
                            <td style={{ padding:"10px 14px" }}>
                              <span style={{ fontSize:9, fontWeight:700, padding:"3px 8px", borderRadius:3,
                                background:fc.bg, color:fc.color, whiteSpace:"nowrap" }}>
                                {fc.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
