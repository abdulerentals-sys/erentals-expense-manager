import type { UserRole } from "./types";

export function personRoleMatchesUserRole(personRole: string, userRole: UserRole) {
  const role = personRole.trim().toLowerCase();
  if (userRole === "admin") return true;
  if (userRole === "accountant") return role.includes("accountant");
  if (userRole === "sales") return role.includes("sales");
  return role.includes("supervisor") || role.includes("execution manager");
}
