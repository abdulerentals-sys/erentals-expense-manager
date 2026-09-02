export type LedgerCustomer = {
  id: string;
  openingBalance: number;
  createdAt: string;
};

export type LedgerOrder = {
  id: string;
  orderNo: string;
  title?: string;
  venue?: string;
  customerId: string;
  eventDate: string;
  contractValue: number;
  status: string;
  createdAt: string;
};

export type LedgerPayment = {
  id: string;
  orderId: string;
  manualOrderId: string;
  customerId: string;
  direction: string;
  amount: number;
  paymentDate: string;
  method: string;
  reference: string;
  notes: string;
};

export type CustomerLedgerEntry = {
  id: string;
  date: string;
  particulars: string;
  voucherType: "Opening Balance" | "Order" | "Receipt";
  voucherNo: string;
  debit: number;
  credit: number;
  balance: number;
};

export type CustomerLedger = {
  entries: CustomerLedgerEntry[];
  summary: {
    openingBalance: number;
    orderValue: number;
    received: number;
    closingBalance: number;
  };
};

const wholeAmount = (value: unknown) => Math.round(Number(value) || 0);
const positiveAmount = (value: unknown) => Math.max(0, wholeAmount(value));

export function ledgerDate(value: string) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? "";
}

export function ledgerBalanceSide(balance: number) {
  if (balance > 0) return "Dr";
  if (balance < 0) return "Cr";
  return "";
}

export function buildCustomerLedger(
  customer: LedgerCustomer,
  orders: LedgerOrder[],
  payments: LedgerPayment[],
): CustomerLedger {
  const customerOrders = orders.filter((order) => order.customerId === customer.id && !["Cancelled", "Archived"].includes(order.status));
  const orderById = new Map(customerOrders.map((order) => [order.id, order]));
  const customerReceipts = payments.filter((payment) => payment.customerId === customer.id && payment.direction === "Received");
  const openingBalance = wholeAmount(customer.openingBalance);

  const pendingEntries: Array<Omit<CustomerLedgerEntry, "balance"> & { sequence: number }> = [];
  if (openingBalance !== 0) {
    pendingEntries.push({
      id: `opening-${customer.id}`,
      date: ledgerDate(customer.createdAt),
      particulars: "Opening balance",
      voucherType: "Opening Balance",
      voucherNo: "",
      debit: Math.max(0, openingBalance),
      credit: Math.max(0, -openingBalance),
      sequence: 0,
    });
  }

  for (const order of customerOrders) {
    const context = [order.title, order.venue].find((value) => String(value || "").trim());
    pendingEntries.push({
      id: `order-${order.id}`,
      date: ledgerDate(order.eventDate || order.createdAt),
      particulars: context ? `Order booked · ${context}` : "Order booked",
      voucherType: "Order",
      voucherNo: order.orderNo,
      debit: positiveAmount(order.contractValue),
      credit: 0,
      sequence: 1,
    });
  }

  for (const payment of customerReceipts) {
    const order = orderById.get(payment.orderId);
    const orderReference = order?.orderNo || payment.manualOrderId;
    const detail = [orderReference, payment.method, payment.notes].filter(Boolean).join(" · ");
    pendingEntries.push({
      id: `receipt-${payment.id}`,
      date: ledgerDate(payment.paymentDate),
      particulars: detail ? `Payment received · ${detail}` : "Payment received",
      voucherType: "Receipt",
      voucherNo: payment.reference || payment.manualOrderId || order?.orderNo || payment.id,
      debit: 0,
      credit: positiveAmount(payment.amount),
      sequence: 2,
    });
  }

  pendingEntries.sort((left, right) => left.date.localeCompare(right.date) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  let runningBalance = 0;
  const entries = pendingEntries.map((entry) => {
    runningBalance += entry.debit - entry.credit;
    return {
      id: entry.id,
      date: entry.date,
      particulars: entry.particulars,
      voucherType: entry.voucherType,
      voucherNo: entry.voucherNo,
      debit: entry.debit,
      credit: entry.credit,
      balance: runningBalance,
    };
  });

  return {
    entries,
    summary: {
      openingBalance,
      orderValue: customerOrders.reduce((sum, order) => sum + positiveAmount(order.contractValue), 0),
      received: customerReceipts.reduce((sum, payment) => sum + positiveAmount(payment.amount), 0),
      closingBalance: runningBalance,
    },
  };
}
