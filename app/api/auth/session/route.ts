import { getSessionUser } from "../../../auth/session";

export async function GET() {
  const user = await getSessionUser();
  return user
    ? Response.json({ user })
    : Response.json({ error: "Authentication required" }, { status: 401 });
}
