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

export function expenseCategoryKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
}

export function isBuiltInExpenseCategory(value: string): value is ExpenseCategory {
  const key = expenseCategoryKey(value);
  return EXPENSE_CATEGORIES.some((category) => expenseCategoryKey(category) === key);
}

export function isAllowedExpenseCategory(value: string, customCategories: readonly string[] = []) {
  const key = expenseCategoryKey(value);
  return isBuiltInExpenseCategory(value) || customCategories.some((category) => expenseCategoryKey(category) === key);
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
