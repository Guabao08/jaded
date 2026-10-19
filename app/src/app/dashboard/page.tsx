import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { listWorkspacesForUser } from "@/lib/workspaces";

export default async function DashboardPage() {
  const user = await requireUser();
  const [first] = await listWorkspacesForUser(user.id);
  if (!first) notFound();
  redirect(`/w/${first.id}`);
}
