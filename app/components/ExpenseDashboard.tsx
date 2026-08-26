"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { canCreateRecord, canRecordPayment, canViewSection, roleLabels } from "../auth/permissions";
import type { PublicUser } from "../auth/types";
import { calculateTentativeCost, type PricingBasis } from "../vendor-pricing";

type Customer = { id: string; name: string; businessName: string; phone: string; email: string; gstin: string; address: string; openingBalance: number; createdAt: string };
type Person = { id: string; name: string; role: string; phone: string; email: string; paymentMode: string; status: string; orderId: string; createdAt: string };
type Vendor = { id: string; name: string; contactPerson: string; phone: string; email: string; gstin: string; address: string; paymentMode: string; status: string; createdAt: string };
type VendorProduct = { id: string; vendorId: string; name: string; pricingBasis: PricingBasis; rentalCharge: number; status: string; createdAt: string };
type Order = { id: string; orderNo: string; title: string; customerId: string; salespersonId: string; assignedPersonId: string; venue: string; eventDate: string; status: string; contractValue: number; createdAt: string };
type Invoice = { id: string; invoiceNo: string; customerId: string; orderId: string; billedPersonId: string; issueDate: string; dueDate: string; subtotal: number; tax: number; total: number; paidAmount: number; status: string; notes: string; attachmentKey: string; attachmentName: string; attachmentType: string; createdAt: string };
type OrderVendor = { id: string; orderId: string; vendorId: string; productId: string; productName: string; pricingBasis: PricingBasis; unitRate: number; quantity: number; rentalDays: number; amount: number; notes: string; createdAt: string };
type OrderVendorDraft = { key: string; vendorId: string; productName: string; amount: number; notes: string };
type Expense = { id: string; expenseNo: string; orderId: string; personId: string; vendorId: string; category: string; vendor: string; description: string; expenseDate: string; amount: number; paymentMode: string; receiptKey: string; receiptName: string; createdAt: string };
type Payment = { id: string; orderId: string; personId: string; vendorId: string; invoiceId: string; customerId: string; direction: string; amount: number; paymentDate: string; method: string; reference: string; notes: string; createdAt: string };
type AppData = { customers: Customer[]; historyCustomers: Customer[]; persons: Person[]; vendors: Vendor[]; vendorProducts: VendorProduct[]; orders: Order[]; historyOrders: Order[]; orderVendors: OrderVendor[]; invoices: Invoice[]; expenses: Expense[]; payments: Payment[]; supervisorLinked?: boolean };
type ModalKind = "customer" | "person" | "vendor" | "vendorProduct" | "order" | "orderVendor" | "invoice" | "expense" | "payment" | null;

const emptyData: AppData = { customers: [], historyCustomers: [], persons: [], vendors: [], vendorProducts: [], orders: [], historyOrders: [], orderVendors: [], invoices: [], expenses: [], payments: [] };
const navItems = [
  { key: "overview", label: "Overview", icon: "⌂", href: "/" },
  { key: "customers", label: "Customers", icon: "◎", href: "/customers" },
  { key: "invoices", label: "Invoices", icon: "▤", href: "/invoices" },
  { key: "persons", label: "People", icon: "♧", href: "/persons" },
  { key: "vendors", label: "Vendors", icon: "▣", href: "/vendors" },
  { key: "orders", label: "Orders", icon: "◇", href: "/orders" },
  { key: "expenses", label: "Expenses", icon: "↗", href: "/expenses" },
  { key: "payments", label: "Payments", icon: "₹", href: "/payments" },
  { key: "reports", label: "Reports", icon: "▥", href: "/reports" },
  { key: "history", label: "Order history", icon: "◷", href: "/history" },
  { key: "users", label: "Team access", icon: "♙", href: "/users" },
];
const titles: Record<string, { title: string; eyebrow: string }> = {
  overview: { title: "Business overview", eyebrow: "Your financial command centre" },
  customers: { title: "Customers", eyebrow: "Profiles, balances and activity" },
  invoices: { title: "Invoices", eyebrow: "Create, attach and track every bill" },
  persons: { title: "People & vendors", eyebrow: "Everyone involved in billing and execution" },
  vendors: { title: "Vendor records", eyebrow: "Suppliers, assignments, expenses and payments" },
  orders: { title: "Orders", eyebrow: "Connect the customer, team and job value" },
  expenses: { title: "Order expenses", eyebrow: "Know exactly where every rupee was spent" },
  payments: { title: "Payments", eyebrow: "Money received and money paid" },
  reports: { title: "Reports", eyebrow: "Revenue, cost and profitability" },
  history: { title: "Order history", eyebrow: "Read-only record of all your assigned orders" },
};
const modalTitles: Record<Exclude<ModalKind, null>, string> = {
  customer: "Create customer profile", person: "Add team member", vendor: "Add vendor record", vendorProduct: "Add vendor product", order: "Create a new order", orderVendor: "Assign vendor to order", invoice: "Create invoice", expense: "Add order expense", payment: "Record payment",
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
const orderDisplayTitle = (order: Order) => order.title || order.orderNo;
const personRole = (person: Person) => person.role.trim().toLowerCase();
const isSalesperson = (person: Person) => personRole(person).includes("sales");
const isSupervisor = (person: Person) => personRole(person).includes("supervisor") || personRole(person).includes("execution manager");

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
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [preferredVendorId, setPreferredVendorId] = useState("");
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
      setData({ ...emptyData, ...body });
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
    if (!modal && !mobileMenu && !selectedCustomer && !selectedVendor && !selectedOrder) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [modal, mobileMenu, selectedCustomer, selectedVendor, selectedOrder]);

  const customerById = useCallback((id: string) => data.customers.find((item) => item.id === id), [data.customers]);
  const personById = useCallback((id: string) => data.persons.find((item) => item.id === id), [data.persons]);
  const vendorById = useCallback((id: string) => data.vendors.find((item) => item.id === id), [data.vendors]);
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
    if (!["admin", "supervisor"].includes(user.role)) {
      setToast("Only an administrator or assigned supervisor can edit orders");
      return;
    }
    setFormError(""); setFile(null); setEditingOrder(order); setModal("order");
  };
  const addVendorProduct = (vendor: Vendor) => {
    setPreferredVendorId(vendor.id);
    setSelectedVendor(null);
    openModal("vendorProduct");
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
    const rows = [["Expense no", "Date", "Order", "Person", "Category", "Vendor", "Amount", "Payment mode"], ...data.expenses.map((expense) => { const order = orderById(expense.orderId); return [expense.expenseNo, expense.expenseDate, order ? orderDisplayTitle(order) : "", personById(expense.personId)?.name ?? "", expense.category, expense.vendor, String(expense.amount), expense.paymentMode]; })];
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
      <div className="content-area">{loading ? <LoadingScreen /> : <>{user.role === "supervisor" && data.supervisorLinked === false && <div className="form-error supervisor-link-warning">Your supervisor login is not linked to a Person record. Ask an administrator to create a Person with the same email address as your login and assign that person to orders.</div>}
        {initialSection === "overview" && <Overview data={data} totals={totals} openModal={openModal} customerById={customerById} orderById={orderById} user={user} />}
        {initialSection === "customers" && <CustomersPage customers={filteredCustomers} customerBalance={customerBalance} openModal={openModal} viewCustomer={setSelectedCustomer} user={user} />}
        {initialSection === "invoices" && <InvoicesPage invoices={filteredInvoices} customerById={customerById} personById={personById} openModal={openModal} />}
        {initialSection === "persons" && <PersonsPage persons={data.persons} orders={data.orders} expenses={data.expenses} openModal={openModal} user={user} />}
        {initialSection === "vendors" && <VendorsPage vendors={data.vendors} vendorProducts={data.vendorProducts} orderVendors={data.orderVendors} payments={data.payments} expenses={data.expenses} openModal={openModal} viewVendor={setSelectedVendor} />}
        {initialSection === "orders" && <OrdersPage data={data} openModal={openModal} customerById={customerById} personById={personById} vendorById={vendorById} user={user} editOrder={editOrder} viewTransactions={setSelectedOrder} />}
        {initialSection === "expenses" && <ExpensesPage expenses={data.expenses} orderById={orderById} personById={personById} vendorById={vendorById} openModal={openModal} exportExpenses={exportExpenses} />}
        {initialSection === "payments" && <PaymentsPage payments={data.payments} customerById={customerById} orderById={orderById} vendorById={vendorById} openModal={openModal} />}
        {initialSection === "reports" && <ReportsPage data={data} totals={totals} exportExpenses={exportExpenses} />}
        {initialSection === "history" && <SupervisorHistoryPage orders={data.historyOrders} customers={data.historyCustomers} />}
      </>}</div>
    </main>
    {mobileMenu && <button className="menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}
    {modal && <RecordModal kind={modal} data={data} user={user} preferredVendorId={preferredVendorId} editingOrder={editingOrder} file={file} setFile={setFile} error={formError} saving={saving} onClose={() => { setModal(null); setEditingOrder(null); setPreferredVendorId(""); }} onSubmit={submitRecord} />}
    {selectedCustomer && <CustomerDrawer customer={selectedCustomer} data={data} user={user} onClose={() => setSelectedCustomer(null)} />}
    {selectedVendor && <VendorDashboard vendor={selectedVendor} data={data} onAddProduct={() => addVendorProduct(selectedVendor)} onClose={() => setSelectedVendor(null)} />}
    {selectedOrder && <OrderTransactionHistory order={selectedOrder} data={data} customerById={customerById} personById={personById} vendorById={vendorById} user={user} onClose={() => setSelectedOrder(null)} />}
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

function CustomersPage({ customers, customerBalance, openModal, viewCustomer, user }: { customers: Customer[]; customerBalance: (customer: Customer) => number; openModal: (kind: Exclude<ModalKind, null>) => void; viewCustomer: (customer: Customer) => void; user: PublicUser }) {
  return <div className="section-stack"><PageHead copy={`${customers.length} customer profiles with a complete receivable trail.`} action={user.role !== "supervisor" ? <button className="btn btn-primary" onClick={() => openModal("customer")}>＋ Add customer</button> : undefined} />{customers.length ? <div className="panel table-panel"><div className="data-table customer-table"><div className="table-row table-header"><span>Customer</span><span>Contact</span><span>GSTIN</span><span>Receivable</span><span>Status</span><span /></div>{customers.map((customer) => { const balance = customerBalance(customer); return <div className="table-row" key={customer.id}><div className="entity-cell"><span className="avatar mint">{initials(customer.businessName)}</span><div><strong>{customer.businessName}</strong><small>{customer.name}</small></div></div><div><strong>{customer.phone}</strong><small>{customer.email || "No email"}</small></div><span>{customer.gstin || "Not added"}</span><strong className={balance > 0 ? "negative" : "positive"}>{balance < 0 ? `${fmt(Math.abs(balance))} advance` : fmt(balance)}</strong><Status value={balance > 0 ? "Payment due" : balance < 0 ? "Advance" : "Paid"} /><button className="text-btn" onClick={() => viewCustomer(customer)}>View profile →</button></div>; })}</div></div> : user.role === "supervisor" ? <div className="mini-empty">No customer is linked to your active orders.</div> : <EmptyState title="Add your first customer" copy="Create a profile to connect orders, invoices and payments." action="Create customer" onClick={() => openModal("customer")} />}</div>;
}

function InvoicesPage({ invoices, customerById, personById, openModal }: { invoices: Invoice[]; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; openModal: (kind: Exclude<ModalKind, null>) => void }) {
  const totalDue = invoices.reduce((sum, item) => sum + item.total - item.paidAmount, 0);
  return <div className="section-stack"><PageHead copy={`${invoices.length} invoices · ${fmt(totalDue)} currently receivable.`} action={<button className="btn btn-primary" onClick={() => openModal("invoice")}>＋ Create invoice</button>} secondary={<button className="btn btn-secondary" onClick={() => openModal("payment")}>Record payment</button>} />{invoices.length ? <div className="panel table-panel"><div className="data-table invoice-table"><div className="table-row table-header"><span>Invoice</span><span>Customer</span><span>Dates</span><span>Responsible person</span><span>Amount</span><span>Status</span><span>File</span></div>{invoices.map((invoice) => <div className="table-row" key={invoice.id}><div><strong>{invoice.invoiceNo}</strong><small>{invoice.notes || "Sales invoice"}</small></div><div><strong>{customerById(invoice.customerId)?.businessName || "—"}</strong><small>{customerById(invoice.customerId)?.name || ""}</small></div><div><strong>{shortDate(invoice.issueDate)}</strong><small>Due {shortDate(invoice.dueDate)}</small></div><div className="entity-inline"><span className="avatar tiny">{initials(personById(invoice.billedPersonId)?.name || "NA")}</span><span>{personById(invoice.billedPersonId)?.name || "—"}</span></div><div><strong>{fmt(invoice.total)}</strong><small>{invoice.paidAmount ? `${fmt(invoice.paidAmount)} received` : "No payment"}</small></div><Status value={invoice.status} />{invoice.attachmentKey ? <a className="file-link" href={`/api/upload?key=${encodeURIComponent(invoice.attachmentKey)}`} target="_blank" rel="noreferrer" title={invoice.attachmentName}>▤ View</a> : <span className="muted">—</span>}</div>)}</div></div> : <EmptyState title="Create your first invoice" copy="Attach an existing PDF or image while creating the invoice." action="Create invoice" onClick={() => openModal("invoice")} />}</div>;
}

function PersonsPage({ persons, orders, expenses, openModal, user }: { persons: Person[]; orders: Order[]; expenses: Expense[]; openModal: (kind: Exclude<ModalKind, null>) => void; user: PublicUser }) {
  return <div className="section-stack"><PageHead copy={user.role === "supervisor" ? "Add contact details only for people associated with one of your active orders." : "Add team members, contractors, vendors or accountants, then assign them to orders and expenses."} action={<button className="btn btn-primary" onClick={() => openModal("person")}>＋ Add order contact</button>} />{persons.length ? <div className="person-grid">{persons.map((person) => { const assignedOrders = orders.filter((order) => order.assignedPersonId === person.id || order.salespersonId === person.id).length; const spend = expenses.filter((expense) => expense.personId === person.id).reduce((sum, expense) => sum + expense.amount, 0); return <article className="person-card" key={person.id}><div className="person-card-head"><span className="avatar large">{initials(person.name)}</span><Status value={person.status} /></div><h3>{person.name}</h3><p>{person.role}</p><div className="contact-lines"><span>☎ {person.phone}</span><span>✉ {person.email || "No email added"}</span></div><div className="person-stats"><div><span>Assigned orders</span><strong>{assignedOrders}</strong></div><div><span>Expenses handled</span><strong>{fmt(spend)}</strong></div></div><div className="person-footer"><span>Preferred payment</span><strong>{person.paymentMode}</strong></div></article>; })}</div> : <EmptyState title="Build your execution team" copy="Add the people who create bills, manage orders or spend against jobs." action="Add person" onClick={() => openModal("person")} />}</div>;
}

function VendorsPage({ vendors, vendorProducts, orderVendors, payments, expenses, openModal, viewVendor }: { vendors: Vendor[]; vendorProducts: VendorProduct[]; orderVendors: OrderVendor[]; payments: Payment[]; expenses: Expense[]; openModal: (kind: Exclude<ModalKind, null>) => void; viewVendor: (vendor: Vendor) => void }) {
  return <div className="section-stack"><PageHead copy={`${vendors.length} vendor records with product catalogs, rental rates, assignments and payouts.`} action={<button className="btn btn-primary" onClick={() => openModal("vendor")}>＋ Add vendor</button>} secondary={vendors.length ? <button className="btn btn-secondary" onClick={() => openModal("orderVendor")}>Assign product</button> : undefined} />{vendors.length ? <div className="person-grid">{vendors.map((vendor) => { const products = vendorProducts.filter((item) => item.vendorId === vendor.id); const assignments = orderVendors.filter((item) => item.vendorId === vendor.id); const committed = assignments.reduce((sum, item) => sum + item.amount, 0); const spent = expenses.filter((item) => item.vendorId === vendor.id).reduce((sum, item) => sum + item.amount, 0); const paid = payments.filter((item) => item.vendorId === vendor.id && item.direction === "Paid").reduce((sum, item) => sum + item.amount, 0); return <article className="person-card vendor-card" key={vendor.id}><div className="person-card-head"><span className="avatar large">{initials(vendor.name)}</span><Status value={vendor.status} /></div><h3>{vendor.name}</h3><p>{vendor.contactPerson || "Vendor"}</p><div className="contact-lines"><span>☎ {vendor.phone}</span><span>✉ {vendor.email || "No email added"}</span><span>GSTIN: {vendor.gstin || "Not added"}</span></div><div className="person-stats"><div><span>Products</span><strong>{products.length}</strong></div><div><span>Assignments</span><strong>{assignments.length}</strong></div><div><span>Committed</span><strong>{fmt(committed)}</strong></div><div><span>Paid</span><strong>{fmt(paid)}</strong></div></div><div className="person-footer"><span>{fmt(spent)} in expenses</span><button type="button" className="text-btn" onClick={() => viewVendor(vendor)}>Open dashboard →</button></div></article>; })}</div> : <EmptyState title="Add your first vendor" copy="Create a vendor record, then build its product and rental-rate catalog." action="Add vendor" onClick={() => openModal("vendor")} />}</div>;
}

function VendorDashboard({ vendor, data, onAddProduct, onClose }: { vendor: Vendor; data: AppData; onAddProduct: () => void; onClose: () => void }) {
  const products = data.vendorProducts.filter((item) => item.vendorId === vendor.id);
  const assignments = data.orderVendors.filter((item) => item.vendorId === vendor.id);
  const payments = data.payments.filter((item) => item.vendorId === vendor.id && item.direction === "Paid");
  const committed = assignments.reduce((sum, item) => sum + item.amount, 0);
  const paid = payments.reduce((sum, item) => sum + item.amount, 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="customer-drawer transaction-drawer vendor-dashboard" role="dialog" aria-modal="true" aria-label={`${vendor.name} vendor dashboard`}><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="transaction-head"><span className="overline">Vendor dashboard</span><h2>{vendor.name}</h2><p>{vendor.contactPerson || "Vendor contact"} · {vendor.phone}</p></div><div className="transaction-summary vendor-summary"><div><span>Catalog products</span><strong>{products.length}</strong></div><div><span>Order assignments</span><strong>{assignments.length}</strong></div><div><span>Tentative cost</span><strong>{fmt(committed)}</strong></div><div><span>Balance to vendor</span><strong className={committed > paid ? "negative" : "positive"}>{fmt(Math.max(0, committed - paid))}</strong></div></div><div className="drawer-section"><div className="drawer-section-head"><h3>Product & rental catalog</h3><button type="button" className="btn btn-primary btn-small" onClick={onAddProduct}>＋ Add product</button></div><div className="vendor-product-list">{products.map((product) => <div className="vendor-product-row" key={product.id}><div><strong>{product.name}</strong><span>{product.pricingBasis}</span></div><strong>{fmt(product.rentalCharge)}</strong></div>)}{!products.length && <div className="mini-empty">Add the first product and choose whether it is rented per day or per event.</div>}</div></div><div className="drawer-section"><h3>Recent order assignments</h3><div className="transaction-list">{assignments.slice(0, 8).map((assignment) => { const order = data.orders.find((item) => item.id === assignment.orderId); return <div className="transaction-item" key={assignment.id}><span className="activity-icon out">◇</span><div className="grow"><strong>{assignment.productName}</strong><span>{order?.orderNo || "Order"} · {assignment.quantity || 1} unit{assignment.quantity === 1 ? "" : "s"}{assignment.pricingBasis === "Per day" ? ` · ${assignment.rentalDays || 1} day(s)` : " · per event"}</span><small>{shortDate(assignment.createdAt)}</small></div><strong>{fmt(assignment.amount)}</strong></div>; })}{!assignments.length && <div className="mini-empty">Products assigned to orders will appear here.</div>}</div></div></aside></div>;
}

function OrdersPage({ data, openModal, customerById, personById, vendorById, user, editOrder, viewTransactions }: { data: AppData; openModal: (kind: Exclude<ModalKind, null>) => void; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; vendorById: (id: string) => Vendor | undefined; user: PublicUser; editOrder: (order: Order) => void; viewTransactions: (order: Order) => void }) {
  return <div className="section-stack"><PageHead copy={`${data.orders.length} orders connecting sales value with vendors and payment history.`} action={canCreateRecord(user.role, "order") ? <button className="btn btn-primary" onClick={() => openModal("order")}>＋ Create order</button> : undefined} secondary={data.orders.length && data.vendors.length ? <button className="btn btn-secondary" onClick={() => openModal("orderVendor")}>Assign vendor</button> : undefined} />{data.orders.length ? <div className="order-grid">{data.orders.map((order) => {
    const orderExpenses = data.expenses.filter((item) => item.orderId === order.id);
    const orderPayments = data.payments.filter((item) => item.orderId === order.id);
    const orderInvoices = data.invoices.filter((item) => item.orderId === order.id);
    const assignments = data.orderVendors.filter((item) => item.orderId === order.id);
    const cost = orderExpenses.reduce((sum, item) => sum + item.amount, 0);
    const margin = order.contractValue - cost;
    const progress = Math.min(100, order.contractValue ? (cost / order.contractValue) * 100 : 0);
    const transactionCount = orderExpenses.length + orderPayments.length + orderInvoices.length + assignments.length;
    return <article className="order-card" key={order.id}><div className="order-top"><span className="order-no">{order.orderNo}</span><Status value={order.status} /></div><h3>{orderDisplayTitle(order)}</h3><p>{customerById(order.customerId)?.businessName || "Customer"}</p><div className="order-meta"><span>⌖ {order.venue || "Venue not added"}</span><span>◷ {shortDate(order.eventDate)}</span></div><div className="assigned-person"><span className="avatar tiny">{initials(personById(order.assignedPersonId)?.name || "NA")}</span><div><small>Supervisor</small><strong>{personById(order.assignedPersonId)?.name || "Unassigned"}</strong></div></div>{user.role !== "supervisor" && <div className="assigned-person"><span className="avatar tiny">{initials(personById(order.salespersonId)?.name || "NA")}</span><div><small>Salesperson</small><strong>{personById(order.salespersonId)?.name || "Unassigned"}</strong></div></div>}{assignments.length > 0 && <div className="vendor-assignments"><small>Assigned vendors</small>{assignments.map((assignment) => <div key={assignment.id}><span>{vendorById(assignment.vendorId)?.name || "Vendor"} · {assignment.productName}</span><strong>{user.role === "supervisor" ? "Item price hidden" : fmt(assignment.amount)}</strong></div>)}</div>}{user.role !== "supervisor" && <><div className="budget-line"><span>Execution cost</span><span>{fmt(cost)} of {fmt(order.contractValue)}</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="order-values"><div><span>Order value</span><strong>{fmt(order.contractValue)}</strong></div><div><span>Gross margin</span><strong className={margin >= 0 ? "positive" : "negative"}>{fmt(margin)}</strong></div></div></>}<div className="order-actions"><button type="button" className="text-btn" onClick={() => viewTransactions(order)}>View {transactionCount} record{transactionCount === 1 ? "" : "s"} →</button>{["admin", "supervisor"].includes(user.role) && <button type="button" className="btn btn-secondary btn-small" onClick={() => editOrder(order)}>Edit order</button>}</div></article>;
  })}</div> : <EmptyState title="Create your first order" copy="An order connects the customer, execution lead, vendors, payments and expenses." action="Create order" onClick={() => openModal("order")} />}</div>;
}

function ExpensesPage({ expenses, orderById, personById, vendorById, openModal, exportExpenses }: { expenses: Expense[]; orderById: (id: string) => Order | undefined; personById: (id: string) => Person | undefined; vendorById: (id: string) => Vendor | undefined; openModal: (kind: Exclude<ModalKind, null>) => void; exportExpenses: () => void }) {
  void vendorById;
  return <div className="section-stack"><PageHead copy={`${expenses.length} expenses · ${fmt(expenses.reduce((sum, item) => sum + item.amount, 0))} total execution cost.`} action={<button className="btn btn-primary" onClick={() => openModal("expense")}>＋ Add expense</button>} secondary={<button className="btn btn-secondary" onClick={exportExpenses}>⇩ Export CSV</button>} />{expenses.length ? <div className="panel table-panel"><div className="data-table expense-table"><div className="table-row table-header"><span>Expense</span><span>Order</span><span>Person</span><span>Category / vendor</span><span>Payment</span><span>Amount</span><span>Receipt</span></div>{expenses.map((expense) => { const order = orderById(expense.orderId); return <div className="table-row" key={expense.id}><div><strong>{expense.description || expense.expenseNo}</strong><small>{expense.expenseNo} · {shortDate(expense.expenseDate)}</small></div><div><strong>{order ? orderDisplayTitle(order) : "—"}</strong><small>{order?.orderNo || ""}</small></div><div className="entity-inline"><span className="avatar tiny">{initials(personById(expense.personId)?.name || "NA")}</span><span>{personById(expense.personId)?.name || "—"}</span></div><div><strong>{expense.category}</strong><small>{expense.vendor || "No vendor"}</small></div><span>{expense.paymentMode}</span><strong className="negative">{fmt(expense.amount)}</strong>{expense.receiptKey ? <a className="file-link" href={`/api/upload?key=${encodeURIComponent(expense.receiptKey)}`} target="_blank" rel="noreferrer">▤ View</a> : <span className="muted">—</span>}</div>; })}</div></div> : <EmptyState title="Record an order expense" copy="Choose the order and person responsible, then attach a receipt if available." action="Add expense" onClick={() => openModal("expense")} />}</div>;
}

function PaymentsPage({ payments, customerById, orderById, vendorById, openModal }: { payments: Payment[]; customerById: (id: string) => Customer | undefined; orderById: (id: string) => Order | undefined; vendorById: (id: string) => Vendor | undefined; openModal: (kind: Exclude<ModalKind, null>) => void }) {
  const personById = vendorById;
  return <div className="section-stack"><PageHead copy="Every customer receipt and vendor payout is recorded against an order ID." action={<button className="btn btn-primary" onClick={() => openModal("payment")}>＋ Record payment</button>} />{payments.length ? <div className="panel table-panel"><div className="data-table payment-table"><div className="table-row table-header"><span>Date</span><span>Type</span><span>Order ID / party</span><span>Method</span><span>Reference</span><span>Amount</span></div>{payments.map((payment) => { const order = orderById(payment.orderId); const party = payment.direction === "Received" ? customerById(payment.customerId)?.businessName : personById(payment.personId)?.name; return <div className="table-row" key={payment.id}><strong>{shortDate(payment.paymentDate)}</strong><Status value={payment.direction === "Paid" ? "Paid out" : payment.direction} /><div><strong>{order?.orderNo || "Legacy payment"}</strong><small>{party || payment.notes || order?.title || "Party not available"}</small></div><span>{payment.method}</span><span>{payment.reference || "—"}</span><strong className={payment.direction === "Received" ? "positive" : "negative"}>{payment.direction === "Received" ? "+" : "−"}{fmt(payment.amount)}</strong></div>; })}</div></div> : <EmptyState title="Start your payment ledger" copy="Choose an order ID, then record a customer receipt or vendor payout." action="Record payment" onClick={() => openModal("payment")} />}</div>;
}

function ReportsPage({ data, totals, exportExpenses }: { data: AppData; totals: { invoiced: number; received: number; expenses: number; outstanding: number; profit: number }; exportExpenses: () => void }) {
  const categories = Array.from(new Set(data.expenses.map((item) => item.category))).map((category) => ({ name: category, value: data.expenses.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount, 0) })).sort((a, b) => b.value - a.value); const max = Math.max(...categories.map((item) => item.value), 1); const efficiency = totals.invoiced ? Math.round((totals.received / totals.invoiced) * 100) : 0;
  return <div className="section-stack"><PageHead copy="A clear view of collection efficiency and job profitability." action={<button className="btn btn-primary" onClick={exportExpenses}>⇩ Export expense report</button>} /><section className="report-hero"><div><span>Gross cash profit</span><strong className={totals.profit >= 0 ? "positive" : "negative"}>{fmt(totals.profit)}</strong><p>Payments received minus recorded execution expenses.</p></div><div className="report-score"><i style={{ "--score": `${efficiency}%` } as React.CSSProperties}><span>{efficiency}%</span></i><p>Collection efficiency</p></div></section><section className="report-grid"><article className="panel category-panel"><div className="panel-head"><div><span className="overline">Cost analysis</span><h3>Expenses by category</h3></div></div><div className="category-bars">{categories.map((item) => <div className="category-row" key={item.name}><div><span>{item.name}</span><strong>{fmt(item.value)}</strong></div><i><b style={{ width: `${(item.value / max) * 100}%` }} /></i></div>)}{!categories.length && <div className="mini-empty">Add expenses to see the cost split.</div>}</div></article><article className="panel report-summary"><div className="panel-head"><div><span className="overline">Financial summary</span><h3>Current position</h3></div></div><div className="summary-lines"><div><span>Sales invoiced</span><strong>{fmt(totals.invoiced)}</strong></div><div><span>Payments collected</span><strong className="positive">{fmt(totals.received)}</strong></div><div><span>Order expenses</span><strong className="negative">{fmt(totals.expenses)}</strong></div><div><span>Receivables pending</span><strong>{fmt(totals.outstanding)}</strong></div><div className="summary-total"><span>Cash profit</span><strong>{fmt(totals.profit)}</strong></div></div></article></section></div>;
}

function SupervisorHistoryPage({ orders, customers }: { orders: Order[]; customers: Customer[] }) {
  const customerById = (id: string) => customers.find((customer) => customer.id === id);
  return <div className="section-stack"><PageHead copy="A read-only history of every order assigned to you. Financial values and personal contact numbers are hidden." />{orders.length ? <div className="panel table-panel"><div className="data-table history-table"><div className="table-row table-header"><span>Order</span><span>Customer</span><span>Venue</span><span>Date</span><span>Status</span></div>{orders.map((order) => <div className="table-row" key={order.id}><div><strong>{order.orderNo}</strong><small>{order.title || "No title"}</small></div><div><strong>{customerById(order.customerId)?.businessName || "Customer"}</strong><small>{customerById(order.customerId)?.name || ""}</small></div><span>{order.venue || "Not added"}</span><strong>{shortDate(order.eventDate)}</strong><Status value={order.status} /></div>)}</div></div> : <div className="mini-empty">No order history is available for your supervisor profile.</div>}</div>;
}

function CustomerDrawer({ customer, data, user, onClose }: { customer: Customer; data: AppData; user: PublicUser; onClose: () => void }) {
  const customerInvoices = data.invoices.filter((item) => item.customerId === customer.id); const customerOrders = data.orders.filter((item) => item.customerId === customer.id); const customerReceipts = data.payments.filter((item) => item.customerId === customer.id && item.direction === "Received"); const unallocatedReceipts = customerReceipts.filter((item) => !item.invoiceId).reduce((sum, item) => sum + item.amount, 0); const due = customer.openingBalance + customerInvoices.reduce((sum, item) => sum + item.total - item.paidAmount, 0) - unallocatedReceipts;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="customer-drawer" role="dialog" aria-modal="true" aria-label="Customer profile"><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="profile-hero"><span className="avatar profile-avatar">{initials(customer.businessName)}</span><h2>{customer.businessName}</h2><p>{customer.name}</p>{user.role !== "supervisor" && <Status value={due > 0 ? "Payment due" : "Paid"} />}</div>{user.role !== "supervisor" && <div className="profile-balance"><span>{due >= 0 ? "Total receivable" : "Customer advance"}</span><strong>{fmt(Math.abs(due))}</strong></div>}<div className="profile-details"><div><span>Phone</span><strong>{customer.phone}</strong></div><div><span>Email</span><strong>{customer.email || "Not added"}</strong></div><div><span>GSTIN</span><strong>{customer.gstin || "Not added"}</strong></div><div><span>Address</span><strong>{customer.address || "Not added"}</strong></div></div>{user.role !== "supervisor" && <><div className="drawer-section"><h3>Customer activity</h3><div className="profile-stats"><div><strong>{customerOrders.length}</strong><span>Orders</span></div><div><strong>{customerInvoices.length}</strong><span>Invoices</span></div><div><strong>{fmt(customerReceipts.reduce((sum, item) => sum + item.amount, 0))}</strong><span>Received</span></div></div></div><div className="drawer-section"><h3>Invoices</h3>{customerInvoices.slice(0, 5).map((invoice) => <div className="drawer-invoice" key={invoice.id}><div><strong>{invoice.invoiceNo}</strong><span>Due {shortDate(invoice.dueDate)}</span></div><div><strong>{fmt(invoice.total)}</strong><Status value={invoice.status} /></div></div>)}{!customerInvoices.length && <div className="mini-empty">No invoices created yet.</div>}</div></>}</aside></div>;
}

function OrderTransactionHistory({ order, data, customerById, personById, vendorById, user, onClose }: { order: Order; data: AppData; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; vendorById: (id: string) => Vendor | undefined; user: PublicUser; onClose: () => void }) {
  const orderPayments = data.payments.filter((item) => item.orderId === order.id);
  const orderExpenses = data.expenses.filter((item) => item.orderId === order.id);
  const orderInvoices = data.invoices.filter((item) => item.orderId === order.id);
  const vendorAssignments = data.orderVendors.filter((item) => item.orderId === order.id);
  const received = orderPayments.filter((item) => item.direction === "Received").reduce((sum, item) => sum + item.amount, 0);
  const vendorPaid = orderPayments.filter((item) => item.direction === "Paid").reduce((sum, item) => sum + item.amount, 0);
  const expenseTotal = orderExpenses.reduce((sum, item) => sum + item.amount, 0);
  const transactions = [
    ...orderPayments.map((payment) => ({
      id: `payment-${payment.id}`,
      date: payment.paymentDate,
      type: payment.direction === "Received" ? "Customer receipt" : "Vendor payment",
      title: payment.direction === "Received" ? customerById(payment.customerId)?.businessName || "Customer" : vendorById(payment.vendorId)?.name || personById(payment.personId)?.name || "Vendor / payee",
      meta: [payment.method, payment.reference].filter(Boolean).join(" · ") || "Payment",
      amount: payment.direction === "Received" ? payment.amount : -payment.amount,
    })),
    ...orderExpenses.map((expense) => ({
      id: `expense-${expense.id}`,
      date: expense.expenseDate,
      type: "Order expense",
      title: expense.description || expense.category,
      meta: [expense.expenseNo, vendorById(expense.vendorId)?.name || expense.vendor || personById(expense.personId)?.name].filter(Boolean).join(" · "),
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
    ...vendorAssignments.map((assignment) => ({
      id: `vendor-${assignment.id}`,
      date: assignment.createdAt,
      type: "Vendor assigned",
      title: vendorById(assignment.vendorId)?.name || "Vendor",
      meta: [assignment.productName, assignment.notes].filter(Boolean).join(" · "),
      amount: -assignment.amount,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="customer-drawer transaction-drawer" role="dialog" aria-modal="true" aria-label={`Transactions for ${order.orderNo}`}><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="transaction-head"><span className="order-no">{order.orderNo}</span><h2>{orderDisplayTitle(order)}</h2><p>{customerById(order.customerId)?.businessName || "Customer"} · {shortDate(order.eventDate)}</p></div><div className="transaction-summary"><div><span>Received</span><strong className="positive">{fmt(received)}</strong></div><div><span>Vendor paid</span><strong className="negative">{fmt(vendorPaid)}</strong></div><div><span>Expenses</span><strong>{fmt(expenseTotal)}</strong></div><div><span>Net cash</span><strong className={received - vendorPaid >= 0 ? "positive" : "negative"}>{fmt(received - vendorPaid)}</strong></div></div><div className="drawer-section"><h3>Complete order history</h3><div className="transaction-list">{transactions.map((item) => <div className="transaction-item" key={item.id}><span className={`activity-icon ${item.amount >= 0 ? "in" : "out"}`}>{item.amount >= 0 ? "↓" : "↑"}</span><div className="grow"><strong>{item.title}</strong><span>{item.type} · {item.meta}</span><small>{shortDate(item.date)}</small></div><strong className={item.amount >= 0 ? "positive" : "negative"}>{user.role === "supervisor" && item.type === "Vendor assigned" ? "Price hidden" : <>{item.amount >= 0 ? "+" : "−"}{fmt(Math.abs(item.amount))}</>}</strong></div>)}{!transactions.length && <div className="mini-empty">No invoices, expenses or payments have been recorded for this order.</div>}</div></div></aside></div>;
}

function RecordModal({ kind, data, user, preferredVendorId, editingOrder, file, setFile, error, saving, onClose, onSubmit }: { kind: Exclude<ModalKind, null>; data: AppData; user: PublicUser; preferredVendorId: string; editingOrder: Order | null; file: File | null; setFile: (file: File | null) => void; error: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(() => { const due = new Date(); due.setDate(due.getDate() + 15); return dateInputValue(due); });
  const [paymentDirection, setPaymentDirection] = useState("Received");
  const [paymentOrderId, setPaymentOrderId] = useState("");
  const [paymentAllocations, setPaymentAllocations] = useState<Record<string, number>>({});
  const [orderVendorDrafts, setOrderVendorDrafts] = useState<OrderVendorDraft[]>([]);
  const [assignmentVendorId, setAssignmentVendorId] = useState("");
  const [assignmentProductId, setAssignmentProductId] = useState("");
  const [assignmentQuantity, setAssignmentQuantity] = useState(1);
  const [assignmentDays, setAssignmentDays] = useState(1);
  const nextInvoice = `INV-${new Date().getFullYear()}-${String(data.invoices.length + 1).padStart(3, "0")}`; const nextOrder = `ORD-${String(data.orders.length + 1).padStart(4, "0")}`; const nextExpense = `EXP-${String(data.expenses.length + 1).padStart(4, "0")}`; const customerOrders = data.orders.filter((order) => order.customerId === invoiceCustomerId); const paymentOrder = data.orders.find((order) => order.id === paymentOrderId); const paymentDirections = ["Received", "Paid"].filter((direction) => canRecordPayment(user.role, direction));
  const canAllocateMultipleOrders = ["admin", "accountant"].includes(user.role);
  const selectedPaymentOrders = data.orders.filter((order) => paymentAllocations[order.id] !== undefined);
  const allocationCustomerId = selectedPaymentOrders[0]?.customerId ?? "";
  const allocationRows = selectedPaymentOrders.map((order) => ({ orderId: order.id, amount: paymentAllocations[order.id] || 0 }));
  const allocationTotal = allocationRows.reduce((sum, item) => sum + item.amount, 0);
  const eligiblePaymentVendors = paymentDirection === "Paid" && selectedPaymentOrders.length
    ? data.vendors.filter((vendor) => selectedPaymentOrders.every((order) => data.orderVendors.some((assignment) => assignment.orderId === order.id && assignment.vendorId === vendor.id)))
    : [];
  const assignmentProducts = data.vendorProducts.filter((product) => product.vendorId === assignmentVendorId && product.status === "Active");
  const assignmentProduct = assignmentProducts.find((product) => product.id === assignmentProductId);
  const tentativeCost = assignmentProduct ? calculateTentativeCost(assignmentProduct.rentalCharge, assignmentProduct.pricingBasis, assignmentQuantity, assignmentDays) : 0;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="record-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><span className="overline">eKhata workspace</span><h2 id="modal-title">{kind === "order" && editingOrder ? "Edit order" : modalTitles[kind]}</h2><p>Fields marked with * are required.</p></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></div><form onSubmit={onSubmit}><div className="form-grid">
    {kind === "customer" && <><Field label="Contact person *"><input name="name" required placeholder="e.g. Rohan Mehta" /></Field><Field label="Business / company name *"><input name="businessName" required placeholder="e.g. Quest Strategy" /></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" placeholder="accounts@company.com" /></Field><Field label="GSTIN"><input name="gstin" placeholder="27ABCDE1234F1Z5" /></Field><Field label="Opening balance"><input name="openingBalance" type="number" defaultValue="0" /></Field><Field label="Billing address" wide><textarea name="address" rows={3} placeholder="Full billing address" /></Field></>}
    {kind === "person" && <><Field label="Full name *"><input name="name" required placeholder="Person or vendor name" /></Field><Field label="Role / type *"><select name="role" required defaultValue=""><option value="" disabled>Select role</option><option>Team member</option><option>Supervisor</option><option>Execution manager</option><option>Labour supervisor</option><option>Sales person</option><option>Sales & billing</option><option>Accountant</option><option>Vendor</option><option>Contractor</option></select></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" placeholder="name@example.com" /></Field><Field label="Preferred payment mode"><select name="paymentMode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Cheque</option></select></Field>{user.role === "supervisor" && <Field label="Associated active order *"><OrderSelect orders={data.orders} name="orderId" /></Field>}</>}
    {kind === "vendor" && <><Field label="Vendor name *"><input name="name" required placeholder="Business or supplier name" /></Field><Field label="Contact person"><input name="contactPerson" placeholder="Primary contact" /></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" placeholder="accounts@vendor.com" /></Field><Field label="GSTIN"><input name="gstin" placeholder="27ABCDE1234F1Z5" /></Field><Field label="Preferred payment mode"><select name="paymentMode"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option></select></Field><Field label="Address" wide><textarea name="address" rows={3} placeholder="Vendor address" /></Field></>}
    {kind === "vendorProduct" && <><Field label="Vendor *"><VendorSelect vendors={data.vendors} name="vendorId" defaultValue={preferredVendorId} /></Field><Field label="Product name *"><input name="name" required placeholder="e.g. LED wall rental" /></Field><Field label="Rental basis *"><select name="pricingBasis" required defaultValue="Per event"><option>Per event</option><option>Per day</option></select></Field><Field label="Rental charge *"><input name="rentalCharge" required type="number" min="1" placeholder="0" /></Field><div className="form-hint field-wide">This catalog rate is used to calculate tentative order costs. Accountants and administrators can override the final amount while assigning the product.</div></>}
    {kind === "orderVendor" && <><Field label="Order *"><OrderSelect orders={data.orders} name="orderId" /></Field><Field label="Vendor *"><select name="vendorId" required value={assignmentVendorId} onChange={(event) => { setAssignmentVendorId(event.target.value); setAssignmentProductId(""); }}><option value="">{data.vendors.length ? "Select vendor" : "Add a vendor first"}</option>{data.vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}</option>)}</select></Field><Field label="Product *"><select name="productId" required value={assignmentProductId} disabled={!assignmentVendorId} onChange={(event) => setAssignmentProductId(event.target.value)}><option value="">{!assignmentVendorId ? "Select vendor first" : assignmentProducts.length ? "Select catalog product" : "No catalog products for this vendor"}</option>{assignmentProducts.map((product) => <option value={product.id} key={product.id}>{product.name}{user.role === "supervisor" ? "" : ` · ${product.pricingBasis}`}</option>)}</select></Field><Field label="Quantity *"><input name="quantity" required type="number" min="1" value={assignmentQuantity} onChange={(event) => setAssignmentQuantity(Math.max(1, Math.round(Number(event.target.value) || 1)))} /></Field>{assignmentProduct?.pricingBasis === "Per day" && <Field label="Rental days *"><input name="rentalDays" required type="number" min="1" value={assignmentDays} onChange={(event) => setAssignmentDays(Math.max(1, Math.round(Number(event.target.value) || 1)))} /></Field>}{user.role !== "supervisor" && <><Field label="Tentative cost"><input value={tentativeCost ? fmt(tentativeCost) : "Select a product"} readOnly /></Field><Field label="Final cost override"><input name="amount" type="number" min="1" placeholder={tentativeCost ? String(tentativeCost) : "Optional"} /></Field></>}{user.role === "supervisor" && <div className="form-hint field-wide">Cost calculated privately from the vendor catalog. Rental rates and final amounts are only visible to Admin and Accountant users.</div>}<Field label="Notes" wide><textarea name="notes" rows={2} placeholder="Specifications, timing or terms" /></Field></>}
    {kind === "order" && <>{user.role !== "supervisor" && <><Field label="Order number *"><input name="orderNo" required defaultValue={editingOrder?.orderNo ?? nextOrder} /></Field><Field label="Customer *"><CustomerSelect customers={data.customers} name="customerId" defaultValue={editingOrder?.customerId} /></Field><Field label="Salesperson *"><TeamPersonSelect persons={data.persons} name="salespersonId" kind="salesperson" defaultValue={editingOrder?.salespersonId} /></Field><Field label="Supervisor *"><TeamPersonSelect persons={data.persons} name="assignedPersonId" kind="supervisor" defaultValue={editingOrder?.assignedPersonId} /></Field></>}<Field label="Order title (optional)"><input name="title" defaultValue={editingOrder?.title ?? ""} placeholder="e.g. Corporate annual meet" /></Field><Field label="Venue"><input name="venue" defaultValue={editingOrder?.venue ?? ""} placeholder="Event venue or site" /></Field><Field label="Event / delivery date *"><input name="eventDate" required type="date" defaultValue={editingOrder?.eventDate ?? today()} /></Field>{user.role !== "supervisor" && <Field label="Order value *"><input name="contractValue" required type="number" min="1" defaultValue={editingOrder?.contractValue} placeholder="0" /></Field>}<Field label="Status"><select name="status" defaultValue={editingOrder?.status ?? "Planned"}><option>Planned</option><option>In progress</option><option>Completed</option><option>Cancelled</option></select></Field>{!editingOrder && <div className="field field-wide order-vendor-builder"><span>Vendors for this order</span>{orderVendorDrafts.map((draft, index) => <div className="order-vendor-draft" key={draft.key}><VendorSelect vendors={data.vendors} name={`vendor-draft-${index}`} defaultValue={draft.vendorId} onChange={(vendorId) => setOrderVendorDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, vendorId } : item))} /><input aria-label={`Product for vendor ${index + 1}`} required placeholder="Product or service" value={draft.productName} onChange={(event) => setOrderVendorDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, productName: event.target.value } : item))} /><input aria-label={`Amount for vendor ${index + 1}`} required type="number" min="1" placeholder="Amount" value={draft.amount || ""} onChange={(event) => setOrderVendorDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, amount: Math.max(0, Math.round(Number(event.target.value) || 0)) } : item))} /><button type="button" className="icon-btn" aria-label={`Remove vendor ${index + 1}`} onClick={() => setOrderVendorDrafts((current) => current.filter((item) => item.key !== draft.key))}>×</button></div>)}<button type="button" className="btn btn-secondary btn-small" onClick={() => setOrderVendorDrafts((current) => [...current, { key: crypto.randomUUID(), vendorId: "", productName: "", amount: 0, notes: "" }])}>＋ Add another vendor</button><input type="hidden" name="vendorAssignments" value={JSON.stringify(orderVendorDrafts.map(({ vendorId, productName, amount, notes }) => ({ vendorId, productName, amount, notes })))} /></div>}</>}
    {kind === "invoice" && <><Field label="Invoice number *"><input name="invoiceNo" required defaultValue={nextInvoice} /></Field><Field label="Customer *"><select name="customerId" required value={invoiceCustomerId} onChange={(event) => setInvoiceCustomerId(event.target.value)}><option value="">{data.customers.length ? "Select customer" : "Add a customer first"}</option>{data.customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.businessName}</option>)}</select></Field><Field label="Order *"><select name="orderId" required defaultValue="" disabled={!invoiceCustomerId}><option value="">{!invoiceCustomerId ? "Select customer first" : customerOrders.length ? "Select order" : "No orders for this customer"}</option>{customerOrders.map((order) => <option value={order.id} key={order.id}>{order.orderNo}{order.title ? ` · ${order.title}` : ""}</option>)}</select></Field><Field label="Billed / responsible person *"><PersonSelect persons={data.persons} name="billedPersonId" /></Field><Field label="Issue date *"><input name="issueDate" required type="date" value={issueDate} onChange={(event) => { const value = event.target.value; setIssueDate(value); if (dueDate < value) setDueDate(value); }} /></Field><Field label="Due date *"><input name="dueDate" required type="date" min={issueDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field><Field label="Taxable amount *"><input name="subtotal" required type="number" min="1" placeholder="0" /></Field><Field label="GST / tax amount"><input name="tax" type="number" min="0" defaultValue="0" /></Field><Field label="Status"><select name="status"><option>Draft</option><option>Sent</option><option>Overdue</option></select></Field><Field label="Notes"><input name="notes" placeholder="Description or payment terms" /></Field><FileField file={file} setFile={setFile} label="Attach invoice PDF or image" /></>}
    {kind === "expense" && <><Field label="Expense number *"><input name="expenseNo" required defaultValue={nextExpense} /></Field><Field label="Order *"><OrderSelect orders={data.orders} name="orderId" /></Field>{user.role !== "supervisor" && <Field label="Person responsible *"><PersonSelect persons={data.persons} name="personId" /></Field>}<Field label="Expense date *"><input name="expenseDate" required type="date" defaultValue={today()} /></Field><Field label="Category *"><select name="category" required><option>Material rental</option><option>Fabrication</option><option>Labour</option><option>Transport</option><option>Venue</option><option>Food & hospitality</option><option>Printing & branding</option><option>Miscellaneous</option></select></Field><Field label="Vendor / payee"><VendorSelect vendors={data.vendors} name="vendorId" optional /></Field><Field label="Amount *"><input name="amount" required type="number" min="1" placeholder="0" /></Field><Field label="Payment mode"><select name="paymentMode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Credit card</option><option>Cheque</option></select></Field><Field label="Description" wide><textarea name="description" rows={2} placeholder="What was this expense for?" /></Field><FileField file={file} setFile={setFile} label="Attach receipt (optional)" /></>}
    {kind === "payment" && <><Field label="Payment type *"><select name="direction" required value={paymentDirection} onChange={(event) => { setPaymentDirection(event.target.value); setPaymentAllocations({}); }} >{paymentDirections.map((direction) => <option key={direction}>{direction}</option>)}</select></Field>{canAllocateMultipleOrders ? <div className="field field-wide multi-order-field"><span>Allocate payment across orders *</span><div className="allocation-list">{data.orders.map((order) => { const selected = paymentAllocations[order.id] !== undefined; const disabled = paymentDirection === "Received" && Boolean(allocationCustomerId) && allocationCustomerId !== order.customerId && !selected; return <div className={`allocation-row ${selected ? "selected" : ""}`} key={order.id}><label><input type="checkbox" checked={selected} disabled={disabled} onChange={(event) => setPaymentAllocations((current) => { const next = { ...current }; if (event.target.checked) next[order.id] = 0; else delete next[order.id]; return next; })} /><span><strong>{order.orderNo}</strong><small>{order.title ? `${order.title} · ` : ""}{data.customers.find((customer) => customer.id === order.customerId)?.businessName || "Customer"}</small></span></label>{selected && <input aria-label={`Amount for ${order.orderNo}`} type="number" min="1" required value={paymentAllocations[order.id] || ""} placeholder="Amount" onChange={(event) => setPaymentAllocations((current) => ({ ...current, [order.id]: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} />}</div>; })}</div><input type="hidden" name="allocations" value={JSON.stringify(allocationRows)} /><input type="hidden" name="amount" value={allocationTotal || ""} /><small className="allocation-total">{selectedPaymentOrders.length} order{selectedPaymentOrders.length === 1 ? "" : "s"} selected · Total {fmt(allocationTotal)}</small></div> : <><Field label="Order ID *"><select name="orderId" required value={paymentOrderId} onChange={(event) => setPaymentOrderId(event.target.value)}><option value="">{data.orders.length ? "Select order" : "Create an order first"}</option>{data.orders.map((order) => <option value={order.id} key={order.id}>{order.orderNo}{order.title ? ` · ${order.title}` : ""}</option>)}</select></Field><Field label="Customer"><input value={paymentOrder ? data.customers.find((customer) => customer.id === paymentOrder.customerId)?.businessName || "Customer not available" : "Select an order to identify the customer"} readOnly /></Field><Field label="Amount *"><input name="amount" required type="number" min="1" placeholder="0" /></Field></>}{paymentDirection === "Paid" && <Field label="Vendor / payee *"><VendorSelect vendors={eligiblePaymentVendors} name="vendorId" /></Field>}<Field label="Payment date *"><input name="paymentDate" required type="date" defaultValue={today()} /></Field><Field label="Method *"><select name="method" required><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option><option>Credit card</option></select></Field><Field label="Reference"><input name="reference" placeholder="UTR, cheque no. or reference" /></Field><Field label="Notes"><input name="notes" placeholder="Short payment note" /></Field></>}
  </div>{((kind === "order" || kind === "invoice") && (!data.customers.length || !data.persons.length)) && <div className="form-hint">Add at least one customer and one person before saving this record.</div>}{kind === "order" && user.role !== "supervisor" && <div className="form-hint">Salesperson and supervisor choices come from People. Their email addresses must match active Sales person and Supervisor accounts in Team access.</div>}{kind === "expense" && (!data.orders.length || !data.persons.length) && <div className="form-hint">Create an order and add a person before recording its expense.</div>}{kind === "payment" && <div className="form-hint">Accountants can select several orders and enter the amount for each. The allocation total becomes the payment total. Customer receipts must use orders belonging to the same customer. Vendor payouts only show vendors assigned to the selected order or every selected order.</div>}{error && <div className="form-error" role="alert">! {error}</div>}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : kind === "order" && editingOrder ? "Update order" : `Save ${kind}`}</button></div></form></div></div>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`field ${wide ? "field-wide" : ""}`}><span>{label}</span>{children}</label>; }
function CustomerSelect({ customers, name, optional, defaultValue = "" }: { customers: Customer[]; name: string; optional?: boolean; defaultValue?: string }) { return <select name={name} required={!optional} defaultValue={defaultValue}><option value="">{customers.length ? "Select customer" : "Add a customer first"}</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.businessName}</option>)}</select>; }
function PersonSelect({ persons, name, defaultValue = "" }: { persons: Person[]; name: string; defaultValue?: string }) { return <select name={name} required defaultValue={defaultValue}><option value="">{persons.length ? "Select person" : "Add a person first"}</option>{persons.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select>; }
function TeamPersonSelect({ persons, name, kind, defaultValue = "" }: { persons: Person[]; name: string; kind: "salesperson" | "supervisor"; defaultValue?: string }) { const eligible = persons.filter(kind === "salesperson" ? isSalesperson : isSupervisor); return <select name={name} required defaultValue={defaultValue}><option value="">{eligible.length ? `Select ${kind}` : `Add a ${kind} to People first`}</option>{eligible.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select>; }
function VendorSelect({ vendors, name, optional, defaultValue = "", onChange }: { vendors: Vendor[]; name: string; optional?: boolean; defaultValue?: string; onChange?: (vendorId: string) => void }) { return <select name={name} required={!optional} defaultValue={defaultValue} onChange={onChange ? (event) => onChange(event.target.value) : undefined}><option value="">{vendors.length ? optional ? "No vendor" : "Select vendor" : "Add a vendor first"}</option>{vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}{vendor.contactPerson ? ` · ${vendor.contactPerson}` : ""}</option>)}</select>; }
function OrderSelect({ orders, name }: { orders: Order[]; name: string }) { return <select name={name} required defaultValue=""><option value="">{orders.length ? "Select order" : "Create an order first"}</option>{orders.map((order) => <option value={order.id} key={order.id}>{order.orderNo}{order.title ? ` · ${order.title}` : ""}</option>)}</select>; }
function FileField({ file, setFile, label }: { file: File | null; setFile: (file: File | null) => void; label: string }) { return <label className="upload-field field-wide"><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="upload-icon">⇧</span><strong>{file ? file.name : label}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace` : "PDF, JPG, PNG or WebP · maximum 10 MB"}</small></label>; }
