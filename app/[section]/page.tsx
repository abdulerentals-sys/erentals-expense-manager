import ExpenseDashboard from "../components/ExpenseDashboard";
import { canViewSection } from "../auth/permissions";
import { requireDashboardUser } from "../auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const sections = new Set([
  "customers",
  "invoices",
  "persons",
  "orders",
  "expenses",
  "payments",
  "reports",
]);

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const user = await requireDashboardUser();
  if (!sections.has(section) || !canViewSection(user.role, section)) redirect("/");
  return <ExpenseDashboard initialSection={section} user={user} />;
}
