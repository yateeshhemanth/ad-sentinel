import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Papa from "papaparse";
import { saveAs } from "file-saver";

// ── CSV Export ──────────────────────────────────────────────────────
export const exportCSV = (rows, filename = "export.csv") => {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  saveAs(blob, filename);
};

// ── PDF Export (client-side jsPDF) ─────────────────────────────────
export const exportPDF = ({
  title       = "Report",
  subtitle    = "",
  customerName = "",
  columns     = [],
  rows        = [],
  summaryData = null,
  logoUrl     = null,
  generatedBy = "",
}) => {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Header background
  doc.setFillColor(10, 14, 26);
  doc.rect(0, 0, W, 28, "F");

  // Title
  doc.setTextColor(14, 165, 233);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("ADSentinel Enterprise", 14, 12);

  doc.setTextColor(226, 232, 240);
  doc.setFontSize(11);
  doc.text(title, 14, 20);

  // Meta
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.text(
    `${customerName ? `Customer: ${customerName}  ·  ` : ""}Generated: ${new Date().toLocaleString()}  ·  By: ${generatedBy}`,
    14, 27
  );

  let yStart = 34;

  // Summary box
  if (summaryData) {
    doc.setFillColor(15, 22, 41);
    doc.roundedRect(14, yStart, W - 28, 28, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text("SUMMARY", 18, yStart + 6);

    const summaryEntries = Object.entries(summaryData).slice(0, 8);
    summaryEntries.forEach(([key, val], i) => {
      const x = 18 + (i % 4) * ((W - 36) / 4);
      const y = yStart + (i < 4 ? 12 : 22);
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      doc.text(key.replace(/([A-Z])/g, " $1").trim(), x, y);
      doc.setTextColor(226, 232, 240);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(String(val), x, y + 4);
    });
    yStart += 34;
  }

  // Table
  if (columns.length && rows.length) {
    autoTable(doc, {
      startY: yStart,
      head: [columns.map((c) => (typeof c === "string" ? c : c.header))],
      body: rows.map((row) =>
        columns.map((c) => {
          const key = typeof c === "string" ? c : c.dataKey;
          return row[key] !== undefined ? String(row[key]) : "";
        })
      ),
      styles: {
        fontSize: 8,
        cellPadding: 3,
        fillColor: [20, 28, 53],
        textColor: [226, 232, 240],
        lineColor: [30, 45, 82],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [15, 22, 41],
        textColor: [100, 116, 139],
        fontStyle: "bold",
        fontSize: 7,
      },
      alternateRowStyles: { fillColor: [12, 18, 34] },
      didParseCell: (data) => {
        if (data.section === "body") {
          const val = String(data.cell.raw).toLowerCase();
          if (["compromised", "blank", "critical"].includes(val))
            data.cell.styles.textColor = [239, 68, 68];
          else if (["expired", "weak", "high"].includes(val))
            data.cell.styles.textColor = [245, 158, 11];
          else if (["ok", "good"].includes(val))
            data.cell.styles.textColor = [34, 197, 94];
        }
      },
    });
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFillColor(10, 14, 26);
    doc.rect(0, H - 8, W, 8, "F");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7);
    doc.text(`ADSentinel Enterprise · Confidential · Page ${i} of ${pageCount}`, W / 2, H - 3, { align: "center" });
  }

  doc.save(`${title.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.pdf`);
};

// ── Quick report helpers ────────────────────────────────────────────
export const REPORT_COLUMNS = {
  password: [
    { header: "Username",        dataKey: "username"  },
    { header: "Department",      dataKey: "dept"      },
    { header: "Last Login",      dataKey: "lastLogin" },
    { header: "Pwd Age (Days)",  dataKey: "pwdAge"    },
    { header: "Status",          dataKey: "status"    },
    { header: "Admin",           dataKey: "admin"     },
  ],
  policy: [
    { header: "Control",         dataKey: "control"   },
    { header: "Current Value",   dataKey: "current"   },
    { header: "Recommended",     dataKey: "rec"       },
    { header: "Status",          dataKey: "status"    },
  ],
  tickets: [
    { header: "Ticket #",        dataKey: "ticket_no"      },
    { header: "Title",           dataKey: "title"          },
    { header: "Priority",        dataKey: "priority"       },
    { header: "Status",          dataKey: "status"         },
    { header: "Customer",        dataKey: "customer_name"  },
    { header: "Created",         dataKey: "created_at"     },
  ],
};
