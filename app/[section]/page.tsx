import ExpenseDashboard from "../components/ExpenseDashboard";

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
  return <ExpenseDashboard initialSection={sections.has(section) ? section : "overview"} />;
}
