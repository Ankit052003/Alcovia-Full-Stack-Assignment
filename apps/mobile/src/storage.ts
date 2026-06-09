import { createDefaultStudentState } from "./seed";
import type { DeviceId, DeviceState } from "./types";

const STUDENT_ID = "student-001";

export function createDeviceState(deviceId: DeviceId): DeviceState {
  return {
    studentId: STUDENT_ID,
    deviceId,
    storageKey: createStorageKey(deviceId),
    deviceSeq: 0,
    isOnline: true,
    activeFocusSession: null,
    localState: createDefaultStudentState(),
    pendingOperations: [],
    lastSyncMessage: "Not synced yet"
  };
}

export function loadDeviceState(deviceId: DeviceId): DeviceState {
  const fallbackState = createDeviceState(deviceId);

  if (!canUseLocalStorage()) {
    return fallbackState;
  }

  const rawState = window.localStorage.getItem(fallbackState.storageKey);

  if (rawState === null) {
    saveDeviceState(fallbackState);
    return fallbackState;
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<DeviceState>;

    return {
      ...fallbackState,
      ...parsedState,
      activeFocusSession: parsedState.activeFocusSession ?? null,
      localState: parsedState.localState ?? fallbackState.localState,
      pendingOperations: parsedState.pendingOperations ?? []
    };
  } catch {
    saveDeviceState(fallbackState);
    return fallbackState;
  }
}

export function saveDeviceState(deviceState: DeviceState): void {
  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(deviceState.storageKey, JSON.stringify(deviceState));
}

export function resetDeviceState(deviceId: DeviceId): DeviceState {
  const nextState = createDeviceState(deviceId);
  saveDeviceState(nextState);
  return nextState;
}

function createStorageKey(deviceId: DeviceId): string {
  return `alcovia:${deviceId}`;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && window.localStorage !== undefined;
}
