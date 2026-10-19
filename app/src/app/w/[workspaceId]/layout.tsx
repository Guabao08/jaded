import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getWorkspaceForUser } from "@/lib/workspaces";
import { signOutAction } from "../../actions";
import styles from "./shell.module.css";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceId]">) {
  const user = await requireUser();
  const { workspaceId } = await params;
  // Not a member (or no such workspace): respond exactly as if it did not exist.
  const workspace = await getWorkspaceForUser(user.id, workspaceId);
  if (!workspace) notFound();

  const nav = (
    <>
      <p className={styles.workspace}>{workspace.name}</p>
      <nav aria-label="Workspace">
        <ul className={styles.nav}>
          <li>
            <Link className={styles.active} href={`/w/${workspace.id}`} aria-current="page">
              Overview
            </Link>
          </li>
        </ul>
      </nav>
      <div className={styles.account}>
        <p className={styles.login}>Signed in as {user.githubLogin}</p>
        <form action={signOutAction}>
          <button className="button button-ghost" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <p className={styles.brand}>Jaded</p>
        {nav}
      </aside>
      <details className={styles.drawer}>
        <summary>
          <span className={styles.brand}>Jaded</span>
          <span className={styles.menu}>Menu</span>
        </summary>
        <div className={styles.drawerBody}>{nav}</div>
      </details>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
