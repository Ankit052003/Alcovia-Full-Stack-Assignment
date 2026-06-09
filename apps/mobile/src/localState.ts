import type {
  ClientOperation,
  DeviceState,
  FocusFailureReason,
  FocusRewardEvent,
  FocusSession,
  FocusSessionFailedOperation,
  FocusSessionStartedOperation,
  FocusSessionSucceededOperation,
  OperationBase,
  StudentState,
  StudyTask,
  TaskDeletedOperation,
  TaskStatus,
  TaskStatusChangedOperation
} from "./types";

const STUDENT_ID = "student-001";
const COINS_PER_SUCCESSFUL_SESSION = 50;
const TASK_STATUS_RANK: Record<TaskStatus, number> = {
  not_started: 0,
  in_progress: 1,
  done: 2
};

type TaskOperation = TaskStatusChangedOperation | TaskDeletedOperation;

export function queueLocalOperation(deviceState: DeviceState, operation: ClientOperation): DeviceState {
  return {
    ...deviceState,
    deviceSeq: operation.deviceSeq,
    localState: applyOperationToLocalState(deviceState.localState, operation),
    pendingOperations: [...deviceState.pendingOperations, operation],
    lastSyncMessage: deviceState.isOnline ? "Queued locally; syncing" : "Queued offline"
  };
}

export function createFocusStartedOperation(deviceState: DeviceState, targetSeconds: number): FocusSessionStartedOperation {
  const operationBase = createOperationBase(deviceState);

  return {
    ...operationBase,
    type: "focus_session_started",
    sessionId: `focus:${deviceState.deviceId}:${operationBase.deviceSeq}`,
    targetMinutes: secondsToMinutes(targetSeconds),
    studyDay: getStudyDay()
  };
}

export function createFocusSucceededOperation(deviceState: DeviceState): FocusSessionSucceededOperation {
  if (deviceState.activeFocusSession === null) {
    throw new Error("Cannot finish focus session because no session is active.");
  }

  const operationBase = createOperationBase(deviceState);

  return {
    ...operationBase,
    type: "focus_session_succeeded",
    sessionId: deviceState.activeFocusSession.sessionId,
    targetMinutes: secondsToMinutes(deviceState.activeFocusSession.targetSeconds),
    completedMinutes: secondsToMinutes(deviceState.activeFocusSession.targetSeconds),
    studyDay: deviceState.activeFocusSession.studyDay
  };
}

export function createFocusFailedOperation(deviceState: DeviceState, failureReason: FocusFailureReason): FocusSessionFailedOperation {
  if (deviceState.activeFocusSession === null) {
    throw new Error("Cannot fail focus session because no session is active.");
  }

  const operationBase = createOperationBase(deviceState);

  return {
    ...operationBase,
    type: "focus_session_failed",
    sessionId: deviceState.activeFocusSession.sessionId,
    targetMinutes: secondsToMinutes(deviceState.activeFocusSession.targetSeconds),
    completedMinutes: secondsToMinutes(deviceState.activeFocusSession.elapsedSeconds),
    studyDay: deviceState.activeFocusSession.studyDay,
    failureReason
  };
}

export function createTaskStatusOperation(deviceState: DeviceState, task: StudyTask, status: TaskStatus): TaskStatusChangedOperation {
  return {
    ...createOperationBase(deviceState),
    type: "task_status_changed",
    taskId: task.taskId,
    status,
    baseStatusVersion: task.statusVersion
  };
}

export function createTaskDeletedOperation(deviceState: DeviceState, task: StudyTask): TaskDeletedOperation {
  return {
    ...createOperationBase(deviceState),
    type: "task_deleted",
    taskId: task.taskId,
    baseStatusVersion: task.statusVersion
  };
}

export function applyOperationToLocalState(state: StudentState, operation: ClientOperation): StudentState {
  if (operation.type === "focus_session_started" || operation.type === "focus_session_succeeded" || operation.type === "focus_session_failed") {
    return recomputeFocusState(applyFocusOperation(state, operation));
  }

  if (operation.type === "task_status_changed" || operation.type === "task_deleted") {
    return applyTaskOperation(state, operation);
  }

  return state;
}

export function recomputeFocusState(state: StudentState): StudentState {
  const rewardEventsById = deriveRewardEvents(state.focus.sessionsById);
  const focusMinutesByDay = deriveFocusMinutesByDay(state.focus.sessionsById);
  const coins = Object.keys(rewardEventsById).length * COINS_PER_SUCCESSFUL_SESSION;
  const streakDays = calculateCurrentStreak(Object.keys(focusMinutesByDay));

  return {
    ...state,
    focus: {
      sessionsById: state.focus.sessionsById,
      rewardEventsById,
      coins,
      streakDays,
      focusMinutesByDay
    }
  };
}

export function secondsToMinutes(seconds: number): number {
  return Number((seconds / 60).toFixed(2));
}

export function getStudyDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function createOperationBase(deviceState: DeviceState): OperationBase {
  const deviceSeq = deviceState.deviceSeq + 1;

  return {
    operationId: `${deviceState.deviceId}:${deviceSeq}`,
    studentId: STUDENT_ID,
    deviceId: deviceState.deviceId,
    deviceSeq
  };
}

function applyFocusOperation(state: StudentState, operation: FocusSessionStartedOperation | FocusSessionSucceededOperation | FocusSessionFailedOperation): StudentState {
  const existingSession = state.focus.sessionsById[operation.sessionId];

  if (existingSession !== undefined && existingSession.outcome === "failed") {
    return state;
  }

  if (operation.type === "focus_session_started") {
    if (existingSession !== undefined) {
      return state;
    }

    return {
      ...state,
      focus: {
        ...state.focus,
        sessionsById: {
          ...state.focus.sessionsById,
          [operation.sessionId]: {
            sessionId: operation.sessionId,
            studentId: operation.studentId,
            deviceId: operation.deviceId,
            targetMinutes: operation.targetMinutes,
            completedMinutes: 0,
            studyDay: operation.studyDay,
            outcome: "running",
            failureReason: null,
            operationId: operation.operationId
          }
        }
      }
    };
  }

  if (operation.type === "focus_session_failed") {
    return {
      ...state,
      focus: {
        ...state.focus,
        sessionsById: {
          ...state.focus.sessionsById,
          [operation.sessionId]: {
            sessionId: operation.sessionId,
            studentId: operation.studentId,
            deviceId: operation.deviceId,
            targetMinutes: operation.targetMinutes,
            completedMinutes: operation.completedMinutes,
            studyDay: operation.studyDay,
            outcome: "failed",
            failureReason: operation.failureReason,
            operationId: operation.operationId
          }
        }
      }
    };
  }

  if (existingSession !== undefined && existingSession.outcome === "success") {
    return state;
  }

  return {
    ...state,
    focus: {
      ...state.focus,
      sessionsById: {
        ...state.focus.sessionsById,
        [operation.sessionId]: {
          sessionId: operation.sessionId,
          studentId: operation.studentId,
          deviceId: operation.deviceId,
          targetMinutes: operation.targetMinutes,
          completedMinutes: operation.completedMinutes,
          studyDay: operation.studyDay,
          outcome: "success",
          failureReason: null,
          operationId: operation.operationId
        }
      }
    }
  };
}

function applyTaskOperation(state: StudentState, operation: TaskOperation): StudentState {
  if (operation.type === "task_deleted") {
    return {
      ...state,
      syllabus: {
        ...state.syllabus,
        tasksById: removeTask(state.syllabus.tasksById, operation.taskId),
        taskTombstonesById: {
          ...state.syllabus.taskTombstonesById,
          [operation.taskId]: {
            taskId: operation.taskId,
            deletedByOperationId: operation.operationId
          }
        }
      }
    };
  }

  if (state.syllabus.taskTombstonesById[operation.taskId] !== undefined) {
    return state;
  }

  const task = state.syllabus.tasksById[operation.taskId];

  if (task === undefined) {
    return state;
  }

  return {
    ...state,
    syllabus: {
      ...state.syllabus,
      tasksById: {
        ...state.syllabus.tasksById,
        [operation.taskId]: mergeTaskStatus(task, operation)
      }
    }
  };
}

function mergeTaskStatus(task: StudyTask, operation: TaskStatusChangedOperation): StudyTask {
  if (operation.baseStatusVersion === task.statusVersion) {
    return applyStatusOperation(task, operation);
  }

  if (readDeviceIdFromOperationId(task.statusVersion) === operation.deviceId) {
    const currentSeq = readSeqFromOperationId(task.statusVersion);

    if (currentSeq !== null && operation.deviceSeq > currentSeq) {
      return applyStatusOperation(task, operation);
    }

    return task;
  }

  const currentRank = TASK_STATUS_RANK[task.status];
  const incomingRank = TASK_STATUS_RANK[operation.status];

  if (incomingRank > currentRank) {
    return applyStatusOperation(task, operation);
  }

  if (incomingRank === currentRank && operation.operationId > task.statusVersion) {
    return applyStatusOperation(task, operation);
  }

  return task;
}

function applyStatusOperation(task: StudyTask, operation: TaskStatusChangedOperation): StudyTask {
  return {
    ...task,
    status: operation.status,
    statusVersion: operation.operationId,
    statusBaseVersion: operation.baseStatusVersion
  };
}

function removeTask(tasksById: Record<string, StudyTask>, taskId: string): Record<string, StudyTask> {
  const nextTasksById = { ...tasksById };
  delete nextTasksById[taskId];
  return nextTasksById;
}

function deriveRewardEvents(sessionsById: Record<string, FocusSession>): Record<string, FocusRewardEvent> {
  const focusMinutesByDay = deriveFocusMinutesByDay(sessionsById);
  const finalStreak = calculateCurrentStreak(Object.keys(focusMinutesByDay));
  const rewardEventsById: Record<string, FocusRewardEvent> = {};

  for (const session of Object.values(sessionsById)) {
    if (session.outcome !== "success") {
      continue;
    }

    const eventId = `reward:${session.sessionId}`;

    rewardEventsById[eventId] = {
      eventId,
      sessionId: session.sessionId,
      studentId: session.studentId,
      coinsAwarded: COINS_PER_SUCCESSFUL_SESSION,
      streakDaysAfter: finalStreak,
      focusMinutesTodayAfter: focusMinutesByDay[session.studyDay] ?? 0
    };
  }

  return rewardEventsById;
}

function deriveFocusMinutesByDay(sessionsById: Record<string, FocusSession>): Record<string, number> {
  const focusMinutesByDay: Record<string, number> = {};

  for (const session of Object.values(sessionsById)) {
    if (session.outcome !== "success") {
      continue;
    }

    focusMinutesByDay[session.studyDay] = (focusMinutesByDay[session.studyDay] ?? 0) + session.completedMinutes;
  }

  return focusMinutesByDay;
}

function calculateCurrentStreak(studyDays: string[]): number {
  const uniqueDays = [...new Set(studyDays)].sort();

  if (uniqueDays.length === 0) {
    return 0;
  }

  let streak = 1;
  let previousDay = uniqueDays[uniqueDays.length - 1];

  for (let index = uniqueDays.length - 2; index >= 0; index -= 1) {
    const currentDay = uniqueDays[index];

    if (daysBetween(currentDay, previousDay) !== 1) {
      break;
    }

    streak += 1;
    previousDay = currentDay;
  }

  return streak;
}

function daysBetween(firstDay: string, secondDay: string): number {
  const firstDate = new Date(`${firstDay}T00:00:00.000Z`);
  const secondDate = new Date(`${secondDay}T00:00:00.000Z`);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round((secondDate.getTime() - firstDate.getTime()) / millisecondsPerDay);
}

function readDeviceIdFromOperationId(operationId: string): string | null {
  const [deviceId] = operationId.split(":");

  if (deviceId === "device-a" || deviceId === "device-b") {
    return deviceId;
  }

  return null;
}

function readSeqFromOperationId(operationId: string): number | null {
  const [, rawSeq] = operationId.split(":");
  const seq = Number(rawSeq);

  if (Number.isInteger(seq)) {
    return seq;
  }

  return null;
}
