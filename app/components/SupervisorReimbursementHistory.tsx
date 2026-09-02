"use client";

import { useEffect, useState } from "react";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmt = (n: number) => inr.format(n || 0);
const date = (value: string) => value ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";

type Payment = { id: string; orderId: string; personId: string; direction: string; amount: number; paymentDate: string; reference: string; notes: string };

export default function SupervisorReimbursementHistory() {
  const [payments, setPayments] = useState<Payment[]>([]);
  useEffect(() => { void fetch("/api/expense-approvals", { cache: "no-store" }).then((response) => response.json()).then((body) => setPayments(body.payments || [])).catch(() => setPayments([])); }, []);
  return <article className="panel expense-history-panel"><div className="panel-head"><div><span className="overline">Payment history</span><h3>Reimbursements already paid</h3></div><strong>{fmt(payments.reduce((sum, payment) => sum + payment.amount, 0))}</strong></div><div className="table-wrap"><table className="expense-table"><thead><tr><th>Date</th><th>Order</th><th>Supervisor</th><th>Amount</th><th>Reference</th><th>Notes</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{date(payment.paymentDate)}</td><td>{payment.orderId || "—"}</td><td>{payment.personId || "—"}</td><td className="positive">{fmt(payment.amount)}</td><td>{payment.reference || "—"}</td><td>{payment.notes || "Supervisor reimbursement"}</td></tr>)}</tbody></table>{!payments.length && <div className="mini-empty">No supervisor reimbursement has been recorded yet.</div>}</div></article>;
}
