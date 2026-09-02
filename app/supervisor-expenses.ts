import type { ExpenseFundingSource } from "./payment-accounts";

export type SupervisorExpenseStatus = "Pending approval" | "Approved" | "Disapproved";

export type SupervisorExpenseRow = {
  id: string;
  expenseNo: string;
  orderId: string;
  orderNo: string;
  orderTitle: string;
  supervisorId: string;
  supervisorName: string;
  category: string;
  description: string;
  expenseDate: string;
  amount: number;
  paymentMode: string;
  fundingSource: ExpenseFundingSource;
  paymentAccountId: string;
  paymentAccountName: string;
  status: SupervisorExpenseStatus;
  reimbursedAmount: number;
};

export function expenseStatus(value: unknown): SupervisorExpenseStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "disapproved" || normalized === "rejected") return "Disapproved";
  return "Pending approval";
}

export function reimbursementPending(amount: number, reimbursedAmount: number) {
  return Math.max(0, Math.round(amount || 0) - Math.round(reimbursedAmount || 0));
}

export function approvedExpenseTotal(rows: Array<Pick<SupervisorExpenseRow, "amount" | "status">>) {
  return rows.reduce((sum, row) => row.status === "Approved" ? sum + Math.max(0, row.amount) : sum, 0);
}

export function reimbursementTotal(rows: Array<Pick<SupervisorExpenseRow, "reimbursedAmount">>) {
  return rows.reduce((sum, row) => sum + Math.max(0, row.reimbursedAmount), 0);
}

export function pendingReimbursementTotal(rows: Array<Pick<SupervisorExpenseRow, "amount" | "status" | "reimbursedAmount"> & Partial<Pick<SupervisorExpenseRow, "fundingSource">>>) {
  return rows.reduce((sum, row) => sum + (row.status === "Approved" && String(row.fundingSource ?? "Reimbursement").toLowerCase() !== "account" ? reimbursementPending(row.amount, row.reimbursedAmount) : 0), 0);
}

export function orderExpenseTotal(rows: Array<Pick<SupervisorExpenseRow, "orderId" | "amount" | "status">>, orderId: string) {
  return rows.reduce((sum, row) => sum + (row.orderId === orderId && row.status === "Approved" ? row.amount : 0), 0);
}
