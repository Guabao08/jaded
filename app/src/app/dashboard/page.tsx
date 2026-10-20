import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { listWorkspacesForUser } from "@/lib/workspaces";

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const [first] = await listWorkspacesForUser(user.id);
  if (!first) notFound();
  // Carry a GitHub connection result (e.g. ?github=state) through to the workspace.
  const { github } = await searchParams;
  const result = typeof github === "string" && /^[a-z_]{1,30}$/.test(github) ? `?github=${github}` : "";
  redirect(`/w/${first.id}${result}`);
}
