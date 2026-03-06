import { useState, useEffect } from "react";
import { THEME as T } from "../../constants/theme";
import { PageHeader, Btn, Table, TR, TD } from "../shared";
import { reportsApi, customersApi, downloadReport } from "../../utils/api";

const REPORT_TYPES = [
  { type:"executive_summary",     title:"Executive Summary",        icon:"📊", color:"#0ea5e9", desc:"High-level risk overview for management"             },
  { type:"password_vulnerability", title:"Password Vulnerabilities", icon:"🔐", color:"#ef4444", desc:"Full password audit with compromised accounts"        },
  { type:"stale_accounts",         title:"Stale Accounts",           icon:"💤", color:"#a78bfa", desc:"Accounts inactive beyond configured threshold"        },
  { type:"policy_compliance",      title:"Policy Compliance",        icon:"📋", color:"#f59e0b", desc:"GPO and domain policy audit results"                  },
  { type:"privileged_accounts",    title:"Privileged Accounts",      icon:"👑", color:"#f59e0b", desc:"Domain Admins and privileged group members"           },
  { type:"compliance_mapping",     title:"Compliance Mapping",       icon:"🗂️", color:"#0ea5e9", desc:"Findings mapped to CIS, NIST, ISO 27001, SOC2, MITRE" },
  { type:"kerberos_risks",         title:"Kerberos Attack Surface",  icon:"🎫", color:"#ef4444", desc:"Kerberoastable and AS-REP roastable accounts"         },
  { type:"trust_analysis",         title:"Trust Analysis",           icon:"🔗", color:"#a78bfa", desc:"External trusts and SID filtering status"             },
  { type:"ad_health_dashboard",    title:"AD Health Dashboard",      icon:"🏥", color:"#22c55e", desc:"DC/user/GPO-oriented health summary inspired by legacy AD reports" },
];

export default function ReportsPanel() {
  const [customers,    setCustomers]    = useState([]);
  const [history,      setHistory]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(null); // "type_format" key
  const [downloading,  setDownloading]  = useState(null); // history id
  const [selectedCust, setSelectedCust] = useState("");
  const [custName,     setCustName]     = useState("");

  const loadHistory = () =>
    reportsApi.history().then(h => setHistory(Array.isArray(h) ? h : [])).catch(() => {});

  useEffect(() => {
    Promise.all([customersApi.list(), reportsApi.history()])
      .then(([c, h]) => {
        setCustomers(Array.isArray(c) ? c : []);
        setHistory(Array.isArray(h)   ? h : []);
      }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const generate = async (type, format) => {
    const key = `${type}_${format}`;
    setGenerating(key);
    try {
      const result = await reportsApi.generate({
        type,
        format,
        customer_id:   selectedCust || undefined,
        customer_name: custName     || undefined,
      });
      // Use authenticated download helper so auth header is sent
      if (result?.download_url) {
        await downloadReport(result.download_url, result.filename || `${type}.${format}`);
      }
      await loadHistory();
    } catch (err) {
      alert("Report generation failed: " + err.message);
    }
    setGenerating(null);
  };

  const doDownload = async (r) => {
    if (!r.download_url) return;
    setDownloading(r.id);
    await downloadReport(r.download_url, r.filename || `${r.type}.${r.format}`);
    setDownloading(null);
  };

  const handleCustChange = (e) => {
    const id = e.target.value;
    setSelectedCust(id);
    const c = customers.find(x => x.id === id);
    setCustName(c?.name || "");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <PageHeader title="Reports" sub="Generate and download audit reports for any customer" />

      {/* Customer scope */}
      <div style={{ display:"flex", alignItems:"center", gap:12, background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"12px 18px" }}>
        <span style={{ fontSize:11, fontWeight:700, color:T.colors.muted, whiteSpace:"nowrap" }}>CUSTOMER SCOPE</span>
        <select value={selectedCust} onChange={handleCustChange}
          style={{ flex:1, background:T.colors.surface, border:`1px solid ${T.colors.border}`, borderRadius:6, color:T.colors.text, padding:"8px 12px", fontSize:13 }}>
          <option value="">All customers (platform-wide)</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>)}
        </select>
        {selectedCust && (
          <Btn variant="ghost" size="sm" onClick={() => { setSelectedCust(""); setCustName(""); }}>✕ Clear</Btn>
        )}
      </div>

      {/* Report cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
        {REPORT_TYPES.map(r => {
          const pKey = `${r.type}_pdf`;
          const cKey = `${r.type}_csv`;
          const isGen = generating === pKey || generating === cKey;
          return (
            <div key={r.type}
              style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:18, display:"flex", gap:14, transition:"border-color 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = r.color}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.colors.border}>
              <span style={{ fontSize:28 }}>{r.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:13, marginBottom:4 }}>{r.title}</div>
                <div style={{ fontSize:11, color:T.colors.muted, marginBottom:12, lineHeight:1.5 }}>{r.desc}</div>
                <div style={{ display:"flex", gap:8 }}>
                  <Btn variant="danger" size="sm"
                    disabled={!!generating}
                    onClick={() => generate(r.type, "pdf")}>
                    {generating===pKey ? "Generating…" : "⬇ PDF"}
                  </Btn>
                  <Btn variant="secondary" size="sm"
                    disabled={!!generating}
                    onClick={() => generate(r.type, "csv")}>
                    {generating===cKey ? "Generating…" : "⬇ CSV"}
                  </Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Report history */}
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:T.colors.muted, marginBottom:10 }}>REPORT HISTORY</div>
        {loading ? (
          <div style={{ fontSize:12, color:T.colors.muted }}>Loading…</div>
        ) : history.length === 0 ? (
          <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"30px 20px", textAlign:"center" }}>
            <div style={{ fontSize:24, marginBottom:8 }}>📂</div>
            <div style={{ fontSize:12, color:T.colors.muted }}>No reports generated yet. Click any report card above to generate one.</div>
          </div>
        ) : (
          <Table headers={["Report","Customer","Format","Generated By","Time","Download"]}>
            {history.map((r, i) => (
              <TR key={r.id||i} idx={i}>
                <TD style={{ fontWeight:600 }}>{r.title || r.type}</TD>
                <TD muted>{r.customer_name || "All customers"}</TD>
                <TD>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, fontFamily:T.fonts.mono,
                    background: r.format==="pdf" ? "rgba(239,68,68,0.12)" : "rgba(14,165,233,0.12)",
                    color:      r.format==="pdf" ? T.colors.danger : T.colors.accent,
                  }}>{(r.format||"pdf").toUpperCase()}</span>
                </TD>
                <TD muted style={{ fontSize:11 }}>{r.generated_by}</TD>
                <TD muted style={{ fontFamily:T.fonts.mono, fontSize:11 }}>
                  {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                </TD>
                <TD>
                  {r.download_url ? (
                    <Btn variant="secondary" size="sm"
                      disabled={downloading===r.id}
                      onClick={() => doDownload(r)}>
                      {downloading===r.id ? "…" : "⬇ Download"}
                    </Btn>
                  ) : (
                    <span style={{ fontSize:11, color:T.colors.dim }}>—</span>
                  )}
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}
