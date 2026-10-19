import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** The signed-in user, or a redirect to /signin. Use at the top of every private page. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  return session.user;
}
