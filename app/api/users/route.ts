import { canViewSection } from "../../auth/permissions";
import { hashPassword, validPassword } from "../../auth/password";
import { getSessionUser } from "../../auth/session";
import { createUser, listUsers } from "../../auth/store";
import { isUserRole, toPublicUser } from "../../auth/types";

const clean = (value: unknown) => String(value ?? "").trim();

async function adminUser() {
  const user = await getSessionUser();
  return user && !user.mustChangePassword && canViewSection(user.role, "users") ? user : null;
}

export async function GET() {
  if (!(await adminUser())) return Response.json({ error: "Administrator access required" }, { status: 403 });
  const users = await listUsers();
  return Response.json({ users: users.map(toPublicUser) });
}

export async function POST(request: Request) {
  if (!(await adminUser())) return Response.json({ error: "Administrator access required" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = clean(body.name);
    const email = clean(body.email).toLowerCase();
    const password = String(body.password ?? "");
    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    if (!isUserRole(body.role)) return Response.json({ error: "Select a valid role" }, { status: 400 });
    if (!validPassword(password)) {
      return Response.json({ error: "Temporary password needs 10 characters, a letter and a number" }, { status: 400 });
    }
    const user = await createUser({
      name,
      email,
      role: body.role,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    });
    return Response.json({ user: toPublicUser(user) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create user";
    const duplicate = /duplicate|unique|E11000/i.test(message);
    return Response.json({ error: duplicate ? "A user with that email already exists" : "Unable to create user" }, { status: duplicate ? 409 : 500 });
  }
}
