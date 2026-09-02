import ExpenseDashboard from "../components/ExpenseDashboard";
import { canViewSection } from "../auth/permissions";
import { requireDashboardUser } from "../auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ExpenseEntryPage() {
  const user = await requireDashboardUser();
  if (!canViewSection(user.role, "expenses")) redirect("/");
  return <ExpenseDashboard initialSection="expenses" user={user} />;
}
