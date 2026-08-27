export const userRoles = ["admin", "accountant", "supervisor", "sales"] as const;

export type UserRole = (typeof userRoles)[number];
export type UserStatus = "Active" | "Disabled";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  personId: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = Omit<AppUser, "passwordHash">;

export function isUserRole(value: unknown): value is UserRole {
  return userRoles.includes(value as UserRole);
}

export function toPublicUser(user: AppUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    personId: user.personId,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
