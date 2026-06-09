import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { fetchHealth, fetchServerState, resetServerState, syncDevice } from "./api";
import {
  createFocusFailedOperation,
  createFocusStartedOperation,
  createFocusSucceededOperation,
  createTaskDeletedOperation,
  createTaskStatusOperation,
  queueLocalOperation
} from "./localState";
import { getChapterProgress, getSubjectProgress } from "./progress";
import { loadDeviceState, resetDeviceState, saveDeviceState } from "./storage";
import type { ActiveFocusSession, DeviceId, DeviceState, FocusFailureReason, ServerStateResponse, StudyTask, TaskStatus } from "./types";

const DEVICE_IDS: DeviceId[] = ["device-a", "device-b"];
const DEFAULT_FOCUS_SECONDS = "10";

export default function App() {
  const [devices, setDevices] = useState<Record<DeviceId, DeviceState>>({
    "device-a": loadDeviceState("device-a"),
    "device-b": loadDeviceState("device-b")
  });
  const [serverState, setServerState] = useState<ServerStateResponse | null>(null);
  const [serverMessage, setServerMessage] = useState("Backend not checked");
  const [focusDurationSeconds, setFocusDurationSeconds] = useState(DEFAULT_FOCUS_SECONDS);
  const [syncingDevices, setSyncingDevices] = useState<Record<DeviceId, boolean>>({
    "device-a": false,
    "device-b": false
  });

  useEffect(() => {
    void refreshServerState();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setDevices((currentDevices: Record<DeviceId, DeviceState>) => {
        let changed = false;
        const nextDevices = { ...currentDevices };

        for (const deviceId of DEVICE_IDS) {
          const device = currentDevices[deviceId];

          if (device.activeFocusSession === null) {
            continue;
          }

          const activeFocusSession = updateElapsedSeconds(device.activeFocusSession);

          if (activeFocusSession.elapsedSeconds >= activeFocusSession.targetSeconds) {
            const deviceAtTarget: DeviceState = {
              ...device,
              activeFocusSession: {
                ...activeFocusSession,
                elapsedSeconds: activeFocusSession.targetSeconds
              }
            };
            const operation = createFocusSucceededOperation(deviceAtTarget);
            const nextDevice = queueLocalOperation(
              {
                ...deviceAtTarget,
                activeFocusSession: null
              },
              operation
            );

            nextDevices[deviceId] = {
              ...nextDevice,
              lastSyncMessage: nextDevice.isOnline ? "Focus succeeded; syncing" : "Focus succeeded offline"
            };
            saveDeviceState(nextDevices[deviceId]);
            changed = true;
            continue;
          }

          if (activeFocusSession.elapsedSeconds !== device.activeFocusSession.elapsedSeconds) {
            nextDevices[deviceId] = {
              ...device,
              activeFocusSession
            };
            saveDeviceState(nextDevices[deviceId]);
            changed = true;
          }
        }

        return changed ? nextDevices : currentDevices;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    for (const deviceId of DEVICE_IDS) {
      const device = devices[deviceId];

      if (device.isOnline && device.pendingOperations.length > 0 && !syncingDevices[deviceId]) {
        void syncOneDevice(deviceId);
      }
    }
  }, [devices, syncingDevices]);

  const orderedDevices = useMemo(() => DEVICE_IDS.map((deviceId: DeviceId) => devices[deviceId]), [devices]);

  async function refreshServerState(): Promise<void> {
    try {
      const health = await fetchHealth();
      const response = await fetchServerState();

      setServerState(response);
      setServerMessage(`${health.service} online`);
    } catch (error: unknown) {
      setServerMessage(error instanceof Error ? error.message : "Backend check failed");
    }
  }

  function updateDevice(deviceId: DeviceId, update: (deviceState: DeviceState) => DeviceState): void {
    setDevices((currentDevices: Record<DeviceId, DeviceState>) => {
      const nextDevice = update(currentDevices[deviceId]);
      saveDeviceState(nextDevice);

      return {
        ...currentDevices,
        [deviceId]: nextDevice
      };
    });
  }

  function toggleDeviceOnline(deviceId: DeviceId): void {
    updateDevice(deviceId, (deviceState: DeviceState) => {
      const nextIsOnline = !deviceState.isOnline;

      return {
        ...deviceState,
        isOnline: nextIsOnline,
        lastSyncMessage: nextIsOnline ? "Online; pending operations will sync" : "Offline"
      };
    });
  }

  async function syncOneDevice(deviceId: DeviceId): Promise<void> {
    const device = devices[deviceId];

    if (syncingDevices[deviceId]) {
      return;
    }

    if (!device.isOnline) {
      updateDevice(deviceId, (deviceState: DeviceState) => ({
        ...deviceState,
        lastSyncMessage: "Device is offline"
      }));
      return;
    }

    setSyncingDevices((currentSyncingDevices: Record<DeviceId, boolean>) => ({
      ...currentSyncingDevices,
      [deviceId]: true
    }));

    try {
      const operationsToSync = [...device.pendingOperations];
      const result = await syncDevice(deviceId, operationsToSync);
      const clearedOperationIds = new Set<string>([
        ...result.acceptedOperationIds,
        ...result.duplicateOperationIds,
        ...result.rejectedOperations.flatMap((operation) => (operation.operationId === null ? [] : [operation.operationId]))
      ]);
      const rejectedMessage =
        result.rejectedOperations.length > 0 ? `, ${result.rejectedOperations.length} rejected` : "";

      setDevices((currentDevices: Record<DeviceId, DeviceState>) => {
        const nextDevices = { ...currentDevices };
        const currentDevice = currentDevices[deviceId];
        const nextPendingOperations = currentDevice.pendingOperations.filter((operation) => !clearedOperationIds.has(operation.operationId));

        nextDevices[deviceId] = {
          ...currentDevice,
          localState: result.state,
          pendingOperations: nextPendingOperations,
          lastSyncMessage: `Synced v${result.serverVersion}: ${result.acceptedOperationIds.length} accepted, ${result.duplicateOperationIds.length} duplicate${rejectedMessage}`
        };
        saveDeviceState(nextDevices[deviceId]);

        for (const otherDeviceId of DEVICE_IDS) {
          if (otherDeviceId === deviceId) {
            continue;
          }

          const otherDevice = currentDevices[otherDeviceId];

          if (otherDevice.isOnline && otherDevice.pendingOperations.length === 0) {
            nextDevices[otherDeviceId] = {
              ...otherDevice,
              localState: result.state,
              lastSyncMessage: `Auto-refreshed server v${result.serverVersion}`
            };
            saveDeviceState(nextDevices[otherDeviceId]);
          }
        }

        return nextDevices;
      });
      await refreshServerState();
    } catch (error: unknown) {
      updateDevice(deviceId, (deviceState: DeviceState) => ({
        ...deviceState,
        lastSyncMessage: error instanceof Error ? error.message : "Sync failed"
      }));
    } finally {
      setSyncingDevices((currentSyncingDevices: Record<DeviceId, boolean>) => ({
        ...currentSyncingDevices,
        [deviceId]: false
      }));
    }
  }

  async function pullServerIntoDevice(deviceId: DeviceId): Promise<void> {
    const device = devices[deviceId];

    if (!device.isOnline) {
      updateDevice(deviceId, (deviceState: DeviceState) => ({
        ...deviceState,
        lastSyncMessage: "Device is offline"
      }));
      return;
    }

    if (device.pendingOperations.length > 0) {
      updateDevice(deviceId, (deviceState: DeviceState) => ({
        ...deviceState,
        lastSyncMessage: "Sync pending operations before pulling"
      }));
      return;
    }

    try {
      const response = await fetchServerState();

      updateDevice(deviceId, (deviceState: DeviceState) => ({
        ...deviceState,
        localState: response.state,
        lastSyncMessage: `Pulled server v${response.state.sync.serverVersion}`
      }));
      setServerState(response);
    } catch (error: unknown) {
      updateDevice(deviceId, (deviceState: DeviceState) => ({
        ...deviceState,
        lastSyncMessage: error instanceof Error ? error.message : "Pull failed"
      }));
    }
  }

  function startFocusSession(deviceId: DeviceId): void {
    const targetSeconds = parseTargetSeconds(focusDurationSeconds);

    if (targetSeconds === null) {
      updateDevice(deviceId, (deviceState: DeviceState) => ({
        ...deviceState,
        lastSyncMessage: "Enter a positive whole number of demo seconds"
      }));
      return;
    }

    updateDevice(deviceId, (deviceState: DeviceState) => {
      if (deviceState.activeFocusSession !== null) {
        return {
          ...deviceState,
          lastSyncMessage: "Focus session is already running"
        };
      }

      const operation = createFocusStartedOperation(deviceState, targetSeconds);
      const activeFocusSession: ActiveFocusSession = {
        sessionId: operation.sessionId,
        targetSeconds,
        startedAtEpochMs: Date.now(),
        elapsedSeconds: 0,
        studyDay: operation.studyDay
      };

      return queueLocalOperation(
        {
          ...deviceState,
          activeFocusSession
        },
        operation
      );
    });
  }

  function failFocusSession(deviceId: DeviceId, failureReason: FocusFailureReason): void {
    updateDevice(deviceId, (deviceState: DeviceState) => {
      if (deviceState.activeFocusSession === null) {
        return {
          ...deviceState,
          lastSyncMessage: "No running focus session"
        };
      }

      const activeFocusSession = updateElapsedSeconds(deviceState.activeFocusSession);
      const operation = createFocusFailedOperation(
        {
          ...deviceState,
          activeFocusSession
        },
        failureReason
      );

      return queueLocalOperation(
        {
          ...deviceState,
          activeFocusSession: null
        },
        operation
      );
    });
  }

  function changeTaskStatus(deviceId: DeviceId, taskId: string, status: TaskStatus): void {
    updateDevice(deviceId, (deviceState: DeviceState) => {
      const task = deviceState.localState.syllabus.tasksById[taskId];

      if (task === undefined) {
        return {
          ...deviceState,
          lastSyncMessage: "Task no longer exists locally"
        };
      }

      const operation = createTaskStatusOperation(deviceState, task, status);

      return queueLocalOperation(deviceState, operation);
    });
  }

  function deleteTask(deviceId: DeviceId, taskId: string): void {
    updateDevice(deviceId, (deviceState: DeviceState) => {
      const task = deviceState.localState.syllabus.tasksById[taskId];

      if (task === undefined) {
        return {
          ...deviceState,
          lastSyncMessage: "Task no longer exists locally"
        };
      }

      const operation = createTaskDeletedOperation(deviceState, task);

      return queueLocalOperation(deviceState, operation);
    });
  }

  async function resetDemo(): Promise<void> {
    try {
      const response = await resetServerState();
      const nextDeviceA = resetDeviceState("device-a");
      const nextDeviceB = resetDeviceState("device-b");

      setDevices({
        "device-a": {
          ...nextDeviceA,
          localState: response.state,
          lastSyncMessage: "Reset"
        },
        "device-b": {
          ...nextDeviceB,
          localState: response.state,
          lastSyncMessage: "Reset"
        }
      });
      setSyncingDevices({
        "device-a": false,
        "device-b": false
      });
      setServerState(response);
      setServerMessage("Demo reset");
    } catch (error: unknown) {
      setServerMessage(error instanceof Error ? error.message : "Reset failed");
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Alcovia Offline Sync</Text>
          <Text style={styles.subtitle}>student-001</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.secondaryButton} onPress={refreshServerState}>
            <Text style={styles.secondaryButtonText}>Refresh</Text>
          </Pressable>
          <Pressable style={styles.dangerButton} onPress={resetDemo}>
            <Text style={styles.dangerButtonText}>Reset</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.serverPanel}>
        <Text style={styles.sectionTitle}>Server</Text>
        <Text style={styles.mutedText}>{serverMessage}</Text>
        <View style={styles.metricsRow}>
          <Metric label="Version" value={serverState?.diagnostics.serverVersion ?? 0} />
          <Metric label="Operations" value={serverState?.diagnostics.acceptedOperations ?? 0} />
          <Metric label="Notifications" value={serverState?.diagnostics.notifications ?? 0} />
          <Metric label="Mock Sends" value={serverState?.diagnostics.mockNotifications ?? 0} />
        </View>
      </View>

      <View style={styles.deviceGrid}>
        {orderedDevices.map((device: DeviceState) => (
          <DevicePanel
            device={device}
            focusDurationSeconds={focusDurationSeconds}
            isSyncing={syncingDevices[device.deviceId]}
            key={device.deviceId}
            onChangeFocusDuration={setFocusDurationSeconds}
            onDeleteTask={(taskId: string) => {
              deleteTask(device.deviceId, taskId);
            }}
            onFailFocus={(failureReason: FocusFailureReason) => {
              failFocusSession(device.deviceId, failureReason);
            }}
            onPull={() => {
              void pullServerIntoDevice(device.deviceId);
            }}
            onStartFocus={() => {
              startFocusSession(device.deviceId);
            }}
            onSync={() => {
              void syncOneDevice(device.deviceId);
            }}
            onTaskStatusChange={(taskId: string, status: TaskStatus) => {
              changeTaskStatus(device.deviceId, taskId, status);
            }}
            onToggleOnline={() => {
              toggleDeviceOnline(device.deviceId);
            }}
          />
        ))}
      </View>
    </ScrollView>
  );
}

type DevicePanelProps = {
  device: DeviceState;
  focusDurationSeconds: string;
  isSyncing: boolean;
  onChangeFocusDuration: (value: string) => void;
  onDeleteTask: (taskId: string) => void;
  onFailFocus: (failureReason: FocusFailureReason) => void;
  onPull: () => void;
  onStartFocus: () => void;
  onSync: () => void;
  onTaskStatusChange: (taskId: string, status: TaskStatus) => void;
  onToggleOnline: () => void;
};

function DevicePanel({
  device,
  focusDurationSeconds,
  isSyncing,
  onChangeFocusDuration,
  onDeleteTask,
  onFailFocus,
  onPull,
  onStartFocus,
  onSync,
  onTaskStatusChange,
  onToggleOnline
}: DevicePanelProps) {
  const todayFocusMinutes = Object.values(device.localState.focus.focusMinutesByDay).reduce((total: number, minutes: number) => total + minutes, 0);
  const successfulSessions = Object.values(device.localState.focus.sessionsById).filter((session) => session.outcome === "success").length;
  const failedSessions = Object.values(device.localState.focus.sessionsById).filter((session) => session.outcome === "failed").length;

  return (
    <View style={styles.devicePanel}>
      <View style={styles.deviceHeader}>
        <View>
          <Text style={styles.deviceTitle}>{formatDeviceName(device.deviceId)}</Text>
          <Text style={styles.storageKey}>{device.storageKey}</Text>
        </View>
        <Pressable style={[styles.statusToggle, device.isOnline ? styles.onlineToggle : styles.offlineToggle]} onPress={onToggleOnline}>
          <Text style={styles.statusToggleText}>{device.isOnline ? "Online" : "Offline"}</Text>
        </Pressable>
      </View>

      <View style={styles.metricsRow}>
        <Metric label="Coins" value={device.localState.focus.coins} />
        <Metric label="Streak" value={device.localState.focus.streakDays} />
        <Metric label="Minutes" value={formatNumber(todayFocusMinutes)} />
        <Metric label="Pending" value={device.pendingOperations.length} />
        <Metric label="Success" value={successfulSessions} />
        <Metric label="Failed" value={failedSessions} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sync</Text>
        <View style={styles.actionRow}>
          <Pressable style={styles.primaryButton} onPress={onSync}>
            <Text style={styles.primaryButtonText}>{isSyncing ? "Syncing" : "Sync"}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onPull}>
            <Text style={styles.secondaryButtonText}>Pull</Text>
          </Pressable>
        </View>
        <Text style={styles.mutedText}>{device.lastSyncMessage}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Focus</Text>
        <View style={styles.focusRow}>
          <TextInput
            keyboardType="numeric"
            onChangeText={onChangeFocusDuration}
            style={styles.durationInput}
            value={focusDurationSeconds}
          />
          <Pressable style={styles.primaryButton} onPress={onStartFocus}>
            <Text style={styles.primaryButtonText}>Start</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => onFailFocus("give_up")}>
            <Text style={styles.secondaryButtonText}>Give Up</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => onFailFocus("app_switch")}>
            <Text style={styles.secondaryButtonText}>App Switch</Text>
          </Pressable>
        </View>
        <Text style={styles.mutedText}>
          {device.activeFocusSession === null
            ? "No running session"
            : `Running ${device.activeFocusSession.elapsedSeconds}/${device.activeFocusSession.targetSeconds}s`}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Syllabus</Text>
        <SyllabusView device={device} onDeleteTask={onDeleteTask} onTaskStatusChange={onTaskStatusChange} />
      </View>
    </View>
  );
}

type SyllabusViewProps = {
  device: DeviceState;
  onDeleteTask: (taskId: string) => void;
  onTaskStatusChange: (taskId: string, status: TaskStatus) => void;
};

function SyllabusView({ device, onDeleteTask, onTaskStatusChange }: SyllabusViewProps) {
  const subjects = Object.values(device.localState.syllabus.subjectsById);

  return (
    <View style={styles.syllabusList}>
      {subjects.map((subject) => {
        const progress = getSubjectProgress(device.localState, subject);

        return (
          <View key={subject.subjectId} style={styles.subjectBlock}>
            <View style={styles.subjectHeader}>
              <Text style={styles.subjectTitle}>{subject.title}</Text>
              <Text style={styles.progressText}>{progress.percent}%</Text>
            </View>
            {subject.chapterIds.map((chapterId: string) => {
              const chapter = device.localState.syllabus.chaptersById[chapterId];

              if (chapter === undefined) {
                return null;
              }

              const chapterProgress = getChapterProgress(device.localState, chapter);

              return (
                <View key={chapter.chapterId} style={styles.chapterBlock}>
                  <View style={styles.chapterHeader}>
                    <Text style={styles.chapterTitle}>{chapter.title}</Text>
                    <Text style={styles.progressText}>{chapterProgress.percent}%</Text>
                  </View>
                  {chapter.taskIds.map((taskId: string) => {
                    const task = device.localState.syllabus.tasksById[taskId];

                    if (task === undefined) {
                      return null;
                    }

                    return <TaskRow key={task.taskId} onDeleteTask={onDeleteTask} onTaskStatusChange={onTaskStatusChange} task={task} />;
                  })}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

type TaskRowProps = {
  task: StudyTask;
  onDeleteTask: (taskId: string) => void;
  onTaskStatusChange: (taskId: string, status: TaskStatus) => void;
};

function TaskRow({ task, onDeleteTask, onTaskStatusChange }: TaskRowProps) {
  return (
    <View style={styles.taskRow}>
      <View style={styles.taskTextBlock}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        <Text style={styles.taskStatus}>{formatTaskStatus(task.status)}</Text>
      </View>
      <View style={styles.taskActions}>
        <Pressable style={styles.compactButton} onPress={() => onTaskStatusChange(task.taskId, "not_started")}>
          <Text style={styles.compactButtonText}>Not</Text>
        </Pressable>
        <Pressable style={styles.compactButton} onPress={() => onTaskStatusChange(task.taskId, "in_progress")}>
          <Text style={styles.compactButtonText}>Doing</Text>
        </Pressable>
        <Pressable style={styles.compactButton} onPress={() => onTaskStatusChange(task.taskId, "done")}>
          <Text style={styles.compactButtonText}>Done</Text>
        </Pressable>
        <Pressable style={styles.deleteTaskButton} onPress={() => onDeleteTask(task.taskId)}>
          <Text style={styles.deleteTaskButtonText}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function updateElapsedSeconds(activeFocusSession: ActiveFocusSession): ActiveFocusSession {
  const elapsedSeconds = Math.floor((Date.now() - activeFocusSession.startedAtEpochMs) / 1000);

  return {
    ...activeFocusSession,
    elapsedSeconds: Math.max(activeFocusSession.elapsedSeconds, elapsedSeconds)
  };
}

function parseTargetSeconds(value: string): number | null {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function formatDeviceName(deviceId: DeviceId): string {
  return deviceId === "device-a" ? "Device A" : "Device B";
}

function formatTaskStatus(status: StudyTask["status"]): string {
  if (status === "not_started") {
    return "Not started";
  }

  if (status === "in_progress") {
    return "In progress";
  }

  return "Done";
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#f6f7f9"
  },
  pageContent: {
    gap: 16,
    padding: 20
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  title: {
    color: "#172033",
    fontSize: 28,
    fontWeight: "700"
  },
  subtitle: {
    color: "#586174",
    fontSize: 14,
    marginTop: 4
  },
  headerActions: {
    flexDirection: "row",
    gap: 8
  },
  serverPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#d9dee8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14
  },
  deviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16
  },
  devicePanel: {
    backgroundColor: "#ffffff",
    borderColor: "#d9dee8",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 14,
    minWidth: 360,
    padding: 14
  },
  deviceHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  },
  deviceTitle: {
    color: "#172033",
    fontSize: 20,
    fontWeight: "700"
  },
  storageKey: {
    color: "#687386",
    fontSize: 12,
    marginTop: 3
  },
  statusToggle: {
    alignItems: "center",
    borderRadius: 6,
    minWidth: 76,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  onlineToggle: {
    backgroundColor: "#176c48"
  },
  offlineToggle: {
    backgroundColor: "#9d3a2f"
  },
  statusToggleText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700"
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  metric: {
    backgroundColor: "#eef1f6",
    borderRadius: 6,
    minWidth: 82,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  metricValue: {
    color: "#172033",
    fontSize: 18,
    fontWeight: "700"
  },
  metricLabel: {
    color: "#586174",
    fontSize: 11,
    marginTop: 2,
    textTransform: "uppercase"
  },
  section: {
    borderTopColor: "#e5e8ef",
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 12
  },
  sectionTitle: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "700"
  },
  mutedText: {
    color: "#687386",
    fontSize: 13
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#225ea8",
    borderRadius: 6,
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#dde4ef",
    borderRadius: 6,
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  secondaryButtonText: {
    color: "#172033",
    fontSize: 14,
    fontWeight: "700"
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#ffe3df",
    borderRadius: 6,
    minWidth: 80,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  dangerButtonText: {
    color: "#8d2e24",
    fontSize: 14,
    fontWeight: "700"
  },
  compactButton: {
    alignItems: "center",
    backgroundColor: "#dde4ef",
    borderRadius: 6,
    minWidth: 58,
    paddingHorizontal: 8,
    paddingVertical: 7
  },
  compactButtonText: {
    color: "#172033",
    fontSize: 12,
    fontWeight: "700"
  },
  deleteTaskButton: {
    alignItems: "center",
    backgroundColor: "#ffe3df",
    borderRadius: 6,
    minWidth: 64,
    paddingHorizontal: 8,
    paddingVertical: 7
  },
  deleteTaskButtonText: {
    color: "#8d2e24",
    fontSize: 12,
    fontWeight: "700"
  },
  focusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  durationInput: {
    backgroundColor: "#ffffff",
    borderColor: "#ccd3df",
    borderRadius: 6,
    borderWidth: 1,
    color: "#172033",
    minWidth: 80,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  syllabusList: {
    gap: 12
  },
  subjectBlock: {
    gap: 8
  },
  subjectHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  subjectTitle: {
    color: "#172033",
    fontSize: 15,
    fontWeight: "700"
  },
  chapterBlock: {
    borderColor: "#e4e8f0",
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
    padding: 8
  },
  chapterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  chapterTitle: {
    color: "#293449",
    fontSize: 14,
    fontWeight: "700"
  },
  progressText: {
    color: "#225ea8",
    fontSize: 13,
    fontWeight: "700"
  },
  taskRow: {
    alignItems: "center",
    borderTopColor: "#edf0f5",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 42,
    paddingTop: 6
  },
  taskTextBlock: {
    flex: 1,
    minWidth: 190
  },
  taskTitle: {
    color: "#354055",
    fontSize: 13
  },
  taskStatus: {
    color: "#586174",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2
  },
  taskActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  }
});
