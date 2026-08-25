import { clearSession } from "../../../auth/session";

export async function POST() {
  await clearSession();
  return Response.json({ ok: true });
}
