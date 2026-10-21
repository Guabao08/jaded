import { monthlyCapMicro } from "@/lib/ai";
import { formatUsd, usageMonth } from "@/lib/ai/cost";
import { requireUser } from "@/lib/auth/session";
import { signMediaPath } from "@/lib/media/signed-url";
import { requireWorkspace } from "@/lib/workspaces";

const PLATFORM_NAME = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook" } as const;

export default async function PostsPage({ params }: PageProps<"/w/[workspaceId]/posts">) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ws = await requireWorkspace(user.id, workspaceId);
  const [posts, spend] = await Promise.all([ws.listPosts(), ws.aiSpendThisMonth(usageMonth())]);
  const spent = spend._sum.estimatedCostMicro ?? 0;

  return (
    <div className="stack">
      <section className="sheet">
        <p className="label">Posts</p>
        <h1>Draft posts</h1>
        <p>
          Drafts written from your updates. Nothing is published: reviewing and publishing come in a later step. Every
          draft is marked as AI-generated so the label can be applied when it&rsquo;s posted.
        </p>
        <p className="muted">
          AI use this month (estimated at list prices): {formatUsd(spent)} of {formatUsd(monthlyCapMicro())} ·{" "}
          {spend._count} {spend._count === 1 ? "request" : "requests"}
        </p>
      </section>

      {posts.length === 0 ? (
        <section className="sheet">
          <p>No drafts yet. They appear here after a push that&rsquo;s worth a post.</p>
        </section>
      ) : (
        posts.map((post) => (
          <section key={post.id} className="sheet post" id={`update-${post.update.id}`}>
            <p className="label">
              {PLATFORM_NAME[post.platform]} · {post.app.name} · {post.update.repository.fullName}{" "}
              <span className="mono">{post.update.afterSha.slice(0, 7)}</span> ·{" "}
              <span className="badge" title={`Written by ${post.aiProvider} (${post.aiModel})`}>
                AI-generated
              </span>{" "}
              · {post.status.toLowerCase()}
            </p>
            {/* Signed image links expire after 10 minutes; reloading the page makes fresh ones. */}
            <div className="post-media">
              {post.media.map((m) => (
                <img
                  key={m.id}
                  src={signMediaPath(m.id)}
                  alt={post.altText}
                  width={m.width}
                  height={m.height}
                  loading="lazy"
                />
              ))}
            </div>
            <h2>{post.headline}</h2>
            <p className="caption">{post.caption}</p>
            {post.hashtags.length > 0 && <p className="muted">{post.hashtags.map((h) => `#${h}`).join(" ")}</p>}
            <p className="muted">Alt text: {post.altText}</p>
          </section>
        ))
      )}
    </div>
  );
}
