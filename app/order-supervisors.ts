export type OrderSupervisorFields = {
  assignedPersonId?: unknown;
  supervisorIds?: unknown;
};

export function normalizeSupervisorIds(value: unknown): string[] {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try { raw = JSON.parse(trimmed); } catch { raw = [trimmed]; }
    } else {
      raw = [trimmed];
    }
  }
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

export function orderSupervisorIds(order: OrderSupervisorFields | null | undefined): string[] {
  if (!order) return [];
  return normalizeSupervisorIds([
    ...normalizeSupervisorIds(order.supervisorIds),
    String(order.assignedPersonId ?? "").trim(),
  ]);
}

export function isOrderSupervisor(order: OrderSupervisorFields | null | undefined, personId: string) {
  return Boolean(personId && orderSupervisorIds(order).includes(personId));
}
