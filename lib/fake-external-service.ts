import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRuntimeDirectory } from "@/lib/runtime";
import type { ExternalAction } from "@/lib/types";

function actionsFile(): string {
  return path.join(getRuntimeDirectory(), "fake-external-actions.json");
}

async function readActions(): Promise<ExternalAction[]> {
  try {
    return JSON.parse(await readFile(actionsFile(), "utf8")) as ExternalAction[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeActions(actions: ExternalAction[]): Promise<void> {
  await mkdir(getRuntimeDirectory(), { recursive: true });
  const temporaryFile = `${actionsFile()}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(actions, null, 2), "utf8");
  await rename(temporaryFile, actionsFile());
}

export async function createDocument(input: {
  runId: string;
  title: string;
  content: string;
  idempotencyKey: string;
}): Promise<ExternalAction> {
  const actions = await readActions();
  const existing = actions.find((action) => action.idempotencyKey === input.idempotencyKey);
  if (existing) {
    return existing;
  }

  const action: ExternalAction = {
    id: crypto.randomUUID(),
    runId: input.runId,
    title: input.title,
    content: input.content,
    createdAt: new Date().toISOString(),
    idempotencyKey: input.idempotencyKey,
  };

  await writeActions([...actions, action]);
  return action;
}

export async function listDocuments(): Promise<ExternalAction[]> {
  return readActions();
}

export async function resetDocuments(): Promise<void> {
  await writeActions([]);
}
