import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExternalAction } from "@/lib/types";

const runtimeDirectory = path.join(process.cwd(), ".runtime");

type ExternalServiceGlobals = typeof globalThis & {
  __fakeExternalServiceLock?: Promise<void>;
};

const serviceGlobals = globalThis as ExternalServiceGlobals;
serviceGlobals.__fakeExternalServiceLock ??= Promise.resolve();

function actionsFile(): string {
  return process.env.FAKE_EXTERNAL_ACTIONS_FILE ??
    path.join(runtimeDirectory, "fake-external-actions.json");
}

async function withServiceLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = serviceGlobals.__fakeExternalServiceLock!;
  let release!: () => void;
  serviceGlobals.__fakeExternalServiceLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
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
  const file = actionsFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(actions, null, 2), "utf8");
  await rename(temporaryFile, file);
}

export async function createDocument(input: {
  idempotencyKey: string;
  runId: string;
  title: string;
  content: string;
}): Promise<ExternalAction> {
  return withServiceLock(async () => {
    const actions = await readActions();
    const existing = actions.find((action) => action.idempotencyKey === input.idempotencyKey);
    if (existing) return structuredClone(existing);

    const action: ExternalAction = {
      id: crypto.randomUUID(),
      idempotencyKey: input.idempotencyKey,
      runId: input.runId,
      title: input.title,
      content: input.content,
      createdAt: new Date().toISOString(),
    };

    await writeActions([...actions, action]);
    return structuredClone(action);
  });
}

export async function listDocuments(): Promise<ExternalAction[]> {
  return withServiceLock(async () => structuredClone(await readActions()));
}

export async function resetDocuments(): Promise<void> {
  await withServiceLock(() => writeActions([]));
}
