export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { startWorker } = await import("./lib/worker");
  startWorker();
}
