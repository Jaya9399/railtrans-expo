import React, { useMemo, useCallback } from "react";
import DataTable from "./DataTable";

/**
 * DashboardSection
 * - Removed per-section "Add New" button because Add Registrant is centralized. 
 * - Keeps "Manage" button for exhibitors/partners.
 * - Shows "Send Ticket" button for ALL entities (visitors, exhibitors, partners, speakers, awardees)
 * - Enhanced with premium/delegate ticket status display
 */
export default function DashboardSection({
  label,
  data = [],
  tableKey,
  configs = {},
  onEdit,
  onAddNew,
  onDelete,
  onRefreshRow,
  onResend,
  resendLoadingId,
  setShowExhibitorManager,
  setShowPartnerManager,
  PAGE_SIZE = 10,
  HIDDEN_FIELDS = new Set(),
  prettifyKey = (k) => String(k || "").replace(/[_-]/g, " ").replace(/\b\w/g, (s) => s.toUpperCase()),
  showSendTicket = true,
}) {
  const columns = useMemo(() => {
    const keysSet = new Set();
    (data || []).forEach((row) => {
      Object.keys(row || {}).forEach((k) => {
        if (!HIDDEN_FIELDS.has(k)) keysSet.add(k);
      });
    });

    let configCols = configs?.[tableKey]?.columns?.map((c) => c.key) || configs?.[tableKey]?.fields?.map((c) => c.name);
    if (configCols && configCols.length > 0) {
      const missing = [...keysSet].filter((k) => !configCols.includes(k));
      configCols = [...configCols, ...missing];
    } else {
      configCols = [...keysSet];
    }

    const preferred = ["name", "full_name", "company", "email", "ticket_code", "ticket_category", "mobile", "phone", "id", "_id"];
    const ordered = [];
    const seen = new Set();
    for (const p of preferred) {
      if (configCols.includes(p) && !seen.has(p)) { 
        ordered.push(p); 
        seen.add(p); 
      }
    }
    for (const k of configCols) {
      if (!seen.has(k)) { 
        ordered.push(k); 
        seen.add(k); 
      }
    }

    // ✅ Enhanced columns with premium status display
    return ordered.map((k) => {
      // Ticket Category - Show premium/delegate status
      if (k === "ticket_category") {
        return {
          key: k,
          label: "Ticket Type",
          render: (value, row) => {
            const isPremium = value === "premium" || row.ticket_total > 0;
            
            if (isPremium) {
              let statusText = "🎫 DELEGATE";
              let statusColor = "bg-blue-100 text-blue-800";
              
              if (row.txId) {
                statusText = "🎫 DELEGATE ✅ Paid";
                statusColor = "bg-green-100 text-green-800";
              } else if (row.added_by_admin === true || row.added_by_admin === "Admin") {
                statusText = "⭐ DELEGATE (Free)";
                statusColor = "bg-yellow-100 text-yellow-800";
              } else {
                statusText = "⏳ DELEGATE (Pending)";
                statusColor = "bg-red-100 text-red-800";
              }
              
              return (
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                  {statusText}
                </span>
              );
            }
            return <span className="text-gray-600">👤 Visitor</span>;
          }
        };
      }
      
      // Total Amount - Show with ₹ symbol
      if (k === "ticket_total") {
        return {
          key: k,
          label: "Amount",
          render: (value) => {
            if (value > 0) {
              return <span className="font-semibold text-blue-600">₹{value}</span>;
            }
            return <span className="text-gray-400">Free</span>;
          }
        };
      }
      
      // Payment ID - Show status
      if (k === "txId") {
        return {
          key: k,
          label: "Payment",
          render: (value) => {
            if (value) {
              return <span className="text-green-600 font-medium">✅ Paid</span>;
            }
            return <span className="text-gray-400">—</span>;
          }
        };
      }
      
      // Created By - Show Admin/User
      if (k === "added_by_admin") {
        return {
          key: k,
          label: "Created By",
          render: (value) => {
            if (value === true || value === "Admin") {
              return <span className="text-blue-600 font-medium">Admin</span>;
            }
            return <span className="text-gray-600">User</span>;
          }
        };
      }
      
      return { key: k, label: prettifyKey(k) };
    });
  }, [data, configs, tableKey, HIDDEN_FIELDS, prettifyKey]);

  const handleRowAction = useCallback(
    (action, row) => {
      if (!row) return;
      if (action === "edit") {
        typeof onEdit === "function" && onEdit(tableKey, row);
      } else if (action === "delete") {
        typeof onDelete === "function" && onDelete(tableKey, row);
      } else if (action === "refresh") {
        typeof onRefreshRow === "function" && onRefreshRow(tableKey, row);
      }
    },
    [onEdit, onDelete, onRefreshRow, tableKey]
  );

  function handleManage() {
    if (tableKey === "exhibitors") {
      setShowExhibitorManager && setShowExhibitorManager(true);
    } else if (tableKey === "partners") {
      setShowPartnerManager && setShowPartnerManager(true);
    }
  }

  return (
    <section className="border border-gray-200 rounded bg-white p-4 shadow">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">{label}</h2>
          <div className="text-xs text-gray-500">{(data || []).length} total</div>
        </div>

        <div className="flex items-center gap-2">
          {(tableKey === "exhibitors" || tableKey === "partners") && (
            <button 
              onClick={handleManage} 
              className="text-sm px-3 py-1 border rounded bg-gray-100 hover:bg-gray-200"
            >
              Manage
            </button>
          )}
        </div>
      </header>

      <div>
        <DataTable
          columns={columns}
          data={data}
          defaultPageSize={PAGE_SIZE}
          onEdit={(row) => handleRowAction("edit", row)}
          onDelete={(row) => handleRowAction("delete", row)}
          onRefreshRow={(row) => handleRowAction("refresh", row)}
          onResend={(row) => typeof onResend === "function" && onResend(row)}
          resendLoadingId={resendLoadingId}
          showSendTicket={showSendTicket}
          prettifyKey={prettifyKey}
        />
      </div>
    </section>
  );
}