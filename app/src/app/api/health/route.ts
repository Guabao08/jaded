// Liveness check for the host. Reports nothing about configuration or data.
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
