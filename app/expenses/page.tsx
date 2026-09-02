import SupervisorExpenseDashboard from "../components/SupervisorExpenseDashboard";
import SupervisorExpenseStyles from "../components/SupervisorExpenseStyles";
import SupervisorReimbursementHistory from "../components/SupervisorReimbursementHistory";
import { canViewSection } from "../auth/permissions";
import { requireDashboardUser } from "../auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const user = await requireDashboardUser();
  if (!canViewSection(user.role, "expenses")) redirect("/");
  return <><SupervisorExpenseStyles /><SupervisorExpenseDashboard user={user} /><SupervisorReimbursementHistory /></>;
}
