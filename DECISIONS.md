# Decisions

This file records the technical decisions for the Alcovia offline-first assignment. It will be expanded as the sync model, backend, frontend, and n8n workflow are implemented.

## Phase 1 Decisions

### Stack

The project will use the stack required by the assignment:

- TypeScript.
- React Native with Expo for the app.
- Express for the backend.
- n8n for the automation workflow.

The Expo app will target web first. This keeps the demo simple and still satisfies the PDF requirement that Expo running on web is acceptable.

### Account Model

There will be no login.

The app will use one hardcoded student:

```text
student-001
```

The demo will simulate two devices for this same student:

```text
device-a
device-b
```

### Frontend Storage

The frontend will use separate browser storage namespaces for the two simulated devices:

```text
alcovia:device-a
alcovia:device-b
```

This is necessary because two browser tabs on the same site can share storage. The assignment requires each client to behave like a separate device, so each simulated device must have isolated local state and isolated pending operations.

### Backend Storage

The backend will use JSON file storage for the initial implementation.

Reason:

- It is easy to inspect during the demo.
- It keeps the assignment focused on sync, merge rules, idempotency, and n8n integration.
- It avoids spending time on database setup that is not central to the assignment.

If this were production, SQLite or Postgres would be the next step.

### Notification Delivery

The n8n workflow will send notifications to a mock notification sink instead of a real WhatsApp sandbox.

Reason:

- The assignment explicitly allows a mock notification sink.
- It keeps the demo reproducible without external WhatsApp credentials.
- It makes exactly-once notification behavior easy to verify in backend logs and UI state.

### UI Direction

The UI will be simple and functional.

The main screen should show:

- Device A state.
- Device B state.
- Online/offline controls.
- Focus session controls.
- Syllabus task controls.
- Pending operation counts.
- Server state and notification logs for demo visibility.

### Initial Sync Direction

The sync model will be operation-based:

- Devices create durable local operations while offline.
- Each operation has a stable ID.
- The server deduplicates operations by stable ID.
- The server applies operations using deterministic merge rules.
- Clients pull canonical server state after sync.

The detailed data model and conflict-resolution rules were finalized in Phase 2.

## Phase 2 Data And Sync Model

### Design Goal

The app must keep working while offline and must converge after two devices reconnect. The safest simple model for this assignment is an operation log:

- Every user action becomes an immutable operation.
- Operations are saved locally before the UI updates.
- Sync sends pending operations to the server.
- The server stores accepted operations as a set keyed by `operationId`.
- Canonical state is derived from the accepted operation set.

This avoids depending on arrival order. If the same operation arrives twice, the server already has the ID. If operations arrive out of order, the final accepted set is the same, and the derived canonical state is the same.

### Stable IDs

The implementation will use stable IDs everywhere:

```text
studentId: student-001
deviceId: device-a | device-b
operationId: <deviceId>:<deviceSeq>
sessionId: focus:<deviceId>:<deviceSeq>
rewardEventId: reward:<sessionId>
notificationEventId: notification:<rewardEventId>
```

`deviceSeq` is a monotonic integer stored durably in each device namespace. A device increments it before creating a new operation. The counter is local to the device, so it does not require network access.

Seeded syllabus data uses stable hardcoded IDs:

```text
subject-math
chapter-linear-equations
task-linear-equations-1
```

Seed versions use a special actor:

```text
seed:0
```

### Core Types

The TypeScript implementation should model these entities.

```ts
type StudentId = "student-001";
type DeviceId = "device-a" | "device-b";
type OperationId = string;
type SessionId = string;
type RewardEventId = string;
type NotificationEventId = string;

type TaskStatus = "not_started" | "in_progress" | "done";
type FocusFailureReason = "give_up" | "app_switch";
```

### StudentState

`StudentState` is the canonical state returned by the server and stored locally by each client after sync.

```ts
type StudentState = {
  studentId: StudentId;
  focus: FocusState;
  syllabus: SyllabusState;
  sync: SyncState;
  notifications: NotificationState;
};
```

### DeviceState

Each simulated device keeps its own durable local state.

```ts
type DeviceState = {
  studentId: StudentId;
  deviceId: DeviceId;
  deviceSeq: number;
  isOnline: boolean;
  localState: StudentState;
  pendingOperations: ClientOperation[];
  lastSyncResult: SyncResult | null;
};
```

`device-a` and `device-b` must be stored under different browser storage keys so they behave like two real devices.

### FocusState

Focus rewards are derived from unique successful sessions, not blindly incremented from sync messages.

```ts
type FocusState = {
  sessionsById: Record<SessionId, FocusSession>;
  rewardEventsById: Record<RewardEventId, FocusRewardEvent>;
  coins: number;
  streakDays: number;
  focusMinutesByDay: Record<string, number>;
};
```

`coins`, `streakDays`, and `focusMinutesByDay` are derived values:

- `coins = sum(coinsAwarded)` over unique reward events.
- `focusMinutesByDay[studyDay] = sum(completedMinutes)` over unique successful sessions for that day.
- `streakDays = consecutive days with at least one successful session, ending at the latest successful study day in the demo state.

This means replaying a completed session cannot increase rewards twice.

### FocusSession

```ts
type FocusSession = {
  sessionId: SessionId;
  studentId: StudentId;
  deviceId: DeviceId;
  targetMinutes: number;
  completedMinutes: number;
  studyDay: string;
  outcome: "success" | "failed";
  failureReason: FocusFailureReason | null;
  operationId: OperationId;
};
```

`studyDay` is a client-provided local date string such as `2026-06-09`. This is acceptable for the demo, but it is a known production tradeoff because device clocks can be wrong. The merge rules do not use wall-clock timestamps to resolve conflicts.

### FocusRewardEvent

```ts
type FocusRewardEvent = {
  eventId: RewardEventId;
  sessionId: SessionId;
  studentId: StudentId;
  coinsAwarded: number;
  streakDaysAfter: number;
  focusMinutesTodayAfter: number;
};
```

The reward event ID is derived from the session ID:

```text
reward:<sessionId>
```

The server creates this event only once for a successful session.

### SyllabusState

```ts
type SyllabusState = {
  subjectsById: Record<string, Subject>;
  chaptersById: Record<string, Chapter>;
  tasksById: Record<string, StudyTask>;
  taskTombstonesById: Record<string, TaskTombstone>;
};
```

Progress is derived rather than stored as source-of-truth:

- Chapter progress = done non-deleted tasks / total non-deleted tasks.
- Subject progress = done non-deleted tasks across all chapters / total non-deleted tasks across all chapters.

### Subject

```ts
type Subject = {
  subjectId: string;
  title: string;
  chapterIds: string[];
};
```

### Chapter

```ts
type Chapter = {
  chapterId: string;
  subjectId: string;
  title: string;
  taskIds: string[];
};
```

### StudyTask

```ts
type StudyTask = {
  taskId: string;
  chapterId: string;
  title: string;
  status: TaskStatus;
  statusVersion: OperationId;
  statusBaseVersion: OperationId;
  isDeleted: false;
};
```

### TaskTombstone

```ts
type TaskTombstone = {
  taskId: string;
  deletedByOperationId: OperationId;
};
```

Tombstones are kept so old sync messages cannot recreate deleted tasks.

### Client Operations

All client mutations use the same base operation fields.

```ts
type OperationBase = {
  operationId: OperationId;
  studentId: StudentId;
  deviceId: DeviceId;
  deviceSeq: number;
};
```

Supported operations:

```ts
type ClientOperation =
  | FocusSessionSucceededOperation
  | FocusSessionFailedOperation
  | TaskStatusChangedOperation
  | TaskDeletedOperation;
```

### Focus Session Succeeded Operation

```ts
type FocusSessionSucceededOperation = OperationBase & {
  type: "focus_session_succeeded";
  sessionId: SessionId;
  targetMinutes: number;
  completedMinutes: number;
  studyDay: string;
};
```

### Focus Session Failed Operation

```ts
type FocusSessionFailedOperation = OperationBase & {
  type: "focus_session_failed";
  sessionId: SessionId;
  targetMinutes: number;
  completedMinutes: number;
  studyDay: string;
  failureReason: FocusFailureReason;
};
```

If the same `sessionId` somehow receives both success and failure, failure wins. That is conservative: an abandoned signal should not create a reward. In normal app flow, one focus attempt creates exactly one terminal operation.

### Task Status Changed Operation

```ts
type TaskStatusChangedOperation = OperationBase & {
  type: "task_status_changed";
  taskId: string;
  status: TaskStatus;
  baseStatusVersion: OperationId;
};
```

`baseStatusVersion` is the task status version the device saw when the edit was made. It lets the server distinguish sequential edits from concurrent edits without using wall-clock time.

### Task Deleted Operation

```ts
type TaskDeletedOperation = OperationBase & {
  type: "task_deleted";
  taskId: string;
  baseStatusVersion: OperationId;
};
```

Deletes create tombstones. A tombstone prevents stale status-change operations from resurrecting the task.

### SyncEnvelope

Clients send pending operations in a sync envelope.

```ts
type SyncEnvelope = {
  studentId: StudentId;
  deviceId: DeviceId;
  operations: ClientOperation[];
};
```

The server response returns canonical state and operation statuses.

```ts
type SyncResult = {
  serverVersion: number;
  acceptedOperationIds: OperationId[];
  duplicateOperationIds: OperationId[];
  rejectedOperations: RejectedOperation[];
  state: StudentState;
};
```

### SyncState

```ts
type SyncState = {
  serverVersion: number;
  processedOperationIds: Record<OperationId, true>;
  acceptedOperations: ClientOperation[];
};
```

For this assignment, storing the accepted operation log in JSON is acceptable. The server can recompute canonical state from the seed data plus the accepted operation log after every sync.

### NotificationState

```ts
type NotificationState = {
  notificationEventsById: Record<NotificationEventId, NotificationEvent>;
};
```

```ts
type NotificationEvent = {
  eventId: NotificationEventId;
  rewardEventId: RewardEventId;
  sessionId: SessionId;
  studentId: StudentId;
  status: "pending" | "sent" | "failed";
  payload: {
    message: string;
    streakDays: number;
    coinsAwarded: number;
    totalCoins: number;
    focusMinutesToday: number;
  };
};
```

The notification event ID is derived from the reward event ID:

```text
notification:<rewardEventId>
```

This gives the backend and n8n the same stable dedupe key.

## Phase 2 Merge Rules

### Operation Validation

The server accepts an operation only when:

- `studentId` is `student-001`.
- `deviceId` is a known device.
- `operationId` matches the operation's `deviceId` and `deviceSeq`.
- Required entity IDs exist in the seed data or canonical state.
- Numeric values are valid, for example focus minutes are positive.

Invalid operations are rejected and returned in `rejectedOperations`.

### Duplicate Sync Messages

Duplicate sync messages are handled by `operationId`.

If the server has already processed `device-a:7`, receiving `device-a:7` again adds nothing and returns it as duplicate.

### Out-Of-Order Sync Messages

The server stores operations as a set and derives state from the full accepted set. Arrival order is not used as a source of truth.

When a deterministic order is needed for recomputation, operations are applied in dependency-aware order:

1. If an accepted task operation references another accepted task operation in `baseStatusVersion`, the base operation is applied first.
2. Independent operations are sorted by:
   - `deviceSeq`.
   - `deviceId`.
   - `operationId`.

This preserves causal edits that cross devices. For example, if Device B edits a task after seeing Device A's version, Device A's base operation is applied first even if Device B's operation arrived at the server earlier.

If `baseStatusVersion` references an operation that has not synced yet, the operation can still be accepted into the log. The final state will be recomputed when the missing base operation arrives.

The task merge rules below are still written so concurrent edits produce the same result regardless of arrival order.

### Task Status Conflict

Task status has this rank:

```text
not_started = 0
in_progress = 1
done = 2
```

When a task status operation arrives:

- If the task has a tombstone, ignore the status operation.
- If `baseStatusVersion` equals the current task `statusVersion`, the operation is a direct successor and is applied.
- If the current `statusVersion` and incoming operation are from the same device, the higher `deviceSeq` wins.
- Otherwise, the edits are concurrent:
  - Higher status rank wins.
  - If status rank is equal, lexicographically higher `operationId` wins as a stable tie-breaker.

Example:

- Device A sees `seed:0` and changes task to `done`.
- Device B sees `seed:0` and changes the same task to `in_progress`.
- These are concurrent.
- `done` wins because it has higher progress rank.
- Both devices converge to `done` after sync.

This is deliberate, deterministic, and does not use wall-clock time.

### Task Edit vs Delete

Delete wins over status edits.

Rules:

- A delete operation creates a tombstone.
- Once a tombstone exists, status operations for that task are ignored.
- If status arrives first and delete arrives later, the final state is deleted.
- If delete arrives first and status arrives later, the final state is deleted.

This means edit-vs-delete converges regardless of sync order. It is conservative because it avoids resurrecting a task that one device explicitly deleted.

### Focus Session Merge

Focus sessions are keyed by `sessionId`.

Rules:

- A session can be recorded once.
- Replays with the same `sessionId` do not create another session.
- A successful session creates one reward event with ID `reward:<sessionId>`.
- A failed session creates no reward event.
- If conflicting terminal outcomes appear for the same `sessionId`, failure wins.

The reward counters are derived from `rewardEventsById`, not incremented from raw sync attempts. This enforces exactly-once rewards.

### Streak And Today Total

The server derives focus totals from unique successful sessions:

- Today's total is the sum of successful completed minutes for the selected `studyDay`.
- Streak is calculated from the set of days that have at least one successful session.

If both devices complete successful sessions offline on the same day:

- Both sessions count toward today's focus minutes.
- Both sessions award coins once.
- The streak day itself is counted once because both sessions belong to the same day.

## Why Devices Converge

Two devices converge because the canonical state is a pure function of:

1. Seed syllabus data.
2. The set of accepted operation IDs.
3. Deterministic merge rules.

The final state does not depend on:

- Which device reconnects first.
- Whether a sync request is retried.
- Whether operations arrive in the same order they were created.
- Local device wall-clock timestamps.

After sync, each device replaces its local canonical state with the server's canonical state and removes accepted or duplicate operations from its pending queue. When both devices have synced, both hold the same server-derived state.

## Phase 2 Completion Checklist

- Core entities are defined.
- Stable IDs are defined.
- Per-device sequence IDs are defined.
- Sync envelope is defined.
- Backend operation dedupe is defined.
- Focus reward idempotency is defined.
- n8n notification idempotency key is defined.
- Task status conflict handling is defined.
- Task edit-vs-delete handling is defined.
- Duplicate sync handling is defined.
- Out-of-order sync handling is defined.
- Convergence reasoning is documented.

## Phase 3 Backend Implementation

The backend is implemented in `apps/server`.

Endpoints:

- `GET /health`
- `GET /state/:studentId`
- `POST /sync`
- `POST /mock-notifications`
- `POST /reset-dev`

The server uses JSON file storage at `apps/server/data/server-state.json`. The file is ignored by git because it is runtime demo data.

The sync endpoint accepts a `SyncEnvelope`, validates operations, deduplicates by `operationId`, stores accepted operations, recomputes canonical state, and returns a `SyncResult`.

Phase 3 intentionally stops before calling n8n. Notification events are created as canonical pending events, and the real webhook call is reserved for Phase 8.

## Phase 4 Frontend Shell

The frontend is implemented in `apps/mobile`.

The Expo app runs on web and shows:

- Device A.
- Device B.
- Separate storage namespaces.
- Online/offline toggles.
- Sync and pull controls.
- Focus control shell.
- Syllabus state preview.
- Local device metrics.
- Backend diagnostics.

The two simulated devices are stored separately:

```text
alcovia:device-a
alcovia:device-b
```

Phase 4 intentionally did not implement focus session mutation or task mutation. Those were added in Phases 5 and 6.

## Phase 5 Offline-First Focus Sessions

Focus sessions now create local durable operations before any network call:

- `focus_session_started`
- `focus_session_succeeded`
- `focus_session_failed`

The start operation was added because the assignment explicitly lists start as an offline action. A started session has outcome `running`; a terminal success or failure later resolves it.

The frontend stores the active timer in the device namespace:

```text
alcovia:device-a
alcovia:device-b
```

For demo speed, the UI accepts focus duration in seconds. The synced server model still stores `targetMinutes` and `completedMinutes`, using seconds converted to minutes. This is a deliberate demo tradeoff so reviewers do not need to wait 25 minutes.

Failure reasons are:

- `give_up`
- `app_switch`

On local success, the device immediately shows the optimistic reward effect. The server remains the authority after sync and recomputes coins, streak, and focus totals from unique accepted successful sessions.

## Phase 6 Offline-First Syllabus Progress

Task status changes and task deletes now create local durable operations:

- `task_status_changed`
- `task_deleted`

Task status buttons update local state immediately, so chapter and subject progress update while offline.

Task deletes create tombstones. A deleted task is removed from local progress calculations and cannot be recreated by stale status operations after sync.

## Phase 7 Two-Device Sync And Convergence

The frontend now has two simulated devices with isolated storage and pending operation queues.

Sync behavior:

- Offline devices queue operations locally.
- Online devices automatically sync pending operations.
- Manual `Sync` is available for explicit demos.
- Manual `Pull` refreshes a device from the server when it has no pending operations.
- The server returns canonical state after each sync.
- Devices replace their local canonical state with the server state after sync.

Convergence scenarios verified:

- A successful focus session is counted exactly once when replayed.
- Device A marking a task `done` and Device B marking it `in_progress` converges to `done`.
- Editing a task on one device and deleting it on another converges to deleted with a tombstone.

The sync system still stops before n8n delivery. Notification events are created as pending canonical events; Phase 8 will send them through the real exported n8n workflow.

## Assignment Requirements To Preserve

The final implementation must prove:

- Offline actions work instantly.
- Two devices can diverge offline and converge after reconnect.
- Focus rewards are idempotent.
- n8n notifications are idempotent.
- Task conflicts are handled deliberately.
- Duplicate and out-of-order sync messages do not break convergence.

## Known Tradeoff

Using JSON file storage is not suitable for concurrent production traffic, but it is acceptable for this take-home because the assignment is about offline-first reasoning and deterministic reconciliation. The tradeoff keeps the project smaller and easier to review.
