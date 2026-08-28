export const EXPENSE_CATEGORIES = [
  "Material rental",
  "Fabrication",
  "Labour",
  "Transport",
  "Venue",
  "Food & hospitality",
  "Printing & branding",
  "Miscellaneous",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

type ExpensePerson = {
  id: string;
  role: string;
  status: string;
};

type ExpenseOrder = {
  assignedPersonId: string;
};

export function isAllowedExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function isExpenseResponsiblePerson(
  person: ExpensePerson | null | undefined,
  order: ExpenseOrder | null | undefined,
) {
  if (!person || !order || person.status !== "Active") return false;
  const role = person.role.trim().toLowerCase();
  return person.id === order.assignedPersonId
    || role.includes("sales")
    || role.includes("manager");
}
