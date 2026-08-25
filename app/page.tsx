import ExpenseDashboard from "./components/ExpenseDashboard";
import { requireDashboardUser } from "./auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireDashboardUser();
  return <ExpenseDashboard initialSection="overview" user={user} />;
}
