import type { ClientOperation, DeviceId, ServerStateResponse, SyncResult } from "./types";

const API_BASE_URL = "http://localhost:4000";
const STUDENT_ID = "student-001";

export async function fetchHealth(): Promise<{ ok: boolean; service: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return readJsonResponse(response);
}

export async function fetchServerState(): Promise<ServerStateResponse> {
  const response = await fetch(`${API_BASE_URL}/state/${STUDENT_ID}`);
  return readJsonResponse(response);
}

export async function syncDevice(deviceId: DeviceId, operations: ClientOperation[]): Promise<SyncResult> {
  const response = await fetch(`${API_BASE_URL}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      studentId: STUDENT_ID,
      deviceId,
      operations
    })
  });

  return readJsonResponse(response);
}

export async function resetServerState(): Promise<ServerStateResponse> {
  await fetch(`${API_BASE_URL}/reset-dev`, {
    method: "POST"
  });

  return fetchServerState();
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  const parsedBody = body.length > 0 ? JSON.parse(body) : {};

  if (!response.ok) {
    const message = typeof parsedBody.error === "string" ? parsedBody.error : "Request failed.";
    throw new Error(message);
  }

  return parsedBody as T;
}
