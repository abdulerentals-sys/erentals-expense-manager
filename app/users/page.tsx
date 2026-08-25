import { redirect } from "next/navigation";
import { requireDashboardUser } from "../auth/session";
import { canViewSection } from "../auth/permissions";
import UserManagement from "../components/UserManagement";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requireDashboardUser();
  if (!canViewSection(user.role, "users")) redirect("/");
  return <UserManagement currentUser={user} />;
}
