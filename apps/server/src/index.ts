import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { loadStore, resetStore, saveStore } from "./store.js";
import { applySyncEnvelope, deriveStudentState, registerMockNotification } from "./sync.js";
import { STUDENT_ID } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? "4000");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request: Request, response: Response) => {
  response.json({
    ok: true,
    service: "alcovia-server"
  });
});

app.get("/state/:studentId", async (request: Request, response: Response, next: NextFunction) => {
  try {
    if (request.params.studentId !== STUDENT_ID) {
      response.status(404).json({
        error: "Unknown studentId."
      });
      return;
    }

    const store = await loadStore();
    const state = deriveStudentState(store);

    response.json({
      state,
      diagnostics: {
        serverVersion: store.serverVersion,
        acceptedOperations: store.acceptedOperations.length,
        processedOperations: Object.keys(store.processedOperationIds).length,
        notifications: Object.keys(store.notificationEventsById).length,
        mockNotifications: store.mockNotifications.length
      }
    });
  } catch (error: unknown) {
    next(error);
  }
});

app.post("/sync", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const store = await loadStore();
    const syncResult = applySyncEnvelope(store, request.body);

    await saveStore(store);
    response.json(syncResult);
  } catch (error: unknown) {
    next(error);
  }
});

app.post("/mock-notifications", async (request: Request, response: Response, next: NextFunction) => {
  try {
    const store = await loadStore();
    const result = registerMockNotification(store, request.body);

    await saveStore(store);
    response.json(result);
  } catch (error: unknown) {
    next(error);
  }
});

app.post("/reset-dev", async (_request: Request, response: Response, next: NextFunction) => {
  try {
    const store = await resetStore();
    const state = deriveStudentState(store);

    response.json({
      ok: true,
      state
    });
  } catch (error: unknown) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error.";

  response.status(500).json({
    error: message
  });
});

app.listen(port, () => {
  console.log(`Alcovia server listening on http://localhost:${port}`);
});
