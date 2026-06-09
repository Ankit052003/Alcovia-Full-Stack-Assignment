# Alcovia Full Stack Engineering Intern Assignment Plan

This plan divides the assignment into 10 implementation phases. It follows the PDF requirements step by step: offline-first focus sessions, syllabus progress, two-device sync, conflict handling, idempotent rewards, idempotent n8n automation, documentation, and demo video.

## Progress

- Phase 1: Complete.
- Phase 2: Complete.
- Phase 3: Complete.
- Phase 4: Complete.
- Phase 5: Complete.
- Phase 6: Complete.
- Phase 7: Complete.
- Phase 8: Next.

## Phase 1: Understand Scope And Set Up The Repo

Goal: Prepare a clean project structure and confirm exactly what must be delivered.

Tasks:

- Re-read the assignment PDF and keep the core requirements visible while building.
- Create the repository structure:

```text
alcovia-assignment/
  apps/
    mobile/
    server/
  n8n/
    n8n-workflow.json
  README.md
  DECISIONS.md
  plan.md
```

- Use TypeScript across frontend and backend.
- Decide the simplest acceptable storage:
  - Frontend web: localStorage or IndexedDB with separate namespaces for `deviceA` and `deviceB`.
  - Backend: JSON file or SQLite.
- Use one hardcoded `studentId`.
- Do not add login.
- Keep UI functional rather than polished.

PDF reference:

- Stack: TypeScript, React Native Expo, Express, n8n.
- No login; hardcode a single student account.
- UI should be simple and functional.

Deliverable after this phase:

- Project skeleton exists.
- README and DECISIONS files are created as placeholders.

## Phase 2: Define Data Model And Sync Model

Goal: Design the state model before coding the UI.

Core entities:

- `StudentState`
- `DeviceState`
- `FocusSession`
- `FocusRewardEvent`
- `Subject`
- `Chapter`
- `Task`
- `TaskOperation`
- `SyncEnvelope`
- `NotificationEvent`

Important fields:

- Stable IDs for all entities.
- `studentId`
- `deviceId`
- Monotonic per-device sequence number, for example `deviceSeq`.
- Operation IDs, for example `${deviceId}:${deviceSeq}`.
- Session IDs that are stable across retries.
- Event IDs for reward and notification idempotency.

Recommended sync approach:

- Store user actions as durable operations on each device.
- Sync operations to the server.
- Server dedupes operations by `operationId`.
- Server applies operations deterministically.
- Client pulls canonical server state after sync.

Conflict-resolution approach to implement:

- Do not use wall-clock last-write-wins.
- For task status conflicts, use deterministic ordering based on a logical version:
  - Prefer higher progress status if concurrent, for example `Done > In progress > Not started`.
  - If two operations are otherwise tied, use stable operation ID ordering as a deterministic tie-breaker.
- For edit vs delete:
  - Use tombstones.
  - Delete wins over status edits when delete and edit are concurrent.
  - Keep the tombstone so deleted tasks do not reappear from old sync messages.
- For duplicate or out-of-order messages:
  - Deduplicate by operation ID.
  - Apply operations with deterministic merge rules so order does not change final state.

PDF reference:

- Two devices must converge.
- Same task status changed on both devices must be handled.
- Task edited on one device and deleted on another must be handled.
- Same sync message arriving twice or out of order must be handled.
- Wall-clock last-write-wins is discouraged.

Deliverable after this phase:

- `DECISIONS.md` has the initial data/sync model and conflict rules.

## Phase 3: Build The Express Backend

Goal: Implement the server that stores canonical state, receives sync messages, and exposes state to clients.

Backend endpoints:

- `GET /health`
- `GET /state/:studentId`
- `POST /sync`
- `POST /mock-notifications`
- Optional: `POST /reset-dev`

Backend responsibilities:

- Store canonical student state.
- Receive pending operations from clients.
- Deduplicate by `operationId`.
- Apply focus session operations.
- Apply task status and delete operations.
- Return canonical state and list of accepted/rejected/duplicate operations.
- Persist state durably enough for the demo.

Focus idempotency:

- Track processed `sessionId`s.
- Track processed reward event IDs.
- Award coins and streak only once per successful session.
- Count today's focus minutes only once per successful session.
- Failed sessions should be recorded but should not award rewards.

PDF reference:

- Offline sessions can sync later.
- Replays during sync must not award coins twice.
- Backend must keep multiple devices in sync.

Deliverable after this phase:

- Express server runs locally.
- Sync endpoint can accept operations and return canonical state.

## Phase 4: Build The Expo React Native App Shell

Goal: Create the frontend app that can run on web and simulate two devices.

UI structure:

- Main screen with two side-by-side device panels:
  - Device A
  - Device B
- Each device panel shows:
  - Online/offline toggle.
  - Focus session controls.
  - Syllabus task list.
  - Local pending operation count.
  - Current local state summary.
  - Sync button or auto-sync when online.

Storage:

- Use separate storage namespaces:
  - `alcovia-device-a`
  - `alcovia-device-b`
- Each device keeps:
  - Local state.
  - Pending operations.
  - Device sequence counter.
  - Online/offline flag.

PDF reference:

- Two browser tabs share storage, so each client needs its own storage namespace.
- Dev panel must toggle each client online/offline.
- Dev panel must show each device's current state.

Deliverable after this phase:

- Expo web app runs.
- Two separate simulated clients are visible.
- Each client has independent local state.

## Phase 5: Implement Offline-First Focus Sessions

Goal: Make focus sessions work instantly offline and sync later.

Required behavior:

- Student chooses target duration.
- Student starts a timer.
- Success occurs when timer reaches the target duration.
- Failure occurs when:
  - Student taps `Give up`.
  - App/session is left for more than the grace period.
- On success locally:
  - Create a completed focus session operation.
  - Update local coins, streak, and today's focus total optimistically.
  - Add operation to pending queue.
- On failure locally:
  - Create failed focus session operation.
  - Record reason: `give_up` or `app_switch`.
  - Do not award coins.

Demo-friendly choice:

- Support short target durations in dev mode, for example 10 or 30 seconds, while documenting that production examples are 25-120 minutes.
- Use a 5-second app-switch grace period as mentioned in the PDF.

PDF reference:

- Focus session success/failure rules.
- Rewards on success.
- No rewards on failure.
- All of this must work fully offline.

Deliverable after this phase:

- Both devices can complete or fail focus sessions offline.
- Pending operations are stored durably.

## Phase 6: Implement Offline-First Syllabus Progress

Goal: Implement subjects, chapters, tasks, and progress rollups.

Required behavior:

- Seed a small syllabus:
  - A few subjects.
  - Chapters under each subject.
  - Tasks under each chapter.
- Task statuses:
  - `Not started`
  - `In progress`
  - `Done`
- Changing status:
  - Works instantly offline.
  - Creates a task status operation.
  - Updates local chapter and subject progress immediately.
- Deleting a task:
  - Creates a delete operation.
  - Uses tombstones for sync correctness.

Progress formulas:

- Chapter progress = completed tasks / total non-deleted tasks.
- Subject progress = rollup from its chapters.

PDF reference:

- Marking tasks updates chapter and subject progress.
- Editing task status must work offline and update progress instantly.

Deliverable after this phase:

- Syllabus UI works offline.
- Progress updates instantly on each simulated device.

## Phase 7: Implement Two-Device Sync And Convergence

Goal: Make both clients reconcile to one identical state after reconnect.

Sync behavior:

- If a device is offline:
  - Actions are stored locally only.
  - Pending operation queue grows.
- If a device comes online:
  - Send pending operations to `POST /sync`.
  - Server dedupes and applies operations.
  - Client receives canonical state.
  - Client clears accepted duplicate-safe pending operations.
- Both clients should pull the same canonical state after sync.

Scenarios to support:

- Device A and Device B both complete offline focus sessions.
- Device A marks a task `Done` offline.
- Device B marks the same task `In progress` offline.
- Device A edits a task while Device B deletes it.
- Same operation is sent twice.
- Operations arrive out of order.

PDF reference:

- Both devices can go offline, diverge, reconnect, and converge.
- No lost edits.
- No duplicate rewards.
- No duplicate notifications.

Deliverable after this phase:

- End-to-end two-device sync works.
- Dev panel can demonstrate convergence.

## Phase 8: Implement n8n Automation And Notification Idempotency

Goal: Trigger a real n8n workflow exactly once per successful focus session.

Architecture:

- Backend calls n8n webhook when a successful focus session is accepted for the first time.
- n8n workflow receives event payload:
  - `eventId`
  - `sessionId`
  - `studentId`
  - `streak`
  - `coinsAwarded`
  - `totalCoins`
  - `focusMinutesToday`
- n8n sends to either:
  - Real WhatsApp sandbox, or
  - Mock notification endpoint.

Recommended simplest path:

- Use mock notification sink:
  - Backend exposes `POST /mock-notifications`.
  - n8n sends an HTTP request to that endpoint.
  - Backend logs and stores received notifications.

n8n idempotency:

- Dedupe by stable `eventId` or `sessionId`.
- Do not rely on wall-clock time.
- If n8n cannot persist dedupe state easily, keep backend-side webhook idempotency too:
  - Backend should only call n8n once per accepted reward event.
  - n8n workflow should also include dedupe logic if possible.

PDF reference:

- Notification must fire exactly once per successful session.
- Same session can replay during sync or arrive from both devices.
- Dedupe on stable event/session ID, not wall-clock time.
- Workflow must be real and exported.

Deliverable after this phase:

- `n8n-workflow.json` exists and can be imported.
- Mock notification is visible in app logs or backend logs.
- Duplicate sync does not create duplicate notification.

## Phase 9: Add Dev Panel Scenarios And Validation

Goal: Make the assignment easy to demonstrate and easy for reviewers to verify.

Dev panel controls:

- Toggle Device A online/offline.
- Toggle Device B online/offline.
- Start focus session on each device.
- Complete focus session quickly in dev mode.
- Give up focus session.
- Simulate app switch failure.
- Create conflicting task status edits.
- Create edit vs delete conflict.
- Replay last sync message.
- Send operations out of order.
- Reset demo state.

Dev panel views:

- Device A local state.
- Device B local state.
- Server canonical state.
- Pending operations per device.
- Processed operation IDs count.
- Processed session IDs count.
- Reward events count.
- Notification events count.

PDF reference:

- Include a small dev panel to toggle each client online/offline.
- Trigger required scenarios.
- Show each device's current state.
- Make exactly-once n8n notification visible.

Deliverable after this phase:

- Reviewer can run the app and click through all required scenarios.
- Logs clearly prove idempotency and convergence.

## Phase 10: Documentation, Demo Video, And Final Polish

Goal: Package the project for recruitment submission.

README must include:

- Project overview.
- Tech stack.
- How to install dependencies.
- How to run:
  - Expo app.
  - Express backend.
  - n8n.
- How to import `n8n-workflow.json`.
- How to run the demo scenarios.
- Conflict cases handled.
- Known limitations.
- Optional extensions, if any.

DECISIONS.md must include:

- Data model.
- Sync model.
- Conflict-resolution strategy.
- Why two devices converge.
- Backend idempotency.
- n8n idempotency.
- One tradeoff and why.
- Where the design could still break.

Demo video must show:

- Two clients running under one account.
- Both clients going offline.
- Offline focus session on each device.
- Conflicting task edit.
- Reconnect and sync.
- Both clients ending with identical state.
- n8n notification firing exactly once even with replay/duplicate sync.
- Short walkthrough of how sync works.
- Honest explanation of weak points.

PDF reference:

- Deliverables section.
- "What we are really testing" section.

Deliverable after this phase:

- GitHub repo is ready.
- README, DECISIONS, and n8n workflow are complete.
- 5-minute demo video is recorded.
- Assignment is ready to submit.

## Recommended Build Order

Use this practical order while implementing:

1. Backend data model and sync endpoint.
2. Frontend two-device shell.
3. Offline operation queues.
4. Syllabus operations and conflict handling.
5. Focus session operations and reward idempotency.
6. n8n webhook and mock notification sink.
7. Dev panel replay/out-of-order scenarios.
8. Documentation.
9. Demo rehearsal.
10. Final video and submission.

## Success Criteria

The project is complete when all of the following are true:

- A focus session can succeed offline and sync later.
- A failed focus session can be recorded offline and sync later.
- Coins, streak, and today's focus total are awarded exactly once per successful session.
- Task status edits work offline.
- Chapter and subject progress update immediately.
- Two devices can diverge offline and converge after reconnect.
- Duplicate sync messages do not duplicate operations, rewards, or notifications.
- Out-of-order sync messages still produce deterministic final state.
- n8n workflow is real, exported, and importable.
- Notification fires exactly once per successful session.
- README explains how to run everything.
- DECISIONS explains the sync, merge, convergence, and idempotency design.
- A 5-minute demo video proves the required behavior.
