import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ServerStore } from "./types.js";

const STORE_PATH = resolve(process.cwd(), "data", "server-state.json");

export async function loadStore(): Promise<ServerStore> {
  try {
    const rawStore = await readFile(STORE_PATH, "utf8");
    return JSON.parse(rawStore) as ServerStore;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return createEmptyStore();
    }

    throw error;
  }
}

export async function saveStore(store: ServerStore): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function resetStore(): Promise<ServerStore> {
  const store = createEmptyStore();
  await saveStore(store);
  return store;
}

export function createEmptyStore(): ServerStore {
  return {
    serverVersion: 0,
    processedOperationIds: {},
    acceptedOperations: [],
    notificationEventsById: {},
    mockNotifications: []
  };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
