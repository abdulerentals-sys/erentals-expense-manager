import { redirect } from "next/navigation";
import { getSessionUser } from "../auth/session";
import LoginForm from "../components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.mustChangePassword ? "/change-password" : "/");
  return <LoginForm />;
}
