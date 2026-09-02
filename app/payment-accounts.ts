export type ExpenseFundingSource = "Reimbursement" | "Account";

export type PaymentAccountRecord = {
  id: string;
  name: string;
  nameKey: string;
  status: string;
  createdAt: string;
};

export const DEFAULT_PAYMENT_ACCOUNTS = [
  { id: "payment-account-hope-and-dream", name: "Hope and Dream" },
  { id: "payment-account-erentals", name: "eRentals" },
] as const;

export function paymentAccountKey(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function expenseFundingSource(value: unknown): ExpenseFundingSource {
  return String(value ?? "").trim().toLowerCase() === "account" ? "Account" : "Reimbursement";
}

export function expenseNeedsReimbursement(expense: { fundingSource?: unknown }) {
  return expenseFundingSource(expense.fundingSource) === "Reimbursement";
}
