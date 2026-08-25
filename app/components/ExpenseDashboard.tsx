"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { canCreateRecord, canRecordPayment, canViewSection, roleLabels } from "../auth/permissions";
import type { PublicUser } from "../auth/types";

type Customer = { id: string; name: string; businessName: string; phone: string; email: string; gstin: string; address: string; openingBalance: number; createdAt: string };
type Person = { id: string; name: string; role: string; phone: string; email: string; paymentMode: string; status: string; createdAt: string };
type Order = { id: string; orderNo: string; title: string; customerId: string; assignedPersonId: string; venue: string; eventDate: string; status: string; contractValue: number; createdAt: string };
type Invoice = { id: string; invoiceNo: string; customerId: string; orderId: string; billedPersonId: string; issueDate: string; dueDate: string; subtotal: number; tax: number; total: number; paidAmount: number; status: string; notes: string; attachmentKey: string; attachmentName: string; attachmentType: string; createdAt: string };
type Expense = { id: string; expenseNo: string; orderId: string; personId: string; category: string; vendor: string; description: string; expenseDate: string; amount: number; paymentMode: string; receiptKey: string; receiptName: string; createdAt: string };
type Payment = { id: string; orderId: string; personId: string; invoiceId: string; customerId: string; direction: string; amount: number; paymentDate: string; method: string; reference: string; notes: string; createdAt: string };
type AppData = { customers: Customer[]; persons: Person[]; orders: Order[]; invoices: Invoice[]; expenses: Expense[]; payments: Payment[] };
type ModalKind = "customer" | "person" | "order" | "invoice" | "expense" | "payment" | null;

const emptyData: AppData = { customers: [], persons: [], orders: [], invoices: [], expenses: [], payments: [] };
const navItems = [
  { key: "overview", label: "Overview", icon: "⌂", href: "/" },
  { key: "customers", label: "Customers", icon: "◎", href: "/customers" },
  { key: "invoices", label: "Invoices", icon: "▤", href: "/invoices" },
  { key: "persons", label: "People", icon: "♧", href: "/persons" },
  { key: "orders", label: "Orders", icon: "◇", href: "/orders" },
  { key: "expenses", label: "Expenses", icon: "↗", href: "/expenses" },
  { key: "payments", label: "Payments", icon: "₹", href: "/payments" },
  { key: "reports", label: "Reports", icon: "▥", href: "/reports" },
  { key: "users", label: "Team access", icon: "♙", href: "/users" },
];
const titles: Record<string, { title: string; eyebrow: string }> = {
  overview: { title: "Business overview", eyebrow: "Your financial command centre" },
  customers: { title: "Customers", eyebrow: "Profiles, balances and activity" },
  invoices: { title: "Invoices", eyebrow: "Create, attach and track every bill" },
  persons: { title: "People & vendors", eyebrow: "Everyone involved in billing and execution" },
  orders: { title: "Orders", eyebrow: "Connect the customer, team and job value" },
  expenses: { title: "Order expenses", eyebrow: "Know exactly where every rupee was spent" },
  payments: { title: "Payments", eyebrow: "Money received and money paid" },
  reports: { title: "Reports", eyebrow: "Revenue, cost and profitability" },
};
const modalTitles: Record<Exclude<ModalKind, null>, string> = {
  customer: "Create customer profile", person: "Add person or vendor", order: "Create a new order", invoice: "Create invoice", expense: "Add order expense", payment: "Record payment",
};
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmt = (value: number) => inr.format(value || 0);
const shortDate = (value: string) => value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const dateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const today = () => dateInputValue(new Date());
const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

function Status({ value }: { value: string }) {
  const tone = ["Paid", "Active", "Completed", "Received", "Advance"].includes(value) ? "success" : ["Overdue", "Cancelled", "Paid out"].includes(value) ? "danger" : ["Part paid", "In progress", "Sent", "Payment due"].includes(value) ? "warning" : "neutral";
  return <span className={`status ${tone}`}>{value}</span>;
}

function EmptyState({ title, copy, action, onClick }: { title: string; copy: string; action: string; onClick: () => void }) {
  return <div className="empty-state"><div className="empty-icon">＋</div><h3>{title}</h3><p>{copy}</p><button className="btn btn-primary" onClick={onClick}>{action}</button></div>;
}

export default function ExpenseDashboard({ initialSection, user }: { initialSection: string; user: PublicUser }) {
  const router = useRouter();
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [search, setSearch] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [toast, setToast] = useState("");

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/records", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load data");
      setData(body);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to load records");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3600); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!modal && !mobileMenu && !selectedCustomer && !selectedOrder) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modal, mobileMenu, selectedCustomer, selectedOrder]);

  const customerById = useCallback((id: string) => data.customers.find((item) => item.id === id), [data.customers]);
  const personById = useCallback((id: string) => data.persons.find((item) => item.id === id), [data.persons]);
  const orderById = useCallback((id: string) => data.orders.find((item) => item.id === id), [data.orders]);
  const totals = useMemo(() => {
    const invoiced = data.invoices.reduce((sum, item) => sum + item.total, 0);
    const received = data.payments.filter((item) => item.direction === "Received").reduce((sum, item) => sum + item.amount, 0);
    const invoiceBalance = data.invoices.reduce((sum, item) => sum + item.total - item.paidAmount, 0);
    const expensesTotal = data.expenses.reduce((sum, item) => sum + item.amount, 0);
    return { invoiced, received, expenses: expensesTotal, outstanding: Math.max(0, invoiceBalance), profit: received - expensesTotal };
  }, [data]);
  const customerBalance = useCallback((customer: Customer) => {
    const invoiceBalance = data.invoices.filter((item) => item.customerId === customer.id).reduce((sum, item) => sum + item.total - item.paidAmount, 0);
    const unallocatedReceipts = data.payments.filter((item) => item.customerId === customer.id && item.direction === "Received" && !item.invoiceId).reduce((sum, item) => sum + item.amount, 0);
    return customer.openingBalance + invoiceBalance - unallocatedReceipts;
  }, [data.invoices, data.payments]);
  const filteredCustomers = data.customers.filter((item) => `${item.name} ${item.businessName} ${item.phone}`.toLowerCase().includes(search.toLowerCase()));
  const filteredInvoices = data.invoices.filter((item) => `${item.invoiceNo} ${customerById(item.customerId)?.businessName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const openModal = (kind: Exclude<ModalKind, null>) => {
    if (!canCreateRecord(user.role, kind)) {
      setToast(`${roleLabels[user.role]} access does not include this action`);
      return;
    }
    setFormError(""); setFile(null); setEditingOrder(null); setModal(kind);
  };
  const editOrder = (order: Order) => {
    if (user.role !== "admin") {
      setToast("Only an administrator can edit orders");
      return;
    }
    setFormError(""); setFile(null); setEditingOrder(order); setModal("order");
  };

  const uploadDocument = async () => {
    if (!file) return null;
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) throw new Error("Choose a PDF, JPG, PNG, or WebP file");
    if (file.size > 10 * 1024 * 1024) throw new Error("The file must be smaller than 10 MB");
    const form = new FormData(); form.append("file", file); form.append("kind", modal ?? "");
    const response = await fetch("/api/upload", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Document upload failed");
    return body as { key: string; name: string; type: string };
  };

  const submitRecord = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!modal) return; setSaving(true); setFormError("");
    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries()) as Record<string, unknown>; delete payload.file;
      if ((modal === "invoice" || modal === "expense") && file) {
        const upload = await uploadDocument();
        if (upload && modal === "invoice") { payload.attachmentKey = upload.key; payload.attachmentName = upload.name; payload.attachmentType = upload.type; }
        if (upload && modal === "expense") { payload.receiptKey = upload.key; payload.receiptName = upload.name; }
      }
      const isOrderEdit = modal === "order" && Boolean(editingOrder);
      const response = await fetch("/api/records", { method: isOrderEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: modal, id: editingOrder?.id, payload }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to save record");
      setModal(null); setEditingOrder(null); setFile(null); setToast(isOrderEdit ? "Order updated successfully" : `${modalTitles[modal]} saved successfully`); await loadData();
    } catch (error) { setFormError(error instanceof Error ? error.message : "Unable to save record"); }
    finally { setSaving(false); }
  };

  const exportExpenses = () => {
    const rows = [["Expense no", "Date", "Order", "Person", "Category", "Vendor", "Amount", "Payment mode"], ...data.expenses.map((expense) => [expense.expenseNo, expense.expenseDate, orderById(expense.orderId)?.title ?? "", personById(expense.personId)?.name ?? "", expense.category, expense.vendor, String(expense.amount), expense.paymentMode])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `expense-report-${today()}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const sectionMeta = titles[initialSection] ?? titles.overview;
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? "open" : ""}`}>
      <div className="brand-row"><Image className="sidebar-logo" src="/erentals-logo.png" alt="eRentals" width={92} height={48} priority /><div><div className="brand-name">Expense Manager</div><div className="brand-sub">Team workspace</div></div><button className="icon-btn sidebar-close" onClick={() => setMobileMenu(false)} aria-label="Close menu">×</button></div>
      <nav className="nav-list" aria-label="Main navigation"><span className="nav-label">{roleLabels[user.role]} workspace</span>{navItems.filter((item) => canViewSection(user.role, item.key)).map((item) => <Link key={item.key} href={item.href} className={`nav-item ${initialSection === item.key ? "active" : ""}`} onClick={() => setMobileMenu(false)}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{item.key === "invoices" && totals.outstanding > 0 && <span className="nav-dot" />}</Link>)}</nav>
      <div className="sidebar-help"><div className="help-icon">?</div><strong>Need help?</strong><p>Keep every order, bill and expense connected.</p></div>
      <div className="sidebar-user"><div className="avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><span>{roleLabels[user.role]}</span><div className="user-links"><Link href="/change-password">Password</Link><button type="button" onClick={logout}>Sign out</button></div></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-btn mobile-toggle" onClick={() => setMobileMenu(true)} aria-label="Open menu">☰</button><div className="title-block"><span>{sectionMeta.eyebrow}</span><h1>{sectionMeta.title}</h1></div><div className="topbar-actions"><label className="global-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records" aria-label="Search records" /></label><button className="icon-btn notification" title="Notifications" aria-label="Notifications">◌<span /></button>{canCreateRecord(user.role, "expense") && <button className="btn btn-primary" onClick={() => openModal("expense")} aria-label="Add expense"><span aria-hidden="true">＋</span><span className="desktop-label">Add expense</span></button>}</div></header>
      <div className="content-area">{loading ? <LoadingScreen /> : <>
        {initialSection === "overview" && <Overview data={data} totals={totals} openModal={openModal} customerById={customerById} orderById={orderById} user={user} />}
        {initialSection === "customers" && <CustomersPage customers={filteredCustomers} customerBalance={customerBalance} openModal={openModal} viewCustomer={setSelectedCustomer} />}
        {initialSection === "invoices" && <InvoicesPage invoices={filteredInvoices} customerById={customerById} personById={personById} openModal={openModal} />}
        {initialSection === "persons" && <PersonsPage persons={data.persons} orders={data.orders} expenses={data.expenses} openModal={openModal} />}
        {initialSection === "orders" && <OrdersPage data={data} openModal={openModal} customerById={customerById} personById={personById} user={user} editOrder={editOrder} viewTransactions={setSelectedOrder} />}
        {initialSection === "expenses" && <ExpensesPage expenses={data.expenses} orderById={orderById} personById={personById} openModal={openModal} exportExpenses={exportExpenses} />}
        {initialSection === "payments" && <PaymentsPage payments={data.payments} customerById={customerById} orderById={orderById} personById={personById} openModal={openModal} />}
        {initialSection === "reports" && <ReportsPage data={data} totals={totals} exportExpenses={exportExpenses} />}
      </>}</div>
    </main>
    {mobileMenu && <button className="menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}
    {modal && <RecordModal kind={modal} data={data} user={user} editingOrder={editingOrder} file={file} setFile={setFile} error={formError} saving={saving} onClose={() => { setModal(null); setEditingOrder(null); }} onSubmit={submitRecord} />}
    {selectedCustomer && <CustomerDrawer customer={selectedCustomer} data={data} onClose={() => setSelectedCustomer(null)} />}
    {selectedOrder && <OrderTransactionHistory order={selectedOrder} data={data} customerById={customerById} personById={personById} onClose={() => setSelectedOrder(null)} />}
    {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
  </div>;
}

function LoadingScreen() { return <div className="loading-grid"><div className="skeleton sk-wide" />{[1,2,3,4].map((item) => <div key={item} className="skeleton" />)}<div className="skeleton sk-chart" /><div className="skeleton sk-chart" /></div>; }
function PageHead({ copy, action, secondary }: { copy: string; action?: React.ReactNode; secondary?: React.ReactNode }) { return <div className="page-head"><p>{copy}</p><div className="page-head-actions">{secondary}{action}</div></div>; }

function Overview({ data, totals, openModal, customerById, orderById, user }: { data: AppData; totals: { invoiced: number; received: number; expenses: number; outstanding: number; profit: number }; openModal: (kind: Exclude<ModalKind, null>) => void; customerById: (id: string) => Customer | undefined; orderById: (id: string) => Order | undefined; user: PublicUser }) {
  const bars = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(); month.setDate(1); month.setMonth(month.getMonth() - (5 - index));
    const key = month.toISOString().slice(0, 7);
    return {
      label: new Intl.DateTimeFormat("en-IN", { month: "short" }).format(month),
      received: data.payments.filter((item) => item.direction === "Received" && item.paymentDate.startsWith(key)).reduce((sum, item) => sum + item.amount, 0),
      spent: data.expenses.filter((item) => item.expenseDate.startsWith(key)).reduce((sum, item) => sum + item.amount, 0),
    };
  });
  const barMax = Math.max(1, ...bars.flatMap((bar) => [bar.received, bar.spent]));
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const recent = [...data.payments.slice(0, 3).map((item) => ({ id: item.id, kind: item.direction === "Received" ? "Received" : "Paid", title: item.direction === "Received" ? customerById(item.customerId)?.businessName || "Customer payment" : item.notes || "Outgoing payment", meta: `${item.method} · ${shortDate(item.paymentDate)}`, amount: item.direction === "Received" ? item.amount : -item.amount })), ...data.expenses.slice(0, 3).map((item) => ({ id: item.id, kind: "Expense", title: item.description || item.category, meta: `${orderById(item.orderId)?.orderNo || "Order"} · ${shortDate(item.expenseDate)}`, amount: -item.amount }))].slice(0, 5);
  const metricCards = user.role === "supervisor"
    ? [
        { label: "Active orders", value: String(data.orders.filter((item) => item.status !== "Completed").length), change: "Jobs requiring execution", icon: "◇", tone: "green" },
        { label: "People & vendors", value: String(data.persons.length), change: "Available execution contacts", icon: "♧", tone: "blue" },
        { label: "Execution expenses", value: fmt(totals.expenses), change: "Cost visible to supervisors", icon: "↗", tone: "orange" },
        { label: "Customers", value: String(data.customers.length), change: "Connected to current orders", icon: "◎", tone: "red" },
      ]
    : user.role === "sales"
      ? [
          { label: "Sales invoiced", value: fmt(totals.invoiced), change: "Across visible invoices", icon: "▤", tone: "green" },
          { label: "Outstanding", value: fmt(totals.outstanding), change: "Awaiting customer payment", icon: "!", tone: "red" },
          { label: "Active orders", value: String(data.orders.filter((item) => item.status !== "Completed").length), change: "Open sales commitments", icon: "◇", tone: "blue" },
          { label: "Customers", value: String(data.customers.length), change: "Managed customer profiles", icon: "◎", tone: "orange" },
        ]
      : [
          { label: "Total invoiced", value: fmt(totals.invoiced), change: "Across all invoices", icon: "▤", tone: "green" },
          { label: "Payments received", value: fmt(totals.received), change: `${totals.invoiced ? Math.round((totals.received / totals.invoiced) * 100) : 0}% collection rate`, icon: "↓", tone: "blue" },
          { label: "Total expenses", value: fmt(totals.expenses), change: "Order execution cost", icon: "↗", tone: "orange" },
          { label: "Outstanding", value: fmt(totals.outstanding), change: `${data.invoices.filter((item) => item.status === "Overdue").length} overdue invoice`, icon: "!", tone: "red" },
        ];
  return <div className="section-stack">
    <section className="welcome-strip"><div><span className="mini-label">{dateLabel} · {roleLabels[user.role]} dashboard</span><h2>Welcome back, {user.name.split(" ")[0]}.</h2><p>You have <strong>{data.invoices.filter((item) => item.status !== "Paid").length} open invoices</strong> and <strong>{data.orders.filter((item) => item.status !== "Completed").length} active orders</strong> visible in your workspace.</p></div><div className="quick-actions">{canCreateRecord(user.role, "customer") && <button onClick={() => openModal("customer")}><span>◎</span><b>New customer</b></button>}{canCreateRecord(user.role, "invoice") && <button onClick={() => openModal("invoice")}><span>▤</span><b>Create invoice</b></button>}{canCreateRecord(user.role, "order") && <button onClick={() => openModal("order")}><span>◇</span><b>New order</b></button>}{canCreateRecord(user.role, "expense") && <button onClick={() => openModal("expense")}><span>↗</span><b>Add expense</b></button>}{canCreateRecord(user.role, "payment") && <button onClick={() => openModal("payment")}><span>₹</span><b>Record payment</b></button>}</div></section>
    <section className="metric-grid">{metricCards.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    {(canViewSection(user.role, "payments") || canViewSection(user.role, "invoices")) && <section className="dashboard-grid">{canViewSection(user.role, "payments") && <article className="panel cashflow-panel"><div className="panel-head"><div><span className="overline">Cash movement</span><h3>Cash flow</h3></div><div className="legend"><span><i className="green-dot" />Received</span><span><i className="orange-dot" />Spent</span></div></div><div className="bar-chart" aria-label="Six month cash flow chart">{bars.map((bar) => <div className="bar-group" key={bar.label}><div className="bar-pair"><i className="bar received" style={{ height: `${bar.received ? Math.max(5, (bar.received / barMax) * 94) : 0}%` }} /><i className="bar spent" style={{ height: `${bar.spent ? Math.max(5, (bar.spent / barMax) * 94) : 0}%` }} /></div><span>{bar.label}</span></div>)}</div><div className="cashflow-footer"><span>Net cash position</span><strong className={totals.profit >= 0 ? "positive" : "negative"}>{fmt(totals.profit)}</strong></div></article>}
      {canViewSection(user.role, "invoices") && <article className="panel outstanding-panel"><div className="panel-head"><div><span className="overline">Needs attention</span><h3>Outstanding invoices</h3></div><Link href="/invoices">View all →</Link></div><div className="invoice-list">{data.invoices.filter((item) => item.status !== "Paid").slice(0, 4).map((invoice) => <div className="invoice-list-row" key={invoice.id}><div className="invoice-symbol">{initials(customerById(invoice.customerId)?.businessName || "IN")}</div><div className="grow"><strong>{customerById(invoice.customerId)?.businessName || "Customer"}</strong><span>{invoice.invoiceNo} · Due {shortDate(invoice.dueDate)}</span></div><div className="amount-stack"><strong>{fmt(invoice.total - invoice.paidAmount)}</strong><Status value={invoice.status} /></div></div>)}{!data.invoices.some((item) => item.status !== "Paid") && <div className="mini-empty">You’re all caught up. No invoices are outstanding.</div>}</div></article>}</section>}
    {(canViewSection(user.role, "payments") || canViewSection(user.role, "expenses")) && <section className="panel activity-panel"><div className="panel-head"><div><span className="overline">Latest entries</span><h3>Recent activity</h3></div><Link href={canViewSection(user.role, "payments") ? "/payments" : "/expenses"}>Open ledger →</Link></div><div className="activity-table">{recent.map((item) => <div className="activity-row" key={`${item.kind}-${item.id}`}><span className={`activity-icon ${item.amount >= 0 ? "in" : "out"}`}>{item.amount >= 0 ? "↓" : "↑"}</span><div className="grow"><strong>{item.title}</strong><span>{item.meta}</span></div><span className="activity-kind">{item.kind}</span><strong className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : "−"}{fmt(Math.abs(item.amount))}</strong></div>)}{!recent.length && <div className="mini-empty">Your latest payments and expenses will appear here.</div>}</div></section>}
  </div>;
}

function MetricCard({ label, value, change, icon, tone }: { label: string; value: string; change: string; icon: string; tone: string }) { return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{change}</small></article>; }

function CustomersPage({ customers, customerBalance, openModal, viewCustomer }: { customers: Customer[]; customerBalance: (customer: Customer) => number; openModal: (kind: Exclude<ModalKind, null>) => void; viewCustomer: (customer: Customer) => void }) {
  return <div className="section-stack"><PageHead copy={`${customers.length} customer profiles with a complete receivable trail.`} action={<button className="btn btn-primary" onClick={() => openModal("customer")}>＋ Add customer</button>} />{customers.length ? <div className="panel table-panel"><div className="data-table customer-table"><div className="table-row table-header"><span>Customer</span><span>Contact</span><span>GSTIN</span><span>Receivable</span><span>Status</span><span /></div>{customers.map((customer) => { const balance = customerBalance(customer); return <div className="table-row" key={customer.id}><div className="entity-cell"><span className="avatar mint">{initials(customer.businessName)}</span><div><strong>{customer.businessName}</strong><small>{customer.name}</small></div></div><div><strong>{customer.phone}</strong><small>{customer.email || "No email"}</small></div><span>{customer.gstin || "Not added"}</span><strong className={balance > 0 ? "negative" : "positive"}>{balance < 0 ? `${fmt(Math.abs(balance))} advance` : fmt(balance)}</strong><Status value={balance > 0 ? "Payment due" : balance < 0 ? "Advance" : "Paid"} /><button className="text-btn" onClick={() => viewCustomer(customer)}>View profile →</button></div>; })}</div></div> : <EmptyState title="Add your first customer" copy="Create a profile to connect orders, invoices and payments." action="Create customer" onClick={() => openModal("customer")} />}</div>;
}

function InvoicesPage({ invoices, customerById, personById, openModal }: { invoices: Invoice[]; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; openModal: (kind: Exclude<ModalKind, null>) => void }) {
  const totalDue = invoices.reduce((sum, item) => sum + item.total - item.paidAmount, 0);
  return <div className="section-stack"><PageHead copy={`${invoices.length} invoices · ${fmt(totalDue)} currently receivable.`} action={<button className="btn btn-primary" onClick={() => openModal("invoice")}>＋ Create invoice</button>} secondary={<button className="btn btn-secondary" onClick={() => openModal("payment")}>Record payment</button>} />{invoices.length ? <div className="panel table-panel"><div className="data-table invoice-table"><div className="table-row table-header"><span>Invoice</span><span>Customer</span><span>Dates</span><span>Responsible person</span><span>Amount</span><span>Status</span><span>File</span></div>{invoices.map((invoice) => <div className="table-row" key={invoice.id}><div><strong>{invoice.invoiceNo}</strong><small>{invoice.notes || "Sales invoice"}</small></div><div><strong>{customerById(invoice.customerId)?.businessName || "—"}</strong><small>{customerById(invoice.customerId)?.name || ""}</small></div><div><strong>{shortDate(invoice.issueDate)}</strong><small>Due {shortDate(invoice.dueDate)}</small></div><div className="entity-inline"><span className="avatar tiny">{initials(personById(invoice.billedPersonId)?.name || "NA")}</span><span>{personById(invoice.billedPersonId)?.name || "—"}</span></div><div><strong>{fmt(invoice.total)}</strong><small>{invoice.paidAmount ? `${fmt(invoice.paidAmount)} received` : "No payment"}</small></div><Status value={invoice.status} />{invoice.attachmentKey ? <a className="file-link" href={`/api/upload?key=${encodeURIComponent(invoice.attachmentKey)}`} target="_blank" rel="noreferrer" title={invoice.attachmentName}>▤ View</a> : <span className="muted">—</span>}</div>)}</div></div> : <EmptyState title="Create your first invoice" copy="Attach an existing PDF or image while creating the invoice." action="Create invoice" onClick={() => openModal("invoice")} />}</div>;
}

function PersonsPage({ persons, orders, expenses, openModal }: { persons: Person[]; orders: Order[]; expenses: Expense[]; openModal: (kind: Exclude<ModalKind, null>) => void }) {
  return <div className="section-stack"><PageHead copy="Add team members, contractors, vendors or accountants, then assign them to orders and expenses." action={<button className="btn btn-primary" onClick={() => openModal("person")}>＋ Add person</button>} />{persons.length ? <div className="person-grid">{persons.map((person) => { const assignedOrders = orders.filter((order) => order.assignedPersonId === person.id).length; const spend = expenses.filter((expense) => expense.personId === person.id).reduce((sum, expense) => sum + expense.amount, 0); return <article className="person-card" key={person.id}><div className="person-card-head"><span className="avatar large">{initials(person.name)}</span><Status value={person.status} /></div><h3>{person.name}</h3><p>{person.role}</p><div className="contact-lines"><span>☎ {person.phone}</span><span>✉ {person.email || "No email added"}</span></div><div className="person-stats"><div><span>Assigned orders</span><strong>{assignedOrders}</strong></div><div><span>Expenses handled</span><strong>{fmt(spend)}</strong></div></div><div className="person-footer"><span>Preferred payment</span><strong>{person.paymentMode}</strong></div></article>; })}</div> : <EmptyState title="Build your execution team" copy="Add the people who create bills, manage orders or spend against jobs." action="Add person" onClick={() => openModal("person")} />}</div>;
}

function OrdersPage({ data, openModal, customerById, personById, user, editOrder, viewTransactions }: { data: AppData; openModal: (kind: Exclude<ModalKind, null>) => void; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; user: PublicUser; editOrder: (order: Order) => void; viewTransactions: (order: Order) => void }) {
  return <div className="section-stack"><PageHead copy={`${data.orders.length} orders connecting sales value with execution cost and payment history.`} action={<button className="btn btn-primary" onClick={() => openModal("order")}>＋ Create order</button>} />{data.orders.length ? <div className="order-grid">{data.orders.map((order) => { const orderExpenses = data.expenses.filter((item) => item.orderId === order.id); const orderPayments = data.payments.filter((item) => item.orderId === order.id); const orderInvoices = data.invoices.filter((item) => item.orderId === order.id); const cost = orderExpenses.reduce((sum, item) => sum + item.amount, 0); const margin = order.contractValue - cost; const progress = Math.min(100, order.contractValue ? (cost / order.contractValue) * 100 : 0); const transactionCount = orderExpenses.length + orderPayments.length + orderInvoices.length; return <article className="order-card" key={order.id}><div className="order-top"><span className="order-no">{order.orderNo}</span><Status value={order.status} /></div><h3>{order.title}</h3><p>{customerById(order.customerId)?.businessName || "Customer"}</p><div className="order-meta"><span>⌖ {order.venue || "Venue not added"}</span><span>◷ {shortDate(order.eventDate)}</span></div><div className="assigned-person"><span className="avatar tiny">{initials(personById(order.assignedPersonId)?.name || "NA")}</span><div><small>Execution lead</small><strong>{personById(order.assignedPersonId)?.name || "Unassigned"}</strong></div></div><div className="budget-line"><span>Execution cost</span><span>{fmt(cost)} of {fmt(order.contractValue)}</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="order-values"><div><span>Order value</span><strong>{fmt(order.contractValue)}</strong></div><div><span>Gross margin</span><strong className={margin >= 0 ? "positive" : "negative"}>{fmt(margin)}</strong></div></div><div className="order-actions"><button type="button" className="text-btn" onClick={() => viewTransactions(order)}>View {transactionCount} transaction{transactionCount === 1 ? "" : "s"} →</button>{user.role === "admin" && <button type="button" className="btn btn-secondary btn-small" onClick={() => editOrder(order)}>Edit order</button>}</div></article>; })}</div> : <EmptyState title="Create your first order" copy="An order connects the customer, execution lead, invoices, payments and expenses." action="Create order" onClick={() => openModal("order")} />}</div>;
}

function ExpensesPage({ expenses, orderById, personById, openModal, exportExpenses }: { expenses: Expense[]; orderById: (id: string) => Order | undefined; personById: (id: string) => Person | undefined; openModal: (kind: Exclude<ModalKind, null>) => void; exportExpenses: () => void }) {
  return <div className="section-stack"><PageHead copy={`${expenses.length} expenses · ${fmt(expenses.reduce((sum, item) => sum + item.amount, 0))} total execution cost.`} action={<button className="btn btn-primary" onClick={() => openModal("expense")}>＋ Add expense</button>} secondary={<button className="btn btn-secondary" onClick={exportExpenses}>⇩ Export CSV</button>} />{expenses.length ? <div className="panel table-panel"><div className="data-table expense-table"><div className="table-row table-header"><span>Expense</span><span>Order</span><span>Person</span><span>Category / vendor</span><span>Payment</span><span>Amount</span><span>Receipt</span></div>{expenses.map((expense) => <div className="table-row" key={expense.id}><div><strong>{expense.description || expense.expenseNo}</strong><small>{expense.expenseNo} · {shortDate(expense.expenseDate)}</small></div><div><strong>{orderById(expense.orderId)?.title || "—"}</strong><small>{orderById(expense.orderId)?.orderNo || ""}</small></div><div className="entity-inline"><span className="avatar tiny">{initials(personById(expense.personId)?.name || "NA")}</span><span>{personById(expense.personId)?.name || "—"}</span></div><div><strong>{expense.category}</strong><small>{expense.vendor || "No vendor"}</small></div><span>{expense.paymentMode}</span><strong className="negative">{fmt(expense.amount)}</strong>{expense.receiptKey ? <a className="file-link" href={`/api/upload?key=${encodeURIComponent(expense.receiptKey)}`} target="_blank" rel="noreferrer">▤ View</a> : <span className="muted">—</span>}</div>)}</div></div> : <EmptyState title="Record an order expense" copy="Choose the order and person responsible, then attach a receipt if available." action="Add expense" onClick={() => openModal("expense")} />}</div>;
}

function PaymentsPage({ payments, customerById, orderById, personById, openModal }: { payments: Payment[]; customerById: (id: string) => Customer | undefined; orderById: (id: string) => Order | undefined; personById: (id: string) => Person | undefined; openModal: (kind: Exclude<ModalKind, null>) => void }) {
  return <div className="section-stack"><PageHead copy="Every customer receipt and vendor payout is recorded against an order ID." action={<button className="btn btn-primary" onClick={() => openModal("payment")}>＋ Record payment</button>} />{payments.length ? <div className="panel table-panel"><div className="data-table payment-table"><div className="table-row table-header"><span>Date</span><span>Type</span><span>Order ID / party</span><span>Method</span><span>Reference</span><span>Amount</span></div>{payments.map((payment) => { const order = orderById(payment.orderId); const party = payment.direction === "Received" ? customerById(payment.customerId)?.businessName : personById(payment.personId)?.name; return <div className="table-row" key={payment.id}><strong>{shortDate(payment.paymentDate)}</strong><Status value={payment.direction === "Paid" ? "Paid out" : payment.direction} /><div><strong>{order?.orderNo || "Legacy payment"}</strong><small>{party || payment.notes || order?.title || "Party not available"}</small></div><span>{payment.method}</span><span>{payment.reference || "—"}</span><strong className={payment.direction === "Received" ? "positive" : "negative"}>{payment.direction === "Received" ? "+" : "−"}{fmt(payment.amount)}</strong></div>; })}</div></div> : <EmptyState title="Start your payment ledger" copy="Choose an order ID, then record a customer receipt or vendor payout." action="Record payment" onClick={() => openModal("payment")} />}</div>;
}

function ReportsPage({ data, totals, exportExpenses }: { data: AppData; totals: { invoiced: number; received: number; expenses: number; outstanding: number; profit: number }; exportExpenses: () => void }) {
  const categories = Array.from(new Set(data.expenses.map((item) => item.category))).map((category) => ({ name: category, value: data.expenses.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount, 0) })).sort((a, b) => b.value - a.value); const max = Math.max(...categories.map((item) => item.value), 1); const efficiency = totals.invoiced ? Math.round((totals.received / totals.invoiced) * 100) : 0;
  return <div className="section-stack"><PageHead copy="A clear view of collection efficiency and job profitability." action={<button className="btn btn-primary" onClick={exportExpenses}>⇩ Export expense report</button>} /><section className="report-hero"><div><span>Gross cash profit</span><strong className={totals.profit >= 0 ? "positive" : "negative"}>{fmt(totals.profit)}</strong><p>Payments received minus recorded execution expenses.</p></div><div className="report-score"><i style={{ "--score": `${efficiency}%` } as React.CSSProperties}><span>{efficiency}%</span></i><p>Collection efficiency</p></div></section><section className="report-grid"><article className="panel category-panel"><div className="panel-head"><div><span className="overline">Cost analysis</span><h3>Expenses by category</h3></div></div><div className="category-bars">{categories.map((item) => <div className="category-row" key={item.name}><div><span>{item.name}</span><strong>{fmt(item.value)}</strong></div><i><b style={{ width: `${(item.value / max) * 100}%` }} /></i></div>)}{!categories.length && <div className="mini-empty">Add expenses to see the cost split.</div>}</div></article><article className="panel report-summary"><div className="panel-head"><div><span className="overline">Financial summary</span><h3>Current position</h3></div></div><div className="summary-lines"><div><span>Sales invoiced</span><strong>{fmt(totals.invoiced)}</strong></div><div><span>Payments collected</span><strong className="positive">{fmt(totals.received)}</strong></div><div><span>Order expenses</span><strong className="negative">{fmt(totals.expenses)}</strong></div><div><span>Receivables pending</span><strong>{fmt(totals.outstanding)}</strong></div><div className="summary-total"><span>Cash profit</span><strong>{fmt(totals.profit)}</strong></div></div></article></section></div>;
}

function CustomerDrawer({ customer, data, onClose }: { customer: Customer; data: AppData; onClose: () => void }) {
  const customerInvoices = data.invoices.filter((item) => item.customerId === customer.id); const customerOrders = data.orders.filter((item) => item.customerId === customer.id); const customerReceipts = data.payments.filter((item) => item.customerId === customer.id && item.direction === "Received"); const unallocatedReceipts = customerReceipts.filter((item) => !item.invoiceId).reduce((sum, item) => sum + item.amount, 0); const due = customer.openingBalance + customerInvoices.reduce((sum, item) => sum + item.total - item.paidAmount, 0) - unallocatedReceipts;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="customer-drawer" role="dialog" aria-modal="true" aria-label="Customer profile"><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="profile-hero"><span className="avatar profile-avatar">{initials(customer.businessName)}</span><h2>{customer.businessName}</h2><p>{customer.name}</p><Status value={due > 0 ? "Payment due" : "Paid"} /></div><div className="profile-balance"><span>{due >= 0 ? "Total receivable" : "Customer advance"}</span><strong>{fmt(Math.abs(due))}</strong></div><div className="profile-details"><div><span>Phone</span><strong>{customer.phone}</strong></div><div><span>Email</span><strong>{customer.email || "Not added"}</strong></div><div><span>GSTIN</span><strong>{customer.gstin || "Not added"}</strong></div><div><span>Address</span><strong>{customer.address || "Not added"}</strong></div></div><div className="drawer-section"><h3>Customer activity</h3><div className="profile-stats"><div><strong>{customerOrders.length}</strong><span>Orders</span></div><div><strong>{customerInvoices.length}</strong><span>Invoices</span></div><div><strong>{fmt(customerReceipts.reduce((sum, item) => sum + item.amount, 0))}</strong><span>Received</span></div></div></div><div className="drawer-section"><h3>Invoices</h3>{customerInvoices.slice(0, 5).map((invoice) => <div className="drawer-invoice" key={invoice.id}><div><strong>{invoice.invoiceNo}</strong><span>Due {shortDate(invoice.dueDate)}</span></div><div><strong>{fmt(invoice.total)}</strong><Status value={invoice.status} /></div></div>)}{!customerInvoices.length && <div className="mini-empty">No invoices created yet.</div>}</div></aside></div>;
}

function OrderTransactionHistory({ order, data, customerById, personById, onClose }: { order: Order; data: AppData; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; onClose: () => void }) {
  const orderPayments = data.payments.filter((item) => item.orderId === order.id);
  const orderExpenses = data.expenses.filter((item) => item.orderId === order.id);
  const orderInvoices = data.invoices.filter((item) => item.orderId === order.id);
  const received = orderPayments.filter((item) => item.direction === "Received").reduce((sum, item) => sum + item.amount, 0);
  const vendorPaid = orderPayments.filter((item) => item.direction === "Paid").reduce((sum, item) => sum + item.amount, 0);
  const expenseTotal = orderExpenses.reduce((sum, item) => sum + item.amount, 0);
  const transactions = [
    ...orderPayments.map((payment) => ({
      id: `payment-${payment.id}`,
      date: payment.paymentDate,
      type: payment.direction === "Received" ? "Customer receipt" : "Vendor payment",
      title: payment.direction === "Received" ? customerById(payment.customerId)?.businessName || "Customer" : personById(payment.personId)?.name || "Vendor / payee",
      meta: [payment.method, payment.reference].filter(Boolean).join(" · ") || "Payment",
      amount: payment.direction === "Received" ? payment.amount : -payment.amount,
    })),
    ...orderExpenses.map((expense) => ({
      id: `expense-${expense.id}`,
      date: expense.expenseDate,
      type: "Order expense",
      title: expense.description || expense.category,
      meta: [expense.expenseNo, expense.vendor || personById(expense.personId)?.name].filter(Boolean).join(" · "),
      amount: -expense.amount,
    })),
    ...orderInvoices.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      date: invoice.issueDate,
      type: "Invoice issued",
      title: invoice.invoiceNo,
      meta: customerById(invoice.customerId)?.businessName || "Customer invoice",
      amount: invoice.total,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="customer-drawer transaction-drawer" role="dialog" aria-modal="true" aria-label={`Transactions for ${order.orderNo}`}><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="transaction-head"><span className="order-no">{order.orderNo}</span><h2>{order.title}</h2><p>{customerById(order.customerId)?.businessName || "Customer"} · {shortDate(order.eventDate)}</p></div><div className="transaction-summary"><div><span>Received</span><strong className="positive">{fmt(received)}</strong></div><div><span>Vendor paid</span><strong className="negative">{fmt(vendorPaid)}</strong></div><div><span>Expenses</span><strong>{fmt(expenseTotal)}</strong></div><div><span>Net cash</span><strong className={received - vendorPaid >= 0 ? "positive" : "negative"}>{fmt(received - vendorPaid)}</strong></div></div><div className="drawer-section"><h3>Complete order history</h3><div className="transaction-list">{transactions.map((item) => <div className="transaction-item" key={item.id}><span className={`activity-icon ${item.amount >= 0 ? "in" : "out"}`}>{item.amount >= 0 ? "↓" : "↑"}</span><div className="grow"><strong>{item.title}</strong><span>{item.type} · {item.meta}</span><small>{shortDate(item.date)}</small></div><strong className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : "−"}{fmt(Math.abs(item.amount))}</strong></div>)}{!transactions.length && <div className="mini-empty">No invoices, expenses or payments have been recorded for this order.</div>}</div></div></aside></div>;
}

function RecordModal({ kind, data, user, editingOrder, file, setFile, error, saving, onClose, onSubmit }: { kind: Exclude<ModalKind, null>; data: AppData; user: PublicUser; editingOrder: Order | null; file: File | null; setFile: (file: File | null) => void; error: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => { const due = new Date(); due.setDate(due.getDate() + 15); return dateInputValue(due); });
  const [paymentDirection, setPaymentDirection] = useState("Received");
  const [paymentOrderId, setPaymentOrderId] = useState("");
  const nextInvoice = `INV-${new Date().getFullYear()}-${String(data.invoices.length + 1).padStart(3, "0")}`; const nextOrder = `ORD-${String(data.orders.length + 1).padStart(4, "0")}`; const nextExpense = `EXP-${String(data.expenses.length + 1).padStart(4, "0")}`; const customerOrders = data.orders.filter((order) => order.customerId === invoiceCustomerId); const paymentOrder = data.orders.find((order) => order.id === paymentOrderId); const paymentDirections = ["Received", "Paid"].filter((direction) => canRecordPayment(user.role, direction));
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="record-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><span className="overline">eKhata workspace</span><h2 id="modal-title">{kind === "order" && editingOrder ? "Edit order" : modalTitles[kind]}</h2><p>Fields marked with * are required.</p></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></div><form onSubmit={onSubmit}><div className="form-grid">
    {kind === "customer" && <><Field label="Contact person *"><input name="name" required placeholder="e.g. Rohan Mehta" /></Field><Field label="Business / company name *"><input name="businessName" required placeholder="e.g. Quest Strategy" /></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" placeholder="accounts@company.com" /></Field><Field label="GSTIN"><input name="gstin" placeholder="27ABCDE1234F1Z5" /></Field><Field label="Opening balance"><input name="openingBalance" type="number" defaultValue="0" /></Field><Field label="Billing address" wide><textarea name="address" rows={3} placeholder="Full billing address" /></Field></>}
    {kind === "person" && <><Field label="Full name *"><input name="name" required placeholder="Person or vendor name" /></Field><Field label="Role / type *"><select name="role" required defaultValue=""><option value="" disabled>Select role</option><option>Team member</option><option>Execution manager</option><option>Sales & billing</option><option>Accountant</option><option>Vendor</option><option>Contractor</option><option>Labour supervisor</option></select></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" placeholder="name@example.com" /></Field><Field label="Preferred payment mode"><select name="paymentMode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Cheque</option></select></Field></>}
    {kind === "order" && <><Field label="Order number *"><input name="orderNo" required defaultValue={editingOrder?.orderNo ?? nextOrder} /></Field><Field label="Order title *"><input name="title" required defaultValue={editingOrder?.title ?? ""} placeholder="e.g. Corporate annual meet" /></Field><Field label="Customer *"><CustomerSelect customers={data.customers} name="customerId" defaultValue={editingOrder?.customerId} /></Field><Field label="Execution lead *"><PersonSelect persons={data.persons} name="assignedPersonId" defaultValue={editingOrder?.assignedPersonId} /></Field><Field label="Venue"><input name="venue" defaultValue={editingOrder?.venue ?? ""} placeholder="Event venue or site" /></Field><Field label="Event / delivery date *"><input name="eventDate" required type="date" defaultValue={editingOrder?.eventDate ?? today()} /></Field><Field label="Order value *"><input name="contractValue" required type="number" min="1" defaultValue={editingOrder?.contractValue} placeholder="0" /></Field><Field label="Status"><select name="status" defaultValue={editingOrder?.status ?? "Planned"}><option>Planned</option><option>In progress</option><option>Completed</option><option>Cancelled</option></select></Field></>}
    {kind === "invoice" && <><Field label="Invoice number *"><input name="invoiceNo" required defaultValue={nextInvoice} /></Field><Field label="Customer *"><select name="customerId" required value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}><option value="">{data.customers.length ? "Select customer" : "Add a customer first"}</option>{data.customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.businessName}</option>)}</select></Field><Field label="Order *"><select name="orderId" required defaultValue="" disabled={!invoiceCustomerId}><option value="">{!invoiceCustomerId ? "Select customer first" : customerOrders.length ? "Select order" : "No orders for this customer"}</option>{customerOrders.map((order) => <option value={order.id} key={order.id}>{order.orderNo} · {order.title}</option>)}</select></Field><Field label="Billed / responsible person *"><PersonSelect persons={data.persons} name="billedPersonId" /></Field><Field label="Issue date *"><input name="issueDate" required type="date" value={issueDate} onChange={(event) => { const value = event.target.value; setIssueDate(value); if (dueDate < value) setDueDate(value); }} /></Field><Field label="Due date *"><input name="dueDate" required type="date" min={issueDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field><Field label="Taxable amount *"><input name="subtotal" required type="number" min="1" placeholder="0" /></Field><Field label="GST / tax amount"><input name="tax" type="number" min="0" defaultValue="0" /></Field><Field label="Status"><select name="status"><option>Draft</option><option>Sent</option><option>Overdue</option></select></Field><Field label="Notes"><input name="notes" placeholder="Description or payment terms" /></Field><FileField file={file} setFile={setFile} label="Attach invoice PDF or image" /></>}
    {kind === "expense" && <><Field label="Expense number *"><input name="expenseNo" required defaultValue={nextExpense} /></Field><Field label="Order *"><OrderSelect orders={data.orders} name="orderId" /></Field><Field label="Person responsible *"><PersonSelect persons={data.persons} name="personId" /></Field><Field label="Expense date *"><input name="expenseDate" required type="date" defaultValue={today()} /></Field><Field label="Category *"><select name="category" required><option>Material rental</option><option>Fabrication</option><option>Labour</option><option>Transport</option><option>Venue</option><option>Food & hospitality</option><option>Printing & branding</option><option>Miscellaneous</option></select></Field><Field label="Vendor / payee"><input name="vendor" placeholder="Vendor or supplier" /></Field><Field label="Amount *"><input name="amount" required type="number" min="1" placeholder="0" /></Field><Field label="Payment mode"><select name="paymentMode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Credit card</option><option>Cheque</option></select></Field><Field label="Description" wide><textarea name="description" rows={2} placeholder="What was this expense for?" /></Field><FileField file={file} setFile={setFile} label="Attach receipt (optional)" /></>}
    {kind === "payment" && <><Field label="Payment type *"><select name="direction" required value={paymentDirection} onChange={(event) => setPaymentDirection(event.target.value)}>{paymentDirections.map((direction) => <option key={direction}>{direction}</option>)}</select></Field><Field label="Order ID *"><select name="orderId" required value={paymentOrderId} onChange={(event) => setPaymentOrderId(event.target.value)}><option value="">{data.orders.length ? "Select order" : "Create an order first"}</option>{data.orders.map((order) => <option value={order.id} key={order.id}>{order.orderNo} · {order.title}</option>)}</select></Field><Field label="Customer"><input value={paymentOrder ? data.customers.find((customer) => customer.id === paymentOrder.customerId)?.businessName || "Customer not available" : "Select an order to identify the customer"} readOnly /></Field>{paymentDirection === "Paid" && <Field label="Vendor / payee *"><PersonSelect persons={data.persons} name="personId" /></Field>}<Field label="Amount *"><input name="amount" required type="number" min="1" placeholder="0" /></Field><Field label="Payment date *"><input name="paymentDate" required type="date" defaultValue={today()} /></Field><Field label="Method *"><select name="method" required><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option><option>Credit card</option></select></Field><Field label="Reference"><input name="reference" placeholder="UTR, cheque no. or reference" /></Field><Field label="Notes"><input name="notes" placeholder="Short payment note" /></Field></>}
  </div>{((kind === "order" || kind === "invoice") && (!data.customers.length || !data.persons.length)) && <div className="form-hint">Add at least one customer and one person before saving this record.</div>}{kind === "expense" && (!data.orders.length || !data.persons.length) && <div className="form-hint">Create an order and add a person before recording its expense.</div>}{kind === "payment" && <div className="form-hint">Customer receipts and vendor payouts are stored against the selected order ID. Sales users can record receipts; accountants can record both types.</div>}{error && <div className="form-error" role="alert">! {error}</div>}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : kind === "order" && editingOrder ? "Update order" : `Save ${kind}`}</button></div></form></div></div>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`field ${wide ? "field-wide" : ""}`}><span>{label}</span>{children}</label>; }
function CustomerSelect({ customers, name, optional, defaultValue = "" }: { customers: Customer[]; name: string; optional?: boolean; defaultValue?: string }) { return <select name={name} required={!optional} defaultValue={defaultValue}><option value="">{customers.length ? "Select customer" : "Add a customer first"}</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.businessName}</option>)}</select>; }
function PersonSelect({ persons, name, defaultValue = "" }: { persons: Person[]; name: string; defaultValue?: string }) { return <select name={name} required defaultValue={defaultValue}><option value="">{persons.length ? "Select person" : "Add a person first"}</option>{persons.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select>; }
function OrderSelect({ orders, name }: { orders: Order[]; name: string }) { return <select name={name} required defaultValue=""><option value="">{orders.length ? "Select order" : "Create an order first"}</option>{orders.map((order) => <option value={order.id} key={order.id}>{order.orderNo} · {order.title}</option>)}</select>; }
function FileField({ file, setFile, label }: { file: File | null; setFile: (file: File | null) => void; label: string }) { return <label className="upload-field field-wide"><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="upload-icon">⇧</span><strong>{file ? file.name : label}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace` : "PDF, JPG, PNG or WebP · maximum 10 MB"}</small></label>; }
