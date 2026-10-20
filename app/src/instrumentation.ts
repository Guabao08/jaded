// Runs once when the server starts. Starts the background worker in the same
// process (fine for a single instance; split it out before scaling).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.JOBS_WORKER === "off") return;
  const { startWorkers } = await import("./lib/worker");
  await startWorkers();
}
