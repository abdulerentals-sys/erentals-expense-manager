import type { AppUser, UserRole } from "./types";

export type NewUser = {
  name: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  mustChangePassword: boolean;
};

function usesMongoStorage() {
  return typeof process !== "undefined" && Boolean(process.env.MONGODB_URI?.trim());
}

async function adapter() {
  return usesMongoStorage() ? import("./store-mongodb") : import("./store-d1");
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  return (await adapter()).findUserByEmail(email);
}

export async function findUserById(id: string): Promise<AppUser | null> {
  return (await adapter()).findUserById(id);
}

export async function listUsers(): Promise<AppUser[]> {
  return (await adapter()).listUsers();
}

export async function countUsers(): Promise<number> {
  return (await adapter()).countUsers();
}

export async function createUser(input: NewUser): Promise<AppUser> {
  return (await adapter()).createUser(input);
}

export async function updateUserPassword(id: string, passwordHash: string): Promise<void> {
  return (await adapter()).updateUserPassword(id, passwordHash);
}
