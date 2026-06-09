import { createSeedSyllabus } from "./seed.js";
import {
  DEVICE_IDS,
  STUDENT_ID,
  TASK_STATUS_RANK,
  type ClientOperation,
  type DeviceId,
  type FocusFailureReason,
  type FocusRewardEvent,
  type FocusSession,
  type MockNotification,
  type NotificationEvent,
  type NotificationEventId,
  type OperationId,
  type RejectedOperation,
  type ServerStore,
  type StudentState,
  type StudyTask,
  type SyncEnvelope,
  type SyncResult,
  type TaskDeletedOperation,
  type TaskStatus,
  type TaskStatusChangedOperation
} from "./types.js";

const COINS_PER_SUCCESSFUL_SESSION = 50;

type OperationValidationResult =
  | {
      ok: true;
      operation: ClientOperation;
    }
  | {
      ok: false;
      rejection: RejectedOperation;
    };

type TaskOperation = TaskStatusChangedOperation | TaskDeletedOperation;

export function applySyncEnvelope(store: ServerStore, envelope: unknown): SyncResult {
  const parsedEnvelope = parseSyncEnvelope(envelope);
  const acceptedOperationIds: OperationId[] = [];
  const duplicateOperationIds: OperationId[] = [];
  const rejectedOperations: RejectedOperation[] = [];

  if (!parsedEnvelope.ok) {
    const state = deriveStudentState(store);

    return {
      serverVersion: store.serverVersion,
      acceptedOperationIds,
      duplicateOperationIds,
      rejectedOperations: [parsedEnvelope.rejection],
      state
    };
  }

  for (const rawOperation of parsedEnvelope.envelope.operations) {
    const validation = parseOperation(rawOperation);

    if (!validation.ok) {
      rejectedOperations.push(validation.rejection);
      continue;
    }

    if (store.processedOperationIds[validation.operation.operationId]) {
      duplicateOperationIds.push(validation.operation.operationId);
      continue;
    }

    store.processedOperationIds[validation.operation.operationId] = true;
    store.acceptedOperations.push(validation.operation);
    acceptedOperationIds.push(validation.operation.operationId);
  }

  if (acceptedOperationIds.length > 0) {
    store.serverVersion += 1;
  }

  const state = deriveStudentState(store);
  store.notificationEventsById = state.notifications.notificationEventsById;

  return {
    serverVersion: store.serverVersion,
    acceptedOperationIds,
    duplicateOperationIds,
    rejectedOperations,
    state
  };
}

export function deriveStudentState(store: ServerStore): StudentState {
  const sessionsById = deriveFocusSessions(store.acceptedOperations);
  const rewardEventsById = deriveRewardEvents(sessionsById);
  const notificationEventsById = deriveNotificationEvents(rewardEventsById, store);
  const focusMinutesByDay = deriveFocusMinutesByDay(sessionsById);
  const coins = Object.keys(rewardEventsById).length * COINS_PER_SUCCESSFUL_SESSION;
  const streakDays = calculateCurrentStreak(Object.keys(focusMinutesByDay));

  return {
    studentId: STUDENT_ID,
    focus: {
      sessionsById,
      rewardEventsById,
      coins,
      streakDays,
      focusMinutesByDay
    },
    syllabus: deriveSyllabus(store.acceptedOperations),
    sync: {
      serverVersion: store.serverVersion,
      processedOperationIds: store.processedOperationIds,
      acceptedOperations: store.acceptedOperations
    },
    notifications: {
      notificationEventsById
    }
  };
}

export function registerMockNotification(store: ServerStore, payload: unknown): {
  duplicate: boolean;
  notification: MockNotification | null;
} {
  const eventId = readNotificationEventId(payload);

  if (eventId === null) {
    throw new Error("Mock notification payload must include a string eventId.");
  }

  const existingNotification = store.mockNotifications.find((notification: MockNotification) => notification.eventId === eventId);

  if (existingNotification !== undefined) {
    return {
      duplicate: true,
      notification: existingNotification
    };
  }

  const notification: MockNotification = {
    eventId,
    receivedAt: new Date().toISOString(),
    payload
  };

  store.mockNotifications.push(notification);

  const existingEvent = store.notificationEventsById[eventId];

  if (existingEvent !== undefined) {
    store.notificationEventsById[eventId] = {
      ...existingEvent,
      status: "sent"
    };
  }

  return {
    duplicate: false,
    notification
  };
}

function parseSyncEnvelope(rawEnvelope: unknown):
  | {
      ok: true;
      envelope: SyncEnvelope;
    }
  | {
      ok: false;
      rejection: RejectedOperation;
    } {
  if (!isRecord(rawEnvelope)) {
    return createEnvelopeRejection("Sync payload must be an object.");
  }

  if (rawEnvelope.studentId !== STUDENT_ID) {
    return createEnvelopeRejection("Unknown studentId.");
  }

  if (!isDeviceId(rawEnvelope.deviceId)) {
    return createEnvelopeRejection("Unknown deviceId.");
  }

  if (!Array.isArray(rawEnvelope.operations)) {
    return createEnvelopeRejection("operations must be an array.");
  }

  return {
    ok: true,
    envelope: {
      studentId: STUDENT_ID,
      deviceId: rawEnvelope.deviceId,
      operations: rawEnvelope.operations as ClientOperation[]
    }
  };
}

function parseOperation(rawOperation: unknown): OperationValidationResult {
  if (!isRecord(rawOperation)) {
    return createOperationRejection(null, "Operation must be an object.");
  }

  const operationId = readString(rawOperation.operationId);
  const deviceSeq = readNumber(rawOperation.deviceSeq);

  if (operationId === null) {
    return createOperationRejection(null, "operationId must be a string.");
  }

  if (rawOperation.studentId !== STUDENT_ID) {
    return createOperationRejection(operationId, "Unknown studentId.");
  }

  if (!isDeviceId(rawOperation.deviceId)) {
    return createOperationRejection(operationId, "Unknown deviceId.");
  }

  if (!Number.isInteger(deviceSeq) || deviceSeq <= 0) {
    return createOperationRejection(operationId, "deviceSeq must be a positive integer.");
  }

  if (operationId !== `${rawOperation.deviceId}:${deviceSeq}`) {
    return createOperationRejection(operationId, "operationId must match <deviceId>:<deviceSeq>.");
  }

  if (rawOperation.type === "focus_session_started") {
    return parseFocusSessionStarted(rawOperation, operationId, rawOperation.deviceId, deviceSeq);
  }

  if (rawOperation.type === "focus_session_succeeded") {
    return parseFocusSessionSucceeded(rawOperation, operationId, rawOperation.deviceId, deviceSeq);
  }

  if (rawOperation.type === "focus_session_failed") {
    return parseFocusSessionFailed(rawOperation, operationId, rawOperation.deviceId, deviceSeq);
  }

  if (rawOperation.type === "task_status_changed") {
    return parseTaskStatusChanged(rawOperation, operationId, rawOperation.deviceId, deviceSeq);
  }

  if (rawOperation.type === "task_deleted") {
    return parseTaskDeleted(rawOperation, operationId, rawOperation.deviceId, deviceSeq);
  }

  return createOperationRejection(operationId, "Unknown operation type.");
}

function parseFocusSessionStarted(
  rawOperation: Record<string, unknown>,
  operationId: OperationId,
  deviceId: DeviceId,
  deviceSeq: number
): OperationValidationResult {
  const sessionId = readString(rawOperation.sessionId);
  const targetMinutes = readNumber(rawOperation.targetMinutes);
  const studyDay = readString(rawOperation.studyDay);

  if (sessionId === null || !sessionId.startsWith(`focus:${deviceId}:`)) {
    return createOperationRejection(operationId, "sessionId must be stable and belong to the device.");
  }

  if (!isPositiveNumber(targetMinutes)) {
    return createOperationRejection(operationId, "targetMinutes must be a positive number.");
  }

  if (studyDay === null || !isStudyDay(studyDay)) {
    return createOperationRejection(operationId, "studyDay must use YYYY-MM-DD format.");
  }

  return {
    ok: true,
    operation: {
      type: "focus_session_started",
      operationId,
      studentId: STUDENT_ID,
      deviceId,
      deviceSeq,
      sessionId,
      targetMinutes,
      studyDay
    }
  };
}

function parseFocusSessionSucceeded(
  rawOperation: Record<string, unknown>,
  operationId: OperationId,
  deviceId: DeviceId,
  deviceSeq: number
): OperationValidationResult {
  const sessionId = readString(rawOperation.sessionId);
  const targetMinutes = readNumber(rawOperation.targetMinutes);
  const completedMinutes = readNumber(rawOperation.completedMinutes);
  const studyDay = readString(rawOperation.studyDay);

  if (sessionId === null || !sessionId.startsWith(`focus:${deviceId}:`)) {
    return createOperationRejection(operationId, "sessionId must be stable and belong to the device.");
  }

  if (!isPositiveNumber(targetMinutes) || !isPositiveNumber(completedMinutes)) {
    return createOperationRejection(operationId, "Focus minutes must be positive numbers.");
  }

  if (completedMinutes < targetMinutes) {
    return createOperationRejection(operationId, "Successful sessions must complete the target duration.");
  }

  if (studyDay === null || !isStudyDay(studyDay)) {
    return createOperationRejection(operationId, "studyDay must use YYYY-MM-DD format.");
  }

  return {
    ok: true,
    operation: {
      type: "focus_session_succeeded",
      operationId,
      studentId: STUDENT_ID,
      deviceId,
      deviceSeq,
      sessionId,
      targetMinutes,
      completedMinutes,
      studyDay
    }
  };
}

function parseFocusSessionFailed(
  rawOperation: Record<string, unknown>,
  operationId: OperationId,
  deviceId: DeviceId,
  deviceSeq: number
): OperationValidationResult {
  const sessionId = readString(rawOperation.sessionId);
  const targetMinutes = readNumber(rawOperation.targetMinutes);
  const completedMinutes = readNumber(rawOperation.completedMinutes);
  const studyDay = readString(rawOperation.studyDay);
  const failureReason = rawOperation.failureReason;

  if (sessionId === null || !sessionId.startsWith(`focus:${deviceId}:`)) {
    return createOperationRejection(operationId, "sessionId must be stable and belong to the device.");
  }

  if (!isPositiveNumber(targetMinutes) || !isNonNegativeNumber(completedMinutes)) {
    return createOperationRejection(operationId, "Focus minutes must be valid numbers.");
  }

  if (studyDay === null || !isStudyDay(studyDay)) {
    return createOperationRejection(operationId, "studyDay must use YYYY-MM-DD format.");
  }

  if (!isFailureReason(failureReason)) {
    return createOperationRejection(operationId, "failureReason must be give_up or app_switch.");
  }

  return {
    ok: true,
    operation: {
      type: "focus_session_failed",
      operationId,
      studentId: STUDENT_ID,
      deviceId,
      deviceSeq,
      sessionId,
      targetMinutes,
      completedMinutes,
      studyDay,
      failureReason
    }
  };
}

function parseTaskStatusChanged(
  rawOperation: Record<string, unknown>,
  operationId: OperationId,
  deviceId: DeviceId,
  deviceSeq: number
): OperationValidationResult {
  const taskId = readString(rawOperation.taskId);
  const status = rawOperation.status;
  const baseStatusVersion = readString(rawOperation.baseStatusVersion);
  const seedSyllabus = createSeedSyllabus();

  if (taskId === null || seedSyllabus.tasksById[taskId] === undefined) {
    return createOperationRejection(operationId, "Unknown taskId.");
  }

  if (!isTaskStatus(status)) {
    return createOperationRejection(operationId, "Unknown task status.");
  }

  if (baseStatusVersion === null) {
    return createOperationRejection(operationId, "baseStatusVersion must be a string.");
  }

  return {
    ok: true,
    operation: {
      type: "task_status_changed",
      operationId,
      studentId: STUDENT_ID,
      deviceId,
      deviceSeq,
      taskId,
      status,
      baseStatusVersion
    }
  };
}

function parseTaskDeleted(
  rawOperation: Record<string, unknown>,
  operationId: OperationId,
  deviceId: DeviceId,
  deviceSeq: number
): OperationValidationResult {
  const taskId = readString(rawOperation.taskId);
  const baseStatusVersion = readString(rawOperation.baseStatusVersion);
  const seedSyllabus = createSeedSyllabus();

  if (taskId === null || seedSyllabus.tasksById[taskId] === undefined) {
    return createOperationRejection(operationId, "Unknown taskId.");
  }

  if (baseStatusVersion === null) {
    return createOperationRejection(operationId, "baseStatusVersion must be a string.");
  }

  return {
    ok: true,
    operation: {
      type: "task_deleted",
      operationId,
      studentId: STUDENT_ID,
      deviceId,
      deviceSeq,
      taskId,
      baseStatusVersion
    }
  };
}

function deriveFocusSessions(operations: ClientOperation[]): Record<string, FocusSession> {
  const sessionsById: Record<string, FocusSession> = {};

  for (const operation of operations) {
    if (
      operation.type !== "focus_session_started" &&
      operation.type !== "focus_session_succeeded" &&
      operation.type !== "focus_session_failed"
    ) {
      continue;
    }

    const existingSession = sessionsById[operation.sessionId];

    if (existingSession !== undefined && existingSession.outcome === "failed") {
      continue;
    }

    if (operation.type === "focus_session_started") {
      if (existingSession === undefined) {
        sessionsById[operation.sessionId] = {
          sessionId: operation.sessionId,
          studentId: operation.studentId,
          deviceId: operation.deviceId,
          targetMinutes: operation.targetMinutes,
          completedMinutes: 0,
          studyDay: operation.studyDay,
          outcome: "running",
          failureReason: null,
          operationId: operation.operationId
        };
      }

      continue;
    }

    if (operation.type === "focus_session_failed") {
      sessionsById[operation.sessionId] = {
        sessionId: operation.sessionId,
        studentId: operation.studentId,
        deviceId: operation.deviceId,
        targetMinutes: operation.targetMinutes,
        completedMinutes: operation.completedMinutes,
        studyDay: operation.studyDay,
        outcome: "failed",
        failureReason: operation.failureReason,
        operationId: operation.operationId
      };
      continue;
    }

    if (existingSession !== undefined && existingSession.outcome === "success") {
      continue;
    }

    sessionsById[operation.sessionId] = {
      sessionId: operation.sessionId,
      studentId: operation.studentId,
      deviceId: operation.deviceId,
      targetMinutes: operation.targetMinutes,
      completedMinutes: operation.completedMinutes,
      studyDay: operation.studyDay,
      outcome: "success",
      failureReason: null,
      operationId: operation.operationId
    };
  }

  return sessionsById;
}

function deriveRewardEvents(sessionsById: Record<string, FocusSession>): Record<string, FocusRewardEvent> {
  const successfulSessions = Object.values(sessionsById)
    .filter((session: FocusSession) => session.outcome === "success")
    .sort((first: FocusSession, second: FocusSession) => compareStrings(`${first.studyDay}:${first.sessionId}`, `${second.studyDay}:${second.sessionId}`));
  const focusMinutesByDay = deriveFocusMinutesByDay(sessionsById);
  const finalStreak = calculateCurrentStreak(Object.keys(focusMinutesByDay));
  const rewardEventsById: Record<string, FocusRewardEvent> = {};

  successfulSessions.forEach((session: FocusSession) => {
    const eventId = createRewardEventId(session.sessionId);

    rewardEventsById[eventId] = {
      eventId,
      sessionId: session.sessionId,
      studentId: session.studentId,
      coinsAwarded: COINS_PER_SUCCESSFUL_SESSION,
      streakDaysAfter: finalStreak,
      focusMinutesTodayAfter: focusMinutesByDay[session.studyDay] ?? 0
    };
  });

  return rewardEventsById;
}

function deriveNotificationEvents(
  rewardEventsById: Record<string, FocusRewardEvent>,
  store: ServerStore
): Record<NotificationEventId, NotificationEvent> {
  const notificationEventsById: Record<NotificationEventId, NotificationEvent> = {};
  const totalCoins = Object.keys(rewardEventsById).length * COINS_PER_SUCCESSFUL_SESSION;

  for (const rewardEvent of Object.values(rewardEventsById)) {
    const eventId = createNotificationEventId(rewardEvent.eventId);
    const existingEvent = store.notificationEventsById[eventId];

    notificationEventsById[eventId] = {
      eventId,
      rewardEventId: rewardEvent.eventId,
      sessionId: rewardEvent.sessionId,
      studentId: rewardEvent.studentId,
      status: existingEvent?.status ?? "pending",
      payload: {
        message: `Streak now ${rewardEvent.streakDaysAfter} days, +${rewardEvent.coinsAwarded} coins.`,
        streakDays: rewardEvent.streakDaysAfter,
        coinsAwarded: rewardEvent.coinsAwarded,
        totalCoins,
        focusMinutesToday: rewardEvent.focusMinutesTodayAfter
      }
    };
  }

  return notificationEventsById;
}

function deriveSyllabus(operations: ClientOperation[]) {
  const syllabus = createSeedSyllabus();
  const taskOperations = sortTaskOperationsByDependencies(
    operations.filter((operation: ClientOperation): operation is TaskOperation => operation.type === "task_status_changed" || operation.type === "task_deleted")
  );

  for (const operation of taskOperations) {
    if (operation.type === "task_deleted") {
      syllabus.taskTombstonesById[operation.taskId] = {
        taskId: operation.taskId,
        deletedByOperationId: operation.operationId
      };
      delete syllabus.tasksById[operation.taskId];
      continue;
    }

    if (syllabus.taskTombstonesById[operation.taskId] !== undefined) {
      continue;
    }

    const task = syllabus.tasksById[operation.taskId];

    if (task === undefined) {
      continue;
    }

    const mergedTask = mergeTaskStatus(task, operation);
    syllabus.tasksById[operation.taskId] = mergedTask;
  }

  return syllabus;
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

function sortTaskOperationsByDependencies(operations: TaskOperation[]): TaskOperation[] {
  const operationsById = new Map<OperationId, TaskOperation>();

  for (const operation of operations) {
    operationsById.set(operation.operationId, operation);
  }

  const sortedOperations = [...operations].sort(compareOperations);
  const visitedOperationIds = new Set<OperationId>();
  const visitingOperationIds = new Set<OperationId>();
  const result: TaskOperation[] = [];

  for (const operation of sortedOperations) {
    visitTaskOperation(operation, operationsById, visitedOperationIds, visitingOperationIds, result);
  }

  return result;
}

function visitTaskOperation(
  operation: TaskOperation,
  operationsById: Map<OperationId, TaskOperation>,
  visitedOperationIds: Set<OperationId>,
  visitingOperationIds: Set<OperationId>,
  result: TaskOperation[]
): void {
  if (visitedOperationIds.has(operation.operationId)) {
    return;
  }

  if (visitingOperationIds.has(operation.operationId)) {
    throw new Error(`Cycle detected in task operation dependencies at ${operation.operationId}.`);
  }

  visitingOperationIds.add(operation.operationId);

  const baseOperation = operationsById.get(operation.baseStatusVersion);

  if (baseOperation !== undefined) {
    visitTaskOperation(baseOperation, operationsById, visitedOperationIds, visitingOperationIds, result);
  }

  visitingOperationIds.delete(operation.operationId);
  visitedOperationIds.add(operation.operationId);
  result.push(operation);
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

function compareOperations(first: ClientOperation, second: ClientOperation): number {
  if (first.deviceSeq !== second.deviceSeq) {
    return first.deviceSeq - second.deviceSeq;
  }

  const deviceComparison = compareStrings(first.deviceId, second.deviceId);

  if (deviceComparison !== 0) {
    return deviceComparison;
  }

  return compareStrings(first.operationId, second.operationId);
}

function compareStrings(first: string, second: string): number {
  return first.localeCompare(second);
}

function createRewardEventId(sessionId: string): string {
  return `reward:${sessionId}`;
}

function createNotificationEventId(rewardEventId: string): NotificationEventId {
  return `notification:${rewardEventId}`;
}

function readNotificationEventId(payload: unknown): NotificationEventId | null {
  if (!isRecord(payload)) {
    return null;
  }

  return readString(payload.eventId);
}

function readDeviceIdFromOperationId(operationId: OperationId): DeviceId | null {
  const [deviceId] = operationId.split(":");

  if (isDeviceId(deviceId)) {
    return deviceId;
  }

  return null;
}

function readSeqFromOperationId(operationId: OperationId): number | null {
  const [, rawSeq] = operationId.split(":");
  const seq = Number(rawSeq);

  if (Number.isInteger(seq)) {
    return seq;
  }

  return null;
}

function createEnvelopeRejection(reason: string): {
  ok: false;
  rejection: RejectedOperation;
} {
  return {
    ok: false,
    rejection: {
      operationId: null,
      reason
    }
  };
}

function createOperationRejection(operationId: OperationId | null, reason: string): OperationValidationResult {
  return {
    ok: false,
    rejection: {
      operationId,
      reason
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  return null;
}

function readNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  return Number.NaN;
}

function isDeviceId(value: unknown): value is DeviceId {
  return typeof value === "string" && DEVICE_IDS.includes(value as DeviceId);
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && value in TASK_STATUS_RANK;
}

function isFailureReason(value: unknown): value is FocusFailureReason {
  return value === "give_up" || value === "app_switch";
}

function isPositiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isStudyDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
