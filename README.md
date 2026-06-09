# Alcovia Offline-First Study Sync

This repository is for the Alcovia Full Stack Engineering Intern take-home assignment.

The assignment asks for an offline-first study app prototype with:

- React Native Expo frontend, running on web.
- Express backend.
- n8n automation workflow.
- Two simulated devices under one hardcoded student account.
- Offline focus sessions and syllabus progress.
- Deterministic sync, conflict handling, and exactly-once rewards/notifications.

## Current Status

Phase 1 through Phase 7 are complete:

- Repository structure has been created.
- Initial technical choices are documented.
- `README.md`, `DECISIONS.md`, `plan.md`, and `n8n/n8n-workflow.json` exist.
- Data model, sync envelope, merge rules, and idempotency keys are documented in `DECISIONS.md`.
- Express backend exists under `apps/server`.
- Expo web shell exists under `apps/mobile`.
- Offline-first focus sessions are implemented.
- Offline-first syllabus task edits and deletes are implemented.
- Two-device sync and convergence are implemented.

Implementation continues in Phase 8 with the n8n automation workflow.

## Repository Structure

```text
.
  apps/
    mobile/          # Expo React Native app, planned for Phase 4
    server/          # Express backend, planned for Phase 3
  n8n/
    n8n-workflow.json
  DECISIONS.md
  README.md
  plan.md
```

## Planned Stack

- Language: TypeScript.
- Frontend: React Native with Expo, running on web for the demo.
- Backend: Express.
- Automation: n8n.
- Frontend storage: browser local storage with separate namespaces for each simulated device.
- Backend storage: JSON file storage for a simple, inspectable demo.
- Notification delivery: mock notification endpoint through n8n.

## Assignment Constants

- Hardcoded student ID: `student-001`.
- Simulated devices:
  - `device-a`
  - `device-b`
- No login will be added.
- UI will stay simple and functional because the assignment evaluates sync and reasoning over visual polish.

## Planned Demo Flow

The final demo should show:

1. Two clients open under the same student account.
2. Both clients go offline.
3. Each client completes an offline focus session.
4. The clients create a conflicting task edit.
5. The clients reconnect and sync.
6. Both clients converge to the same state.
7. Rewards are counted exactly once per successful session.
8. The n8n notification fires exactly once per successful session, even after replay or duplicate sync.

## How To Run

Install dependencies from the repository root:

```powershell
npm install
```

Run the backend:

```powershell
npm run dev:server
```

The backend listens on:

```text
http://localhost:4000
```

Check the backend health endpoint:

```powershell
Invoke-RestMethod http://localhost:4000/health
```

Run the Expo web app in another terminal:

```powershell
npm run dev:mobile
```

Open the Expo URL printed in the terminal. It is usually:

```text
http://localhost:8081
```

Useful backend endpoints:

- `GET /health`
- `GET /state/student-001`
- `POST /sync`
- `POST /mock-notifications`
- `POST /reset-dev`

## Current Demo Controls

In the Expo app:

- Use the Online/Offline toggle on each device to simulate network loss.
- Set the focus duration in demo seconds. The default is `10`.
- Click `Start` to create a durable local `focus_session_started` operation.
- Let the timer reach the target to create a successful session.
- Click `Give Up` or `App Switch` to create a failed session.
- Use task buttons `Not`, `Doing`, `Done`, and `Delete` to create offline syllabus operations.
- Click `Sync` or toggle a device online to push pending operations.
- Click `Pull` to replace a device's local canonical state with the server state when it has no pending operations.
- After any device syncs, other online devices with no pending operations auto-refresh to the same canonical state.

Recommended Phase 7 demo:

1. Click `Reset`.
2. Toggle both devices offline.
3. Start a focus session on both devices and wait for success.
4. On the same task, mark Device A as `Done` and Device B as `Doing`.
5. Optionally delete another task on one device while editing it on the other.
6. Toggle devices online and let sync run.
7. Confirm the already-online device auto-refreshes after the other device syncs. Use `Pull` only if you intentionally kept a device offline.
8. Confirm both devices show the same task state, coins, streak, and focus minutes.

## Development Plan

See `plan.md` for the full 10-phase implementation plan.
