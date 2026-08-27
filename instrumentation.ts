export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureRunWorker } = await import("@/lib/run-worker");
    await ensureRunWorker();
  }
}
