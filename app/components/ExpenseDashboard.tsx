"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { canCreateRecord, canEditCustomerProfile, canEditVendorProfile, canRecordPayment, canViewSection, roleLabels } from "../auth/permissions";
import { isOrderTeamPerson } from "../auth/team";
import type { PublicUser } from "../auth/types";
import { isSupportedOrderDocument, isSupportedReceiptDocument } from "../upload-types";
import { EXPENSE_CATEGORIES, isExpenseResponsiblePerson } from "../expense-rules";
import { calculateTentativeCost, isProductType, measurementLabel, productTypes, type PricingBasis, type ProductType } from "../vendor-pricing";
import { adminDateRange, dateIsInRange, indiaDateKey, shiftDateKey, summarizeAdminOrders, type AdminPeriod } from "../admin-analytics";
import { isOrderSupervisor, orderSupervisorIds } from "../order-supervisors";
import { buildCustomerLedger, ledgerBalanceSide } from "../customer-ledger";
import { isActiveOrder, isFinancialOrder, isHistoricalOrder } from "../order-lifecycle";

type Customer = { id: string; name: string; businessName: string; phone: string; email: string; gstin: string; address: string; openingBalance: number; createdAt: string };
type Person = { id: string; name: string; role: string; phone: string; email: string; paymentMode: string; status: string; orderId: string; createdAt: string };
type Vendor = { id: string; name: string; contactPerson: string; phone: string; email: string; gstin: string; address: string; paymentMode: string; status: string; createdAt: string };
type VendorProduct = { id: string; vendorId: string; name: string; productType: ProductType; pricingBasis: PricingBasis; rentalCharge: number; status: string; createdAt: string };
type Order = { id: string; orderNo: string; title: string; customerId: string; salespersonId: string; assignedPersonId: string; supervisorIds: string[]; venue: string; eventDate: string; deliveryAddress: string; deliveryDate: string; deliveryTime: string; pickupDate: string; pickupTime: string; pickupAddress: string; pickupFromGodown: boolean; contactPerson: string; contactPhone: string; productName: string; productPrice: number; attachmentKey: string; attachmentName: string; attachmentType: string; status: string; contractValue: number; createdAt: string };
type OrderProduct = { id: string; orderId: string; name: string; quantity: number; price: number; amount: number; createdAt: string };
type OrderProductDraft = { key: string; name: string; quantity: number; price: number };
type OrderVendor = { id: string; orderId: string; vendorId: string; productId: string; productName: string; productType: ProductType; pricingBasis: PricingBasis; unitRate: number; quantity: number; measurement: number; rentalDays: number; amount: number; notes: string; createdAt: string };
type OrderVendorDraft = { key: string; vendorId: string; productName: string; amount: number; notes: string };
type Expense = { id: string; expenseNo: string; orderId: string; personId: string; vendorId: string; category: string; vendor: string; description: string; expenseDate: string; amount: number; paymentMode: string; receiptKey: string; receiptName: string; createdAt: string };
type ExpenseCategoryRecord = { id: string; name: string; status: string; createdAt: string };
type Payment = { id: string; orderId: string; manualOrderId: string; personId: string; vendorId: string; customerId: string; direction: string; amount: number; paymentDate: string; method: string; reference: string; notes: string; createdAt: string };
type AdminDetailItem = { id: string; date: string; title: string; meta: string; detail: string; amount?: number; status?: string };
type AdminReportDetail = { eyebrow: string; title: string; description: string; summary: Array<{ label: string; value: string }>; items: AdminDetailItem[] };
type AppData = { customers: Customer[]; historyCustomers: Customer[]; persons: Person[]; vendors: Vendor[]; vendorProducts: VendorProduct[]; orders: Order[]; historyOrders: Order[]; orderProducts: OrderProduct[]; orderVendors: OrderVendor[]; expenses: Expense[]; expenseCategories: ExpenseCategoryRecord[]; payments: Payment[]; supervisorLinked?: boolean; currentPersonId?: string };
type ModalKind = "customer" | "person" | "vendor" | "vendorProduct" | "order" | "orderVendor" | "expense" | "payment" | null;

const emptyData: AppData = { customers: [], historyCustomers: [], persons: [], vendors: [], vendorProducts: [], orders: [], historyOrders: [], orderProducts: [], orderVendors: [], expenses: [], expenseCategories: [], payments: [] };
const navItems = [
  { key: "overview", label: "Overview", icon: "⌂", href: "/" },
  { key: "customers", label: "Customers", icon: "◎", href: "/customers" },
  { key: "persons", label: "People", icon: "♧", href: "/persons" },
  { key: "vendors", label: "Vendors", icon: "▣", href: "/vendors" },
  { key: "orders", label: "Orders", icon: "◇", href: "/orders" },
  { key: "expenses", label: "Expenses", icon: "↗", href: "/expenses" },
  { key: "payments", label: "Payments", icon: "₹", href: "/payments" },
  { key: "reports", label: "Reports", icon: "▥", href: "/reports" },
  { key: "history", label: "Order history", icon: "◷", href: "/history" },
  { key: "settings", label: "Settings", icon: "⚙", href: "/settings" },
  { key: "users", label: "Team access", icon: "♙", href: "/users" },
];
const titles: Record<string, { title: string; eyebrow: string }> = {
  overview: { title: "Business overview", eyebrow: "Your financial command centre" },
  customers: { title: "Customers", eyebrow: "Profiles, balances and activity" },
  persons: { title: "People & vendors", eyebrow: "Everyone involved in billing and execution" },
  vendors: { title: "Vendor records", eyebrow: "Suppliers, assignments, expenses and payments" },
  orders: { title: "Orders", eyebrow: "Connect the customer, team and job value" },
  expenses: { title: "Order expenses", eyebrow: "Know exactly where every rupee was spent" },
  payments: { title: "Payments", eyebrow: "Money received and money paid" },
  reports: { title: "Reports", eyebrow: "Revenue, cost and profitability" },
  history: { title: "Order history", eyebrow: "Read-only record of all your assigned orders" },
  settings: { title: "Settings", eyebrow: "Manage expense categories and workspace options" },
};
const modalTitles: Record<Exclude<ModalKind, null>, string> = {
  customer: "Create customer profile", person: "Add team member", vendor: "Add vendor record", vendorProduct: "Add vendor product", order: "Create a new order", orderVendor: "Assign vendor to order", expense: "Add order expense", payment: "Record payment",
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
const customerDisplayName = (customer?: Customer) => customer?.name.trim() || customer?.businessName.trim() || "Customer";
const customerCompanyName = (customer?: Customer) => {
  const company = customer?.businessName.trim() || "";
  return company && company !== customerDisplayName(customer) ? company : "";
};
const orderDisplayTitle = (order: Order) => order.title || order.orderNo;
const catalogProductType = (value: unknown): ProductType => isProductType(value) ? value : "Quantity-wise";

function Status({ value }: { value: string }) {
  const tone = ["Paid", "Active", "Completed", "Received", "Advance"].includes(value) ? "success" : ["Overdue", "Cancelled", "Archived", "Paid out"].includes(value) ? "danger" : ["Part paid", "In progress", "Sent", "Payment due"].includes(value) ? "warning" : "neutral";
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
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editingVendorProduct, setEditingVendorProduct] = useState<VendorProduct | null>(null);
  const [deletingProductId, setDeletingProductId] = useState("");
  const [deletingAssignmentId, setDeletingAssignmentId] = useState("");
  const [deletingOrderId, setDeletingOrderId] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState("");
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
    const orderValue = data.orders.reduce((sum, item) => isFinancialOrder(item) ? sum + item.contractValue : sum, 0);
    const received = data.payments.filter((item) => item.direction === "Received").reduce((sum, item) => sum + item.amount, 0);
    const expensesTotal = data.expenses.reduce((sum, item) => sum + item.amount, 0);
    return { orderValue, received, expenses: expensesTotal, outstanding: Math.max(0, orderValue - received), profit: received - expensesTotal };
  }, [data]);
  const customerBalance = useCallback((customer: Customer) => {
    return buildCustomerLedger(customer, data.orders, data.payments).summary.closingBalance;
  }, [data.orders, data.payments]);
  const filteredCustomers = data.customers.filter((item) => `${item.name} ${item.businessName} ${item.phone}`.toLowerCase().includes(search.toLowerCase()));
  const openModal = (kind: Exclude<ModalKind, null>) => {
    if (!canCreateRecord(user.role, kind)) {
      setToast(`${roleLabels[user.role]} access does not include this action`);
      return;
    }
    setFormError(""); setFile(null); setEditingCustomer(null); setEditingVendor(null); setEditingOrder(null); setEditingPayment(null); setEditingVendorProduct(null); setModal(kind);
  };
  const editCustomer = (customer: Customer) => {
    if (!canEditCustomerProfile(user.role)) {
      setToast("Your role cannot edit customer profiles");
      return;
    }
    setSelectedCustomer(null); setEditingCustomer(customer); setFormError(""); setModal("customer");
  };
  const editVendor = (vendor: Vendor) => {
    if (!canEditVendorProfile(user.role)) {
      setToast("Your role cannot edit vendor profiles");
      return;
    }
    setSelectedVendor(null); setEditingVendor(vendor); setFormError(""); setModal("vendor");
  };
  const editOrder = (order: Order) => {
    const salesOwnsOrder = user.role === "sales" && order.salespersonId === (data.currentPersonId || user.personId);
    if (!["admin", "supervisor"].includes(user.role) && !salesOwnsOrder) {
      setToast("Only an administrator, assigned salesperson or assigned supervisor can edit this order");
      return;
    }
    setFormError(""); setFile(null); setEditingOrder(order); setModal("order");
  };
  const editPayment = (payment: Payment) => {
    if (!canRecordPayment(user.role, payment.direction)) {
      setToast("Your role cannot edit this payment");
      return;
    }
    setFormError(""); setFile(null); setEditingOrder(null); setEditingPayment(payment); setModal("payment");
  };
  const addVendorProduct = (vendor: Vendor) => {
    setPreferredVendorId(vendor.id);
    setSelectedVendor(null);
    openModal("vendorProduct");
  };
  const editVendorProduct = (product: VendorProduct) => {
    if (!canCreateRecord(user.role, "vendorProduct")) return setToast("Your role cannot edit vendor products");
    setPreferredVendorId(product.vendorId); setSelectedVendor(null); setEditingVendorProduct(product); setFormError(""); setModal("vendorProduct");
  };
  const deleteVendorProduct = async (product: VendorProduct) => {
    if (!canCreateRecord(user.role, "vendorProduct")) return setToast("Your role cannot delete vendor products");
    if (!window.confirm(`Delete ${product.name} from the vendor catalog? Existing order history will be preserved.`)) return;
    setDeletingProductId(product.id);
    try {
      const response = await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "vendorProduct", id: product.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete vendor product");
      setToast("Vendor product deleted successfully");
      await loadData();
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to delete vendor product"); }
    finally { setDeletingProductId(""); }
  };

  const removeVendorAssignment = async (assignment: OrderVendor) => {
    if (!["admin", "accountant"].includes(user.role)) return setToast("Your role cannot remove vendor assignments");
    if (!window.confirm(`Remove ${assignment.productName} from this vendor's order assignments? The catalog product will remain available.`)) return;
    setDeletingAssignmentId(assignment.id);
    try {
      const response = await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "orderVendor", id: assignment.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to remove vendor assignment");
      setToast("Vendor assignment removed successfully");
      await loadData();
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to remove vendor assignment"); }
    finally { setDeletingAssignmentId(""); }
  };

  const deleteOrder = async (order: Order) => {
    if (user.role !== "admin") return setToast("Only administrators can delete orders");
    if (!window.confirm(`Delete ${order.orderNo} from active orders? It will be moved to Order History and kept for audit.`)) return;
    setDeletingOrderId(order.id);
    try {
      const response = await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "order", id: order.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete order");
      setToast("Order moved to Order History");
      await loadData();
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to delete order"); }
    finally { setDeletingOrderId(""); }
  };

  const addExpenseCategory = async (name: string) => {
    setSavingCategory(true);
    try {
      const response = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "expenseCategory", payload: { name } }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to add expense category");
      setToast("Expense category added successfully");
      await loadData();
      return true;
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to add expense category"); return false; }
    finally { setSavingCategory(false); }
  };

  const deleteExpenseCategory = async (category: ExpenseCategoryRecord) => {
    if (!window.confirm(`Delete ${category.name} from future expense forms? Existing expense history will be preserved.`)) return;
    setDeletingCategoryId(category.id);
    try {
      const response = await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "expenseCategory", id: category.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete expense category");
      setToast("Expense category removed from future forms");
      await loadData();
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to delete expense category"); }
    finally { setDeletingCategoryId(""); }
  };

  const uploadDocument = async () => {
    if (!file) return null;
    const allowed = modal === "order" ? isSupportedOrderDocument(file.type) : isSupportedReceiptDocument(file.type);
    if (!allowed) throw new Error(modal === "order" ? "Choose an image, PDF, XLS, XLSX, or CSV file" : "Choose an image or PDF file");
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
      if (modal === "order") payload.supervisorIds = form.getAll("supervisorIds").map(String);
      if (modal === "expense" && file) {
        const upload = await uploadDocument();
        if (upload && modal === "expense") { payload.receiptKey = upload.key; payload.receiptName = upload.name; }
      }
      if (modal === "order" && file) {
        const upload = await uploadDocument();
        if (upload) { payload.attachmentKey = upload.key; payload.attachmentName = upload.name; payload.attachmentType = upload.type; }
      }
      const isCustomerEdit = modal === "customer" && Boolean(editingCustomer);
      const isVendorEdit = modal === "vendor" && Boolean(editingVendor);
      const isOrderEdit = modal === "order" && Boolean(editingOrder);
      const isPaymentEdit = modal === "payment" && Boolean(editingPayment);
      const isVendorProductEdit = modal === "vendorProduct" && Boolean(editingVendorProduct);
      const response = await fetch("/api/records", { method: isCustomerEdit || isVendorEdit || isOrderEdit || isPaymentEdit || isVendorProductEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: modal, id: editingCustomer?.id ?? editingVendor?.id ?? editingOrder?.id ?? editingPayment?.id ?? editingVendorProduct?.id, payload }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to save record");
      setModal(null); setEditingCustomer(null); setEditingVendor(null); setEditingOrder(null); setEditingPayment(null); setEditingVendorProduct(null); setFile(null); setToast(isCustomerEdit ? "Customer updated successfully" : isVendorEdit ? "Vendor updated successfully" : isOrderEdit ? "Order updated successfully" : isPaymentEdit ? "Payment updated successfully" : isVendorProductEdit ? "Vendor product updated successfully" : `${modalTitles[modal]} saved successfully`); await loadData();
    } catch (error) { setFormError(error instanceof Error ? error.message : "Unable to save record"); }
    finally { setSaving(false); }
  };

  const exportExpenses = () => {
    const rows = [["Date", "Order", "Person", "Category", "Vendor", "Amount", "Payment mode"], ...data.expenses.map((expense) => { const order = orderById(expense.orderId); return [expense.expenseDate, order ? orderDisplayTitle(order) : "", personById(expense.personId)?.name ?? "", expense.category, expense.vendor, String(expense.amount), expense.paymentMode]; })];
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
      <nav className="nav-list" aria-label="Main navigation"><span className="nav-label">{roleLabels[user.role]} workspace</span>{navItems.filter((item) => canViewSection(user.role, item.key)).map((item) => <Link key={item.key} href={item.href} className={`nav-item ${initialSection === item.key ? "active" : ""}`} onClick={() => setMobileMenu(false)}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></Link>)}</nav>
      <div className="sidebar-help"><div className="help-icon">?</div><strong>Need help?</strong><p>{user.role === "supervisor" ? "Keep assigned orders, contacts and expenses organized." : "Keep every order, payment and expense connected."}</p></div>
      <div className="sidebar-user"><div className="avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><span>{roleLabels[user.role]}</span><div className="user-links"><Link href="/change-password">Password</Link><button type="button" onClick={logout}>Sign out</button></div></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-btn mobile-toggle" onClick={() => setMobileMenu(true)} aria-label="Open menu">☰</button><div className="title-block"><span>{sectionMeta.eyebrow}</span><h1>{sectionMeta.title}</h1></div><div className="topbar-actions"><label className="global-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records" aria-label="Search records" /></label><button className="icon-btn notification" title="Notifications" aria-label="Notifications">◌<span /></button>{canCreateRecord(user.role, "expense") && <button className="btn btn-primary" onClick={() => openModal("expense")} aria-label="Add expense"><span aria-hidden="true">＋</span><span className="desktop-label">Add expense</span></button>}</div></header>
      <div className="content-area">{loading ? <LoadingScreen /> : <>{user.role === "supervisor" && data.supervisorLinked === false && <div className="form-error supervisor-link-warning">Add an active People record with the same name as this account and a Supervisor role to receive assigned orders.</div>}
        {initialSection === "overview" && <Overview data={data} totals={totals} openModal={openModal} customerById={customerById} orderById={orderById} user={user} />}
        {initialSection === "customers" && <CustomersPage customers={filteredCustomers} customerBalance={customerBalance} openModal={openModal} viewCustomer={setSelectedCustomer} user={user} />}
        {initialSection === "persons" && <PersonsPage persons={data.persons} orders={data.orders} expenses={data.expenses} openModal={openModal} user={user} />}
        {initialSection === "vendors" && <VendorsPage vendors={data.vendors} vendorProducts={data.vendorProducts} orderVendors={data.orderVendors} payments={data.payments} expenses={data.expenses} openModal={openModal} viewVendor={setSelectedVendor} />}
        {initialSection === "orders" && <OrdersPage data={data} openModal={openModal} customerById={customerById} personById={personById} vendorById={vendorById} user={user} editOrder={editOrder} deleteOrder={(order) => void deleteOrder(order)} deletingOrderId={deletingOrderId} viewTransactions={setSelectedOrder} />}
        {initialSection === "expenses" && <ExpensesPage data={data} user={user} openModal={openModal} />}
        {initialSection === "payments" && <PaymentsPage payments={data.payments} customerById={customerById} orderById={orderById} vendorById={vendorById} openModal={openModal} editPayment={editPayment} />}
        {initialSection === "reports" && <ReportsPage data={data} totals={totals} exportExpenses={exportExpenses} />}
        {initialSection === "history" && <SupervisorHistoryPage orders={data.historyOrders} customers={data.historyCustomers} />}
        {initialSection === "settings" && <SettingsPage customCategories={data.expenseCategories} saving={savingCategory} deletingId={deletingCategoryId} onAdd={addExpenseCategory} onDelete={(category) => void deleteExpenseCategory(category)} />}
      </>}</div>
    </main>
    {mobileMenu && <button className="menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}
    {modal && <RecordModal kind={modal} data={data} user={user} preferredVendorId={preferredVendorId} editingCustomer={editingCustomer} editingVendor={editingVendor} editingOrder={editingOrder} editingPayment={editingPayment} editingVendorProduct={editingVendorProduct} file={file} setFile={setFile} error={formError} saving={saving} onClose={() => { setModal(null); setEditingCustomer(null); setEditingVendor(null); setEditingOrder(null); setEditingPayment(null); setEditingVendorProduct(null); setPreferredVendorId(""); }} onSubmit={submitRecord} />}
    {selectedCustomer && <CustomerDrawer customer={selectedCustomer} data={data} user={user} onEdit={() => editCustomer(selectedCustomer)} onClose={() => setSelectedCustomer(null)} />}
    {selectedVendor && <VendorDashboard vendor={selectedVendor} data={data} deletingProductId={deletingProductId} deletingAssignmentId={deletingAssignmentId} onEditVendor={() => editVendor(selectedVendor)} onAddProduct={() => addVendorProduct(selectedVendor)} onEditProduct={editVendorProduct} onDeleteProduct={(product) => void deleteVendorProduct(product)} onRemoveAssignment={(assignment) => void removeVendorAssignment(assignment)} onClose={() => setSelectedVendor(null)} />}
    {selectedOrder && <OrderTransactionHistory order={selectedOrder} data={data} customerById={customerById} personById={personById} vendorById={vendorById} user={user} onClose={() => setSelectedOrder(null)} />}
    {toast && <div className="toast" role="status" aria-live="polite"><span>✓</span>{toast}</div>}
  </div>;
}

function LoadingScreen() { return <div className="loading-grid"><div className="skeleton sk-wide" />{[1,2,3,4].map((item) => <div key={item} className="skeleton" />)}<div className="skeleton sk-chart" /><div className="skeleton sk-chart" /></div>; }
function PageHead({ copy, action, secondary }: { copy: string; action?: React.ReactNode; secondary?: React.ReactNode }) { return <div className="page-head"><p>{copy}</p><div className="page-head-actions">{secondary}{action}</div></div>; }

function Overview({ data, totals, openModal, customerById, orderById, user }: { data: AppData; totals: { orderValue: number; received: number; expenses: number; outstanding: number; profit: number }; openModal: (kind: Exclude<ModalKind, null>) => void; customerById: (id: string) => Customer | undefined; orderById: (id: string) => Order | undefined; user: PublicUser }) {
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
  const recentPayments = user.role === "supervisor" ? [] : data.payments.slice(0, 3);
  const recent = [...recentPayments.map((item) => ({ id: item.id, kind: item.direction === "Received" ? "Received" : "Paid", title: item.direction === "Received" ? customerDisplayName(customerById(item.customerId)) : item.notes || "Outgoing payment", meta: `${item.method} · ${shortDate(item.paymentDate)}`, amount: item.direction === "Received" ? item.amount : -item.amount })), ...data.expenses.slice(0, 3).map((item) => ({ id: item.id, kind: "Expense", title: item.description || item.category, meta: `${orderById(item.orderId)?.orderNo || "Order"} · ${shortDate(item.expenseDate)}`, amount: -item.amount }))].slice(0, 5);
  const metricCards = user.role === "supervisor"
    ? [
        { label: "Active orders", value: String(data.orders.filter(isActiveOrder).length), change: "Jobs requiring execution", icon: "◇", tone: "green" },
        { label: "People & vendors", value: String(data.persons.length), change: "Available execution contacts", icon: "♧", tone: "blue" },
        { label: "Execution expenses", value: fmt(totals.expenses), change: "Cost visible to supervisors", icon: "↗", tone: "orange" },
        { label: "Customers", value: String(data.customers.length), change: "Connected to current orders", icon: "◎", tone: "red" },
      ]
    : user.role === "sales"
      ? [
          { label: "Booked order value", value: fmt(totals.orderValue), change: "Across visible orders", icon: "◇", tone: "green" },
          { label: "Outstanding", value: fmt(totals.outstanding), change: "Awaiting customer payment", icon: "!", tone: "red" },
          { label: "Active orders", value: String(data.orders.filter(isActiveOrder).length), change: "Open sales commitments", icon: "◇", tone: "blue" },
          { label: "Customers", value: String(data.customers.length), change: "Managed customer profiles", icon: "◎", tone: "orange" },
        ]
      : [
          { label: "Total order value", value: fmt(totals.orderValue), change: "Across all orders", icon: "◇", tone: "green" },
          { label: "Payments received", value: fmt(totals.received), change: `${totals.orderValue ? Math.round((totals.received / totals.orderValue) * 100) : 0}% collection rate`, icon: "↓", tone: "blue" },
          { label: "Total expenses", value: fmt(totals.expenses), change: "Order execution cost", icon: "↗", tone: "orange" },
          { label: "Outstanding", value: fmt(totals.outstanding), change: "Order value not yet received", icon: "!", tone: "red" },
        ];
  return <div className="section-stack">
    <section className="welcome-strip"><div><span className="mini-label">{dateLabel} · {roleLabels[user.role]} dashboard</span><h2>Welcome back, {user.name.split(" ")[0]}.</h2><p>You have <strong>{data.orders.filter(isActiveOrder).length} active orders</strong> visible in your workspace.</p></div><div className="quick-actions">{canCreateRecord(user.role, "customer") && <button onClick={() => openModal("customer")}><span>◎</span><b>New customer</b></button>}{canCreateRecord(user.role, "order") && <button onClick={() => openModal("order")}><span>◇</span><b>New order</b></button>}{canCreateRecord(user.role, "expense") && <button onClick={() => openModal("expense")}><span>↗</span><b>Add expense</b></button>}{canCreateRecord(user.role, "payment") && <button onClick={() => openModal("payment")}><span>₹</span><b>Record payment</b></button>}</div></section>
    {user.role === "admin" && <AdminOperationsDashboard data={data} customerById={customerById} />}
    {user.role === "admin" && <div className="dashboard-section-label"><span className="overline">All-time position</span><h2>Financial snapshot</h2></div>}
    <section className="metric-grid">{metricCards.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
    {canViewSection(user.role, "payments") && <section className="dashboard-grid"><article className="panel cashflow-panel"><div className="panel-head"><div><span className="overline">Cash movement</span><h3>Cash flow</h3></div><div className="legend"><span><i className="green-dot" />Received</span><span><i className="orange-dot" />Spent</span></div></div><div className="bar-chart" aria-label="Six month cash flow chart">{bars.map((bar) => <div className="bar-group" key={bar.label}><div className="bar-pair"><i className="bar received" style={{ height: `${bar.received ? Math.max(5, (bar.received / barMax) * 94) : 0}%` }} /><i className="bar spent" style={{ height: `${bar.spent ? Math.max(5, (bar.spent / barMax) * 94) : 0}%` }} /></div><span>{bar.label}</span></div>)}</div><div className="cashflow-footer"><span>Net cash position</span><strong className={totals.profit >= 0 ? "positive" : "negative"}>{fmt(totals.profit)}</strong></div></article></section>}
    {(canViewSection(user.role, "payments") || canViewSection(user.role, "expenses")) && <section className="panel activity-panel"><div className="panel-head"><div><span className="overline">Latest entries</span><h3>Recent activity</h3></div><Link href={canViewSection(user.role, "payments") ? "/payments" : "/expenses"}>Open ledger →</Link></div><div className="activity-table">{recent.map((item) => <div className="activity-row" key={`${item.kind}-${item.id}`}><span className={`activity-icon ${item.amount >= 0 ? "in" : "out"}`}>{item.amount >= 0 ? "↓" : "↑"}</span><div className="grow"><strong>{item.title}</strong><span>{item.meta}</span></div><span className="activity-kind">{item.kind}</span><strong className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : "−"}{fmt(Math.abs(item.amount))}</strong></div>)}{!recent.length && <div className="mini-empty">{user.role === "supervisor" ? "Your latest expenses will appear here." : "Your latest payments and expenses will appear here."}</div>}</div></section>}
  </div>;
}

function MetricCard({ label, value, change, icon, tone }: { label: string; value: string; change: string; icon: string; tone: string }) { return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{change}</small></article>; }

function AdminOperationsDashboard({ data, customerById }: { data: AppData; customerById: (id: string) => Customer | undefined }) {
  const todayKey = indiaDateKey();
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const [period, setPeriod] = useState<AdminPeriod>("today");
  const [customFrom, setCustomFrom] = useState(todayKey);
  const [customTo, setCustomTo] = useState(todayKey);
  const [detail, setDetail] = useState<AdminReportDetail | null>(null);
  const range = useMemo(() => adminDateRange(period, todayKey, customFrom, customTo), [period, todayKey, customFrom, customTo]);
  const analytics = useMemo(() => summarizeAdminOrders(data.orders, range), [data.orders, range]);
  const todayDeliveries = useMemo(() => summarizeAdminOrders(data.orders, adminDateRange("today", todayKey)).deliveries, [data.orders, todayKey]);
  const tomorrowDeliveries = useMemo(() => summarizeAdminOrders(data.orders, { from: tomorrowKey, to: tomorrowKey, label: "Tomorrow" }).deliveries, [data.orders, tomorrowKey]);
  const todayPickups = useMemo(() => summarizeAdminOrders(data.orders, adminDateRange("today", todayKey)).pickups, [data.orders, todayKey]);
  const tomorrowPickups = useMemo(() => summarizeAdminOrders(data.orders, { from: tomorrowKey, to: tomorrowKey, label: "Tomorrow" }).pickups, [data.orders, tomorrowKey]);
  const eligibleSalespeople = useMemo(() => data.persons.filter((person) => isOrderTeamPerson(person, "salesperson")), [data.persons]);
  const eligibleSupervisors = useMemo(() => data.persons.filter((person) => isOrderTeamPerson(person, "supervisor")), [data.persons]);
  const salespersonRows = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; orderCount: number; salesAmount: number }>();
    eligibleSalespeople.forEach((person) => rows.set(person.id, { id: person.id, name: person.name, orderCount: 0, salesAmount: 0 }));
    analytics.newOrders.forEach((order) => {
      const person = data.persons.find((item) => item.id === order.salespersonId);
      const id = order.salespersonId || "unassigned";
      const current = rows.get(id) || { id, name: person?.name || "Unassigned salesperson", orderCount: 0, salesAmount: 0 };
      current.orderCount += 1;
      current.salesAmount += order.contractValue;
      rows.set(id, current);
    });
    return [...rows.values()].sort((a, b) => b.salesAmount - a.salesAmount || b.orderCount - a.orderCount || a.name.localeCompare(b.name));
  }, [analytics.newOrders, data.persons, eligibleSalespeople]);
  const supervisorRows = useMemo(() => eligibleSupervisors.map((person) => {
    const orders = data.orders.filter((order) => isFinancialOrder(order) && isOrderSupervisor(order, person.id) && dateIsInRange(indiaDateKey(order.createdAt), range));
    const expenses = data.expenses.filter((expense) => expense.personId === person.id && dateIsInRange(expense.expenseDate, range));
    const payments = data.payments.filter((payment) => payment.personId === person.id && dateIsInRange(payment.paymentDate, range));
    return { person, orders, expenses, payments, activityCount: orders.length + expenses.length + payments.length, expenseAmount: expenses.reduce((sum, expense) => sum + expense.amount, 0) };
  }).sort((a, b) => b.activityCount - a.activityCount || b.expenseAmount - a.expenseAmount || a.person.name.localeCompare(b.person.name)), [data.expenses, data.orders, data.payments, eligibleSupervisors, range]);
  const maxSales = Math.max(1, ...salespersonRows.map((row) => row.salesAmount));
  const rangeLabel = range.from === range.to ? shortDate(range.from) : `${shortDate(range.from)} – ${shortDate(range.to)}`;
  const periodOptions: Array<[AdminPeriod, string]> = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["nextMonth", "Next month"], ["custom", "Custom"]];

  useEffect(() => {
    if (!detail) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [detail]);

  const scheduleDetail = (title: string, orders: Order[], kind: "delivery" | "pickup", label: string): AdminReportDetail => ({
    eyebrow: `${label} · ${kind === "delivery" ? "Delivery plan" : "Pickup plan"}`,
    title,
    description: `${orders.length} ${kind === "delivery" ? "delivery" : "pickup"}${orders.length === 1 ? "" : "s"} scheduled. Customer, team, time and venue details are shown below.`,
    summary: [{ label: "Scheduled", value: String(orders.length) }, { label: "Order value", value: fmt(orders.reduce((sum, order) => sum + order.contractValue, 0)) }],
    items: orders.map((order) => {
      const date = kind === "delivery" ? order.deliveryDate : order.pickupDate;
      const time = kind === "delivery" ? order.deliveryTime : order.pickupTime;
      const address = kind === "pickup" && order.pickupFromGodown ? "eRentals godown" : kind === "pickup" ? order.pickupAddress || order.venue : order.deliveryAddress || order.venue;
      const salesperson = data.persons.find((person) => person.id === order.salespersonId);
      const supervisorNames = orderSupervisorIds(order).map((id) => data.persons.find((person) => person.id === id)?.name).filter(Boolean).join(", ");
      return { id: order.id, date, title: customerDisplayName(customerById(order.customerId)), meta: `${order.orderNo} · ${time || "Time not added"}`, detail: [address || "Venue not added", salesperson?.name, supervisorNames].filter(Boolean).join(" · "), amount: order.contractValue, status: order.status };
    }),
  });

  const openSalesperson = (row: { id: string; name: string; orderCount: number; salesAmount: number }) => {
    const orders = analytics.newOrders.filter((order) => (order.salespersonId || "unassigned") === row.id);
    setDetail({ eyebrow: `${range.label} · Salesperson report`, title: row.name, description: `All new sales assigned to ${row.name} within ${rangeLabel}.`, summary: [{ label: "New orders", value: String(orders.length) }, { label: "Sales booked", value: fmt(row.salesAmount) }], items: orders.map((order) => ({ id: order.id, date: indiaDateKey(order.createdAt), title: customerDisplayName(customerById(order.customerId)), meta: `${order.orderNo} · ${orderDisplayTitle(order)}`, detail: `Delivery ${shortDate(order.deliveryDate)} · Pickup ${shortDate(order.pickupDate)}`, amount: order.contractValue, status: order.status })) });
  };

  const openSupervisor = (row: (typeof supervisorRows)[number]) => {
    const items: AdminDetailItem[] = [
      ...row.orders.map((order) => ({ id: `order-${order.id}`, date: indiaDateKey(order.createdAt), title: customerDisplayName(customerById(order.customerId)), meta: `Assigned order · ${order.orderNo}`, detail: `${orderDisplayTitle(order)} · ${shortDate(order.eventDate)}`, amount: order.contractValue, status: order.status })),
      ...row.expenses.map((expense) => ({ id: `expense-${expense.id}`, date: expense.expenseDate, title: expense.description || expense.category, meta: "Expense", detail: `${data.orders.find((order) => order.id === expense.orderId)?.orderNo || "Order"} · ${expense.category}`, amount: -expense.amount })),
      ...row.payments.map((payment) => ({ id: `payment-${payment.id}`, date: payment.paymentDate, title: payment.notes || `${payment.direction} payment`, meta: `${payment.direction} · ${payment.method}`, detail: data.orders.find((order) => order.id === payment.orderId)?.orderNo || payment.manualOrderId || "Payment record", amount: payment.direction === "Received" ? payment.amount : -payment.amount })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    setDetail({ eyebrow: `${range.label} · Supervisor activity`, title: row.person.name, description: `Orders, expenses and payment entries attributed to ${row.person.name} within ${rangeLabel}.`, summary: [{ label: "Transactions", value: String(items.length) }, { label: "Assigned orders", value: String(row.orders.length) }, { label: "Expenses", value: fmt(row.expenseAmount) }], items });
  };

  return <section className="admin-operations" aria-label="Admin sales and operations dashboard">
    <div className="admin-operations-hero"><div><span className="overline">Admin operations centre</span><h2>Sales and movement planner</h2><p>Track new business, salesperson performance, deliveries and pickups from one date-controlled view.</p><div className="admin-day-alerts"><button type="button" onClick={() => setDetail(scheduleDetail("Today’s deliveries", todayDeliveries, "delivery", "Today"))}><strong>{todayDeliveries.length}</strong> deliveries today</button><button type="button" onClick={() => setDetail(scheduleDetail("Tomorrow’s deliveries", tomorrowDeliveries, "delivery", "Tomorrow"))}><strong>{tomorrowDeliveries.length}</strong> deliveries tomorrow</button><button type="button" onClick={() => setDetail(scheduleDetail("Today’s pickups", todayPickups, "pickup", "Today"))}><strong>{todayPickups.length}</strong> pickups today</button><button type="button" onClick={() => setDetail(scheduleDetail("Tomorrow’s pickups", tomorrowPickups, "pickup", "Tomorrow"))}><strong>{tomorrowPickups.length}</strong> pickups tomorrow</button></div></div><div className="admin-period-control"><span>Reporting period</span><div className="admin-period-tabs" role="group" aria-label="Admin dashboard period">{periodOptions.map(([value, label]) => <button type="button" key={value} className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div>{period === "custom" && <div className="admin-custom-dates"><label><span>From</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}<small>{range.label} · {rangeLabel}</small></div></div>
    <div className="admin-kpi-grid"><AdminKpi label="New orders" value={String(analytics.newOrders.length)} detail={`Created in ${range.label.toLowerCase()}`} icon="◇" onClick={() => setDetail({ eyebrow: `${range.label} · Order report`, title: "New orders", description: `All orders created within ${rangeLabel}.`, summary: [{ label: "New orders", value: String(analytics.newOrders.length) }, { label: "Sales booked", value: fmt(analytics.salesAmount) }], items: analytics.newOrders.map((order) => ({ id: order.id, date: indiaDateKey(order.createdAt), title: customerDisplayName(customerById(order.customerId)), meta: `${order.orderNo} · ${orderDisplayTitle(order)}`, detail: `${data.persons.find((person) => person.id === order.salespersonId)?.name || "Unassigned salesperson"} · ${shortDate(order.eventDate)}`, amount: order.contractValue, status: order.status })) })} /><AdminKpi label="Sales booked" value={fmt(analytics.salesAmount)} detail="Confirmed order value" icon="₹" onClick={() => setDetail({ eyebrow: `${range.label} · Sales report`, title: "Sales booked", description: `Sales booked within ${rangeLabel}, grouped in the detailed order list below.`, summary: [{ label: "Orders", value: String(analytics.newOrders.length) }, { label: "Sales", value: fmt(analytics.salesAmount) }], items: analytics.newOrders.map((order) => ({ id: order.id, date: indiaDateKey(order.createdAt), title: customerDisplayName(customerById(order.customerId)), meta: `${order.orderNo} · ${data.persons.find((person) => person.id === order.salespersonId)?.name || "Unassigned salesperson"}`, detail: orderDisplayTitle(order), amount: order.contractValue, status: order.status })) })} /><AdminKpi label="Deliveries" value={String(analytics.deliveries.length)} detail={`Scheduled for ${range.label.toLowerCase()}`} icon="↓" onClick={() => setDetail(scheduleDetail("Delivery schedule", analytics.deliveries, "delivery", range.label))} /><AdminKpi label="Pickups" value={String(analytics.pickups.length)} detail={`Scheduled for ${range.label.toLowerCase()}`} icon="↑" onClick={() => setDetail(scheduleDetail("Pickup schedule", analytics.pickups, "pickup", range.label))} /></div>
    <div className="admin-spotlight-grid"><AdminSchedulePanel title="Today’s deliveries" eyebrow={shortDate(todayKey)} orders={todayDeliveries} kind="delivery" customerById={customerById} data={data} compact onView={() => setDetail(scheduleDetail("Today’s deliveries", todayDeliveries, "delivery", "Today"))} /><AdminSchedulePanel title="Tomorrow’s deliveries" eyebrow={shortDate(tomorrowKey)} orders={tomorrowDeliveries} kind="delivery" customerById={customerById} data={data} compact onView={() => setDetail(scheduleDetail("Tomorrow’s deliveries", tomorrowDeliveries, "delivery", "Tomorrow"))} /></div>
    <div className="admin-insight-grid"><article className="panel admin-sales-panel"><div className="panel-head"><div><span className="overline">Salesperson-wise sales</span><h3>Salesperson performance</h3></div><span className="admin-range-chip">{rangeLabel}</span></div><div className="admin-sales-list">{salespersonRows.map((row) => <button type="button" className="admin-sales-row" key={row.id} onClick={() => openSalesperson(row)}><span className="avatar tiny">{initials(row.name)}</span><span className="grow"><span><strong>{row.name}</strong><b>{fmt(row.salesAmount)}</b></span><small>{row.orderCount} new order{row.orderCount === 1 ? "" : "s"} · View sales</small><i><b style={{ width: `${row.salesAmount ? Math.max(4, (row.salesAmount / maxSales) * 100) : 0}%` }} /></i></span></button>)}{!salespersonRows.length && <div className="mini-empty">Add salespeople in People to compare performance.</div>}</div></article><article className="panel admin-sales-panel admin-supervisor-panel"><div className="panel-head"><div><span className="overline">Supervisor activity</span><h3>Supervisor transactions</h3></div><span className="admin-range-chip">{rangeLabel}</span></div><div className="admin-sales-list">{supervisorRows.map((row) => <button type="button" className="admin-sales-row" key={row.person.id} onClick={() => openSupervisor(row)}><span className="avatar tiny">{initials(row.person.name)}</span><span className="grow"><span><strong>{row.person.name}</strong><b>{row.activityCount}</b></span><small>{row.orders.length} orders · {row.expenses.length} expenses · View activity</small></span></button>)}{!supervisorRows.length && <div className="mini-empty">Add supervisors in People to review their activity.</div>}</div></article><AdminSchedulePanel title="Delivery schedule" eyebrow={`${analytics.deliveries.length} selected`} orders={analytics.deliveries} kind="delivery" customerById={customerById} data={data} onView={() => setDetail(scheduleDetail("Delivery schedule", analytics.deliveries, "delivery", range.label))} /><AdminSchedulePanel title="Pickup schedule" eyebrow={`${analytics.pickups.length} selected`} orders={analytics.pickups} kind="pickup" customerById={customerById} data={data} onView={() => setDetail(scheduleDetail("Pickup schedule", analytics.pickups, "pickup", range.label))} /></div>
    {detail && <AdminReportDrawer detail={detail} onClose={() => setDetail(null)} />}
  </section>;
}

function AdminKpi({ label, value, detail, icon, onClick }: { label: string; value: string; detail: string; icon: string; onClick: () => void }) {
  return <button type="button" className="admin-kpi admin-clickable-stat" onClick={onClick} aria-label={`View ${label} details`}><span>{icon}</span><span><small>{label}</small><strong>{value}</strong><p>{detail}</p></span></button>;
}

function AdminSchedulePanel({ title, eyebrow, orders, kind, customerById, data, compact = false, onView }: { title: string; eyebrow: string; orders: Order[]; kind: "delivery" | "pickup"; customerById: (id: string) => Customer | undefined; data: AppData; compact?: boolean; onView?: () => void }) {
  return <article className={`panel admin-schedule-panel ${compact ? "compact" : ""}`}><div className="panel-head"><div><span className="overline">{eyebrow}</span><h3>{title}</h3></div><div className="schedule-panel-actions"><span className="schedule-count">{orders.length}</span>{onView && <button type="button" className="text-btn" onClick={onView}>View all →</button>}</div></div><div className="admin-schedule-list">{orders.map((order) => { const date = kind === "delivery" ? order.deliveryDate : order.pickupDate; const time = kind === "delivery" ? order.deliveryTime : order.pickupTime; const salesperson = data.persons.find((person) => person.id === order.salespersonId); const location = kind === "pickup" && order.pickupFromGodown ? "eRentals godown" : kind === "pickup" ? order.pickupAddress || order.venue || "Venue not added" : order.deliveryAddress || order.venue || "Venue not added"; return <div className="admin-schedule-row" key={`${kind}-${order.id}`}><div className="schedule-date"><strong>{shortDate(date)}</strong><span>{time || "Time not added"}</span></div><div className="grow"><strong>{customerDisplayName(customerById(order.customerId))}</strong><span>{order.orderNo} · {salesperson?.name || "Salesperson not assigned"}</span><small>⌖ {location}</small></div><Status value={order.status} /></div>; })}{!orders.length && <div className="mini-empty">No {kind === "delivery" ? "deliveries" : "pickups"} are scheduled for this date range.</div>}</div></article>;
}

function AdminReportDrawer({ detail, onClose }: { detail: AdminReportDetail; onClose: () => void }) {
  return <div className="modal-backdrop admin-report-overlay" role="presentation"><aside className="customer-drawer transaction-drawer admin-insight-drawer" role="dialog" aria-modal="true" aria-label={detail.title}><button type="button" className="modal-close" onClick={onClose} aria-label="Close report details">×</button><div className="transaction-head"><span className="overline">{detail.eyebrow}</span><h2>{detail.title}</h2><p>{detail.description}</p></div><div className="admin-detail-summary">{detail.summary.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div><div className="drawer-section"><h3>Detailed records</h3><div className="transaction-list">{detail.items.map((item) => <div className="transaction-item admin-detail-item" key={item.id}><span className={`activity-icon ${(item.amount ?? 0) >= 0 ? "in" : "out"}`}>{(item.amount ?? 0) >= 0 ? "↓" : "↑"}</span><div className="grow"><strong>{item.title}</strong><span>{item.meta}</span><small>{item.detail} · {shortDate(item.date)}</small></div>{item.amount !== undefined && <strong className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : "−"}{fmt(Math.abs(item.amount))}</strong>}{item.status && <Status value={item.status} />}</div>)}{!detail.items.length && <div className="mini-empty">No records match this reporting period.</div>}</div></div></aside></div>;
}

function SettingsPage({ customCategories, saving, deletingId, onAdd, onDelete }: { customCategories: ExpenseCategoryRecord[]; saving: boolean; deletingId: string; onAdd: (name: string) => Promise<boolean>; onDelete: (category: ExpenseCategoryRecord) => void }) {
  const [name, setName] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await onAdd(name)) setName("");
  };
  return <div className="section-stack settings-category-manager"><PageHead copy="Administrators can add categories for future expense records. Built-in categories and historical expense entries remain protected." /><div className="settings-grid"><article className="panel settings-create-card"><span className="overline">Expense setup</span><h2>Add a new category</h2><p>Custom categories become available immediately in expense forms for every permitted role.</p><form onSubmit={submit}><Field label="Category name *"><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} placeholder="e.g. Equipment repair" /></Field><button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>{saving ? "Adding…" : "＋ Add category"}</button></form></article><article className="panel settings-list-card"><div className="panel-head"><div><span className="overline">Category library</span><h3>Expense categories</h3></div><span className="schedule-count">{EXPENSE_CATEGORIES.length + customCategories.length}</span></div><div className="settings-category-list">{EXPENSE_CATEGORIES.map((category) => <div className="settings-category-row" key={category}><div><strong>{category}</strong><span>Built-in category</span></div><span className="settings-lock">Protected</span></div>)}{customCategories.map((category) => <div className="settings-category-row" key={category.id}><div><strong>{category.name}</strong><span>Custom category</span></div><button type="button" className="btn-icon-danger" disabled={deletingId === category.id} onClick={() => onDelete(category)} aria-label={`Delete ${category.name}`}>{deletingId === category.id ? "…" : "Delete"}</button></div>)}</div></article></div></div>;
}

function CustomersPage({ customers, customerBalance, openModal, viewCustomer, user }: { customers: Customer[]; customerBalance: (customer: Customer) => number; openModal: (kind: Exclude<ModalKind, null>) => void; viewCustomer: (customer: Customer) => void; user: PublicUser }) {
  const canManageCustomers = canEditCustomerProfile(user.role);
  return <div className="section-stack">
    <PageHead copy={user.role === "supervisor" ? `${customers.length} customer profiles connected to your active assigned orders.` : `${customers.length} customer profiles with a complete order and payment trail.`} action={canManageCustomers ? <button className="btn btn-primary" onClick={() => openModal("customer")}>＋ Add customer</button> : undefined} />
    {customers.length ? <div className="panel table-panel"><div className={`data-table customer-table ${user.role === "supervisor" ? "supervisor-customer-table" : ""}`}>
      <div className="table-row table-header"><span>Customer</span><span>Contact</span><span>GSTIN</span>{user.role !== "supervisor" && <><span>Receivable</span><span>Status</span></>}<span /></div>
      {customers.map((customer) => {
        const balance = customerBalance(customer);
        return <div className="table-row" key={customer.id}>
          <button type="button" className="customer-profile-link entity-cell" onClick={() => viewCustomer(customer)} aria-label={`Open ledger for ${customerDisplayName(customer)}`}>
            <span className="avatar mint">{initials(customerDisplayName(customer))}</span>
            <span><strong>{customerDisplayName(customer)}</strong><small>{customerCompanyName(customer) || "Individual customer"}</small></span>
          </button>
          <div><strong>{customer.phone}</strong><small>{customer.email || "No email"}</small></div>
          <span>{customer.gstin || "Not added"}</span>
          {user.role !== "supervisor" && <><strong className={balance > 0 ? "negative" : "positive"}>{balance < 0 ? `${fmt(Math.abs(balance))} advance` : fmt(balance)}</strong><Status value={balance > 0 ? "Payment due" : balance < 0 ? "Advance" : "Paid"} /></>}
          <button className="text-btn" onClick={() => viewCustomer(customer)}>View profile →</button>
        </div>;
      })}
    </div></div> : user.role === "supervisor" ? <div className="mini-empty">No customer is linked to your active orders.</div> : <EmptyState title="Add your first customer" copy="Create a profile to connect orders and payments." action="Create customer" onClick={() => openModal("customer")} />}
  </div>;
}

function PersonsPage({ persons, orders, expenses, openModal, user }: { persons: Person[]; orders: Order[]; expenses: Expense[]; openModal: (kind: Exclude<ModalKind, null>) => void; user: PublicUser }) {
  return <div className="section-stack"><PageHead copy={user.role === "supervisor" ? "Add contact details only for people associated with one of your active orders." : "Add team members, contractors, vendors or accountants, then assign them to orders and expenses."} action={<button className="btn btn-primary" onClick={() => openModal("person")}>＋ Add order contact</button>} />{persons.length ? <div className="person-grid">{persons.map((person) => { const assignedOrders = orders.filter((order) => isOrderSupervisor(order, person.id) || order.salespersonId === person.id).length; const spend = expenses.filter((expense) => expense.personId === person.id).reduce((sum, expense) => sum + expense.amount, 0); return <article className="person-card" key={person.id}><div className="person-card-head"><span className="avatar large">{initials(person.name)}</span><Status value={person.status} /></div><h3>{person.name}</h3><p>{person.role}</p><div className="contact-lines"><span>☎ {person.phone}</span><span>✉ {person.email || "No email added"}</span></div><div className="person-stats"><div><span>Assigned orders</span><strong>{assignedOrders}</strong></div><div><span>Expenses handled</span><strong>{fmt(spend)}</strong></div></div>{user.role !== "supervisor" && <div className="person-footer"><span>Preferred payment</span><strong>{person.paymentMode}</strong></div>}</article>; })}</div> : <EmptyState title="Build your execution team" copy="Add the people who create bills, manage orders or spend against jobs." action="Add person" onClick={() => openModal("person")} />}</div>;
}

function VendorsPage({ vendors, vendorProducts, orderVendors, payments, expenses, openModal, viewVendor }: { vendors: Vendor[]; vendorProducts: VendorProduct[]; orderVendors: OrderVendor[]; payments: Payment[]; expenses: Expense[]; openModal: (kind: Exclude<ModalKind, null>) => void; viewVendor: (vendor: Vendor) => void }) {
  return <div className="section-stack"><PageHead copy={`${vendors.length} vendor records with product catalogs, rental rates, assignments and payouts.`} action={<button className="btn btn-primary" onClick={() => openModal("vendor")}>＋ Add vendor</button>} secondary={vendors.length ? <button className="btn btn-secondary" onClick={() => openModal("orderVendor")}>Assign product</button> : undefined} />{vendors.length ? <div className="person-grid">{vendors.map((vendor) => { const products = vendorProducts.filter((item) => item.vendorId === vendor.id); const assignments = orderVendors.filter((item) => item.vendorId === vendor.id); const committed = assignments.reduce((sum, item) => sum + item.amount, 0); const spent = expenses.filter((item) => item.vendorId === vendor.id).reduce((sum, item) => sum + item.amount, 0); const paid = payments.filter((item) => item.vendorId === vendor.id && item.direction === "Paid").reduce((sum, item) => sum + item.amount, 0); return <article className="person-card vendor-card" key={vendor.id}><div className="person-card-head"><span className="avatar large">{initials(vendor.name)}</span><Status value={vendor.status} /></div><h3>{vendor.name}</h3><p>{vendor.contactPerson || "Vendor"}</p><div className="contact-lines"><span>☎ {vendor.phone}</span><span>✉ {vendor.email || "No email added"}</span><span>GSTIN: {vendor.gstin || "Not added"}</span></div><div className="person-stats"><div><span>Products</span><strong>{products.length}</strong></div><div><span>Assignments</span><strong>{assignments.length}</strong></div><div><span>Committed</span><strong>{fmt(committed)}</strong></div><div><span>Paid</span><strong>{fmt(paid)}</strong></div></div><div className="person-footer"><span>{fmt(spent)} in expenses</span><button type="button" className="text-btn" onClick={() => viewVendor(vendor)}>Open dashboard →</button></div></article>; })}</div> : <EmptyState title="Add your first vendor" copy="Create a vendor record, then build its product and rental-rate catalog." action="Add vendor" onClick={() => openModal("vendor")} />}</div>;
}

function VendorDashboard({ vendor, data, deletingProductId, deletingAssignmentId, onEditVendor, onAddProduct, onEditProduct, onDeleteProduct, onRemoveAssignment, onClose }: { vendor: Vendor; data: AppData; deletingProductId: string; deletingAssignmentId: string; onEditVendor: () => void; onAddProduct: () => void; onEditProduct: (product: VendorProduct) => void; onDeleteProduct: (product: VendorProduct) => void; onRemoveAssignment: (assignment: OrderVendor) => void; onClose: () => void }) {
  const products = data.vendorProducts.filter((item) => item.vendorId === vendor.id);
  const assignments = data.orderVendors.filter((item) => item.vendorId === vendor.id);
  const payments = data.payments.filter((item) => item.vendorId === vendor.id && item.direction === "Paid");
  const committed = assignments.reduce((sum, item) => sum + item.amount, 0);
  const paid = payments.reduce((sum, item) => sum + item.amount, 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="customer-drawer transaction-drawer vendor-dashboard" role="dialog" aria-modal="true" aria-label={`${vendor.name} vendor dashboard`}>
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <div className="transaction-head vendor-dashboard-head">
        <div><span className="overline">Vendor dashboard</span><h2>{vendor.name}</h2><p>{vendor.contactPerson || "Vendor contact"} · {vendor.phone}</p></div>
        <button type="button" className="btn btn-secondary btn-small" onClick={onEditVendor}>Edit vendor profile</button>
      </div>
      <div className="transaction-summary vendor-summary"><div><span>Catalog products</span><strong>{products.length}</strong></div><div><span>Order assignments</span><strong>{assignments.length}</strong></div><div><span>Tentative cost</span><strong>{fmt(committed)}</strong></div><div><span>Balance to vendor</span><strong className={committed > paid ? "negative" : "positive"}>{fmt(Math.max(0, committed - paid))}</strong></div></div>
      <div className="drawer-section"><div className="drawer-section-head"><h3>Product & rental catalog</h3><button type="button" className="btn btn-primary btn-small" onClick={onAddProduct}>＋ Add product</button></div><div className="vendor-product-list">{products.map((product) => { const productType = catalogProductType(product.productType); return <div className="vendor-product-row" key={product.id}><div className="grow"><strong>{product.name}</strong><span>{productType} · {product.pricingBasis}</span></div><strong>{fmt(product.rentalCharge)}</strong><div className="vendor-product-actions"><button type="button" className="text-btn" aria-label={`Edit product ${product.name}`} onClick={() => onEditProduct(product)}>Edit product</button><button type="button" className="text-btn danger-text" aria-label={`Delete product ${product.name}`} disabled={deletingProductId === product.id} onClick={() => onDeleteProduct(product)}>{deletingProductId === product.id ? "Deleting…" : "Delete product"}</button></div></div>; })}{!products.length && <div className="mini-empty">Add the first product, choose quantity, length or area pricing, then set its per-day or per-event rate.</div>}</div></div>
      <div className="drawer-section"><h3>Recent order assignments</h3><div className="transaction-list">{assignments.slice(0, 8).map((assignment) => { const order = data.orders.find((item) => item.id === assignment.orderId); const productType = catalogProductType(assignment.productType); const measurement = assignment.measurement || assignment.quantity || 1; return <div className="transaction-item vendor-assignment-item" key={assignment.id}><span className="activity-icon out">◇</span><div className="grow"><strong>{assignment.productName}</strong><span>{order?.orderNo || "Order"} · {measurementLabel(productType)} {measurement}{assignment.pricingBasis === "Per day" ? ` · ${assignment.rentalDays || 1} day(s)` : " · per event"}</span><small>{shortDate(assignment.createdAt)}</small></div><strong>{fmt(assignment.amount)}</strong><button type="button" className="text-btn danger-text" disabled={deletingAssignmentId === assignment.id} onClick={() => onRemoveAssignment(assignment)}>{deletingAssignmentId === assignment.id ? "Removing…" : "Remove assignment"}</button></div>; })}{!assignments.length && <div className="mini-empty">Products assigned to orders will appear here.</div>}</div></div>
    </aside>
  </div>;
}

type SalesOrderPeriod = "today" | "tomorrow" | "week" | "month" | "custom";

function SalespersonOrderDashboard({ orders, payments, customerById }: { orders: Order[]; payments: Payment[]; customerById: (id: string) => Customer | undefined }) {
  const todayKey = indiaDateKey();
  const [period, setPeriod] = useState<SalesOrderPeriod>("today");
  const [customFrom, setCustomFrom] = useState(todayKey);
  const [customTo, setCustomTo] = useState(todayKey);
  const [detail, setDetail] = useState<AdminReportDetail | null>(null);
  const range = useMemo(() => period === "tomorrow"
    ? { from: shiftDateKey(todayKey, 1), to: shiftDateKey(todayKey, 1), label: "Tomorrow" }
    : adminDateRange(period, todayKey, customFrom, customTo), [period, todayKey, customFrom, customTo]);
  const eligible = useMemo(() => orders.filter(isFinancialOrder), [orders]);
  const closedOrders = useMemo(() => eligible.filter((order) => order.status === "Completed" && dateIsInRange(order.pickupDate || order.eventDate, range)), [eligible, range]);
  const deliveries = useMemo(() => eligible.filter((order) => dateIsInRange(order.deliveryDate || order.eventDate, range)).sort((a, b) => `${a.deliveryDate}${a.deliveryTime}`.localeCompare(`${b.deliveryDate}${b.deliveryTime}`)), [eligible, range]);
  const pickups = useMemo(() => eligible.filter((order) => dateIsInRange(order.pickupDate, range)).sort((a, b) => `${a.pickupDate}${a.pickupTime}`.localeCompare(`${b.pickupDate}${b.pickupTime}`)), [eligible, range]);
  const pendingOrders = useMemo(() => eligible.map((order) => {
    const received = payments.filter((payment) => payment.direction === "Received" && paymentMatchesOrder(payment, order)).reduce((sum, payment) => sum + payment.amount, 0);
    return { order, remaining: Math.max(0, order.contractValue - received) };
  }).filter(({ order, remaining }) => remaining > 0 && dateIsInRange(order.deliveryDate || order.eventDate, range)), [eligible, payments, range]);
  const rangeLabel = range.from === range.to ? shortDate(range.from) : `${shortDate(range.from)} – ${shortDate(range.to)}`;
  const periodOptions: Array<[SalesOrderPeriod, string]> = [["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["month", "This month"], ["custom", "Custom"]];

  useEffect(() => {
    if (!detail) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [detail]);

  const orderItems = (rows: Order[], kind: "closed" | "delivery" | "pickup"): AdminDetailItem[] => rows.map((order) => {
    const date = kind === "delivery" ? order.deliveryDate || order.eventDate : kind === "pickup" ? order.pickupDate : order.pickupDate || order.eventDate;
    const time = kind === "delivery" ? order.deliveryTime : kind === "pickup" ? order.pickupTime : "";
    const location = kind === "pickup" && order.pickupFromGodown ? "eRentals godown" : kind === "pickup" ? order.pickupAddress || order.venue : order.deliveryAddress || order.venue;
    return { id: `${kind}-${order.id}`, date, title: customerDisplayName(customerById(order.customerId)), meta: `${order.orderNo}${time ? ` · ${time}` : ""}`, detail: [order.title, location || "Venue not added"].filter(Boolean).join(" · "), amount: order.contractValue, status: order.status };
  });
  const showOrders = (title: string, description: string, rows: Order[], kind: "closed" | "delivery" | "pickup") => setDetail({ eyebrow: `${range.label} · My order schedule`, title, description, summary: [{ label: "Orders", value: String(rows.length) }, { label: "Order value", value: fmt(rows.reduce((sum, order) => sum + order.contractValue, 0)) }], items: orderItems(rows, kind) });

  return <section className="sales-order-dashboard" aria-label="Salesperson order dashboard">
    <div className="sales-order-hero"><div><span className="overline">My order desk</span><h2>Sales, delivery and pickup planner</h2><p>Review only your assigned orders, customer movements and outstanding collections for the selected period.</p></div><div className="admin-period-control"><span>Schedule period</span><div className="admin-period-tabs" role="group" aria-label="Salesperson order period">{periodOptions.map(([value, label]) => <button type="button" key={value} className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}</div>{period === "custom" && <div className="admin-custom-dates"><label><span>From</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}<small>{range.label} · {rangeLabel}</small></div></div>
    <div className="admin-kpi-grid sales-order-kpis"><AdminKpi label="Closed orders" value={String(closedOrders.length)} detail={`Completed in ${range.label.toLowerCase()}`} icon="✓" onClick={() => showOrders("Closed orders", `Your completed orders for ${rangeLabel}.`, closedOrders, "closed")} /><AdminKpi label="Deliveries" value={String(deliveries.length)} detail={`Scheduled for ${range.label.toLowerCase()}`} icon="↓" onClick={() => showOrders("Delivery schedule", `Your deliveries scheduled for ${rangeLabel}.`, deliveries, "delivery")} /><AdminKpi label="Pickups" value={String(pickups.length)} detail={`Scheduled for ${range.label.toLowerCase()}`} icon="↑" onClick={() => showOrders("Pickup schedule", `Your pickups scheduled for ${rangeLabel}.`, pickups, "pickup")} /><AdminKpi label="Pending payments" value={fmt(pendingOrders.reduce((sum, item) => sum + item.remaining, 0))} detail={`${pendingOrders.length} order${pendingOrders.length === 1 ? "" : "s"} need collection`} icon="₹" onClick={() => setDetail({ eyebrow: `${range.label} · Collections`, title: "Pending payments", description: `Outstanding customer collections for your orders scheduled within ${rangeLabel}.`, summary: [{ label: "Orders due", value: String(pendingOrders.length) }, { label: "Outstanding", value: fmt(pendingOrders.reduce((sum, item) => sum + item.remaining, 0)) }], items: pendingOrders.map(({ order, remaining }) => ({ id: `pending-${order.id}`, date: order.deliveryDate || order.eventDate, title: customerDisplayName(customerById(order.customerId)), meta: `${order.orderNo} · ${orderDisplayTitle(order)}`, detail: `Delivery ${shortDate(order.deliveryDate || order.eventDate)} · Payment pending`, amount: remaining, status: "Payment due" })) })} /></div>
    {detail && <AdminReportDrawer detail={detail} onClose={() => setDetail(null)} />}
  </section>;
}

function OrdersPage({ data, openModal, customerById, personById, vendorById, user, editOrder, deleteOrder, deletingOrderId, viewTransactions }: { data: AppData; openModal: (kind: Exclude<ModalKind, null>) => void; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; vendorById: (id: string) => Vendor | undefined; user: PublicUser; editOrder: (order: Order) => void; deleteOrder: (order: Order) => void; deletingOrderId: string; viewTransactions: (order: Order) => void }) {
  const currentSalespersonId = data.currentPersonId || user.personId;
  const visibleOrders = user.role === "sales" ? data.orders.filter((order) => order.salespersonId === currentSalespersonId) : data.orders;
  const historicalOrders = visibleOrders.filter(isHistoricalOrder);
  const activeOrders = visibleOrders.filter(isActiveOrder);
  const paymentReceived = (order: Order) => data.payments.filter((payment) => payment.direction === "Received" && paymentMatchesOrder(payment, order)).reduce((sum, payment) => sum + payment.amount, 0);
  return <div className="section-stack"><PageHead copy={user.role === "supervisor" ? `${activeOrders.length} active orders with customer, vendor assignment and execution details.` : `${activeOrders.length} active orders connecting sales value with vendors and payment history.`} action={canCreateRecord(user.role, "order") ? <button className="btn btn-primary" onClick={() => openModal("order")}>＋ Create order</button> : undefined} secondary={activeOrders.length && data.vendors.length ? <button className="btn btn-secondary" onClick={() => openModal("orderVendor")}>Assign vendor</button> : undefined} />{user.role === "sales" && <SalespersonOrderDashboard orders={visibleOrders} payments={data.payments} customerById={customerById} />}{activeOrders.length ? <div className="order-grid">{activeOrders.map((order) => {
    const orderExpenses = data.expenses.filter((item) => item.orderId === order.id);
    const orderPayments = data.payments.filter((item) => item.orderId === order.id);
	const visibleOrderPayments = user.role === "supervisor" ? [] : orderPayments;
    const received = visibleOrderPayments.filter((item) => item.direction === "Received").reduce((sum, item) => sum + item.amount, 0);
	    const remaining = Math.max(0, order.contractValue - received);
	    const savedProducts = data.orderProducts.filter((item) => item.orderId === order.id);
	    const products = savedProducts.length ? savedProducts : order.productName ? [{ id: `legacy-${order.id}`, orderId: order.id, name: order.productName, quantity: 1, price: order.productPrice, amount: order.productPrice, createdAt: order.createdAt }] : [];
	    const assignments = data.orderVendors.filter((item) => item.orderId === order.id);
    const cost = orderExpenses.reduce((sum, item) => sum + item.amount, 0);
    const margin = order.contractValue - cost;
    const progress = Math.min(100, order.contractValue ? (cost / order.contractValue) * 100 : 0);
    const transactionCount = orderExpenses.length + visibleOrderPayments.length + assignments.length;
	    const salesOwnsOrder = user.role === "sales" && order.salespersonId === (data.currentPersonId || user.personId);
	    const supervisors = orderSupervisorIds(order).map((id) => personById(id)).filter((person): person is Person => Boolean(person));
	    return <article className="order-card" key={order.id}><div className="order-top"><span className="order-no">{order.orderNo}</span><Status value={order.status} /></div><h3>{orderDisplayTitle(order)}</h3><p>{customerDisplayName(customerById(order.customerId))}</p><div className="order-meta"><span>⌖ {order.deliveryAddress || order.venue || (order.pickupFromGodown ? "Godown pickup" : "Address not added")}</span><span>↓ {shortDate(order.deliveryDate || order.eventDate)} {order.deliveryTime || ""}</span><span>↑ {shortDate(order.pickupDate)} {order.pickupTime || ""}</span>{order.contactPerson && <span>☎ {order.contactPerson} · {order.contactPhone}</span>}</div>{products.length > 0 && <div className="order-product-list"><small>Order products</small>{products.map((product) => <div className="order-product-line" key={product.id}><span>{product.name} · Qty {product.quantity}</span>{user.role !== "supervisor" && <strong>{fmt(product.price)} each · {fmt(product.amount)}</strong>}</div>)}</div>}{order.attachmentKey && user.role !== "supervisor" && <a className="file-link" href={`/api/upload?key=${encodeURIComponent(order.attachmentKey)}`} target="_blank" rel="noreferrer">▤ {order.attachmentName || "Order document"}</a>}<div className="assigned-person"><span className="avatar tiny">{initials(supervisors[0]?.name || "NA")}</span><div><small>Supervisors</small><strong>{supervisors.map((person) => person.name).join(", ") || "Unassigned"}</strong></div></div>{user.role !== "supervisor" && <div className="assigned-person"><span className="avatar tiny">{initials(personById(order.salespersonId)?.name || "NA")}</span><div><small>Salesperson</small><strong>{personById(order.salespersonId)?.name || "Unassigned"}</strong></div></div>}{assignments.length > 0 && <div className="vendor-assignments"><small>Assigned vendors</small>{assignments.map((assignment) => <div key={assignment.id}><span>{vendorById(assignment.vendorId)?.name || "Vendor"} · {assignment.productName}</span>{user.role !== "supervisor" && <strong>{fmt(assignment.amount)}</strong>}</div>)}</div>}{user.role !== "supervisor" && <><div className="budget-line"><span>Execution cost</span><span>{fmt(cost)} of {fmt(order.contractValue)}</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="order-values"><div><span>Order value</span><strong>{fmt(order.contractValue)}</strong></div><div><span>Received</span><strong className="positive">{fmt(received)}</strong></div><div><span>Remaining payment</span><strong className={remaining ? "negative" : "positive"}>{fmt(remaining)}</strong></div><div><span>Gross margin</span><strong className={margin >= 0 ? "positive" : "negative"}>{fmt(margin)}</strong></div></div></>}<div className="order-actions"><button type="button" className="text-btn" onClick={() => viewTransactions(order)}>View {transactionCount} record{transactionCount === 1 ? "" : "s"} →</button><div className="order-action-buttons">{(["admin", "supervisor"].includes(user.role) || salesOwnsOrder) && <button type="button" className="btn btn-secondary btn-small" onClick={() => editOrder(order)}>Edit order</button>}{user.role === "admin" && <button type="button" className="btn-icon-danger" disabled={deletingOrderId === order.id} onClick={() => deleteOrder(order)}>{deletingOrderId === order.id ? "Deleting…" : "Delete order"}</button>}</div></div></article>;
  })}</div> : !historicalOrders.length && <EmptyState title="Create your first order" copy={user.role === "supervisor" ? "Assigned active orders will appear here." : "An order connects the customer, execution lead, vendors, payments and expenses."} action="Create order" onClick={() => openModal("order")} />}
  {user.role !== "supervisor" && historicalOrders.length > 0 && <section className="panel completed-order-summary"><div className="panel-head"><div><span className="overline">Completed, cancelled and deleted</span><h3>Order History</h3></div><span className="schedule-count">{historicalOrders.length}</span></div><div className="table-panel"><div className="data-table completed-order-table"><div className="table-row table-header"><span>Order / customer</span><span>Delivery</span><span>Pickup</span><span>Status</span><span>Order value</span><span>Pending</span><span>Action</span></div>{historicalOrders.map((order) => { const received = paymentReceived(order); const remaining = Math.max(0, order.contractValue - received); return <div className="table-row" key={`history-${order.id}`}><div><strong>{order.orderNo} · {customerDisplayName(customerById(order.customerId))}</strong><small>{order.title || order.venue || order.deliveryAddress || "No title or venue"}</small></div><div><strong>{shortDate(order.deliveryDate || order.eventDate)}</strong><small>{order.deliveryTime || "Time not added"}</small></div><div><strong>{shortDate(order.pickupDate)}</strong><small>{order.pickupTime || "Time not added"}</small></div><Status value={order.status} /><strong>{fmt(order.contractValue)}</strong><strong className={remaining ? "negative" : "positive"}>{fmt(remaining)}</strong><div className="completed-order-actions"><button type="button" className="text-btn" onClick={() => viewTransactions(order)}>View</button>{user.role === "admin" && order.status === "Completed" && <button type="button" className="btn btn-secondary btn-small" onClick={() => editOrder(order)}>Edit</button>}</div></div>; })}</div></div></section>}
  </div>;
}

type ExpensePeriod = "today" | "week" | "month" | "custom";
type ExpenseBreakdown = { id: string; name: string; detail: string; amount: number; count: number };
type SpreadsheetValue = string | number;

function expensePeriodRange(period: ExpensePeriod, customFrom: string, customTo: string) {
  const now = new Date();
  const end = today();
  if (period === "today") return { from: end, to: end, label: "Today" };
  if (period === "week") {
    const start = new Date(now);
    const daysFromMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysFromMonday);
    return { from: dateInputValue(start), to: end, label: "This week" };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: dateInputValue(start), to: end, label: "This month" };
  }
  return { from: customFrom || end, to: customTo || customFrom || end, label: `${shortDate(customFrom || end)} to ${shortDate(customTo || customFrom || end)}` };
}

function expenseBreakdown(expenses: Expense[], keyFor: (expense: Expense) => { id: string; name: string; detail: string }): ExpenseBreakdown[] {
  const rows = new Map<string, ExpenseBreakdown>();
  for (const expense of expenses) {
    const key = keyFor(expense);
    const current = rows.get(key.id);
    rows.set(key.id, current
      ? { ...current, amount: current.amount + expense.amount, count: current.count + 1 }
      : { ...key, amount: expense.amount, count: 1 });
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

function paymentMatchesOrder(payment: Payment, order: Order) {
  if (payment.orderId === order.id) return true;
  const manualOrderReference = payment.manualOrderId.trim().toLowerCase();
  const orderNumber = order.orderNo.trim().toLowerCase();
  return Boolean(manualOrderReference)
    && payment.direction === "Received"
    && payment.customerId === order.customerId
    && manualOrderReference === orderNumber;
}

function xmlValue(value: SpreadsheetValue) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function spreadsheetWorksheet(name: string, rows: SpreadsheetValue[][]) {
  return `<Worksheet ss:Name="${xmlValue(name)}"><Table>${rows.map((row, rowIndex) => `<Row>${row.map((value) => `<Cell${rowIndex === 0 ? ' ss:StyleID="Header"' : ""}><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${xmlValue(value)}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet>`;
}

function downloadSpreadsheetWorkbook(sheets: Array<{ name: string; rows: SpreadsheetValue[][] }>, fileName: string) {
  const workbook = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11"/></Style><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#176B50" ss:Pattern="Solid"/></Style></Styles>${sheets.map((sheet) => spreadsheetWorksheet(sheet.name, sheet.rows)).join("")}</Workbook>`;
  const url = URL.createObjectURL(new Blob([workbook], { type: "application/vnd.ms-excel" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function BreakdownPanel({ title, eyebrow, rows, total }: { title: string; eyebrow: string; rows: ExpenseBreakdown[]; total: number }) {
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return <article className="panel expense-breakdown-panel"><div className="panel-head"><div><span className="overline">{eyebrow}</span><h3>{title}</h3></div><strong>{fmt(total)}</strong></div><div className="expense-breakdown-list">{rows.map((row) => <div className="expense-breakdown-row" key={row.id}><div><strong>{row.name}</strong><span>{row.detail} · {row.count} record{row.count === 1 ? "" : "s"}</span></div><strong>{fmt(row.amount)}</strong><i><b style={{ width: `${(row.amount / max) * 100}%` }} /></i></div>)}{!rows.length && <div className="mini-empty">No expenses match this filter.</div>}</div></article>;
}

function ExpensesPage({ data, user, openModal }: { data: AppData; user: PublicUser; openModal: (kind: Exclude<ModalKind, null>) => void }) {
  const [period, setPeriod] = useState<ExpensePeriod>("month");
  const [customFrom, setCustomFrom] = useState(today());
  const [customTo, setCustomTo] = useState(today());
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const dateRange = useMemo(() => expensePeriodRange(period, customFrom, customTo), [period, customFrom, customTo]);
  const filteredExpenses = useMemo(() => data.expenses.filter((expense) =>
    expense.expenseDate >= dateRange.from
    && expense.expenseDate <= dateRange.to
    && (!selectedOrderId || expense.orderId === selectedOrderId)
  ), [data.expenses, dateRange, selectedOrderId]);
  const selectedOrder = data.orders.find((order) => order.id === selectedOrderId);
  const personById = (id: string) => data.persons.find((person) => person.id === id);
  const orderById = (id: string) => data.orders.find((order) => order.id === id);
  const customerById = (id: string) => data.customers.find((customer) => customer.id === id);
  const total = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const average = filteredExpenses.length ? total / filteredExpenses.length : 0;
  const personCount = new Set(filteredExpenses.map((expense) => expense.personId).filter(Boolean)).size;
  const orderRows = expenseBreakdown(filteredExpenses, (expense) => {
    const order = orderById(expense.orderId);
    return { id: expense.orderId || "unassigned", name: order?.orderNo || "Order not available", detail: order ? orderDisplayTitle(order) : "Unassigned order" };
  });
  const personRows = expenseBreakdown(filteredExpenses, (expense) => {
    const person = personById(expense.personId);
    return { id: expense.personId || "unassigned", name: person?.name || "Person not available", detail: person?.role || "No responsible person" };
  });
  const categoryRows = expenseBreakdown(filteredExpenses, (expense) => ({ id: expense.category, name: expense.category, detail: "Expense category" }));
  const supervisorRows = expenseBreakdown(filteredExpenses.filter((expense) => {
    const person = personById(expense.personId);
    const order = orderById(expense.orderId);
    const role = person?.role.toLowerCase() || "";
    return Boolean(person && (isOrderSupervisor(order, person.id) || role.includes("supervisor")));
  }), (expense) => {
    const person = personById(expense.personId);
    return { id: expense.personId, name: person?.name || "Supervisor", detail: person?.role || "Supervisor" };
  });
  const topSupervisor = supervisorRows[0];
  const orderExpenses = selectedOrder ? data.expenses.filter((expense) => expense.orderId === selectedOrder.id) : [];
  const orderExpenseTotal = orderExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const supervisorExpenseTotal = selectedOrder ? orderExpenses.filter((expense) => {
    const person = personById(expense.personId);
    const role = person?.role.toLowerCase() || "";
    return Boolean(person && (isOrderSupervisor(selectedOrder, person.id) || role.includes("supervisor")));
  }).reduce((sum, expense) => sum + expense.amount, 0) : 0;
  const selectedOrderPayments = selectedOrder ? data.payments.filter((payment) => paymentMatchesOrder(payment, selectedOrder)) : [];
  const orderReceived = selectedOrderPayments.filter((payment) => payment.direction === "Received").reduce((sum, payment) => sum + payment.amount, 0);
  const vendorPaid = selectedOrderPayments.filter((payment) => payment.direction === "Paid").reduce((sum, payment) => sum + payment.amount, 0);
  const vendorCommitment = selectedOrder ? data.orderVendors.filter((assignment) => assignment.orderId === selectedOrder.id).reduce((sum, assignment) => sum + assignment.amount, 0) : 0;
  const remainingCustomerBalance = selectedOrder ? Math.max(0, selectedOrder.contractValue - orderReceived) : 0;
  const vendorBalance = Math.max(0, vendorCommitment - vendorPaid);
  const selectedCustomer = selectedOrder ? customerById(selectedOrder.customerId) : undefined;
  const selectedSalesperson = selectedOrder ? personById(selectedOrder.salespersonId) : undefined;
  const selectedSupervisors = selectedOrder ? orderSupervisorIds(selectedOrder).map(personById).filter((person): person is Person => Boolean(person)) : [];

  const exportFilteredExpenses = () => {
    const summaryRows: SpreadsheetValue[][] = [
      ["Expense report summary", "Value"],
      ["Period", dateRange.label],
      ["Order filter", selectedOrder?.orderNo || "All order IDs"],
      ["Expense records", filteredExpenses.length],
      ["Total expenses", total],
      ["People spending", personCount],
      ["Average expense", average],
      ["Top supervisor spender", topSupervisor?.name || "No supervisor expense"],
      ["Top supervisor spend", topSupervisor?.amount || 0],
    ];
    const detailRows: SpreadsheetValue[][] = [["Date", "Order ID", "Order title", "Responsible person", "Role", "Category", "Description", "Payment mode", "Amount"], ...filteredExpenses.map((expense) => {
      const order = orderById(expense.orderId);
      const person = personById(expense.personId);
      return [expense.expenseDate, order?.orderNo || "", order ? orderDisplayTitle(order) : "", person?.name || "", person?.role || "", expense.category, expense.description, expense.paymentMode, expense.amount];
    })];
    const orderSummaryRows: SpreadsheetValue[][] = [["Order ID", "Order title", "Expense records", "Total expenses"], ...orderRows.map((row) => [row.name, row.detail, row.count, row.amount])];
    const personSummaryRows: SpreadsheetValue[][] = [["Responsible person", "Role", "Expense records", "Total expenses"], ...personRows.map((row) => [row.name, row.detail, row.count, row.amount])];
    const categorySummaryRows: SpreadsheetValue[][] = [["Category", "Expense records", "Total expenses"], ...categoryRows.map((row) => [row.name, row.count, row.amount])];
    const sheets = [
      { name: "Summary", rows: summaryRows },
      { name: "Expense detail", rows: detailRows },
      { name: "Order summary", rows: orderSummaryRows },
      { name: "Person summary", rows: personSummaryRows },
      { name: "Category summary", rows: categorySummaryRows },
    ];
    if (selectedOrder) sheets.push({ name: "Order financials", rows: [
      ["Order financial detail", "Value"],
      ["Order ID", selectedOrder.orderNo],
      ["Customer", selectedCustomer ? customerDisplayName(selectedCustomer) : ""],
      ["Total order value", selectedOrder.contractValue],
      ["Customer receipts", orderReceived],
      ["Remaining customer balance", remainingCustomerBalance],
      ["Vendor commitment", vendorCommitment],
      ["Vendor payouts", vendorPaid],
      ["Vendor balance", vendorBalance],
      ["All order expenses", orderExpenseTotal],
      ["Supervisor expenses", supervisorExpenseTotal],
      ["Salesperson", selectedSalesperson?.name || ""],
      ["Supervisors", selectedSupervisors.map((person) => person.name).join(", ")],
      ["Delivery", `${selectedOrder.deliveryDate || selectedOrder.eventDate} ${selectedOrder.deliveryTime || ""}`.trim()],
      ["Pickup", `${selectedOrder.pickupDate || ""} ${selectedOrder.pickupTime || ""}`.trim()],
    ] });
    downloadSpreadsheetWorkbook(sheets, `expense-report-${dateRange.from}-to-${dateRange.to}.xls`);
  };

  return <div className="section-stack expense-dashboard"><PageHead copy={`${filteredExpenses.length} expense records · ${fmt(total)} for ${dateRange.label.toLowerCase()}.`} action={<button className="btn btn-primary" onClick={() => openModal("expense")}>＋ Add expense</button>} secondary={<button className="btn btn-secondary" onClick={exportFilteredExpenses}>⇩ Export Excel</button>} />
    <section className="panel expense-filter-panel" aria-label="Expense report filters"><div><span className="overline">Reporting period</span><h2>Expense intelligence</h2><p>Compare spending by order, person and category, then export the exact filtered view.</p></div><div className="expense-period-tabs" role="group" aria-label="Expense period">{([['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']] as Array<[ExpensePeriod, string]>).map(([value, label]) => <button type="button" className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => setPeriod(value)} key={value}>{label}</button>)}</div><div className="expense-filter-fields"><label><span>Order ID</span><select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)}><option value="">All order IDs</option>{data.orders.map((order) => <option value={order.id} key={order.id}>{order.orderNo}{order.title ? ` · ${order.title}` : ""}</option>)}</select></label>{period === "custom" && <><label><span>From date</span><input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>To date</span><input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></>}</div></section>
    <section className="expense-summary-grid"><MetricCard label="Expense total" value={fmt(total)} change={dateRange.label} icon="₹" tone="orange" /><MetricCard label="Expense records" value={String(filteredExpenses.length)} change={selectedOrder ? selectedOrder.orderNo : "Across all orders"} icon="▤" tone="blue" /><MetricCard label="People spending" value={String(personCount)} change="Responsible team members" icon="♧" tone="green" /><MetricCard label="Average expense" value={fmt(average)} change="Per filtered record" icon="↗" tone="red" /></section>
    <section className="expense-analysis-grid"><BreakdownPanel title="Order-wise expenses" eyebrow="Jobs" rows={orderRows} total={total} /><BreakdownPanel title="Person-wise expenses" eyebrow="Responsibility" rows={personRows} total={total} /><BreakdownPanel title="Category-wise expenses" eyebrow="Cost type" rows={categoryRows} total={total} /></section>
    <section className="panel top-supervisor-panel"><div className="top-supervisor-icon">♙</div><div><span className="overline">Top supervisor spender</span><h3>{topSupervisor?.name || "No supervisor expense in this view"}</h3><p>{topSupervisor ? `${topSupervisor.count} expense record${topSupervisor.count === 1 ? "" : "s"} · ${topSupervisor.detail}${selectedOrder ? ` · ${selectedOrder.orderNo}` : ""}` : "Supervisor spending will appear after an expense is recorded."}</p></div><strong>{fmt(topSupervisor?.amount || 0)}</strong></section>
    {selectedOrder && user.role !== "supervisor" && <section className="panel order-financial-panel"><div className="order-financial-head"><div><span className="overline">Complete order ledger</span><h2>{selectedOrder.orderNo} · {orderDisplayTitle(selectedOrder)}</h2><p>{customerDisplayName(selectedCustomer)} · <Status value={selectedOrder.status} /></p></div><div className="order-financial-identity"><span>Customer</span><strong>{selectedCustomer ? customerDisplayName(selectedCustomer) : "Not available"}</strong>{customerCompanyName(selectedCustomer) && <small>{customerCompanyName(selectedCustomer)}</small>}</div></div><div className="order-financial-metrics"><div><span>Total order value</span><strong>{fmt(selectedOrder.contractValue)}</strong></div><div><span>Customer receipts</span><strong className="positive">{fmt(orderReceived)}</strong></div><div><span>Remaining customer balance</span><strong className={remainingCustomerBalance ? "negative" : "positive"}>{fmt(remainingCustomerBalance)}</strong></div><div><span>Vendor commitment</span><strong>{fmt(vendorCommitment)}</strong></div><div><span>Vendor payouts</span><strong>{fmt(vendorPaid)}</strong></div><div><span>Vendor balance</span><strong className={vendorBalance ? "negative" : "positive"}>{fmt(vendorBalance)}</strong></div><div><span>All order expenses</span><strong>{fmt(orderExpenseTotal)}</strong></div><div><span>Supervisor expenses</span><strong>{fmt(supervisorExpenseTotal)}</strong></div></div><div className="order-detail-grid"><div><span>Salesperson</span><strong>{selectedSalesperson?.name || "Not assigned"}</strong></div><div><span>Supervisors</span><strong>{selectedSupervisors.map((person) => person.name).join(", ") || "Not assigned"}</strong></div><div><span>Delivery</span><strong>{shortDate(selectedOrder.deliveryDate || selectedOrder.eventDate)} · {selectedOrder.deliveryTime || "Time not added"}</strong></div><div><span>Pickup</span><strong>{shortDate(selectedOrder.pickupDate)} · {selectedOrder.pickupTime || "Time not added"}</strong></div><div><span>Delivery address</span><strong>{selectedOrder.deliveryAddress || selectedOrder.venue || (selectedOrder.pickupFromGodown ? "Pickup from godown" : "Not added")}</strong></div><div><span>Contact person</span><strong>{selectedOrder.contactPerson ? `${selectedOrder.contactPerson} · ${selectedOrder.contactPhone}` : "Not added"}</strong></div></div></section>}
    {selectedOrder && user.role === "supervisor" && <div className="form-hint">The filtered expense analysis above covers your assigned order and expenses recorded under your supervisor profile.</div>}
    <section className="panel expense-detail-panel"><div className="panel-head"><div><span className="overline">Filtered ledger</span><h3>Expense details</h3></div><span className="expense-result-count">{filteredExpenses.length} result{filteredExpenses.length === 1 ? "" : "s"}</span></div>{filteredExpenses.length ? <div className="table-panel"><div className="data-table expense-table"><div className="table-row table-header"><span>Expense</span><span>Order</span><span>Responsible person</span><span>Category</span><span>Payment</span><span>Amount</span><span>Receipt</span></div>{filteredExpenses.map((expense) => { const order = orderById(expense.orderId); const person = personById(expense.personId); return <div className="table-row" key={expense.id}><div><strong>{expense.description || expense.category}</strong><small>{shortDate(expense.expenseDate)}</small></div><div><strong>{order?.orderNo || "—"}</strong><small>{order ? orderDisplayTitle(order) : "Order not available"}</small></div><div className="entity-inline"><span className="avatar tiny">{initials(person?.name || "NA")}</span><span>{person?.name || "—"}</span></div><strong>{expense.category}</strong><span>{expense.paymentMode}</span><strong className="negative">{fmt(expense.amount)}</strong>{expense.receiptKey ? <a className="file-link" href={`/api/upload?key=${encodeURIComponent(expense.receiptKey)}`} target="_blank" rel="noreferrer">▤ View</a> : <span className="muted">—</span>}</div>; })}</div></div> : <div className="mini-empty">No expenses match this reporting period and order selection.</div>}</section>
  </div>;
}

function PaymentsPage({ payments, customerById, orderById, vendorById, openModal, editPayment }: { payments: Payment[]; customerById: (id: string) => Customer | undefined; orderById: (id: string) => Order | undefined; vendorById: (id: string) => Vendor | undefined; openModal: (kind: Exclude<ModalKind, null>) => void; editPayment: (payment: Payment) => void }) {
  return <div className="section-stack"><PageHead copy="Every customer receipt and vendor payout is recorded against an order ID." action={<button className="btn btn-primary" onClick={() => openModal("payment")}>＋ Record payment</button>} />{payments.length ? <div className="panel table-panel"><div className="data-table payment-table"><div className="table-row table-header"><span>Date</span><span>Type</span><span>Order ID / party</span><span>Method</span><span>Reference</span><span>Amount</span></div>{payments.map((payment) => { const order = orderById(payment.orderId); const party = payment.direction === "Received" ? customerDisplayName(customerById(payment.customerId)) : vendorById(payment.vendorId)?.name; return <div className="table-row" key={payment.id}><strong>{shortDate(payment.paymentDate)}</strong><Status value={payment.direction === "Paid" ? "Paid out" : payment.direction} /><div><strong>{payment.manualOrderId || order?.orderNo || "Legacy payment"}</strong><small>{party || payment.notes || order?.title || "Party not available"}{payment.manualOrderId ? " · Manual Order ID" : ""}</small></div><span>{payment.method}</span><span>{payment.reference || "—"}</span><div className="amount-stack"><strong className={payment.direction === "Received" ? "positive" : "negative"}>{payment.direction === "Received" ? "+" : "−"}{fmt(payment.amount)}</strong><button type="button" className="text-btn" onClick={() => editPayment(payment)}>Edit payment</button></div></div>; })}</div></div> : <EmptyState title="Start your payment ledger" copy="Choose an order ID, then record a customer receipt or vendor payout." action="Record payment" onClick={() => openModal("payment")} />}</div>;
}

function ReportsPage({ data, totals, exportExpenses }: { data: AppData; totals: { orderValue: number; received: number; expenses: number; outstanding: number; profit: number }; exportExpenses: () => void }) {
  const categories = Array.from(new Set(data.expenses.map((item) => item.category))).map((category) => ({ name: category, value: data.expenses.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount, 0) })).sort((a, b) => b.value - a.value); const max = Math.max(...categories.map((item) => item.value), 1); const efficiency = totals.orderValue ? Math.round((totals.received / totals.orderValue) * 100) : 0;
  return <div className="section-stack"><PageHead copy="A clear view of collection efficiency and job profitability." action={<button className="btn btn-primary" onClick={exportExpenses}>⇩ Export expense report</button>} /><section className="report-hero"><div><span>Gross cash profit</span><strong className={totals.profit >= 0 ? "positive" : "negative"}>{fmt(totals.profit)}</strong><p>Payments received minus recorded execution expenses.</p></div><div className="report-score"><i style={{ "--score": `${efficiency}%` } as React.CSSProperties}><span>{efficiency}%</span></i><p>Collection efficiency</p></div></section><section className="report-grid"><article className="panel category-panel"><div className="panel-head"><div><span className="overline">Cost analysis</span><h3>Expenses by category</h3></div></div><div className="category-bars">{categories.map((item) => <div className="category-row" key={item.name}><div><span>{item.name}</span><strong>{fmt(item.value)}</strong></div><i><b style={{ width: `${(item.value / max) * 100}%` }} /></i></div>)}{!categories.length && <div className="mini-empty">Add expenses to see the cost split.</div>}</div></article><article className="panel report-summary"><div className="panel-head"><div><span className="overline">Financial summary</span><h3>Current position</h3></div></div><div className="summary-lines"><div><span>Total order value</span><strong>{fmt(totals.orderValue)}</strong></div><div><span>Payments collected</span><strong className="positive">{fmt(totals.received)}</strong></div><div><span>Order expenses</span><strong className="negative">{fmt(totals.expenses)}</strong></div><div><span>Receivables pending</span><strong>{fmt(totals.outstanding)}</strong></div><div className="summary-total"><span>Cash profit</span><strong>{fmt(totals.profit)}</strong></div></div></article></section></div>;
}

function SupervisorHistoryPage({ orders, customers }: { orders: Order[]; customers: Customer[] }) {
  const customerById = (id: string) => customers.find((customer) => customer.id === id);
  return <div className="section-stack"><PageHead copy="A read-only history of every order assigned to you. Financial values and personal contact numbers are hidden." />{orders.length ? <div className="panel table-panel"><div className="data-table history-table"><div className="table-row table-header"><span>Order</span><span>Customer</span><span>Venue</span><span>Date</span><span>Status</span></div>{orders.map((order) => { const customer = customerById(order.customerId); return <div className="table-row" key={order.id}><div><strong>{order.orderNo}</strong><small>{order.title || "No title"}</small></div><div><strong>{customerDisplayName(customer)}</strong><small>{customerCompanyName(customer)}</small></div><span>{order.venue || "Not added"}</span><strong>{shortDate(order.eventDate)}</strong><Status value={order.status} /></div>; })}</div></div> : <div className="mini-empty">No order history is available for your supervisor profile.</div>}</div>;
}

function CustomerDrawer({ customer, data, user, onEdit, onClose }: { customer: Customer; data: AppData; user: PublicUser; onEdit: () => void; onClose: () => void }) {
  const canManageCustomer = canEditCustomerProfile(user.role);
  const customerOrders = data.orders.filter((item) => item.customerId === customer.id);
  const ledger = buildCustomerLedger(customer, data.orders, data.payments);
  const due = ledger.summary.closingBalance;
  const downloadCustomerLedger = () => {
    const balanceSide = ledgerBalanceSide(ledger.summary.closingBalance) || "Settled";
    const summaryRows: SpreadsheetValue[][] = [
      ["Customer account ledger", "Value"],
      ["Customer", customerDisplayName(customer)],
      ["Company", customerCompanyName(customer)],
      ["Phone", customer.phone],
      ["Email", customer.email],
      ["GSTIN", customer.gstin],
      ["Address", customer.address],
      ["Opening balance", Math.abs(ledger.summary.openingBalance)],
      ["Opening balance side", ledgerBalanceSide(ledger.summary.openingBalance) || "Settled"],
      ["Order value", ledger.summary.orderValue],
      ["Payments received", ledger.summary.received],
      ["Closing balance", Math.abs(ledger.summary.closingBalance)],
      ["Closing balance side", balanceSide],
      ["Downloaded on", today()],
    ];
    const ledgerRows: SpreadsheetValue[][] = [
      ["Date", "Particulars", "Vch Type", "Vch No.", "Debit", "Credit", "Running Balance", "Dr / Cr"],
      ...ledger.entries.map((entry) => [entry.date, entry.particulars, entry.voucherType, entry.voucherNo, entry.debit || "", entry.credit || "", Math.abs(entry.balance), ledgerBalanceSide(entry.balance)]),
    ];
    const fileKey = customerDisplayName(customer).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer";
    downloadSpreadsheetWorkbook([
      { name: "Account summary", rows: summaryRows },
      { name: "Ledger", rows: ledgerRows },
    ], `customer-ledger-${fileKey}-${today()}.xls`);
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className={`customer-drawer ${canManageCustomer ? "customer-ledger-drawer" : ""}`} role="dialog" aria-modal="true" aria-label="Customer profile">
      <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
      <div className="profile-hero">
        <span className="avatar profile-avatar">{initials(customerDisplayName(customer))}</span>
        <h2>{customerDisplayName(customer)}</h2>
        {customerCompanyName(customer) && <p>{customerCompanyName(customer)}</p>}
        {canManageCustomer && <><Status value={due > 0 ? "Payment due" : due < 0 ? "Advance" : "Paid"} /><div className="profile-actions"><button type="button" className="btn btn-secondary btn-small" onClick={onEdit}>Edit customer</button><button type="button" className="btn btn-primary btn-small" onClick={downloadCustomerLedger}>⇩ Download ledger</button></div></>}
      </div>
      {canManageCustomer && <div className="profile-balance"><span>{due >= 0 ? "Closing receivable" : "Customer advance"}</span><strong>{fmt(Math.abs(due))} {ledgerBalanceSide(due)}</strong></div>}
      <div className="profile-details"><div><span>Company</span><strong>{customerCompanyName(customer) || "Not added"}</strong></div><div><span>Phone</span><strong>{customer.phone}</strong></div><div><span>Email</span><strong>{customer.email || "Not added"}</strong></div><div><span>GSTIN</span><strong>{customer.gstin || "Not added"}</strong></div><div><span>Address</span><strong>{customer.address || "Not added"}</strong></div></div>
      {canManageCustomer && <>
        <div className="drawer-section"><h3>Customer activity</h3><div className="ledger-summary-grid"><div><strong>{customerOrders.length}</strong><span>Orders</span></div><div><strong>{fmt(ledger.summary.orderValue)}</strong><span>Order value</span></div><div><strong>{fmt(ledger.summary.received)}</strong><span>Received</span></div><div><strong>{fmt(Math.abs(due))} {ledgerBalanceSide(due)}</strong><span>Closing balance</span></div></div></div>
        <div className="drawer-section customer-ledger-section"><div className="drawer-section-head"><div><span className="overline">Tally-style statement</span><h3>Account ledger</h3></div><button type="button" className="text-btn" onClick={downloadCustomerLedger}>Download ledger</button></div><p>Order amounts are debits, customer payments are credits, and the balance runs by transaction date.</p><div className="customer-ledger-scroll"><table className="customer-ledger-table"><thead><tr><th>Date</th><th>Particulars</th><th>Vch type</th><th>Vch no.</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>{ledger.entries.map((entry) => <tr key={entry.id}><td>{shortDate(entry.date)}</td><td><strong>{entry.particulars}</strong></td><td>{entry.voucherType}</td><td>{entry.voucherNo || "—"}</td><td className="ledger-number">{entry.debit ? fmt(entry.debit) : "—"}</td><td className="ledger-number positive">{entry.credit ? fmt(entry.credit) : "—"}</td><td className={`ledger-number ${entry.balance > 0 ? "negative" : entry.balance < 0 ? "positive" : ""}`}>{fmt(Math.abs(entry.balance))} {ledgerBalanceSide(entry.balance)}</td></tr>)}{!ledger.entries.length && <tr><td colSpan={7} className="ledger-empty">No opening balance, orders, or customer payments have been recorded.</td></tr>}</tbody></table></div></div>
      </>}
    </aside>
  </div>;
}

function OrderTransactionHistory({ order, data, customerById, personById, vendorById, user, onClose }: { order: Order; data: AppData; customerById: (id: string) => Customer | undefined; personById: (id: string) => Person | undefined; vendorById: (id: string) => Vendor | undefined; user: PublicUser; onClose: () => void }) {
  const orderPayments = data.payments.filter((item) => item.orderId === order.id);
  const visibleOrderPayments = user.role === "supervisor" ? [] : orderPayments;
  const orderExpenses = data.expenses.filter((item) => item.orderId === order.id);
  const vendorAssignments = data.orderVendors.filter((item) => item.orderId === order.id);
  const received = visibleOrderPayments.filter((item) => item.direction === "Received").reduce((sum, item) => sum + item.amount, 0);
  const vendorPaid = visibleOrderPayments.filter((item) => item.direction === "Paid").reduce((sum, item) => sum + item.amount, 0);
  const expenseTotal = orderExpenses.reduce((sum, item) => sum + item.amount, 0);
  const transactions = [
    ...visibleOrderPayments.map((payment) => ({
      id: `payment-${payment.id}`,
      date: payment.paymentDate,
      type: payment.direction === "Received" ? "Customer receipt" : "Vendor payment",
      title: payment.direction === "Received" ? customerDisplayName(customerById(payment.customerId)) : vendorById(payment.vendorId)?.name || personById(payment.personId)?.name || "Vendor / payee",
      meta: [payment.method, payment.reference].filter(Boolean).join(" · ") || "Payment",
      amount: payment.direction === "Received" ? payment.amount : -payment.amount,
    })),
    ...orderExpenses.map((expense) => ({
      id: `expense-${expense.id}`,
      date: expense.expenseDate,
      type: "Order expense",
      title: expense.description || expense.category,
      meta: [vendorById(expense.vendorId)?.name || expense.vendor || personById(expense.personId)?.name, expense.category].filter(Boolean).join(" · "),
      amount: -expense.amount,
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

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="customer-drawer transaction-drawer" role="dialog" aria-modal="true" aria-label={`Transactions for ${order.orderNo}`}><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="transaction-head"><span className="order-no">{order.orderNo}</span><h2>{orderDisplayTitle(order)}</h2><p>{customerDisplayName(customerById(order.customerId))} · {shortDate(order.eventDate)}</p></div>{user.role === "supervisor" ? <div className="transaction-summary"><div><span>Expenses</span><strong>{fmt(expenseTotal)}</strong></div><div><span>Vendor assignments</span><strong>{vendorAssignments.length}</strong></div></div> : <div className="transaction-summary"><div><span>Received</span><strong className="positive">{fmt(received)}</strong></div><div><span>Vendor paid</span><strong className="negative">{fmt(vendorPaid)}</strong></div><div><span>Expenses</span><strong>{fmt(expenseTotal)}</strong></div><div><span>Net cash</span><strong className={received - vendorPaid >= 0 ? "positive" : "negative"}>{fmt(received - vendorPaid)}</strong></div></div>}<div className="drawer-section"><h3>Complete order history</h3><div className="transaction-list">{transactions.map((item) => { const privateVendorAssignment = user.role === "supervisor" && item.type === "Vendor assigned"; return <div className="transaction-item" key={item.id}><span className={`activity-icon ${privateVendorAssignment ? "" : item.amount >= 0 ? "in" : "out"}`}>{privateVendorAssignment ? "◇" : item.amount >= 0 ? "↓" : "↑"}</span><div className="grow"><strong>{item.title}</strong><span>{item.type} · {item.meta}</span><small>{shortDate(item.date)}</small></div>{!privateVendorAssignment && <strong className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : "−"}{fmt(Math.abs(item.amount))}</strong>}</div>; })}{!transactions.length && <div className="mini-empty">{user.role === "supervisor" ? "No vendor assignments or expenses have been recorded for this order." : "No vendor assignments, expenses or payments have been recorded for this order."}</div>}</div></div></aside></div>;
}

function RecordModal({ kind, data, user, preferredVendorId, editingCustomer, editingVendor, editingOrder, editingPayment, editingVendorProduct, file, setFile, error, saving, onClose, onSubmit }: { kind: Exclude<ModalKind, null>; data: AppData; user: PublicUser; preferredVendorId: string; editingCustomer: Customer | null; editingVendor: Vendor | null; editingOrder: Order | null; editingPayment: Payment | null; editingVendorProduct: VendorProduct | null; file: File | null; setFile: (file: File | null) => void; error: string; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [paymentDirection, setPaymentDirection] = useState(editingPayment?.direction ?? "Received");
  const [paymentCustomerId, setPaymentCustomerId] = useState(editingPayment?.customerId ?? "");
  const [paymentVendorId, setPaymentVendorId] = useState(editingPayment?.vendorId ?? "");
  const [manualOrderEntry, setManualOrderEntry] = useState(Boolean(editingPayment?.manualOrderId));
  const [paymentOrderId, setPaymentOrderId] = useState(editingPayment?.manualOrderId ? "__manual__" : editingPayment?.orderId ?? "");
	  const availableExpenseCategories = [...EXPENSE_CATEGORIES, ...data.expenseCategories.map((category) => category.name)];
	  const [paymentAllocations, setPaymentAllocations] = useState<Record<string, number>>({});
	  const [orderVendorDrafts, setOrderVendorDrafts] = useState<OrderVendorDraft[]>(() => editingOrder
	    ? data.orderVendors.filter((assignment) => assignment.orderId === editingOrder.id).map((assignment) => ({ key: assignment.id, vendorId: assignment.vendorId, productName: assignment.productName, amount: assignment.amount, notes: assignment.notes }))
	    : []);
	  const [orderProductDrafts, setOrderProductDrafts] = useState<OrderProductDraft[]>(() => {
	    if (!editingOrder) return [];
	    const products = data.orderProducts.filter((product) => product.orderId === editingOrder.id);
	    if (products.length) return products.map((product) => ({ key: product.id, name: product.name, quantity: product.quantity, price: product.price }));
	    return editingOrder.productName ? [{ key: `legacy-${editingOrder.id}`, name: editingOrder.productName, quantity: 1, price: editingOrder.productPrice }] : [];
	  });
  const [assignmentVendorId, setAssignmentVendorId] = useState("");
  const [assignmentProductId, setAssignmentProductId] = useState("");
  const [assignmentMeasurement, setAssignmentMeasurement] = useState(1);
  const [assignmentDays, setAssignmentDays] = useState(1);
  const [expenseOrderId, setExpenseOrderId] = useState("");
  const [pickupFromGodown, setPickupFromGodown] = useState(Boolean(editingOrder?.pickupFromGodown));
  const financialOrderOptions = data.orders.filter(isFinancialOrder);
  const nextOrder = `ORD-${String(data.orders.length + 1).padStart(4, "0")}`; const paymentDirections = ["Received", "Paid"].filter((direction) => canRecordPayment(user.role, direction));
  const canAllocateMultipleOrders = ["admin", "accountant"].includes(user.role) && !editingPayment;
  const selectedPaymentOrders = financialOrderOptions.filter((order) => paymentAllocations[order.id] !== undefined);
  const allocationRows = selectedPaymentOrders.map((order) => ({ orderId: order.id, amount: paymentAllocations[order.id] || 0 }));
  const allocationTotal = allocationRows.reduce((sum, item) => sum + item.amount, 0);
  const eligiblePaymentVendors = data.vendors.filter((vendor) => data.orderVendors.some((assignment) => assignment.vendorId === vendor.id));
  const eligiblePaymentOrders = paymentDirection === "Received"
    ? financialOrderOptions.filter((order) => paymentCustomerId && order.customerId === paymentCustomerId)
    : financialOrderOptions.filter((order) => paymentVendorId && data.orderVendors.some((assignment) => assignment.orderId === order.id && assignment.vendorId === paymentVendorId));
  eligiblePaymentOrders.sort((a, b) => b.eventDate.localeCompare(a.eventDate) || a.orderNo.localeCompare(b.orderNo));
  const assignmentProducts = data.vendorProducts.filter((product) => product.vendorId === assignmentVendorId && product.status === "Active");
  const assignmentProduct = assignmentProducts.find((product) => product.id === assignmentProductId);
  const assignmentProductType = catalogProductType(assignmentProduct?.productType);
  const tentativeCost = assignmentProduct ? calculateTentativeCost(assignmentProduct.rentalCharge, assignmentProduct.pricingBasis, assignmentMeasurement, assignmentDays) : 0;
  const editingOrderReceived = editingOrder ? data.payments.filter((payment) => payment.orderId === editingOrder.id && payment.direction === "Received").reduce((sum, payment) => sum + payment.amount, 0) : 0;
  const editingOrderRemaining = editingOrder ? Math.max(0, editingOrder.contractValue - editingOrderReceived) : 0;
  const selectedExpenseOrder = data.orders.find((order) => order.id === expenseOrderId);
  const eligibleExpensePeople = data.persons.filter((person) => isExpenseResponsiblePerson(person, selectedExpenseOrder));
		  return <div className="modal-backdrop" role="presentation" onMouseDown={kind === "order" ? undefined : (event) => event.target === event.currentTarget && onClose()}><div className="record-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><span className="overline">eKhata workspace</span><h2 id="modal-title">{kind === "customer" && editingCustomer ? "Edit customer profile" : kind === "vendor" && editingVendor ? "Edit vendor profile" : kind === "order" && editingOrder ? "Edit order" : kind === "payment" && editingPayment ? "Edit payment" : kind === "vendorProduct" && editingVendorProduct ? "Edit vendor product" : modalTitles[kind]}</h2><p>Fields marked with * are required.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label={kind === "order" ? "Close order form" : "Close form"}>×</button></div><form onSubmit={onSubmit}><div className="form-grid">
	    {kind === "customer" && <><Field label="Customer name *"><input name="name" required defaultValue={editingCustomer?.name ?? ""} placeholder="e.g. Rohan Mehta" /></Field><Field label="Company name (optional)"><input name="businessName" defaultValue={editingCustomer?.businessName ?? ""} placeholder="e.g. Quest Strategy" /></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" defaultValue={editingCustomer?.phone ?? ""} placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" defaultValue={editingCustomer?.email ?? ""} placeholder="accounts@company.com" /></Field><Field label="GSTIN"><input name="gstin" defaultValue={editingCustomer?.gstin ?? ""} placeholder="27ABCDE1234F1Z5" /></Field><Field label="Opening balance"><input name="openingBalance" type="number" defaultValue={editingCustomer?.openingBalance ?? 0} /></Field><Field label="Billing address" wide><textarea name="address" rows={3} defaultValue={editingCustomer?.address ?? ""} placeholder="Full billing address" /></Field></>}
    {kind === "person" && <><Field label="Full name *"><input name="name" required placeholder="Person or vendor name" /></Field><Field label="Role / type *"><select name="role" required defaultValue=""><option value="" disabled>Select role</option><option>Team member</option><option>Supervisor</option><option>Execution manager</option><option>Labour supervisor</option><option>Sales person</option><option>Sales & billing</option><option>Accountant</option><option>Vendor</option><option>Contractor</option></select></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" placeholder="name@example.com" /></Field><Field label="Preferred payment mode"><select name="paymentMode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Cheque</option></select></Field>{user.role === "supervisor" && <Field label="Associated active order *"><OrderSelect orders={data.orders} name="orderId" /></Field>}</>}
    {kind === "vendor" && <><Field label="Vendor name *"><input name="name" required defaultValue={editingVendor?.name ?? ""} placeholder="Business or supplier name" /></Field><Field label="Contact person"><input name="contactPerson" defaultValue={editingVendor?.contactPerson ?? ""} placeholder="Primary contact" /></Field><Field label="Phone number *"><input name="phone" required inputMode="tel" defaultValue={editingVendor?.phone ?? ""} placeholder="+91 98xxxxxx" /></Field><Field label="Email"><input name="email" type="email" defaultValue={editingVendor?.email ?? ""} placeholder="accounts@vendor.com" /></Field><Field label="GSTIN"><input name="gstin" defaultValue={editingVendor?.gstin ?? ""} placeholder="27ABCDE1234F1Z5" /></Field><Field label="Preferred payment mode"><select name="paymentMode" defaultValue={editingVendor?.paymentMode ?? "Bank transfer"}><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option></select></Field><Field label="Address" wide><textarea name="address" rows={3} defaultValue={editingVendor?.address ?? ""} placeholder="Vendor address" /></Field></>}
    {kind === "vendorProduct" && <><Field label="Vendor *"><VendorSelect vendors={data.vendors} name="vendorId" defaultValue={editingVendorProduct?.vendorId ?? preferredVendorId} /></Field><Field label="Product name *"><input name="name" required defaultValue={editingVendorProduct?.name ?? ""} placeholder="e.g. LED wall rental" /></Field><Field label="Product type *"><select name="productType" required defaultValue={catalogProductType(editingVendorProduct?.productType)}>{productTypes.map((productType) => <option key={productType}>{productType}</option>)}</select></Field><Field label="Rental basis *"><select name="pricingBasis" required defaultValue={editingVendorProduct?.pricingBasis ?? "Per event"}><option>Per event</option><option>Per day</option></select></Field><Field label="Rental charge *"><input name="rentalCharge" required type="number" min="0.01" step="0.01" defaultValue={editingVendorProduct?.rentalCharge} placeholder="0" /></Field><div className="form-hint field-wide">The rate is applied per quantity, unit of length or unit of area, and then per day or event. Accountants and administrators can override the final order cost.</div></>}
    {kind === "orderVendor" && <><Field label="Order *"><OrderSelect orders={data.orders} name="orderId" /></Field><Field label="Vendor *"><select name="vendorId" required value={assignmentVendorId} onChange={(event) => { setAssignmentVendorId(event.target.value); setAssignmentProductId(""); setAssignmentMeasurement(1); }}><option value="">{data.vendors.length ? "Select vendor" : "Add a vendor first"}</option>{data.vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}</option>)}</select></Field><Field label="Product *"><select name="productId" required value={assignmentProductId} disabled={!assignmentVendorId} onChange={(event) => { setAssignmentProductId(event.target.value); setAssignmentMeasurement(1); }}><option value="">{!assignmentVendorId ? "Select vendor first" : assignmentProducts.length ? "Select catalog product" : "No catalog products for this vendor"}</option>{assignmentProducts.map((product) => <option value={product.id} key={product.id}>{product.name}{user.role === "supervisor" ? "" : ` · ${catalogProductType(product.productType)} · ${product.pricingBasis}`}</option>)}</select></Field><Field label={`${measurementLabel(assignmentProductType)} *`}><input name="measurement" required type="number" min={assignmentProductType === "Quantity-wise" ? 1 : 0.01} step={assignmentProductType === "Quantity-wise" ? 1 : 0.01} value={assignmentMeasurement} onChange={(event) => { const value = Number(event.target.value) || 1; setAssignmentMeasurement(assignmentProductType === "Quantity-wise" ? Math.max(1, Math.round(value)) : Math.max(0.01, value)); }} /></Field>{assignmentProduct?.pricingBasis === "Per day" && <Field label="Rental days *"><input name="rentalDays" required type="number" min="1" value={assignmentDays} onChange={(event) => setAssignmentDays(Math.max(1, Math.round(Number(event.target.value) || 1)))} /></Field>}{user.role !== "supervisor" && <><Field label="Tentative cost"><input value={tentativeCost ? fmt(tentativeCost) : "Select a product"} readOnly /></Field><Field label="Final cost override"><input name="amount" type="number" min="1" placeholder={tentativeCost ? String(tentativeCost) : "Optional"} /></Field></>}{user.role === "supervisor" && <div className="form-hint field-wide">Cost calculated privately from the vendor catalog. Rental rates and final amounts are only visible to Admin and Accountant users.</div>}<Field label="Notes" wide><textarea name="notes" rows={2} placeholder="Specifications, timing or terms" /></Field></>}
    {kind === "order" && <>
      {user.role !== "supervisor" && <>
        <Field label="Order number *"><input name="orderNo" required defaultValue={editingOrder?.orderNo ?? nextOrder} /></Field>
        <Field label="Customer *"><CustomerSelect customers={data.customers} name="customerId" defaultValue={editingOrder?.customerId} /></Field>
        {user.role === "sales"
          ? <input type="hidden" name="salespersonId" value={editingOrder?.salespersonId || data.currentPersonId || user.personId} />
          : <Field label="Salesperson *"><TeamPersonSelect persons={data.persons} name="salespersonId" kind="salesperson" defaultValue={editingOrder?.salespersonId} /></Field>}
        <Field label="Supervisor(s) *" wide><TeamPersonMultiSelect persons={data.persons} name="supervisorIds" defaultValues={orderSupervisorIds(editingOrder)} /></Field>
      </>}
      <Field label="Order title (optional)"><input name="title" defaultValue={editingOrder?.title ?? ""} placeholder="e.g. Corporate annual meet" /></Field>
      <Field label="Venue"><input name="venue" defaultValue={editingOrder?.venue ?? ""} placeholder="Event venue or site" /></Field>
      <Field label="Event date *"><input name="eventDate" required type="date" defaultValue={editingOrder?.eventDate ?? today()} /></Field>
      <Field label={`Delivery address${pickupFromGodown ? " (optional)" : " *"}`} wide><textarea name="deliveryAddress" required={!pickupFromGodown} rows={2} defaultValue={editingOrder?.deliveryAddress ?? ""} placeholder="Complete delivery address" /></Field>
      <Field label="Delivery date *"><input name="deliveryDate" required type="date" defaultValue={editingOrder?.deliveryDate || editingOrder?.eventDate || today()} /></Field>
      <Field label="Delivery time *"><input name="deliveryTime" required type="time" defaultValue={editingOrder?.deliveryTime ?? ""} /></Field>
      <div className="field field-wide manual-order-choice">
        <label><input name="pickupFromGodown" type="checkbox" value="true" checked={pickupFromGodown} onChange={(event) => setPickupFromGodown(event.target.checked)} /> Pickup from godown</label>
        <small>When selected, the delivery address and contact details become optional. Delivery and pickup dates remain required.</small>
      </div>
      <Field label="Pickup / return date *"><input name="pickupDate" required type="date" defaultValue={editingOrder?.pickupDate || editingOrder?.eventDate || today()} /></Field>
      <Field label="Pickup / return time *"><input name="pickupTime" required type="time" defaultValue={editingOrder?.pickupTime ?? ""} /></Field>
      <Field label={`Contact person${pickupFromGodown ? " (optional)" : " *"}`}><input name="contactPerson" required={!pickupFromGodown} defaultValue={editingOrder?.contactPerson ?? ""} placeholder="On-site contact name" /></Field>
	      <Field label={`Contact phone${pickupFromGodown ? " (optional)" : " *"}`}><input name="contactPhone" required={!pickupFromGodown} inputMode="tel" defaultValue={editingOrder?.contactPhone ?? ""} placeholder="Contact number" /></Field>
	      {user.role !== "supervisor" && <>
	        <div className="field field-wide order-product-builder"><span>Products for this order (optional)</span>{orderProductDrafts.map((draft, index) => <div className="order-product-draft" key={draft.key}><input aria-label={`Product name ${index + 1}`} required placeholder="Product name" value={draft.name} onChange={(event) => setOrderProductDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, name: event.target.value } : item))} /><input aria-label={`Quantity for product ${index + 1}`} required type="number" min="1" step="1" placeholder="Quantity" value={draft.quantity || ""} onChange={(event) => setOrderProductDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, quantity: Math.max(0, Math.round(Number(event.target.value) || 0)) } : item))} /><input aria-label={`Price for product ${index + 1}`} required type="number" min="1" step="1" placeholder="Price" value={draft.price || ""} onChange={(event) => setOrderProductDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, price: Math.max(0, Math.round(Number(event.target.value) || 0)) } : item))} /><strong>{fmt(draft.quantity * draft.price)}</strong><button type="button" className="icon-btn" aria-label={`Remove product ${index + 1}`} onClick={() => setOrderProductDrafts((current) => current.filter((item) => item.key !== draft.key))}>×</button></div>)}<button type="button" className="btn btn-secondary btn-small" onClick={() => setOrderProductDrafts((current) => [...current, { key: crypto.randomUUID(), name: "", quantity: 1, price: 0 }])}>＋ Add another product</button><input type="hidden" name="products" value={JSON.stringify(orderProductDrafts.map(({ name, quantity, price }) => ({ name, quantity, price })))} /></div>
	        <Field label="Order value *"><input name="contractValue" required type="number" min="1" defaultValue={editingOrder?.contractValue} placeholder="0" /></Field>
	      </>}
      {editingOrder && user.role !== "supervisor" && <div className="field field-wide order-payment-summary">
        <span>Order payment position</span>
        <div><strong>Received against order: {fmt(editingOrderReceived)}</strong><strong>Remaining payment: {fmt(editingOrderRemaining)}</strong></div>
      </div>}
      {["admin", "sales"].includes(user.role) && <FileField file={file} setFile={setFile} label={editingOrder ? "Attach a new image or document (optional)" : "Attach an image, product sheet or quotation (optional)"} kind="order" />}
      {user.role === "sales" && !editingOrder && <>
        <div className="field field-wide order-advance-section"><span>Advance payment received (optional)</span><small>Saving an amount here creates a customer receipt against the new Order ID.</small></div>
        <Field label="Advance payment received"><input name="advancePayment" type="number" min="1" placeholder="0" /></Field>
        <Field label="Advance payment date"><input name="advancePaymentDate" type="date" defaultValue={today()} /></Field>
        <Field label="Advance method"><select name="advancePaymentMethod" defaultValue="Bank transfer"><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option><option>Credit card</option></select></Field>
        <Field label="Advance reference"><input name="advanceReference" placeholder="UTR, cheque no. or reference" /></Field>
        <Field label="Advance notes" wide><input name="advanceNotes" placeholder="Optional note" /></Field>
      </>}
      <Field label="Status"><select name="status" defaultValue={editingOrder?.status ?? "Planned"}><option>Planned</option><option>In progress</option><option>Completed</option><option>Cancelled</option></select></Field>
      {user.role === "admin" && <div className="field field-wide order-vendor-builder order-vendor-editor"><span>{editingOrder ? "Update vendors for this order" : "Vendors for this order"}</span>{orderVendorDrafts.map((draft, index) => <div className="order-vendor-draft" key={draft.key}><VendorSelect vendors={data.vendors} name={`vendor-draft-${index}`} defaultValue={draft.vendorId} onChange={(vendorId) => setOrderVendorDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, vendorId } : item))} /><input aria-label={`Product for vendor ${index + 1}`} required placeholder="Product or service" value={draft.productName} onChange={(event) => setOrderVendorDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, productName: event.target.value } : item))} /><input aria-label={`Amount for vendor ${index + 1}`} required type="number" min="1" placeholder="Amount" value={draft.amount || ""} onChange={(event) => setOrderVendorDrafts((current) => current.map((item) => item.key === draft.key ? { ...item, amount: Math.max(0, Math.round(Number(event.target.value) || 0)) } : item))} /><button type="button" className="icon-btn" aria-label={`Remove vendor ${index + 1}`} onClick={() => setOrderVendorDrafts((current) => current.filter((item) => item.key !== draft.key))}>×</button></div>)}<button type="button" className="btn btn-secondary btn-small" onClick={() => setOrderVendorDrafts((current) => [...current, { key: crypto.randomUUID(), vendorId: "", productName: "", amount: 0, notes: "" }])}>＋ Add another vendor</button><input type="hidden" name="vendorAssignments" value={JSON.stringify(orderVendorDrafts.map(({ vendorId, productName, amount, notes }) => ({ vendorId, productName, amount, notes })))} /></div>}
      {editingOrder?.attachmentKey && user.role !== "supervisor" && <a className="file-link field-wide" href={`/api/upload?key=${encodeURIComponent(editingOrder.attachmentKey)}`} target="_blank" rel="noreferrer">▤ View attached {editingOrder.attachmentName || "order document"}</a>}
    </>}
    {kind === "expense" && <><Field label="Order *"><OrderSelect orders={data.orders} name="orderId" value={expenseOrderId} onChange={setExpenseOrderId} showContext /></Field>{user.role !== "supervisor" && <Field label="Person responsible *"><PersonSelect persons={eligibleExpensePeople} name="personId" emptyLabel={expenseOrderId ? "No eligible active person for this order" : "Select an order first"} /></Field>}<Field label="Expense date *"><input name="expenseDate" required type="date" defaultValue={today()} /></Field><Field label="Category *"><select name="category" required>{availableExpenseCategories.map((category) => <option key={category}>{category}</option>)}</select></Field><Field label="Amount *"><input name="amount" required type="number" min="1" placeholder="0" /></Field><Field label="Payment mode"><select name="paymentMode"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Credit card</option><option>Cheque</option></select></Field><Field label="Description" wide><textarea name="description" rows={2} placeholder="What was this expense for?" /></Field><FileField file={file} setFile={setFile} label="Attach receipt (optional)" /></>}
    {kind === "payment" && <>
      <Field label="Payment type *">
        <select name="direction" required value={paymentDirection} onChange={(event) => {
          setPaymentDirection(event.target.value);
          setPaymentCustomerId("");
          setPaymentVendorId("");
          setPaymentOrderId("");
          setManualOrderEntry(false);
          setPaymentAllocations({});
        }}>
          {paymentDirections.map((direction) => <option key={direction}>{direction}</option>)}
        </select>
      </Field>
      {paymentDirection === "Received" && <Field label="Customer *">
        <select name="customerId" required value={paymentCustomerId} onChange={(event) => {
          setPaymentCustomerId(event.target.value);
          setPaymentOrderId("");
          setManualOrderEntry(false);
          setPaymentAllocations({});
        }}>
          <option value="">{data.customers.length ? "Select customer" : "Add a customer first"}</option>
          {data.customers.map((customer) => <option value={customer.id} key={customer.id}>{customerDisplayName(customer)}{customerCompanyName(customer) ? ` · ${customerCompanyName(customer)}` : ""}</option>)}
        </select>
      </Field>}
      {paymentDirection === "Paid" && <Field label="Vendor / payee *">
        <select name="vendorId" required value={paymentVendorId} onChange={(event) => {
          setPaymentVendorId(event.target.value);
          setPaymentOrderId("");
          setManualOrderEntry(false);
          setPaymentAllocations({});
        }}>
          <option value="">{eligiblePaymentVendors.length ? "Select vendor" : "Assign a vendor to an order first"}</option>
          {eligiblePaymentVendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}{vendor.contactPerson ? ` · ${vendor.contactPerson}` : ""}</option>)}
        </select>
      </Field>}
      {paymentDirection === "Received" && paymentCustomerId && <div className="field field-wide manual-order-choice">
        <small>All {eligiblePaymentOrders.length} customer order{eligiblePaymentOrders.length === 1 ? " is" : "s are"} shown below, including completed and cancelled orders.</small>
        <label><input type="checkbox" checked={manualOrderEntry} onChange={(event) => { setManualOrderEntry(event.target.checked); setPaymentOrderId(event.target.checked ? "__manual__" : ""); setPaymentAllocations({}); }} /> Enter Order ID manually</label>
      </div>}
      {manualOrderEntry ? <>
        <Field label="Manual Order ID *"><input name="manualOrderId" required defaultValue={editingPayment?.manualOrderId ?? ""} placeholder="Enter order number or external reference" /></Field>
        <Field label="Amount *"><input name="amount" required type="number" min="1" defaultValue={editingPayment?.amount} placeholder="0" /></Field>
      </> : canAllocateMultipleOrders ? <div className="field field-wide multi-order-field">
        <span>Allocate payment across orders *</span>
        <div className="allocation-list">
          {eligiblePaymentOrders.map((order) => {
            const selected = paymentAllocations[order.id] !== undefined;
            return <div className={`allocation-row ${selected ? "selected" : ""}`} key={order.id}>
              <label>
                <input type="checkbox" checked={selected} onChange={(event) => setPaymentAllocations((current) => {
                  const next = { ...current };
                  if (event.target.checked) next[order.id] = 0;
                  else delete next[order.id];
                  return next;
                })} />
                <span><strong>{order.orderNo}</strong><small>{order.title ? `${order.title} · ` : ""}{customerDisplayName(data.customers.find((customer) => customer.id === order.customerId))}</small></span>
              </label>
              {selected && <input aria-label={`Amount for ${order.orderNo}`} type="number" min="1" required value={paymentAllocations[order.id] || ""} placeholder="Amount" onChange={(event) => setPaymentAllocations((current) => ({ ...current, [order.id]: Math.max(0, Math.round(Number(event.target.value) || 0)) }))} />}
            </div>;
          })}
          {!eligiblePaymentOrders.length && <div className="mini-empty">{paymentDirection === "Received" ? paymentCustomerId ? "No orders found for this customer." : "Select a customer to see their orders." : paymentVendorId ? "No orders are assigned to this vendor." : "Select a vendor to see assigned orders."}</div>}
        </div>
        <input type="hidden" name="allocations" value={JSON.stringify(allocationRows)} />
        <input type="hidden" name="amount" value={allocationTotal || ""} />
        <small className="allocation-total">{selectedPaymentOrders.length} order{selectedPaymentOrders.length === 1 ? "" : "s"} selected · Total {fmt(allocationTotal)}</small>
      </div> : <>
        <Field label="Order ID *">
          <select name="orderId" required value={paymentOrderId} disabled={paymentDirection === "Received" ? !paymentCustomerId : !paymentVendorId} onChange={(event) => setPaymentOrderId(event.target.value)}>
            <option value="">{eligiblePaymentOrders.length ? "Select order" : paymentDirection === "Received" ? "Select customer first" : "Select vendor first"}</option>
            {eligiblePaymentOrders.map((order) => <option value={order.id} key={order.id}>{order.orderNo}{order.title ? ` · ${order.title}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Amount *"><input name="amount" required type="number" min="1" defaultValue={editingPayment?.amount} placeholder="0" /></Field>
      </>}
      <Field label="Payment date *"><input name="paymentDate" required type="date" defaultValue={editingPayment?.paymentDate ?? today()} /></Field>
      <Field label="Method *"><select name="method" required defaultValue={editingPayment?.method ?? "Bank transfer"}><option>Bank transfer</option><option>UPI</option><option>Cash</option><option>Cheque</option><option>Credit card</option></select></Field>
      <Field label="Reference"><input name="reference" defaultValue={editingPayment?.reference} placeholder="UTR, cheque no. or reference" /></Field>
      <Field label="Notes"><input name="notes" defaultValue={editingPayment?.notes} placeholder="Short payment note" /></Field>
    </>}
	</div>{kind === "order" && (!data.customers.length || !data.persons.length) && <div className="form-hint">Add at least one customer and one person before saving this record.</div>}{kind === "order" && user.role === "admin" && <div className="form-hint">All active People with Sales or Supervisor roles are available directly. Login accounts and email addresses do not control order assignments.</div>}{kind === "order" && user.role === "sales" && <div className="form-hint">Your active People role identifies you automatically. Select every supervisor who should receive this order on their dashboard.</div>}{kind === "expense" && user.role === "supervisor" && !data.orders.length && <div className="form-hint">An active assigned order is required before you can record an expense. Your identity is added automatically.</div>}{kind === "expense" && user.role !== "supervisor" && <div className="form-hint">Select an order first. Responsible-person options are limited to active salespeople, this order&apos;s assigned supervisors, and active manager roles.</div>}{kind === "payment" && <div className="form-hint">Choose the customer for money received to see all of that customer&apos;s orders. If the order is not listed, use Enter Order ID manually. Accountants can allocate one new payment across several listed orders. Vendor payouts still require a vendor assigned to the selected order.</div>}{error && <div className="form-error" role="alert">! {error}</div>}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : kind === "customer" && editingCustomer ? "Update customer" : kind === "vendor" && editingVendor ? "Update vendor" : kind === "order" && editingOrder ? "Update order" : kind === "payment" && editingPayment ? "Update payment" : kind === "vendorProduct" && editingVendorProduct ? "Update vendor product" : `Save ${kind}`}</button></div></form></div></div>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`field ${wide ? "field-wide" : ""}`}><span>{label}</span>{children}</label>; }
function CustomerSelect({ customers, name, optional, defaultValue = "" }: { customers: Customer[]; name: string; optional?: boolean; defaultValue?: string }) { return <select name={name} required={!optional} defaultValue={defaultValue}><option value="">{customers.length ? "Select customer" : "Add a customer first"}</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customerDisplayName(customer)}{customerCompanyName(customer) ? ` · ${customerCompanyName(customer)}` : ""}</option>)}</select>; }
function PersonSelect({ persons, name, defaultValue = "", emptyLabel = "Add a person first" }: { persons: Person[]; name: string; defaultValue?: string; emptyLabel?: string }) { return <select name={name} required defaultValue={defaultValue}><option value="">{persons.length ? "Select person" : emptyLabel}</option>{persons.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select>; }
function TeamPersonSelect({ persons, name, kind, defaultValue = "" }: { persons: Person[]; name: string; kind: "salesperson" | "supervisor"; defaultValue?: string }) { const eligible = persons.filter((person) => isOrderTeamPerson(person, kind)).sort((a, b) => a.name.localeCompare(b.name)); return <select name={name} required defaultValue={defaultValue}><option value="">{eligible.length ? `Select ${kind}` : `Add a ${kind} role in People first`}</option>{eligible.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.role}</option>)}</select>; }
function TeamPersonMultiSelect({ persons, name, defaultValues = [] }: { persons: Person[]; name: string; defaultValues?: string[] }) { const eligible = persons.filter((person) => isOrderTeamPerson(person, "supervisor")).sort((a, b) => a.name.localeCompare(b.name)); return <div className="team-person-multi"><input type="hidden" name="assignedPersonId" value={defaultValues[0] || ""} />{eligible.map((person) => <label key={person.id}><input type="checkbox" name={name} value={person.id} defaultChecked={defaultValues.includes(person.id)} /><span><strong>{person.name}</strong><small>{person.role}</small></span></label>)}{!eligible.length && <small className="muted">Add a supervisor role in People first</small>}</div>; }
function VendorSelect({ vendors, name, optional, defaultValue = "", onChange }: { vendors: Vendor[]; name: string; optional?: boolean; defaultValue?: string; onChange?: (vendorId: string) => void }) { return <select name={name} required={!optional} defaultValue={defaultValue} onChange={onChange ? (event) => onChange(event.target.value) : undefined}><option value="">{vendors.length ? optional ? "No vendor" : "Select vendor" : "Add a vendor first"}</option>{vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}{vendor.contactPerson ? ` · ${vendor.contactPerson}` : ""}</option>)}</select>; }
function OrderSelect({ orders, name, value, defaultValue = "", onChange, showContext = false }: { orders: Order[]; name: string; value?: string; defaultValue?: string; onChange?: (orderId: string) => void; showContext?: boolean }) { const activeOrders = orders.filter(isActiveOrder); return <select name={name} required value={value} defaultValue={value === undefined ? defaultValue : undefined} onChange={onChange ? (event) => onChange(event.target.value) : undefined}><option value="">{activeOrders.length ? "Select order" : "Create an active order first"}</option>{activeOrders.map((order) => <option value={order.id} key={order.id}>{order.orderNo}{showContext ? ` · ${order.title || order.venue || order.deliveryAddress || "Venue not added"}` : order.title ? ` · ${order.title}` : ""}</option>)}</select>; }
function FileField({ file, setFile, label, kind = "receipt" }: { file: File | null; setFile: (file: File | null) => void; label: string; kind?: "receipt" | "order" }) { const orderDocument = kind === "order"; const accept = orderDocument ? "image/*,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.xls,.xlsx,.csv" : "image/*,application/pdf"; return <label className="upload-field field-wide"><input type="file" name="file" accept={accept} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="upload-icon">⇧</span><strong>{file ? file.name : label}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace` : orderDocument ? "Images, PDF, XLS, XLSX or CSV · maximum 10 MB" : "Images or PDF · maximum 10 MB"}</small></label>; }
