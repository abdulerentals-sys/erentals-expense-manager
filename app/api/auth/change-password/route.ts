import { hashPassword, validPassword, verifyPassword } from "../../../auth/password";
import { getSessionUser, setSession } from "../../../auth/session";
import { findUserById, updateUserPassword } from "../../../auth/store";

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const body = (await request.json()) as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");
    if (!validPassword(newPassword)) {
      return Response.json({ error: "Use at least 10 characters with a letter and a number" }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return Response.json({ error: "Choose a password different from your current password" }, { status: 400 });
    }
    const user = await findUserById(sessionUser.id);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return Response.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    await updateUserPassword(user.id, await hashPassword(newPassword));
    await setSession(user.id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Unable to change the password right now" }, { status: 500 });
  }
}
