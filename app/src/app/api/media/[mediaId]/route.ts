import { db } from "@/lib/db";
import { mediaStorage } from "@/lib/media/storage";
import { verifyMediaSignature } from "@/lib/media/signed-url";

// Serves a private image only with a valid, unexpired signed link.
export async function GET(request: Request, { params }: RouteContext<"/api/media/[mediaId]">) {
  const { mediaId } = await params;
  const url = new URL(request.url);
  const check = /^[a-z0-9]{10,40}$/.test(mediaId)
    ? verifyMediaSignature(mediaId, url.searchParams.get("exp"), url.searchParams.get("sig"))
    : ({ ok: false, reason: "bad" } as const);
  if (!check.ok) {
    return new Response(check.reason === "expired" ? "Link expired" : "Forbidden", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  const media = await db().media.findUnique({
    where: { id: mediaId },
    select: { storageKey: true, contentType: true },
  });
  const bytes = media ? await mediaStorage().get(media.storageKey) : null;
  if (!media || !bytes) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": media.contentType === "image/png" ? "image/png" : "application/octet-stream",
      "content-disposition": "inline",
      "cache-control": `private, max-age=${Math.max(0, check.secondsLeft - 30)}`,
      "x-content-type-options": "nosniff",
    },
  });
}
