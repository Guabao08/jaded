import { requireUser } from "@/lib/auth/session";
import { requireWorkspace } from "@/lib/workspaces";
import { UpdateList } from "../update-list";

export default async function UpdatesPage({ params }: PageProps<"/w/[workspaceId]/updates">) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ws = await requireWorkspace(user.id, workspaceId);
  const updates = await ws.listUpdates(100);
  return (
    <section className="sheet">
      <p className="label">Updates</p>
      <h1>Updates</h1>
      <p>
        Each push to a linked repository&rsquo;s default branch. Jaded decides which are worth a post (you can override)
        and writes drafts for those.
      </p>
      <UpdateList
        workspaceId={ws.workspace.id}
        updates={updates}
        empty="No updates yet. Push to a connected repository's default branch."
      />
    </section>
  );
}
