import { canViewSection } from "../../auth/permissions";
import { hashPassword, validPassword } from "../../auth/password";
import { getSessionUser } from "../../auth/session";
import { createUser, findUserById, listTeamPersons, listUsers, updateUserPerson } from "../../auth/store";
import { personRoleMatchesUserRole } from "../../auth/team";
import { isUserRole, toPublicUser, type UserRole } from "../../auth/types";

const clean = (value: unknown) => String(value ?? "").trim();

async function adminUser() {
  const user = await getSessionUser();
  return user && !user.mustChangePassword && canViewSection(user.role, "users") ? user : null;
}

export async function GET() {
  if (!(await adminUser())) return Response.json({ error: "Administrator access required" }, { status: 403 });
  const [users, persons] = await Promise.all([listUsers(), listTeamPersons()]);
  return Response.json({ users: users.map(toPublicUser), persons });
}

function linkedPersonError(
  personId: string,
  role: UserRole,
  persons: Awaited<ReturnType<typeof listTeamPersons>>,
  users: Awaited<ReturnType<typeof listUsers>>,
  currentUserId = "",
) {
  if (!personId) return role === "admin" ? "" : "Select the team member who will use this dashboard";
  const person = persons.find((item) => item.id === personId);
  if (!person) return "Select a valid active team member";
  if (!personRoleMatchesUserRole(person.role, role)) return "The selected team member does not match this dashboard role";
  if (users.some((item) => item.id !== currentUserId && item.personId === personId)) return "That team member is already linked to another dashboard account";
  return "";
}

export async function POST(request: Request) {
  if (!(await adminUser())) return Response.json({ error: "Administrator access required" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = clean(body.name);
    const email = clean(body.email).toLowerCase();
    const personId = clean(body.personId);
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    if (!isUserRole(body.role)) return Response.json({ error: "Select a valid role" }, { status: 400 });
    const [persons, users] = await Promise.all([listTeamPersons(), listUsers()]);
    const linkError = linkedPersonError(personId, body.role, persons, users);
    if (linkError) return Response.json({ error: linkError }, { status: 400 });
    const person = persons.find((item) => item.id === personId);
    const displayName = person?.name || name;
    if (!displayName) return Response.json({ error: "Name is required" }, { status: 400 });
    if (!validPassword(password)) {
      return Response.json({ error: "Temporary password needs 10 characters, a letter and a number" }, { status: 400 });
    }
    const user = await createUser({
      name: displayName,
      email,
      personId,
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

export async function PATCH(request: Request) {
  if (!(await adminUser())) return Response.json({ error: "Administrator access required" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userId = clean(body.userId);
    const personId = clean(body.personId);
    const target = userId ? await findUserById(userId) : null;
    if (!target) return Response.json({ error: "Select a valid dashboard user" }, { status: 400 });
    const [persons, users] = await Promise.all([listTeamPersons(), listUsers()]);
    const linkError = linkedPersonError(personId, target.role, persons, users, target.id);
    if (linkError) return Response.json({ error: linkError }, { status: 400 });
    await updateUserPerson(target.id, personId);
    return Response.json({ user: toPublicUser({ ...target, personId, updatedAt: new Date().toISOString() }) });
  } catch {
    return Response.json({ error: "Unable to update team assignment" }, { status: 500 });
  }
}
