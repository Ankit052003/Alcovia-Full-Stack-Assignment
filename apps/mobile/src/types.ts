export type StudentId = "student-001";
export type DeviceId = "device-a" | "device-b";
export type OperationId = string;
export type SessionId = string;
export type RewardEventId = string;
export type TaskStatus = "not_started" | "in_progress" | "done";
export type FocusFailureReason = "give_up" | "app_switch";

export type Subject = {
  subjectId: string;
  title: string;
  chapterIds: string[];
};

export type Chapter = {
  chapterId: string;
  subjectId: string;
  title: string;
  taskIds: string[];
};

export type StudyTask = {
  taskId: string;
  chapterId: string;
  title: string;
  status: TaskStatus;
  statusVersion: OperationId;
  statusBaseVersion: OperationId;
  isDeleted: false;
};

export type SyllabusState = {
  subjectsById: Record<string, Subject>;
  chaptersById: Record<string, Chapter>;
  tasksById: Record<string, StudyTask>;
  taskTombstonesById: Record<string, { taskId: string; deletedByOperationId: string }>;
};

export type FocusSession = {
  sessionId: SessionId;
  studentId: StudentId;
  deviceId: DeviceId;
  targetMinutes: number;
  completedMinutes: number;
  studyDay: string;
  outcome: "running" | "success" | "failed";
  failureReason: FocusFailureReason | null;
  operationId: OperationId;
};

export type FocusRewardEvent = {
  eventId: RewardEventId;
  sessionId: SessionId;
  studentId: StudentId;
  coinsAwarded: number;
  streakDaysAfter: number;
  focusMinutesTodayAfter: number;
};

export type StudentState = {
  studentId: StudentId;
  focus: {
    sessionsById: Record<string, FocusSession>;
    rewardEventsById: Record<string, FocusRewardEvent>;
    coins: number;
    streakDays: number;
    focusMinutesByDay: Record<string, number>;
  };
  syllabus: SyllabusState;
  sync: {
    serverVersion: number;
    processedOperationIds: Record<string, true>;
    acceptedOperations: ClientOperation[];
  };
  notifications: {
    notificationEventsById: Record<string, unknown>;
  };
};

export type OperationBase = {
  operationId: OperationId;
  studentId: StudentId;
  deviceId: DeviceId;
  deviceSeq: number;
};

export type FocusSessionStartedOperation = OperationBase & {
  type: "focus_session_started";
  sessionId: SessionId;
  targetMinutes: number;
  studyDay: string;
};

export type FocusSessionSucceededOperation = OperationBase & {
  type: "focus_session_succeeded";
  sessionId: SessionId;
  targetMinutes: number;
  completedMinutes: number;
  studyDay: string;
};

export type FocusSessionFailedOperation = OperationBase & {
  type: "focus_session_failed";
  sessionId: SessionId;
  targetMinutes: number;
  completedMinutes: number;
  studyDay: string;
  failureReason: FocusFailureReason;
};

export type TaskStatusChangedOperation = OperationBase & {
  type: "task_status_changed";
  taskId: string;
  status: TaskStatus;
  baseStatusVersion: OperationId;
};

export type TaskDeletedOperation = OperationBase & {
  type: "task_deleted";
  taskId: string;
  baseStatusVersion: OperationId;
};

export type ClientOperation =
  | FocusSessionStartedOperation
  | FocusSessionSucceededOperation
  | FocusSessionFailedOperation
  | TaskStatusChangedOperation
  | TaskDeletedOperation;

export type ActiveFocusSession = {
  sessionId: SessionId;
  targetSeconds: number;
  startedAtEpochMs: number;
  elapsedSeconds: number;
  studyDay: string;
};

export type DeviceState = {
  studentId: StudentId;
  deviceId: DeviceId;
  storageKey: string;
  deviceSeq: number;
  isOnline: boolean;
  activeFocusSession: ActiveFocusSession | null;
  localState: StudentState;
  pendingOperations: ClientOperation[];
  lastSyncMessage: string;
};

export type ServerStateResponse = {
  state: StudentState;
  diagnostics: {
    serverVersion: number;
    acceptedOperations: number;
    processedOperations: number;
    notifications: number;
    mockNotifications: number;
  };
};

export type SyncResult = {
  serverVersion: number;
  acceptedOperationIds: string[];
  duplicateOperationIds: string[];
  rejectedOperations: Array<{ operationId: string | null; reason: string }>;
  state: StudentState;
};
