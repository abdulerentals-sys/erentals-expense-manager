import type { UserRole } from "./types";

export type TeamAssignment = {
  personId: string;
  role: UserRole;
  status: string;
};

export type OrderTeamKind = "salesperson" | "supervisor";

type OrderTeamPerson = {
  id: string;
  role: string;
  status: string;
};

function personRoleMatchesOrderKind(personRole: string, kind: OrderTeamKind) {
  const role = personRole.trim().toLowerCase();
  return kind === "salesperson"
    ? role.includes("sales")
    : role.includes("supervisor") || role.includes("execution manager");
}

export function isOrderTeamPerson(
  person: OrderTeamPerson | null | undefined,
  kind: OrderTeamKind,
  assignments: TeamAssignment[],
) {
  if (!person || person.status !== "Active") return false;
  if (personRoleMatchesOrderKind(person.role, kind)) return true;
  const dashboardRole = kind === "salesperson" ? "sales" : "supervisor";
  return assignments.some((assignment) =>
    assignment.personId === person.id
    && assignment.role === dashboardRole
    && assignment.status === "Active");
}

export function personRoleMatchesUserRole(personRole: string, userRole: UserRole) {
  const role = personRole.trim().toLowerCase();
  if (userRole === "admin") return true;
  if (userRole === "accountant") return role.includes("accountant");
  if (userRole === "sales") return role.includes("sales");
  return role.includes("supervisor") || role.includes("execution manager");
}
