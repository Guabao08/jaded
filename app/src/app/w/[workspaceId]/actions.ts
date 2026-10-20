"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { github } from "@/lib/github";
import { INSTALL_STATE_COOKIE, INSTALL_STATE_MAX_AGE, newInstallState } from "@/lib/github/install";
import { log } from "@/lib/log";
import { importListing, ListingError, parseListingUrl } from "@/lib/stores";
import { requireWorkspace } from "@/lib/workspaces";

// Server actions only accept same-origin POSTs (Next.js checks the Origin
// header), which is the CSRF protection for these forms. Every action
// re-checks membership and validates its input with zod.

const id = z.string().regex(/^[a-z0-9]{10,40}$/);
const line = (max: number) => z.string().trim().min(1).max(max);
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

async function scope(workspaceId: string) {
  const user = await requireUser();
  return { user, ws: await requireWorkspace(user.id, id.parse(workspaceId)) };
}

export async function startGitHubInstall(workspaceId: string) {
  const { ws } = await scope(workspaceId);
  const gh = github();
  if (!gh) redirect(`/w/${ws.workspace.id}?github=not_configured`);
  const state = newInstallState();
  (await cookies()).set(INSTALL_STATE_COOKIE, `${state}:${ws.workspace.id}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/github/callback",
    maxAge: INSTALL_STATE_MAX_AGE,
  });
  redirect(`${gh.webUrl}/apps/${gh.slug}/installations/new?state=${encodeURIComponent(state)}`);
}

export async function createApp(workspaceId: string, formData: FormData) {
  const { ws } = await scope(workspaceId);
  const name = line(100).safeParse(formData.get("name"));
  if (!name.success) redirect(`/w/${ws.workspace.id}?error=app_name`);
  const app = await ws.createApp(name.data);
  redirect(`/w/${ws.workspace.id}/apps/${app.id}`);
}

export async function linkRepository(workspaceId: string, appId: string, formData: FormData) {
  const { ws } = await scope(workspaceId);
  const app = await ws.getApp(id.parse(appId));
  if (!app) redirect(`/w/${ws.workspace.id}`);
  const raw = String(formData.get("repositoryId") ?? "");
  let repositoryId: string | null = null;
  if (raw) {
    const repo = await ws.getRepository(id.parse(raw)); // must belong to this workspace
    if (!repo) redirect(`/w/${ws.workspace.id}/apps/${app.id}?error=repo`);
    repositoryId = repo.id;
  }
  await db().app.update({ where: { id: app.id }, data: { repositoryId } });
  redirect(`/w/${ws.workspace.id}/apps/${app.id}?saved=repo`);
}

export async function importStoreListing(workspaceId: string, appId: string, formData: FormData) {
  const { ws } = await scope(workspaceId);
  const app = await ws.getApp(id.parse(appId));
  if (!app) redirect(`/w/${ws.workspace.id}`);
  const back = `/w/${ws.workspace.id}/apps/${app.id}`;

  let message: string | null = null;
  try {
    const ref = parseListingUrl(String(formData.get("url") ?? "").slice(0, 2000));
    const listing = await importListing(ref);
    const data = {
      ...listing,
      sourceUrl: ref.sourceUrl,
      storeAppId: ref.storeAppId,
      origin: "EXTERNAL_UNTRUSTED" as const,
    };
    await db().storeListing.upsert({
      where: { appId_store: { appId: app.id, store: ref.store } },
      update: { ...data, importedAt: new Date() },
      create: { ...data, appId: app.id, store: ref.store },
    });
    // Prefill the brand profile from the listing unless the user has already written their own.
    const prefill = {
      name: listing.name,
      description: listing.description,
      category: listing.category,
      iconUrl: listing.iconUrl,
      screenshots: listing.screenshots,
      origin: "EXTERNAL_UNTRUSTED" as const,
    };
    if (!app.brandProfile) await db().brandProfile.create({ data: { ...prefill, appId: app.id } });
    else if (app.brandProfile.origin === "EXTERNAL_UNTRUSTED") {
      await db().brandProfile.update({ where: { appId: app.id }, data: prefill });
    } else {
      await db().brandProfile.update({
        where: { appId: app.id },
        data: {
          iconUrl: app.brandProfile.iconUrl ?? listing.iconUrl,
          screenshots: app.brandProfile.screenshots.length ? app.brandProfile.screenshots : listing.screenshots,
        },
      });
    }
  } catch (error) {
    if (error instanceof ListingError) message = error.message;
    else {
      log.error("store listing import failed", { error });
      message = "Import failed. Try again in a minute.";
    }
  }
  redirect(message ? `${back}?importError=${encodeURIComponent(message)}` : `${back}?saved=listing`);
}

const profileSchema = z.object({
  name: line(200),
  description: z.string().trim().max(5000),
  category: optionalLine(100),
});

export async function saveBrandProfile(workspaceId: string, appId: string, formData: FormData) {
  const { ws } = await scope(workspaceId);
  const app = await ws.getApp(id.parse(appId));
  if (!app) redirect(`/w/${ws.workspace.id}`);
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/w/${ws.workspace.id}/apps/${app.id}?error=profile`);
  // Saved by the user, so it is now their own text.
  const data = { ...parsed.data, origin: "USER" as const };
  await db().brandProfile.upsert({
    where: { appId: app.id },
    update: data,
    create: { ...data, appId: app.id, screenshots: [] },
  });
  redirect(`/w/${ws.workspace.id}/apps/${app.id}?saved=profile`);
}

const voiceSchema = z.object({
  tone: optionalLine(200),
  audience: optionalLine(500),
  wordsToAvoid: z
    .string()
    .max(2000)
    .transform((v) =>
      [
        ...new Set(
          v
            .split(/[,\n]/)
            .map((w) => w.trim())
            .filter(Boolean),
        ),
      ].slice(0, 50),
    )
    .pipe(z.array(z.string().max(60))),
});

export async function saveBrandVoice(workspaceId: string, appId: string, formData: FormData) {
  const { ws } = await scope(workspaceId);
  const app = await ws.getApp(id.parse(appId));
  if (!app) redirect(`/w/${ws.workspace.id}`);
  const parsed = voiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/w/${ws.workspace.id}/apps/${app.id}?error=voice`);
  await db().brandProfile.upsert({
    where: { appId: app.id },
    update: parsed.data,
    create: { ...parsed.data, appId: app.id, name: app.name, description: "", screenshots: [] },
  });
  redirect(`/w/${ws.workspace.id}/apps/${app.id}?saved=voice`);
}
