import type { ExpenseFundingSource } from "./payment-accounts";

export type SupervisorExpenseStatus = "Pending approval" | "Approved" | "Paid" | "Rejected";

export type SupervisorExpenseRow = {
  id: string;
  expenseNo: string;
  orderId: string;
  personId: string;
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
  submittedByUserId: string;
  submittedByPersonId: string;
  submittedByName: string;
  submittedByRole: string;
};

export function expenseStatus(value: unknown): SupervisorExpenseStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "paid" || normalized === "reimbursed") return "Paid";
  if (normalized === "disapproved" || normalized === "rejected") return "Rejected";
  return "Pending approval";
}

type ReimbursementSubmission = {
  fundingSource?: unknown;
  submittedByRole?: unknown;
  submittedByUserId?: unknown;
  submittedByPersonId?: unknown;
  personId?: unknown;
};

export function isReimbursementSubmission(expense: ReimbursementSubmission, legacySupervisorExpense = false) {
  if (String(expense.fundingSource ?? "Reimbursement").trim().toLowerCase() === "account") return false;
  const submittedByRole = String(expense.submittedByRole ?? "").trim().toLowerCase();
  if (!submittedByRole) return legacySupervisorExpense;
  if (submittedByRole === "supervisor" || submittedByRole === "admin") return true;
  return submittedByRole === "accountant" && legacySupervisorExpense;
}

export function isOwnReimbursementSubmission(
  expense: ReimbursementSubmission,
  user: { userId?: string; personId?: string },
  legacyOwnExpense = false,
) {
  const submittedByRole = String(expense.submittedByRole ?? "").trim().toLowerCase();
  if (!submittedByRole) return legacyOwnExpense;
  if (submittedByRole !== "supervisor") return false;
  const submittedByUserId = String(expense.submittedByUserId ?? "").trim();
  const userId = String(user.userId ?? "").trim();
  if (submittedByUserId && userId) return submittedByUserId === userId;
  const submittedByPersonId = String(expense.submittedByPersonId ?? expense.personId ?? "").trim();
  const personId = String(user.personId ?? "").trim();
  return Boolean(submittedByPersonId && personId && submittedByPersonId === personId);
}

export function reimbursementPending(amount: number, reimbursedAmount: number) {
  return Math.max(0, Math.round(amount || 0) - Math.round(reimbursedAmount || 0));
}

export function reimbursementStatus(value: unknown, amount: number, reimbursedAmount: number): SupervisorExpenseStatus {
  const status = expenseStatus(value);
  return status === "Approved" && Math.round(amount || 0) > 0 && reimbursementPending(amount, reimbursedAmount) === 0 ? "Paid" : status;
}

export function approvedExpenseTotal(rows: Array<Pick<SupervisorExpenseRow, "amount" | "status">>) {
  return rows.reduce((sum, row) => ["Approved", "Paid"].includes(row.status) ? sum + Math.max(0, row.amount) : sum, 0);
}

export function reimbursementTotal(rows: Array<Pick<SupervisorExpenseRow, "reimbursedAmount">>) {
  return rows.reduce((sum, row) => sum + Math.max(0, row.reimbursedAmount), 0);
}

export function pendingReimbursementTotal(rows: Array<Pick<SupervisorExpenseRow, "amount" | "status" | "reimbursedAmount"> & Partial<Pick<SupervisorExpenseRow, "fundingSource">>>) {
  return rows.reduce((sum, row) => sum + (row.status === "Approved" && String(row.fundingSource ?? "Reimbursement").toLowerCase() !== "account" ? reimbursementPending(row.amount, row.reimbursedAmount) : 0), 0);
}

export function orderExpenseTotal(rows: Array<Pick<SupervisorExpenseRow, "orderId" | "amount" | "status">>, orderId: string) {
  return rows.reduce((sum, row) => sum + (row.orderId === orderId && ["Approved", "Paid"].includes(row.status) ? row.amount : 0), 0);
}
