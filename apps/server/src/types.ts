export const STUDENT_ID = "student-001" as const;

export const DEVICE_IDS = ["device-a", "device-b"] as const;

export const TASK_STATUS_RANK = {
  not_started: 0,
  in_progress: 1,
  done: 2
} as const;

export type StudentId = typeof STUDENT_ID;
export type DeviceId = (typeof DEVICE_IDS)[number];
export type OperationId = string;
export type SessionId = string;
export type RewardEventId = string;
export type NotificationEventId = string;
export type TaskStatus = keyof typeof TASK_STATUS_RANK;
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

export type TaskTombstone = {
  taskId: string;
  deletedByOperationId: OperationId;
};

export type SyllabusState = {
  subjectsById: Record<string, Subject>;
  chaptersById: Record<string, Chapter>;
  tasksById: Record<string, StudyTask>;
  taskTombstonesById: Record<string, TaskTombstone>;
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

export type FocusState = {
  sessionsById: Record<SessionId, FocusSession>;
  rewardEventsById: Record<RewardEventId, FocusRewardEvent>;
  coins: number;
  streakDays: number;
  focusMinutesByDay: Record<string, number>;
};

export type NotificationEvent = {
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

export type NotificationState = {
  notificationEventsById: Record<NotificationEventId, NotificationEvent>;
};

export type SyncState = {
  serverVersion: number;
  processedOperationIds: Record<OperationId, true>;
  acceptedOperations: ClientOperation[];
};

export type StudentState = {
  studentId: StudentId;
  focus: FocusState;
  syllabus: SyllabusState;
  sync: SyncState;
  notifications: NotificationState;
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

export type SyncEnvelope = {
  studentId: StudentId;
  deviceId: DeviceId;
  operations: ClientOperation[];
};

export type RejectedOperation = {
  operationId: OperationId | null;
  reason: string;
};

export type SyncResult = {
  serverVersion: number;
  acceptedOperationIds: OperationId[];
  duplicateOperationIds: OperationId[];
  rejectedOperations: RejectedOperation[];
  state: StudentState;
};

export type MockNotification = {
  eventId: NotificationEventId;
  receivedAt: string;
  payload: unknown;
};

export type ServerStore = {
  serverVersion: number;
  processedOperationIds: Record<OperationId, true>;
  acceptedOperations: ClientOperation[];
  notificationEventsById: Record<NotificationEventId, NotificationEvent>;
  mockNotifications: MockNotification[];
};
