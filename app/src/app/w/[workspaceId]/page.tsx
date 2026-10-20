import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { github } from "@/lib/github";
import { requireWorkspace } from "@/lib/workspaces";
import { createApp, startGitHubInstall } from "./actions";
import { UpdateList } from "./update-list";

const GITHUB_MESSAGES: Record<string, string> = {
  connected: "GitHub is connected.",
  not_configured: "The Jaded GitHub App isn't set up on this server yet.",
  state: "That GitHub link expired or didn't start here. Please try connecting again.",
  missing: "GitHub didn't finish the installation. Please try again.",
  not_yours: "GitHub says your account can't access that installation, so it wasn't connected.",
  other_workspace: "That GitHub installation is already connected to another workspace.",
  error: "Something went wrong connecting GitHub. Please try again.",
};

export default async function WorkspaceOverview({ params, searchParams }: PageProps<"/w/[workspaceId]">) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const query = await searchParams;
  const ws = await requireWorkspace(user.id, workspaceId);
  const [apps, installations, repositories, updates] = await Promise.all([
    ws.listApps(),
    ws.listInstallations(),
    ws.listRepositories(),
    ws.listUpdates(5),
  ]);
  const configured = github() !== null;
  const githubMessage = typeof query.github === "string" ? GITHUB_MESSAGES[query.github] : undefined;
  const id = ws.workspace.id;

  return (
    <div className="stack">
      <section className="sheet">
        <p className="label">Overview</p>
        <h1>{ws.workspace.name}</h1>
        {githubMessage && (
          <p className="notice" role="status">
            {githubMessage}
          </p>
        )}
        <h2>GitHub</h2>
        {installations.length > 0 ? (
          <>
            <p>
              Connected to {installations.map((i) => i.accountLogin).join(", ")} with read-only access to{" "}
              {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}.
            </p>
            <form action={startGitHubInstall.bind(null, id)}>
              <button className="button button-ghost" type="submit">
                Change repository access on GitHub
              </button>
            </form>
          </>
        ) : configured ? (
          <>
            <p>
              Install the Jaded GitHub App on the repositories you want posts about. It gets read-only access to code,
              metadata and pull requests, and receives push events.
            </p>
            <form action={startGitHubInstall.bind(null, id)}>
              <button className="button" type="submit">
                Connect GitHub
              </button>
            </form>
          </>
        ) : (
          <p>The Jaded GitHub App isn&rsquo;t set up on this server yet. See app/README.md.</p>
        )}
      </section>

      <section className="sheet">
        <h2>Apps</h2>
        {apps.length === 0 ? (
          <p>Add the app you want Jaded to market. You can link its repository and store listing next.</p>
        ) : (
          <ul className="rows">
            {apps.map((app) => (
              <li key={app.id}>
                <Link href={`/w/${id}/apps/${app.id}`}>{app.name}</Link>
                <span className="muted">{app.repository ? app.repository.fullName : "No repository linked"}</span>
              </li>
            ))}
          </ul>
        )}
        <form action={createApp.bind(null, id)} className="inline-form">
          <label htmlFor="app-name" className="label">
            New app name
          </label>
          <input id="app-name" name="name" required maxLength={100} className="input" />
          <button className="button" type="submit">
            Add app
          </button>
        </form>
      </section>

      <section className="sheet">
        <h2>Recent updates</h2>
        <UpdateList updates={updates} empty="Pushes to a linked repository's default branch will show up here." />
        {updates.length > 0 && <Link href={`/w/${id}/updates`}>All updates</Link>}
      </section>
    </div>
  );
}
