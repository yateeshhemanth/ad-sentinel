import { useState, useEffect, useMemo } from "react";
import { THEME as T } from "../../constants/theme";
import { PageHeader, Btn, Modal, Input, Table, TR, TD, RawDataModal } from "../shared";
import { ticketsApi } from "../../utils/api";
import { exportCSV } from "../../utils/exportUtils";
import { useAuth } from "../../context/AuthContext";

const PRIORITIES = ["low","medium","high","critical"];
const STATUSES   = ["open","in_progress","resolved","closed"];
const BLANK_FORM = { title:"", description:"", priority:"medium", customer_name:"" };

const PCOLOR = {
  critical:{ bg:"rgba(239,68,68,0.12)",  text:"#ef4444" },
  high:    { bg:"rgba(245,158,11,0.12)", text:"#f59e0b" },
  medium:  { bg:"rgba(14,165,233,0.12)", text:"#0ea5e9" },
  low:     { bg:"rgba(167,139,250,0.12)",text:"#a78bfa" },
};
const SCOLOR = {
  open:       { bg:"rgba(239,68,68,0.12)",  text:"#ef4444" },
  in_progress:{ bg:"rgba(245,158,11,0.12)", text:"#f59e0b" },
  resolved:   { bg:"rgba(34,197,94,0.12)",  text:"#22c55e" },
  closed:     { bg:"rgba(100,116,139,0.12)",text:"#64748b" },
};

export default function TicketsPanel() {
  const { user }  = useAuth();
  const isAdmin   = user?.role === "admin";

  const [tickets,    setTickets]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [filterStat, setFilterStat] = useState("all");
  const [filterPri,  setFilterPri]  = useState("all");
  const [search,     setSearch]     = useState("");
  const [createModal,setCreateModal]= useState(false);
  const [detailModal,setDetailModal]= useState(null);
  const [form,       setForm]       = useState(BLANK_FORM);
  const [saving,     setSaving]     = useState(false);
  const [comment,    setComment]    = useState("");
  const [rawModal,   setRawModal]   = useState(null);

  const load = () => {
    setLoading(true);
    const params = {};
    if (filterStat !== "all") params.status   = filterStat;
    if (filterPri  !== "all") params.priority = filterPri;
    ticketsApi.list(params)
      .then(d => setTickets(Array.isArray(d) ? d : (Array.isArray(d?.tickets) ? d.tickets : [])))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [filterStat, filterPri]); // eslint-disable-line

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const create = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      const t = await ticketsApi.create(form);
      setTickets(p => [t, ...p]);
      setCreateModal(false); setForm(BLANK_FORM);
    } catch (err) { alert(err.message); }
    setSaving(false);
  };

  const updateStatus = async (id, status) => {
    try {
      await ticketsApi.update(id, { status });
      setTickets(p => p.map(t => t.id===id ? {...t, status} : t));
      if (detailModal?.id === id) setDetailModal(x => ({...x, status}));
    } catch (err) { alert(err.message); }
  };

  const removeTicket = async (id) => {
    if (!window.confirm("Delete this ticket?")) return;
    await ticketsApi.remove(id).catch(e => alert(e.message));
    setTickets(p => p.filter(t => t.id !== id));
    if (detailModal?.id === id) setDetailModal(null);
  };

  const addComment = async () => {
    if (!comment.trim() || !detailModal) return;
    try {
      await ticketsApi.addComment(detailModal.id, { comment: comment.trim() });
      setComment("");
      const t = await ticketsApi.get(detailModal.id);
      setDetailModal(t);
    } catch (err) { alert(err.message); }
  };

  const openDetail = async (id) => {
    try { setDetailModal(await ticketsApi.get(id)); }
    catch (err) { alert(err.message); }
  };

  // Stats
  const stats = useMemo(() => ({
    open:       tickets.filter(t=>t.status==="open").length,
    in_progress:tickets.filter(t=>t.status==="in_progress").length,
    resolved:   tickets.filter(t=>t.status==="resolved").length,
    critical:   tickets.filter(t=>t.priority==="critical").length,
  }), [tickets]);

  // Filtered + search
  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return tickets.filter(t =>
      !q || t.title?.toLowerCase().includes(q) ||
            t.customer_name?.toLowerCase().includes(q) ||
            t.ticket_no?.toLowerCase().includes(q)
    );
  }, [tickets, search]);

  const doExport = () => {
    exportCSV(visible.map(t => ({
      TicketNo:    t.ticket_no,
      Title:       t.title,
      Priority:    t.priority,
      Status:      t.status,
      Customer:    t.customer_name || "",
      Created:     new Date(t.created_at).toLocaleString(),
      Updated:     new Date(t.updated_at).toLocaleString(),
    })), "tickets_export.csv");
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <PageHeader title="Tickets" sub="Remediation tracking for security findings">
        <Btn variant="secondary" size="sm" onClick={doExport}>⬇ CSV</Btn>
        <Btn onClick={() => setCreateModal(true)}>+ New Ticket</Btn>
      </PageHeader>

      {/* ── Stats — clickable ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
        {[
          { key:"open",        label:"Open",        color:"#ef4444", onClick:()=>setFilterStat("open") },
          { key:"in_progress", label:"In Progress",  color:"#f59e0b", onClick:()=>setFilterStat("in_progress") },
          { key:"resolved",    label:"Resolved",     color:"#22c55e", onClick:()=>setFilterStat("resolved") },
          { key:"critical",    label:"Critical Pri.", color:"#ef4444",
            onClick:()=>setRawModal({
              title:"Critical Priority Tickets",
              color:"#ef4444",
              headers:[{key:"ticket_no",label:"#",mono:true},{key:"title",label:"Title"},{key:"status",label:"Status"},{key:"customer_name",label:"Customer"}],
              rows:tickets.filter(t=>t.priority==="critical"),
            })},
        ].map(({ key, label, color, onClick }) => (
          <div key={key} onClick={onClick}
            style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"12px 16px",
              cursor:"pointer", borderTop:`2px solid ${color}`, transition:"border-color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = color}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.colors.border; e.currentTarget.style.borderTop = `2px solid ${color}`; }}>
            <div style={{ fontSize:9, fontWeight:700, color:T.colors.muted, letterSpacing:"0.05em", marginBottom:6 }}>{label.toUpperCase()}</div>
            <div style={{ fontSize:26, fontWeight:700, color, fontFamily:T.fonts.mono, lineHeight:1 }}>{stats[key]}</div>
            <div style={{ fontSize:10, color:T.colors.muted, marginTop:4 }}>
              {key === "critical" ? "VIEW ›" : `click to filter`}
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters + search ── */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:3, borderRadius:6, border:`1px solid ${T.colors.border}` }}>
          {["all",...STATUSES].map(s => (
            <button key={s} onClick={() => setFilterStat(s)} style={{
              padding:"5px 12px", borderRadius:4, cursor:"pointer", fontSize:11,
              fontWeight:filterStat===s?700:400,
              background:filterStat===s?T.colors.card:"transparent",
              color:filterStat===s?T.colors.text:T.colors.muted, border:"none",
            }}>{s === "in_progress" ? "In Progress" : s.charAt(0).toUpperCase()+s.slice(1)}</button>
          ))}
        </div>
        <div style={{ display:"flex", gap:2, background:T.colors.surface, padding:3, borderRadius:6, border:`1px solid ${T.colors.border}` }}>
          {["all",...PRIORITIES].map(p => {
            const pc = PCOLOR[p];
            return (
              <button key={p} onClick={() => setFilterPri(p)} style={{
                padding:"5px 12px", borderRadius:4, cursor:"pointer", fontSize:11,
                fontWeight:filterPri===p?700:400,
                background:filterPri===p?(pc?.bg||T.colors.card):"transparent",
                color:filterPri===p?(pc?.text||T.colors.text):T.colors.muted, border:"none",
              }}>{p.charAt(0).toUpperCase()+p.slice(1)}</button>
            );
          })}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍  Search tickets…"
          style={{ flex:1, minWidth:200, background:T.colors.surface, border:`1px solid ${T.colors.border}`,
            borderRadius:6, color:T.colors.text, padding:"7px 12px", fontSize:12 }} />
        <span style={{ fontSize:11, color:T.colors.muted }}>{visible.length} ticket{visible.length!==1?"s":""}</span>
      </div>

      {error && <div style={{ background:"rgba(239,68,68,0.08)", border:`1px solid #ef444444`, borderRadius:6, padding:"10px 14px", fontSize:12, color:"#ef4444" }}>{error}</div>}

      {!loading && visible.length === 0 ? (
        <div style={{ background:T.colors.card, border:`1px solid ${T.colors.border}`, borderRadius:8, padding:"60px 20px", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🎫</div>
          <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>No tickets</div>
          <div style={{ fontSize:12, color:T.colors.muted, marginBottom:16 }}>Create a ticket to track remediation of a finding.</div>
          <Btn onClick={() => setCreateModal(true)}>+ Create First Ticket</Btn>
        </div>
      ) : (
        <Table headers={["#","Priority","Title","Customer","Status","Created","Actions"]}>
          {visible.map((t, i) => {
            const pc = PCOLOR[t.priority] || PCOLOR.medium;
            const sc = SCOLOR[t.status]   || SCOLOR.open;
            return (
              <TR key={t.id} idx={i} onClick={() => openDetail(t.id)}>
                <TD style={{ fontFamily:T.fonts.mono, fontSize:11, color:T.colors.muted }}>{t.ticket_no}</TD>
                <TD>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:pc.bg, color:pc.text, fontFamily:T.fonts.mono }}>
                    {t.priority.toUpperCase()}
                  </span>
                </TD>
                <TD style={{ fontWeight:600, maxWidth:280 }}>
                  <div style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.title}</div>
                </TD>
                <TD muted>{t.customer_name || "—"}</TD>
                <TD>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:3, background:sc.bg, color:sc.text }}>
                    {t.status.replace("_"," ").toUpperCase()}
                  </span>
                </TD>
                <TD muted style={{ fontFamily:T.fonts.mono, fontSize:11 }}>{new Date(t.created_at).toLocaleDateString()}</TD>
                <TD onClick={e => e.stopPropagation()}>
                  <div style={{ display:"flex", gap:6 }}>
                    {t.status !== "resolved" && t.status !== "closed" && (
                      <Btn variant="secondary" size="sm" onClick={() => updateStatus(t.id, "resolved")}>✓ Resolve</Btn>
                    )}
                    {isAdmin && <Btn variant="danger" size="sm" onClick={() => removeTicket(t.id)}>✕</Btn>}
                  </div>
                </TD>
              </TR>
            );
          })}
        </Table>
      )}

      {/* ── Create Ticket Modal ── */}
      <Modal isOpen={createModal} onClose={() => { setCreateModal(false); setForm(BLANK_FORM); }} title="+ New Ticket" width={520}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="Title *" placeholder="e.g. Remediate blank passwords in IT OU" value={form.title} onChange={f("title")} />
          <Input label="Customer" placeholder="Customer name" value={form.customer_name} onChange={f("customer_name")} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <label style={{ fontSize:11,fontWeight:700,color:T.colors.muted,display:"block",marginBottom:6 }}>PRIORITY</label>
              <select value={form.priority} onChange={f("priority")}
                style={{ width:"100%",background:T.colors.surface,border:`1px solid ${T.colors.border}`,borderRadius:6,color:T.colors.text,padding:"9px 12px",fontSize:13 }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize:11,fontWeight:700,color:T.colors.muted,display:"block",marginBottom:6 }}>DESCRIPTION</label>
            <textarea value={form.description} onChange={f("description")} rows={3} placeholder="Describe the issue and scope…"
              style={{ width:"100%",background:T.colors.surface,border:`1px solid ${T.colors.border}`,borderRadius:6,color:T.colors.text,padding:"9px 12px",fontSize:12,resize:"vertical",boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={() => { setCreateModal(false); setForm(BLANK_FORM); }}>Cancel</Btn>
            <Btn onClick={create} disabled={saving||!form.title}>{saving?"Creating…":"Create Ticket"}</Btn>
          </div>
        </div>
      </Modal>

      {/* ── Ticket Detail Modal ── */}
      <Modal isOpen={!!detailModal} onClose={() => setDetailModal(null)} title={detailModal ? `${detailModal.ticket_no} · ${detailModal.title}` : ""} width={640}>
        {detailModal && (() => {
          const pc = PCOLOR[detailModal.priority]||PCOLOR.medium;
          const sc = SCOLOR[detailModal.status]  ||SCOLOR.open;
          return (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                <span style={{ fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:3,background:pc.bg,color:pc.text,fontFamily:T.fonts.mono }}>
                  {detailModal.priority.toUpperCase()}
                </span>
                <span style={{ fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:3,background:sc.bg,color:sc.text }}>
                  {detailModal.status.replace("_"," ").toUpperCase()}
                </span>
                {detailModal.customer_name && (
                  <span style={{ fontSize:11, color:T.colors.muted }}>{detailModal.customer_name}</span>
                )}
              </div>
              {detailModal.description && (
                <div style={{ background:T.colors.surface,borderRadius:6,padding:"10px 14px",fontSize:12,lineHeight:1.7 }}>
                  {detailModal.description}
                </div>
              )}
              {/* Status actions */}
              <div style={{ display:"flex", gap:8 }}>
                {STATUSES.filter(s => s !== detailModal.status).map(s => (
                  <Btn key={s} variant="secondary" size="sm" onClick={() => updateStatus(detailModal.id, s)}>
                    → {s.replace("_"," ")}
                  </Btn>
                ))}
                {isAdmin && <Btn variant="danger" size="sm" onClick={() => removeTicket(detailModal.id)}>Delete</Btn>}
              </div>
              {/* Comments */}
              {(detailModal.comments||[]).length > 0 && (
                <div>
                  <div style={{ fontSize:11,fontWeight:700,color:T.colors.muted,marginBottom:8 }}>COMMENTS</div>
                  {(detailModal.comments||[]).map((c,ci) => (
                    <div key={ci} style={{ background:T.colors.surface,borderRadius:6,padding:"8px 12px",marginBottom:6 }}>
                      <div style={{ fontSize:10,color:T.colors.muted,marginBottom:4 }}>{c.user_name} · {new Date(c.created_at).toLocaleString()}</div>
                      <div style={{ fontSize:12,lineHeight:1.6 }}>{c.comment}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display:"flex", gap:8 }}>
                <input value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a comment…" onKeyDown={e=>e.key==="Enter"&&addComment()}
                  style={{ flex:1,background:T.colors.surface,border:`1px solid ${T.colors.border}`,borderRadius:6,color:T.colors.text,padding:"8px 12px",fontSize:12 }} />
                <Btn variant="secondary" onClick={addComment} disabled={!comment.trim()}>Post</Btn>
              </div>
            </div>
          );
        })()}
      </Modal>

      {rawModal && (
        <RawDataModal isOpen={!!rawModal} onClose={() => setRawModal(null)}
          title={rawModal.title} color={rawModal.color}
          headers={rawModal.headers} rows={rawModal.rows}
          emptyMsg="No tickets match this filter." />
      )}
    </div>
  );
}
