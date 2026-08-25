import { redirect } from "next/navigation";
import { getSessionUser } from "../auth/session";
import ChangePasswordForm from "../components/ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <ChangePasswordForm user={user} required={user.mustChangePassword} />;
}
