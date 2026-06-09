import type { Chapter, StudentState, StudyTask, Subject, SyllabusState } from "./types";

const STUDENT_ID = "student-001";
const SEED_VERSION = "seed:0";

export function createDefaultStudentState(): StudentState {
  return {
    studentId: STUDENT_ID,
    focus: {
      sessionsById: {},
      rewardEventsById: {},
      coins: 0,
      streakDays: 0,
      focusMinutesByDay: {}
    },
    syllabus: createSeedSyllabus(),
    sync: {
      serverVersion: 0,
      processedOperationIds: {},
      acceptedOperations: []
    },
    notifications: {
      notificationEventsById: {}
    }
  };
}

function createSeedSyllabus(): SyllabusState {
  const subjectsById: Record<string, Subject> = {
    "subject-math": {
      subjectId: "subject-math",
      title: "Mathematics",
      chapterIds: ["chapter-linear-equations", "chapter-triangles"]
    },
    "subject-science": {
      subjectId: "subject-science",
      title: "Science",
      chapterIds: ["chapter-motion", "chapter-atoms"]
    }
  };

  const chaptersById: Record<string, Chapter> = {
    "chapter-linear-equations": {
      chapterId: "chapter-linear-equations",
      subjectId: "subject-math",
      title: "Linear Equations",
      taskIds: ["task-linear-equations-1", "task-linear-equations-2"]
    },
    "chapter-triangles": {
      chapterId: "chapter-triangles",
      subjectId: "subject-math",
      title: "Triangles",
      taskIds: ["task-triangles-1", "task-triangles-2"]
    },
    "chapter-motion": {
      chapterId: "chapter-motion",
      subjectId: "subject-science",
      title: "Motion",
      taskIds: ["task-motion-1", "task-motion-2"]
    },
    "chapter-atoms": {
      chapterId: "chapter-atoms",
      subjectId: "subject-science",
      title: "Atoms And Molecules",
      taskIds: ["task-atoms-1", "task-atoms-2"]
    }
  };

  const tasksById: Record<string, StudyTask> = {
    "task-linear-equations-1": createTask("task-linear-equations-1", "chapter-linear-equations", "Solve one-variable equations"),
    "task-linear-equations-2": createTask("task-linear-equations-2", "chapter-linear-equations", "Practice word problems"),
    "task-triangles-1": createTask("task-triangles-1", "chapter-triangles", "Review triangle congruence"),
    "task-triangles-2": createTask("task-triangles-2", "chapter-triangles", "Complete similarity exercises"),
    "task-motion-1": createTask("task-motion-1", "chapter-motion", "Read distance-time graphs"),
    "task-motion-2": createTask("task-motion-2", "chapter-motion", "Solve speed numericals"),
    "task-atoms-1": createTask("task-atoms-1", "chapter-atoms", "Revise atomic structure"),
    "task-atoms-2": createTask("task-atoms-2", "chapter-atoms", "Practice mole concept basics")
  };

  return {
    subjectsById,
    chaptersById,
    tasksById,
    taskTombstonesById: {}
  };
}

function createTask(taskId: string, chapterId: string, title: string): StudyTask {
  return {
    taskId,
    chapterId,
    title,
    status: "not_started",
    statusVersion: SEED_VERSION,
    statusBaseVersion: SEED_VERSION,
    isDeleted: false
  };
}
