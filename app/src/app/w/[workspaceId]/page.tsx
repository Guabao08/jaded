import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getWorkspaceForUser } from "@/lib/workspaces";

export default async function WorkspaceOverview({ params }: PageProps<"/w/[workspaceId]">) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const workspace = await getWorkspaceForUser(user.id, workspaceId);
  if (!workspace) notFound();

  return (
    <section className="sheet">
      <p className="label">Overview</p>
      <h1>{workspace.name}</h1>
      <p>
        This is your private workspace. Next you will connect an app: a GitHub repository and its App Store or Google
        Play listing. That step is being built and is not available yet.
      </p>
      <p className="label">Workspace ID</p>
      <p className="mono">{workspace.id}</p>
    </section>
  );
}
