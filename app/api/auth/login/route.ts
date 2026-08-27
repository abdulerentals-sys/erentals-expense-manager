import { constantTimeTextEqual, hashPassword, verifyPassword } from "../../../auth/password";
import { setSession } from "../../../auth/session";
import { countUsers, createUser, findUserByEmail } from "../../../auth/store";
import { toPublicUser } from "../../../auth/types";

const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
      return Response.json({ error: "Enter a valid email address and password" }, { status: 400 });
    }

    let user = await findUserByEmail(email);
    if (!user) {
      const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
      const initialPassword = process.env.ADMIN_INITIAL_PASSWORD ?? "";
      const canBootstrap =
        adminEmail &&
        initialPassword &&
        constantTimeTextEqual(email, adminEmail) &&
        constantTimeTextEqual(password, initialPassword) &&
        (await countUsers()) === 0;
      if (canBootstrap) {
        user = await createUser({
          name: email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
          email,
          personId: "",
          role: "admin",
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        });
      }
    }

    if (!user || user.status !== "Active" || !(await verifyPassword(password, user.passwordHash))) {
      return Response.json({ error: "Email or password is incorrect" }, { status: 401 });
    }

    await setSession(user.id);
    return Response.json({ user: toPublicUser(user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in";
    const configurationError = message.includes("AUTH_SECRET");
    return Response.json(
      { error: configurationError ? "Login is not configured yet. Ask an administrator to add the authentication variables." : "Unable to sign in right now" },
      { status: configurationError ? 503 : 500 },
    );
  }
}
