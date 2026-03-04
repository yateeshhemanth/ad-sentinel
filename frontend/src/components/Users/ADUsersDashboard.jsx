import { useState, useEffect, useMemo } from "react";
import { THEME as T } from "../../constants/theme";
import { Btn, RawDataModal } from "../shared";
import { adUsersApi } from "../../utils/api";
import { exportCSV } from "../../utils/exportUtils";

const FILTERS = [
  { key:"all",             label:"All Users"           },
  { key:"enabled",         label:"Active"              },
  { key:"disabled",        label:"Disabled"            },
  { key:"admin",           label:"Admins"              },
  { key:"pwd_never_expires",label:"Pwd Never Expires"  },
  { key:"pwd_expired",     label:"Pwd Expired"         },
  { key:"pwd_not_required",label:"No Pwd Required"     },
  { key:"stale",           label:"Stale (90d+)"        },
  { key:"never_logged_in", label:"Never Logged In"     },
];

const FLAG_COLOR = {
  disabled:          "#ef4444",
  admin:             "#f59e0b",
  pwd_never_expires: "#f59e0b",
  pwd_expired:       "#ef4444",
  pwd_not_required:  "#ef4444",
  stale:             "#a78bfa",
};

export default function ADUsersDashboard({ customerId, customerName }) {
  const isPlatform = !customerId;

  const [stats,     setStats]    = useState(null);
  const [users,     setUsers]    = useState([]);
  const [total,     setTotal]    = useState(0);
  const [loading,   setLoading]  = useState(true);
  const [filter,    setFilter]   = useState("all");
  const [search,    setSearch]   = useState("");
  const [page,      setPage]     = useState(1);
  const [rawModal,  setRawModal] = useState(null);
  const LIMIT = 100;

  const loadStats = () => {
    const fn = isPlatform ? adUsersApi.platformStats() : adUsersApi.stats({ customer_id: customerId });
    fn.then(s => setStats(s)).catch(() => {});
  };

  const loadUsers = () => {
    setLoading(true);
    const params = { filter, search, page, limit: LIMIT };
    if (customerId) params.customer_id = customerId;
    adUsersApi.list(params)
      .then(r => { setUsers(r.users || []); setTotal(r.total || 0); })
      .catch(() => { setUsers([]); setTotal(0); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStats(); }, [customerId]); // eslint-disable-line
  useEffect(() => { loadUsers(); }, [filter, search, page, customerId]); // eslint-disable-line

  const noData = stats?.no_data || (stats?.total === 0 && !loading);

  const doExport = () => {
    exportCSV(users.map(u => ({
      SAMAccount:          u.sam_account_name,
      DisplayName:         u.display_name  || "",
      Email:               u.email         || "",
      Department:          u.department    || "",
      Title:               u.title         || "",
      Status:              u.is_enabled ? "Active" : "Disabled",
      Admin:               u.is_admin ? "Yes" : "No",
      PwdNeverExpires:     u.password_never_expires ? "Yes" : "No",
      PwdExpired:          u.password_expired       ? "Yes" : "No",
      PwdNotRequired:      u.password_not_required  ? "Yes" : "No",
      LastLogon:           u.last_logon   ? new Date(u.last_logon).toLocaleString()  : "Never",
      PwdLastSet:          u.pwd_last_set ? new Date(u.pwd_last_set).toLocaleString(): "Never",
      CustomerDomain:      u.customer_name || "",
    })), `ad_users_${filter}_${Date.now()}.csv`);
  };

  const openRaw = (title, color, filterKey) => {
    const relevant = users.filter(u => {
      if (filterKey === "disabled")          return !u.is_enabled;
      if (filterKey === "admin")             return u.is_admin;
      if (filterKey === "pwd_never_expires") return u.password_never_expires;
      if (filterKey === "pwd_expired")       return u.password_expired;
      if (filterKey === "pwd_not_required")  return u.password_not_required;
      if (filterKey === "stale")             return !u.last_logon || new Date(u.last_logon) < new Date(Date.now()-90*86400000);
      if (filterKey === "never_logged_in")   return !u.last_logon;
      return true;
    });
    setRawModal({
      title, color,
      headers: [
        { key:"sam_account_name", label:"Account",     mono:true  },
        { key:"display_name",     label:"Name"                    },
        { key:"department",       label:"Department"              },
        { key:"status",           label:"Status"                  },
        isPlatform && { key:"customer_name", label:"Domain" },
      ].filter(Boolean),
      rows: relevant.map(u => ({
        ...u,
        status: u.is_enabled ? "Active" : "Disabled",
      })),
    });
  };

  // Per-domain breakdown (platform view only)
  const perDomain = stats?.per_domain || [];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── No data state ── */}
      {noData && (
        <div style={{ background:"rgba(245,158,11,0.06)", border:`1px solid #f59e0b44`, borderRadius:8, padding:"20px 24px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#f59e0b", marginBottom:6 }}>
            📡 No AD User Data
          </div>
          <div style={{ fontSize:12, color:T.colors.muted, lineHeight:1.7 }}>
            The AD users directory is empty. This table is populated when a real LDAP scan runs against a configured domain.
            <br />
            <strong style={{ color:T.colors.text }}>To populate:</strong> Settings → AD Connections → configure DC IP + Bind DN + Password → then trigger a scan.
          </div>
        </div>
      )}

      {/* ── Stat cards ── */}
      {stats && !noData && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
            {[
              { key:"total",    label:"Total Users",    color:T.colors.accent, icon:"👥", filterKey:"all"     },
              { key:"active",   label:"Active",          color:T.colors.ok,     icon:"✅", filterKey:"enabled" },
              { key:"disabled", label:"Disabled",        color:"#ef4444",       icon:"🚫", filterKey:"disabled"},
              { key:"admin_count",label:"Admin Accounts",color:"#f59e0b",       icon:"👑", filterKey:"admin"   },
            ].map(({ key, label, color, icon, filterKey }) => (
              <StatCard key={key} label={label} value={stats[key]||0} color={color} icon={icon}
                onClick={() => { setFilter(filterKey); setPage(1); }}
                active={filter === filterKey} />
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
            {[
              { key:"pwd_never_expires", label:"Pwd Never Expires",  color:"#f59e0b", icon:"♾️",  filterKey:"pwd_never_expires", onClick:true },
              { key:"pwd_expired",       label:"Password Expired",   color:"#ef4444", icon:"⌛",  filterKey:"pwd_expired",       onClick:true },
              { key:"pwd_not_required",  label:"No Pwd Required",    color:"#ef4444", icon:"🔓",  filterKey:"pwd_not_required",  onClick:true },
              { key:"stale_90d",         label:"Stale 90+ Days",     color:"#a78bfa", icon:"💤",  filterKey:"stale",             onClick:true },
            ].map(({ key, label, color, icon, filterKey }) => (
              <StatCard key={key} label={label} value={stats[key]||0} color={color} icon={icon}
                onClick={() => { setFilter(filterKey); setPage(1); }}
                active={filter === filterKey} />
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
            {[
              { key:"never_logged_in", label:"Never Logged In",   color:"#a78bfa", icon:"👻", filterKey:"never_logged_in" },
              { key:"pwd_age_90d",     label:"Pwd Age 90+ Days",  color:"#f59e0b", icon:"🔑", filterKey:"all" },
              { key:"dept_count",      label:"Departments",       color:T.colors.accent, icon:"🏬", filterKey:null },
            ].filter(x => stats[x.key] !== undefined).map(({ key, label, color, icon, filterKey }) => (
              <StatCard key={key} label={label} value={stats[key]||0} color={color} icon={icon}
                onClick={filterKey ? () => { setFilter(filterKey); setPage(1); } : undefined}
                active={filterKey && filter === filterKey} />
            ))}
          </div>
        </>
      )}

      {/* ── Department breakdown ── */}
      {stats?.departments?.length > 0 && (
        <div style={{ display:"grid", gridTemplateColumns: isPlatform ? "1fr 1fr" : "1fr", gap:14 }}>
          <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
            <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.colors.border}`, fontSize:11, fontWeight:700, display:"flex", justifyContent:"space-between" }}>
              <span>TOP DEPARTMENTS</span>
              <span style={{ color:T.colors.muted, fontSize:10 }}>{stats.dept_count} total</span>
            </div>
            <div style={{ padding:"10px 14px" }}>
              {stats.departments.map(({ name, count }) => {
                const max = stats.departments[0]?.count || 1;
                return (
                  <div key={name} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                    <span style={{ fontSize:11, color:T.colors.muted, width:100, textAlign:"right", flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</span>
                    <div style={{ flex:1, height:14, background:T.colors.dim, borderRadius:2, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(count/max)*100}%`, background:T.colors.accent, borderRadius:2, display:"flex", alignItems:"center", paddingLeft:6 }}>
                        <span style={{ fontSize:9, fontWeight:700, color:"#fff" }}>{count}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top groups (admin) */}
          {stats.top_groups?.length > 0 && (
            <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
              <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.colors.border}`, fontSize:11, fontWeight:700 }}>TOP PRIVILEGED GROUPS</div>
              <div style={{ padding:"10px 14px" }}>
                {stats.top_groups.map(({ name, count }) => {
                  const max = stats.top_groups[0]?.count || 1;
                  return (
                    <div key={name} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                      <span style={{ fontSize:11, color:T.colors.muted, width:140, textAlign:"right", flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</span>
                      <div style={{ flex:1, height:14, background:T.colors.dim, borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${(count/max)*100}%`, background:"#f59e0b", borderRadius:2, display:"flex", alignItems:"center", paddingLeft:6 }}>
                          <span style={{ fontSize:9, fontWeight:700, color:"#fff" }}>{count}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Per-domain breakdown (platform view) ── */}
      {isPlatform && perDomain.length > 0 && !noData && (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
          <div style={{ padding:"10px 16px", borderBottom:`1px solid ${T.colors.border}`, fontSize:11, fontWeight:700 }}>USER POSTURE BY DOMAIN</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:T.colors.surface }}>
                {["Domain","Total","Active","Disabled","Admins","Pwd Never Exp","Pwd Expired","Never Logged In"].map(h => (
                  <th key={h} style={{ padding:"7px 12px", textAlign:"left", fontSize:9, color:T.colors.muted, fontWeight:700, borderBottom:`1px solid ${T.colors.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perDomain.map((d, i) => (
                <tr key={d.customer_name} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent" }}>
                  <td style={{ padding:"8px 12px", fontWeight:600, fontSize:12 }}>{d.customer_name}</td>
                  <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, fontWeight:700 }}>{d.total}</td>
                  <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, color:T.colors.ok }}>{d.active}</td>
                  <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, color:d.disabled>0?"#ef4444":T.colors.dim }}>{d.disabled||"—"}</td>
                  <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, color:d.admin_count>0?"#f59e0b":T.colors.dim }}>{d.admin_count||"—"}</td>
                  <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, color:d.pwd_never_expires>0?"#f59e0b":T.colors.dim }}>{d.pwd_never_expires||"—"}</td>
                  <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, color:d.pwd_expired>0?"#ef4444":T.colors.dim }}>{d.pwd_expired||"—"}</td>
                  <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, color:d.never_logged_in>0?"#a78bfa":T.colors.dim }}>{d.never_logged_in||"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── User table with filters ── */}
      <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, overflow:"hidden" }}>
        <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.colors.border}`, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontWeight:700, fontSize:12, whiteSpace:"nowrap" }}>AD USER DIRECTORY</span>
          <div style={{ display:"flex", gap:1, background:T.colors.surface, padding:2, borderRadius:5, border:`1px solid ${T.colors.border}`, flexWrap:"wrap" }}>
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); }} style={{
                padding:"4px 10px", borderRadius:3, cursor:"pointer", fontSize:10,
                fontWeight:filter===f.key?700:400, border:"none",
                background:filter===f.key?T.colors.card:"transparent",
                color:filter===f.key?T.colors.text:T.colors.muted,
              }}>{f.label}</button>
            ))}
          </div>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="🔍  Search name, account, dept…"
            style={{ flex:1, minWidth:180, background:T.colors.surface, border:`1px solid ${T.colors.border}`,
              borderRadius:5, color:T.colors.text, padding:"5px 10px", fontSize:11 }} />
          <span style={{ fontSize:11, color:T.colors.muted, whiteSpace:"nowrap" }}>{total} accounts</span>
          <Btn variant="secondary" size="sm" onClick={doExport} disabled={users.length===0}>⬇ CSV</Btn>
        </div>

        {loading ? (
          <div style={{ padding:40, textAlign:"center", color:T.colors.muted, fontSize:12 }}>Loading users…</div>
        ) : users.length === 0 ? (
          <div style={{ padding:"40px 20px", textAlign:"center" }}>
            <div style={{ fontSize:32, marginBottom:10 }}>👥</div>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:6 }}>
              {noData ? "No AD user data" : "No users match this filter"}
            </div>
            <div style={{ fontSize:11, color:T.colors.muted }}>
              {noData
                ? "Run a scan against a configured AD domain to populate the user directory."
                : "Try a different filter or clear the search."}
            </div>
          </div>
        ) : (
          <>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
                <thead>
                  <tr style={{ background:T.colors.surface, position:"sticky", top:0, zIndex:1 }}>
                    {[
                      "Account", "Display Name", "Department",
                      isPlatform ? "Domain" : "Title",
                      "Status", "Admin", "Pwd Flags", "Last Logon",
                    ].map(h => (
                      <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:9, color:T.colors.muted, fontWeight:700, borderBottom:`1px solid ${T.colors.border}`, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => {
                    const flags = [];
                    if (!u.is_enabled)             flags.push({ label:"Disabled",     color:"#ef4444" });
                    if (u.password_never_expires)   flags.push({ label:"No Expiry",   color:"#f59e0b" });
                    if (u.password_expired)         flags.push({ label:"Expired",      color:"#ef4444" });
                    if (u.password_not_required)    flags.push({ label:"No Pwd Req",  color:"#ef4444" });
                    const lastLogonDate = u.last_logon ? new Date(u.last_logon) : null;
                    const isStale = lastLogonDate && lastLogonDate < new Date(Date.now()-90*86400000);
                    return (
                      <tr key={u.id||i} style={{ borderBottom:`1px solid ${T.colors.border}22`, background:i%2?"#0c1222":"transparent" }}>
                        <td style={{ padding:"8px 12px", fontFamily:T.fonts.mono, fontWeight:600, fontSize:11 }}>{u.sam_account_name}</td>
                        <td style={{ padding:"8px 12px", fontSize:11 }}>{u.display_name || "—"}</td>
                        <td style={{ padding:"8px 12px", fontSize:11, color:T.colors.muted }}>{u.department || "—"}</td>
                        <td style={{ padding:"8px 12px", fontSize:11, color:T.colors.muted }}>
                          {isPlatform ? u.customer_name : (u.title || "—")}
                        </td>
                        <td style={{ padding:"8px 12px" }}>
                          <span style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:3,
                            background:u.is_enabled?"rgba(34,197,94,0.12)":"rgba(239,68,68,0.12)",
                            color:u.is_enabled?T.colors.ok:"#ef4444" }}>
                            {u.is_enabled ? "ACTIVE" : "DISABLED"}
                          </span>
                        </td>
                        <td style={{ padding:"8px 12px" }}>
                          {u.is_admin && (
                            <span style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:3, background:"rgba(245,158,11,0.12)", color:"#f59e0b" }}>ADMIN</span>
                          )}
                        </td>
                        <td style={{ padding:"8px 12px" }}>
                          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                            {flags.map(fl => (
                              <span key={fl.label} style={{ fontSize:8, fontWeight:700, padding:"1px 5px", borderRadius:2, background:`${fl.color}22`, color:fl.color }}>{fl.label}</span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding:"8px 12px", fontSize:10, color:isStale?"#a78bfa":T.colors.muted, fontFamily:T.fonts.mono }}>
                          {lastLogonDate ? lastLogonDate.toLocaleDateString() : <span style={{ color:"#a78bfa" }}>Never</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > LIMIT && (
              <div style={{ padding:"10px 16px", borderTop:`1px solid ${T.colors.border}`, display:"flex", gap:10, alignItems:"center", justifyContent:"center" }}>
                <Btn variant="ghost" size="sm" disabled={page<=1} onClick={() => setPage(p=>p-1)}>← Prev</Btn>
                <span style={{ fontSize:11, color:T.colors.muted }}>Page {page} of {Math.ceil(total/LIMIT)} · {total} accounts</span>
                <Btn variant="ghost" size="sm" disabled={page>=Math.ceil(total/LIMIT)} onClick={() => setPage(p=>p+1)}>Next →</Btn>
              </div>
            )}
          </>
        )}
      </div>

      {rawModal && (
        <RawDataModal isOpen={!!rawModal} onClose={() => setRawModal(null)}
          title={rawModal.title} color={rawModal.color}
          headers={rawModal.headers} rows={rawModal.rows}
          emptyMsg="No users in this category." />
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon, onClick, active }) {
  return (
    <div onClick={onClick}
      style={{ background:T.colors.card, border:`1px solid ${active?color:T.colors.border}`,
        borderRadius:8, padding:"12px 16px", cursor:onClick?"pointer":"default",
        borderTop:`2px solid ${color}`, transition:"border-color 0.15s" }}
      onMouseEnter={e => onClick && (e.currentTarget.style.borderColor=color)}
      onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor=T.colors.border; e.currentTarget.style.borderTop=`2px solid ${color}`; }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
        <span style={{ fontSize:9, fontWeight:700, color:T.colors.muted, letterSpacing:"0.05em" }}>{label.toUpperCase()}</span>
        <span style={{ fontSize:18 }}>{icon}</span>
      </div>
      <div style={{ fontSize:26, fontWeight:700, color, fontFamily:T.fonts.mono, lineHeight:1 }}>{value.toLocaleString()}</div>
      {onClick && <div style={{ fontSize:9, color, marginTop:6 }}>FILTER ›</div>}
    </div>
  );
}
