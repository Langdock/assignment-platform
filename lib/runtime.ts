import path from "node:path";

export function getRuntimeDirectory(): string {
  return process.env.RUNTIME_DIR ?? path.join(process.cwd(), ".runtime");
}
