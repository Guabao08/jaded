import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { requireWorkspace } from "@/lib/workspaces";
import { importStoreListing, linkRepository, saveBrandProfile, saveBrandVoice } from "../../actions";

const SAVED: Record<string, string> = {
  repo: "Repository saved.",
  listing: "Listing imported. Check the profile below and save it to make it yours.",
  profile: "Profile saved.",
  voice: "Brand voice saved.",
};
const ERRORS: Record<string, string> = {
  repo: "That repository isn't connected to this workspace.",
  profile:
    "Check the profile fields: a name is required, the description can be up to 5,000 characters and the colour looks like #c94f39.",
  voice: "Check the brand voice fields and try again.",
};

export default async function AppPage({ params, searchParams }: PageProps<"/w/[workspaceId]/apps/[appId]">) {
  const user = await requireUser();
  const { workspaceId, appId } = await params;
  const query = await searchParams;
  const ws = await requireWorkspace(user.id, workspaceId);
  const app = await ws.getApp(appId);
  if (!app) notFound();
  const repositories = await ws.listRepositories();
  const profile = app.brandProfile;
  const id = ws.workspace.id;
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : undefined;
  const error = typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const importError = typeof query.importError === "string" ? query.importError.slice(0, 300) : undefined;

  return (
    <div className="stack">
      <section className="sheet">
        <p className="label">App</p>
        <h1>{app.name}</h1>
        {saved && (
          <p className="notice" role="status">
            {saved}
          </p>
        )}
        {(error || importError) && (
          <p className="notice" role="alert">
            {error ?? importError}
          </p>
        )}

        <h2>Repository</h2>
        {repositories.length === 0 ? (
          <p>Connect GitHub from the overview page first, then pick the repository here.</p>
        ) : (
          <form action={linkRepository.bind(null, id, app.id)} className="inline-form">
            <label htmlFor="repo" className="label">
              Repository
            </label>
            <select id="repo" name="repositoryId" defaultValue={app.repositoryId ?? ""} className="input">
              <option value="">None</option>
              {repositories.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                  {r.private ? " (private)" : ""}
                </option>
              ))}
            </select>
            <button className="button" type="submit">
              Save
            </button>
          </form>
        )}

        <h2>Store listing</h2>
        <p>
          Paste the App Store or Google Play link. Jaded copies the name, icon, description, screenshots and category.
        </p>
        <form action={importStoreListing.bind(null, id, app.id)} className="inline-form">
          <label htmlFor="listing-url" className="label">
            Listing link
          </label>
          <input
            id="listing-url"
            name="url"
            type="url"
            required
            maxLength={2000}
            placeholder="https://apps.apple.com/… or https://play.google.com/store/apps/details?id=…"
            className="input"
          />
          <button className="button" type="submit">
            Import
          </button>
        </form>
        {app.listings.length > 0 && (
          <ul className="rows">
            {app.listings.map((l) => (
              <li key={l.id}>
                <span>{l.store === "APP_STORE" ? "App Store" : "Google Play"}</span>
                <span className="muted">
                  imported {l.importedAt.toUTCString()} from{" "}
                  <a href={l.sourceUrl} rel="noreferrer noopener" target="_blank">
                    the listing
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sheet">
        <h2>Brand profile</h2>
        {profile?.origin === "EXTERNAL_UNTRUSTED" && (
          <p className="notice">This text was copied from the store listing. Review it and save to make it your own.</p>
        )}
        {profile?.iconUrl && (
          <img src={profile.iconUrl} alt={`${profile.name} icon`} width={64} height={64} className="app-icon" />
        )}
        <form action={saveBrandProfile.bind(null, id, app.id)} className="form">
          <label className="label" htmlFor="p-name">
            Name
          </label>
          <input
            id="p-name"
            name="name"
            required
            maxLength={200}
            defaultValue={profile?.name ?? app.name}
            className="input"
          />
          <label className="label" htmlFor="p-category">
            Category
          </label>
          <input
            id="p-category"
            name="category"
            maxLength={100}
            defaultValue={profile?.category ?? ""}
            className="input"
          />
          <label className="label" htmlFor="p-color">
            Brand colour (leave empty to use your icon&rsquo;s colour)
          </label>
          <input
            id="p-color"
            name="brandColor"
            maxLength={7}
            pattern="#[0-9a-fA-F]{6}"
            placeholder="#c94f39"
            defaultValue={profile?.brandColor ?? ""}
            className="input"
          />
          <label className="label" htmlFor="p-description">
            Description
          </label>
          <textarea
            id="p-description"
            name="description"
            rows={8}
            maxLength={5000}
            defaultValue={profile?.description ?? ""}
            className="input"
          />
          <button className="button" type="submit">
            Save profile
          </button>
        </form>
        {profile && profile.screenshots.length > 0 && (
          <div className="shots">
            {profile.screenshots.map((src) => (
              <img key={src} src={src} alt="App screenshot" loading="lazy" />
            ))}
          </div>
        )}
      </section>

      <section className="sheet">
        <h2>Brand voice</h2>
        <form action={saveBrandVoice.bind(null, id, app.id)} className="form">
          <label className="label" htmlFor="v-tone">
            Tone
          </label>
          <input
            id="v-tone"
            name="tone"
            maxLength={200}
            placeholder="e.g. friendly and plain-spoken, a little playful"
            defaultValue={profile?.tone ?? ""}
            className="input"
          />
          <label className="label" htmlFor="v-audience">
            Audience
          </label>
          <input
            id="v-audience"
            name="audience"
            maxLength={500}
            placeholder="e.g. indie iOS developers who ship weekly"
            defaultValue={profile?.audience ?? ""}
            className="input"
          />
          <label className="label" htmlFor="v-avoid">
            Words to avoid (comma or one per line)
          </label>
          <textarea
            id="v-avoid"
            name="wordsToAvoid"
            rows={3}
            maxLength={2000}
            defaultValue={profile?.wordsToAvoid.join(", ") ?? ""}
            className="input"
          />
          <button className="button" type="submit">
            Save brand voice
          </button>
        </form>
      </section>
    </div>
  );
}
