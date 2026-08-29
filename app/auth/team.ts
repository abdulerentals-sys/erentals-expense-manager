import type { UserRole } from "./types";

export type OrderTeamKind = "salesperson" | "supervisor";

type OrderTeamPerson = {
  id: string;
  name?: string;
  email?: string;
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
) {
  return Boolean(person && person.status === "Active" && personRoleMatchesOrderKind(person.role, kind));
}

export function personRoleMatchesUserRole(personRole: string, userRole: UserRole) {
  const role = personRole.trim().toLowerCase();
  if (userRole === "admin") return true;
  if (userRole === "accountant") return role.includes("accountant");
  if (userRole === "sales") return role.includes("sales");
  return role.includes("supervisor") || role.includes("execution manager");
}

export function resolveUserPersonId(
  people: OrderTeamPerson[],
  user: { personId?: string; name?: string; email?: string; role: UserRole },
) {
  const eligible = people.filter((person) =>
    person.status === "Active" && personRoleMatchesUserRole(person.role, user.role));
  const legacyMatch = eligible.find((person) => person.id === user.personId);
  if (legacyMatch) return legacyMatch.id;

  const normalizedName = String(user.name ?? "").trim().toLowerCase();
  const nameMatches = eligible.filter((person) => normalizedName && String(person.name ?? "").trim().toLowerCase() === normalizedName);
  if (nameMatches.length === 1) return nameMatches[0].id;

  const normalizedEmail = String(user.email ?? "").trim().toLowerCase();
  const emailMatches = eligible.filter((person) => normalizedEmail && String(person.email ?? "").trim().toLowerCase() === normalizedEmail);
  return emailMatches.length === 1 ? emailMatches[0].id : "";
}
