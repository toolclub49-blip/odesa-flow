"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCRMData } from "@/hooks/use-crm-data";
import { t } from "@/lib/i18n";
import { normalizePhone, normalizeSum, parseOrders } from "@/lib/parser";
import { cn, createId, escapeHtml } from "@/lib/utils";
import type { AppSnapshot, ClientRecord, Lang, OrderRecord, ParsedOrderDraft, ViewMode } from "@/types";

type ToastState = {
  title: string;
  message: string;
  type: "info" | "success" | "error";
} | null;

function buildCourierText(order: OrderRecord) {
  return [order.name, order.phone, order.addr, order.note, `${order.sum} | ${order.pay}`].filter(Boolean).join("\n");
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function openPrintLabel(order: OrderRecord, lang: Lang) {
  const printWindow = window.open("", "_blank", "width=420,height=600");
  if (!printWindow) return false;

  const noteBlock = order.note
    ? `<div class="section note-section"><div class="mini-label">${escapeHtml(t(lang, "labelComment"))}</div><div class="note">${escapeHtml(order.note)}</div></div>`
    : "";

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="${lang}">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(t(lang, "label"))}</title>
        <style>
          @page { size: 96mm 96mm; margin: 0; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; width: 96mm; height: 96mm; overflow: hidden; background: #f6f1e8; color: #171717; font-family: "Segoe UI", Arial, sans-serif; }
          .sheet { width: 96mm; height: 96mm; overflow: hidden; padding: 4mm; background: radial-gradient(circle at top left, rgba(255,255,255,0.95), transparent 35%), linear-gradient(180deg, #f8f3eb 0%, #efe6da 100%); }
          .label { width: 88mm; height: 88mm; border: 0.6mm solid #4d3d30; border-radius: 5mm; padding: 6mm; overflow: hidden; background: rgba(255,255,255,0.94); box-shadow: inset 0 0 0 0.4mm rgba(255,255,255,0.75); }
          .content { width: 100%; height: 100%; overflow: hidden; }
          .topline { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4mm; }
          .brand { font-size: 7pt; letter-spacing: 0.18em; text-transform: uppercase; color: #8a7765; font-weight: 700; }
          .chip { border: 0.35mm solid #d8ccbf; border-radius: 999px; padding: 1.3mm 2.4mm; font-size: 7pt; color: #6d5c4b; background: #fbf8f3; font-weight: 700; }
          .name { font-size: 17pt; line-height: 1.08; font-weight: 800; margin-bottom: 4mm; letter-spacing: -0.02em; }
          .section { margin-bottom: 2.6mm; padding: 2.4mm 2.8mm; border-radius: 3.2mm; background: #faf7f2; border: 0.35mm solid #ece2d7; }
          .mini-label { font-size: 6.7pt; text-transform: uppercase; letter-spacing: 0.14em; color: #907d6b; font-weight: 700; margin-bottom: 0.9mm; }
          .line { font-size: 11pt; line-height: 1.14; word-break: break-word; }
          .line-value { font-weight: 700; }
          .note { font-size: 9.2pt; line-height: 1.08; word-break: break-word; color: #342b24; }
          .note-section { padding-top: 2.1mm; padding-bottom: 2.2mm; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="label">
            <div id="label-content" class="content">
              <div class="topline">
                <div class="brand">${escapeHtml(t(lang, "printBrand"))}</div>
                <div class="chip">${escapeHtml(t(lang, "labelChip"))}</div>
              </div>
              <div class="name">${escapeHtml(order.name)}</div>
              <div class="section">
                <div class="mini-label">${escapeHtml(t(lang, "labelPhone"))}</div>
                <div class="line line-value">${escapeHtml(order.phone)}</div>
              </div>
              <div class="section">
                <div class="mini-label">${escapeHtml(t(lang, "labelAddress"))}</div>
                <div class="line">${escapeHtml(order.addr)}</div>
              </div>
              ${noteBlock}
            </div>
          </div>
        </div>
        <script>
          function fitLabel() {
            const content = document.getElementById("label-content");
            const label = document.querySelector(".label");
            const name = document.querySelector(".name");
            const lines = Array.from(document.querySelectorAll(".line"));
            const note = document.querySelector(".note");
            const noteLabel = document.querySelector(".note-section .mini-label");
            if (!content || !label || !name) return;
            let nameSize = 17;
            let lineSize = 11;
            let noteSize = note ? 9.2 : 9.2;
            const applySizes = () => {
              name.style.fontSize = nameSize + "pt";
              lines.forEach((line) => line.style.fontSize = lineSize + "pt");
              if (note) note.style.fontSize = noteSize + "pt";
              if (note) note.style.lineHeight = noteSize <= 8 ? 1.02 : noteSize <= 8.6 ? 1.05 : 1.08;
              if (noteLabel && noteSize <= 8.1) noteLabel.style.marginBottom = "0.5mm";
            };
            applySizes();
            let guard = 0;
            while (content.scrollHeight > label.clientHeight - 2 && guard < 30) {
              if (nameSize > 12.5) nameSize -= 0.45;
              if (lineSize > 8.2) lineSize -= 0.3;
              if (note && noteSize > 6.8) noteSize -= 0.35;
              applySizes();
              guard++;
            }
          }
          window.onafterprint = function () { setTimeout(function () { window.close(); }, 150); };
          window.onload = function () {
            fitLabel();
            setTimeout(function () { window.print(); }, 60);
          };
        <\/script>
      </body>
    </html>
  `);

  printWindow.document.close();
  return true;
}

export function CRMApp() {
  const { user, ready: authReady, error: authError, authEnabled, signIn, signUp, logout } = useAuth();
  const { orders, clients, ready, syncError, cloudEnabled, useLocalMode, addOrders, saveOrder, removeOrder, saveClient, removeClient, importSnapshot } = useCRMData(user?.uid ?? null);
  const [lang, setLang] = useState<Lang>("ru");
  const [view, setView] = useState<ViewMode>("add");
  const [rawInput, setRawInput] = useState("");
  const [drafts, setDrafts] = useState<ParsedOrderDraft[]>([]);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [baseSearch, setBaseSearch] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [courierExpanded, setCourierExpanded] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const activeCount = useMemo(() => orders.filter((item) => !item.done).length, [orders]);
  const courierText = useMemo(() => orders.filter((item) => !item.done).map((item, index) => `${index + 1}. ${buildCourierText(item)}`).join("\n\n"), [orders]);
  const authRequired = authEnabled && cloudEnabled && !user;
  const filteredClients = useMemo(() => {
    const query = baseSearch.trim().toLowerCase();
    return clients
      .filter((client) => !query || `${client.name} ${client.phone} ${client.addr}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, lang === "uk" ? "uk" : "ru"));
  }, [baseSearch, clients, lang]);

  function notify(message: string, type: "info" | "success" | "error", title: string) {
    setToast({ message, type, title });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }

  async function handleAuthSubmit() {
    if (!email.trim() || !password.trim()) {
      notify(t(lang, "authEmptyText"), "error", t(lang, "authErrorTitle"));
      return;
    }
    try {
      setAuthPending(true);
      if (authMode === "signup") {
        await signUp(email.trim(), password);
        notify(t(lang, "authSuccessSignup"), "success", t(lang, "authReady"));
      } else {
        await signIn(email.trim(), password);
        notify(t(lang, "authSuccessLogin"), "success", t(lang, "authReady"));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : t(lang, "authErrorTitle"), "error", t(lang, "authErrorTitle"));
    } finally {
      setAuthPending(false);
    }
  }

  function updateDraft(index: number, patch: Partial<ParsedOrderDraft>) {
    setDrafts((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  }

  function updateOrder(orderId: string, patch: Partial<OrderRecord>) {
    const order = orders.find((item) => item.id === orderId);
    if (!order) return;
    void saveOrder({ ...order, ...patch, updatedAt: Date.now() });
  }

  function updateClient(clientId: string, patch: Partial<ClientRecord>) {
    const client = clients.find((item) => item.id === clientId);
    if (!client) return;
    void saveClient({ ...client, ...patch, updatedAt: Date.now() });
  }

  async function handleParse() {
    setDrafts(parseOrders(rawInput, clients));
  }

  async function handleSaveAll() {
    if (!drafts.length) {
      notify(t(lang, "saveEmptyText"), "error", t(lang, "emptyListTitle"));
      return;
    }
    const nextOrders = drafts.map((draft) => ({
      ...draft,
      id: createId(),
      phone: normalizePhone(draft.phone),
      sum: normalizeSum(draft.sum),
      updatedAt: Date.now(),
      createdAt: Date.now()
    }));
    await addOrders(nextOrders);
    setDrafts([]);
    setRawInput("");
    setView("list");
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify(t(lang, "saveSuccessText"), "success", t(lang, "saveSuccessTitle"));
  }

  async function handleCopy(text: string, successMessage: string) {
    if (!text.trim()) {
      notify(t(lang, "emptyListText"), "error", t(lang, "emptyListTitle"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } finally {
      notify(successMessage, "success", t(lang, "copied"));
    }
  }

  function handleExport() {
    const snapshot: AppSnapshot = { orders, clients };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(snapshot, `odessa_backup_${stamp}.json`);
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const nextClients = Array.isArray(parsed.clients) ? parsed.clients : Array.isArray(parsed) ? parsed : null;
      const nextOrders = Array.isArray(parsed.orders) ? parsed.orders : [];
      if (!nextClients) {
        notify(t(lang, "importErrorText"), "error", t(lang, "importErrorTitle"));
        return;
      }
      const snapshot: AppSnapshot = {
        clients: nextClients.map((client: Partial<ClientRecord>) => ({
          id: client.id || createId(),
          name: client.name || "",
          phone: normalizePhone(client.phone || ""),
          addr: client.addr || "",
          createdAt: client.createdAt || Date.now(),
          updatedAt: Date.now()
        })),
        orders: nextOrders.map((order: Partial<OrderRecord>) => ({
          id: order.id || createId(),
          name: order.name || "",
          phone: normalizePhone(order.phone || ""),
          addr: order.addr || "",
          sum: normalizeSum(order.sum || ""),
          pay: order.pay === "НАЛИЧНЫЕ" ? "НАЛИЧНЫЕ" : "КАРТА",
          note: order.note || "",
          done: Boolean(order.done),
          createdAt: order.createdAt || Date.now(),
          updatedAt: Date.now()
        }))
      };
      await importSnapshot(snapshot);
      notify(t(lang, "importDoneText", snapshot.clients.length, snapshot.orders.length), "success", t(lang, "importDoneTitle"));
    } catch {
      notify(t(lang, "readErrorText"), "error", t(lang, "readErrorTitle"));
    } finally {
      event.target.value = "";
    }
  }

  return (
    <main style={{ padding: 18 }}>
      <div className="app-shell">
        <section className="hero">
          <div className="hero-top">
            <div>
              <div className="hero-kicker">{t(lang, "heroKicker")}</div>
              <div className="hero-title">{t(lang, "heroTitle")}</div>
              <div className="hero-sub">{t(lang, "heroSub")}</div>
            </div>
            <div className="hero-controls">
              <div className="lang-switch">
                <button className={cn("lang-btn", lang === "ru" && "active")} onClick={() => setLang("ru")} type="button">RU</button>
                <button className={cn("lang-btn", lang === "uk" && "active")} onClick={() => setLang("uk")} type="button">UA</button>
              </div>
              <div className="hero-pill">{!useLocalMode ? t(lang, "syncCloud") : t(lang, "syncLocal")}</div>
              {user ? (
                <button className="account-pill" onClick={() => void logout()} type="button">
                  <span>{user.email || t(lang, "accountLabel")}</span>
                  <span>{t(lang, "logout")}</span>
                </button>
              ) : null}
            </div>
          </div>
          <div className="hero-sub" style={{ marginTop: 10 }}>
            {!cloudEnabled
              ? t(lang, "syncFallback")
              : authRequired
                ? t(lang, "authNeedLogin")
                : syncError
                  ? `${t(lang, "syncErrorTitle")}: ${t(lang, "syncErrorText")}`
                  : t(lang, "syncReady")}
          </div>
        </section>

        {authRequired ? (
          <div className="card auth-card">
            <div className="headline">{t(lang, "authTitle")}</div>
            <div className="subline">{t(lang, "authSub")}</div>
            <div className="auth-toggle">
              <button className={cn("tab", authMode === "signin" && "active")} onClick={() => setAuthMode("signin")} type="button">
                {t(lang, "authToggleSignIn")}
              </button>
              <button className={cn("tab", authMode === "signup" && "active")} onClick={() => setAuthMode("signup")} type="button">
                {t(lang, "authToggleSignUp")}
              </button>
            </div>
            <span className="lbl">{t(lang, "email")}</span>
            <input className="field" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" />
            <span className="lbl">{t(lang, "password")}</span>
            <input className="field" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t(lang, "authPasswordHint")} type="password" />
            {authError ? <div className="auth-error">{authError}</div> : null}
            <button className="btn-main" onClick={() => void handleAuthSubmit()} disabled={authPending || !authReady} type="button">
              {authPending ? "..." : authMode === "signup" ? t(lang, "signUp") : t(lang, "signIn")}
            </button>
          </div>
        ) : (
          <>
            <div className="tabs">
              <button className={cn("tab", view === "add" && "active")} onClick={() => setView("add")} type="button">{t(lang, "tabAdd")}</button>
              <button className={cn("tab", view === "list" && "active")} onClick={() => setView("list")} type="button">{t(lang, "tabOrders")} ({activeCount})</button>
              <button className={cn("tab", view === "base" && "active")} onClick={() => setView("base")} type="button">{t(lang, "tabBase")} ({clients.length})</button>
            </div>

            {view === "add" ? (
              <>
                <div className="card">
                  <div className="headline">{t(lang, "addHeadline")}</div>
                  <div className="subline">{t(lang, "addSubline")}</div>
                  <span className="lbl">{t(lang, "pasteText")}</span>
                  <textarea className="field" rows={8} value={rawInput} onChange={(event) => setRawInput(event.target.value)} />
                  <button className="btn-main" onClick={handleParse} type="button">{t(lang, "recognize")}</button>
                </div>
                {drafts.map((draft, index) => (
                  <div key={draft.id} className="card" style={{ borderLeft: `4px solid ${draft.isOld ? "#34c759" : "#007aff"}` }}>
                    <span className="badge" style={{ background: draft.isOld ? "#34c759" : "#007aff" }}>{draft.isOld ? t(lang, "inBase") : t(lang, "newClient")}</span>
                    <span className="lbl">{t(lang, "fullName")}</span>
                    <input className="field" value={draft.name} onChange={(event) => updateDraft(index, { name: event.target.value })} />
                    <span className="lbl">{t(lang, "address")}</span>
                    <input className="field" value={draft.addr} onChange={(event) => updateDraft(index, { addr: event.target.value })} />
                    <div className="row">
                      <div style={{ flex: 2 }}>
                        <span className="lbl">{t(lang, "phone")}</span>
                        <input className="field" value={draft.phone} onChange={(event) => updateDraft(index, { phone: event.target.value })} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <span className="lbl">{t(lang, "sum")}</span>
                        <input className="field" value={draft.sum} onChange={(event) => updateDraft(index, { sum: event.target.value })} />
                      </div>
                    </div>
                    <span className="lbl">{t(lang, "note")}</span>
                    <input className="field" value={draft.note} onChange={(event) => updateDraft(index, { note: event.target.value })} />
                    <div style={{ marginTop: 10 }}>
                      <button className={cn("tag-pay", draft.pay === "КАРТА" ? "pay-card" : "pay-cash")} onClick={() => updateDraft(index, { pay: draft.pay === "КАРТА" ? "НАЛИЧНЫЕ" : "КАРТА" })} type="button">
                        {draft.pay === "КАРТА" ? `💳 ${t(lang, "card")}` : `💵 ${t(lang, "cash")}`}
                      </button>
                    </div>
                  </div>
                ))}
                {drafts.length > 0 ? <button className="btn-main btn-save" onClick={handleSaveAll} type="button">{t(lang, "saveAll")}</button> : null}
              </>
            ) : null}

            {view === "list" ? (
              <>
                <div className="toolbar">
                  <button className="btn-sm" onClick={() => void handleCopy(courierText, t(lang, "copiedCourier"))} type="button">{t(lang, "copyList")}</button>
                </div>
                <div className="card">
                  <button className="summary-row" onClick={() => setCourierExpanded((value) => !value)} type="button">
                    <span>{t(lang, "courierList")}</span>
                    <span className="summary-arrow">{courierExpanded ? t(lang, "collapse") : t(lang, "expand")}</span>
                  </button>
                  {courierExpanded ? <div className="courier-box" style={{ marginTop: 12 }}>{courierText || t(lang, "emptyCourier")}</div> : null}
                </div>
                {orders.map((order) => {
                  const editing = editingOrderId === order.id;
                  return (
                    <div key={order.id} className="card" style={{ opacity: order.done ? 0.55 : 1 }}>
                      <div className="order-meta">
                        <div className="order-title">{order.name}</div>
                        <button className={cn("tag-pay", order.pay === "КАРТА" ? "pay-card" : "pay-cash")} onClick={() => updateOrder(order.id, { pay: order.pay === "КАРТА" ? "НАЛИЧНЫЕ" : "КАРТА" })} type="button">
                          {order.pay === "КАРТА" ? t(lang, "card") : t(lang, "cash")}
                        </button>
                      </div>
                      {editing ? (
                        <>
                          <span className="lbl">{t(lang, "fullName")}</span>
                          <input className="field" value={order.name} onChange={(event) => updateOrder(order.id, { name: event.target.value })} />
                          <span className="lbl">{t(lang, "phone")}</span>
                          <input className="field" value={order.phone} onChange={(event) => updateOrder(order.id, { phone: event.target.value })} />
                          <span className="lbl">{t(lang, "address")}</span>
                          <input className="field" value={order.addr} onChange={(event) => updateOrder(order.id, { addr: event.target.value })} />
                          <div className="row">
                            <div style={{ flex: 1 }}>
                              <span className="lbl">{t(lang, "sum")}</span>
                              <input className="field" value={order.sum} onChange={(event) => updateOrder(order.id, { sum: event.target.value })} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <span className="lbl">{t(lang, "payment")}</span>
                              <button className={cn("tag-pay", order.pay === "КАРТА" ? "pay-card" : "pay-cash")} onClick={() => updateOrder(order.id, { pay: order.pay === "КАРТА" ? "НАЛИЧНЫЕ" : "КАРТА" })} type="button">
                                {order.pay === "КАРТА" ? `💳 ${t(lang, "card")}` : `💵 ${t(lang, "cash")}`}
                              </button>
                            </div>
                          </div>
                          <span className="lbl">{t(lang, "note")}</span>
                          <input className="field" value={order.note} onChange={(event) => updateOrder(order.id, { note: event.target.value })} />
                          <div className="row" style={{ marginTop: 10 }}>
                            <button className="btn-sm btn-ok" onClick={() => setEditingOrderId(null)} type="button">{t(lang, "save")}</button>
                            <button className="btn-sm" onClick={() => setEditingOrderId(null)} type="button">{t(lang, "cancel")}</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="order-line">📍 {order.addr}</div>
                          <div className="order-line" style={{ color: "#4c8bf5" }}>📞 {order.phone} | 💰 {order.sum}</div>
                          {order.note ? <div className="note-box">📝 {order.note}</div> : null}
                          <div className="actions-grid">
                            <button className="btn-sm btn-ok" onClick={() => updateOrder(order.id, { done: !order.done })} type="button">{t(lang, "done")}</button>
                            <button className="btn-sm" onClick={() => setEditingOrderId(order.id)} type="button">{t(lang, "edit")}</button>
                            <button className="btn-sm" onClick={() => void handleCopy(buildCourierText(order), t(lang, "copiedOrder"))} type="button">{t(lang, "copy")}</button>
                            <button className="btn-sm" onClick={() => {
                              const opened = openPrintLabel(order, lang);
                              if (!opened) notify(t(lang, "printUnavailableText"), "error", t(lang, "printUnavailableTitle"));
                            }} type="button">{t(lang, "label")}</button>
                            <button className="btn-sm btn-danger" onClick={() => void removeOrder(order.id)} type="button">{t(lang, "delete")}</button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            ) : null}

            {view === "base" ? (
              <>
                <div className="toolbar">
                  <button className="btn-sm" onClick={handleExport} type="button">{t(lang, "exportJson")}</button>
                  <button className="btn-sm" onClick={() => fileRef.current?.click()} type="button">{t(lang, "importJson")}</button>
                </div>
                <div className="card">
                  <div className="headline">{t(lang, "baseHeadline")}</div>
                  <div className="subline">{t(lang, "baseSubline")}</div>
                  <input className="field" value={baseSearch} onChange={(event) => setBaseSearch(event.target.value)} placeholder={t(lang, "baseSearch")} />
                </div>
                {filteredClients.length ? filteredClients.map((client) => {
                  const editing = editingClientId === client.id;
                  return (
                    <div key={client.id} className="card">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <div className="order-title" style={{ fontSize: 16 }}>{client.name || t(lang, "noName")}</div>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn-sm" onClick={() => setEditingClientId(client.id)} type="button">{t(lang, "edit")}</button>
                          <button className="btn-sm btn-danger" onClick={() => void removeClient(client.id)} type="button">{t(lang, "delete")}</button>
                        </div>
                      </div>
                      {editing ? (
                        <>
                          <span className="lbl">{t(lang, "fullName")}</span>
                          <input className="field" value={client.name} onChange={(event) => updateClient(client.id, { name: event.target.value })} />
                          <span className="lbl">{t(lang, "phone")}</span>
                          <input className="field" value={client.phone} onChange={(event) => updateClient(client.id, { phone: event.target.value })} />
                          <span className="lbl">{t(lang, "address")}</span>
                          <input className="field" value={client.addr} onChange={(event) => updateClient(client.id, { addr: event.target.value })} />
                          <div className="row" style={{ marginTop: 8 }}>
                            <button className="btn-sm btn-ok" onClick={() => setEditingClientId(null)} type="button">{t(lang, "save")}</button>
                            <button className="btn-sm" onClick={() => setEditingClientId(null)} type="button">{t(lang, "cancel")}</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="order-line" style={{ marginTop: 8 }}>📞 {client.phone || t(lang, "noPhone")}</div>
                          <div className="subline" style={{ marginBottom: 0 }}>{client.addr || t(lang, "noAddress")}</div>
                        </>
                      )}
                    </div>
                  );
                }) : <div className="card empty-state">{baseSearch ? t(lang, "searchEmpty") : t(lang, "emptyBase")}</div>}
              </>
            ) : null}
          </>
        )}

        {!ready && !authRequired ? <div className="card empty-state">Loading...</div> : null}
      </div>

      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={handleImport} />
      <div className="toast-wrap">
        <div className={cn("toast", toast && "show", toast?.type === "success" && "toast-success", toast?.type === "error" && "toast-error")}>
          <div className="toast-title">{toast?.title ?? "Odesa Flow"}</div>
          <div>{toast?.message ?? ""}</div>
        </div>
      </div>
    </main>
  );
}
