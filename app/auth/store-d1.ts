import { env } from "cloudflare:workers";
import { ensureSchema } from "../../db/ensure";
import type { NewUser, TeamPerson } from "./store";
import type { AppUser, UserRole, UserStatus } from "./types";

type UserRow = {
  id: string;
  name: string;
  email: string;
  person_id: string;
  role: UserRole;
  status: UserStatus;
  password_hash: string;
  must_change_password: number;
  created_at: string;
  updated_at: string;
};

function toUser(row: UserRow | null): AppUser | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    personId: row.person_id ?? "",
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function database() {
  await ensureSchema();
  if (!env.DB) throw new Error("Database storage is unavailable");
  return env.DB;
}

export async function findUserByEmail(email: string) {
  const db = await database();
  return toUser(await db.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").bind(email).first<UserRow>());
}

export async function findUserById(id: string) {
  const db = await database();
  return toUser(await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(id).first<UserRow>());
}

export async function listUsers() {
  const db = await database();
  const result = await db.prepare("SELECT * FROM users ORDER BY created_at DESC").all<UserRow>();
  return result.results.map((row) => toUser(row) as AppUser);
}

export async function countUsers() {
  const db = await database();
  const row = await db.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function createUser(input: NewUser) {
  const db = await database();
  const timestamp = new Date().toISOString();
  const user: AppUser = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    personId: input.personId,
    role: input.role,
    status: "Active",
    passwordHash: input.passwordHash,
    mustChangePassword: input.mustChangePassword,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.prepare("INSERT INTO users (id, name, email, person_id, role, status, password_hash, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(user.id, user.name, user.email, user.personId, user.role, user.status, user.passwordHash, user.mustChangePassword ? 1 : 0, user.createdAt, user.updatedAt)
    .run();
  return user;
}

export async function listTeamPersons() {
  const db = await database();
  const result = await db.prepare("SELECT id, name, role, phone, status FROM persons WHERE status = 'Active' ORDER BY name").all<TeamPerson>();
  return result.results;
}

export async function updateUserPerson(id: string, personId: string) {
  const db = await database();
  await db.prepare("UPDATE users SET person_id = ?, updated_at = ? WHERE id = ?")
    .bind(personId, new Date().toISOString(), id)
    .run();
}

export async function updateUserPassword(id: string, passwordHash: string) {
  const db = await database();
  await db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .bind(passwordHash, new Date().toISOString(), id)
    .run();
}
