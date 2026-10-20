import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { github } from "@/lib/github";
import { completeInstallation, INSTALL_STATE_COOKIE, InstallError } from "@/lib/github/install";
import { log } from "@/lib/log";
import { getWorkspaceForUser } from "@/lib/workspaces";

// GitHub sends the user here after they install the App (with "Request user
// authorization during installation" turned on).
export async function GET(request: NextRequest) {
  const base = env().APP_URL;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/signin", base));

  const jar = await cookies();
  const saved = jar.get(INSTALL_STATE_COOKIE)?.value ?? "";
  jar.delete(INSTALL_STATE_COOKIE);
  const [state, workspaceId] = saved.split(":");
  const params = request.nextUrl.searchParams;

  const back = (result: string) =>
    NextResponse.redirect(new URL(`/w/${encodeURIComponent(workspaceId ?? "")}?github=${result}`, base));

  // The state ties this redirect to an install the user started from our dashboard.
  if (!state || !workspaceId || params.get("state") !== state) {
    return NextResponse.redirect(new URL("/dashboard?github=state", base));
  }
  if (!(await getWorkspaceForUser(session.user.id, workspaceId)))
    return NextResponse.redirect(new URL("/dashboard", base));

  const gh = github();
  if (!gh) return back("not_configured");

  try {
    await completeInstallation(
      { userId: session.user.id, workspaceId, installationId: params.get("installation_id"), code: params.get("code") },
      { db, github: gh.client, audit: recordAudit },
    );
    return back("connected");
  } catch (error) {
    if (error instanceof InstallError) return back(error.code);
    log.error("github installation failed", { error });
    return back("error");
  }
}
