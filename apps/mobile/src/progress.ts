import type { Chapter, StudentState, StudyTask, Subject } from "./types";

export type ProgressSummary = {
  completedTasks: number;
  totalTasks: number;
  percent: number;
};

export function getChapterProgress(state: StudentState, chapter: Chapter): ProgressSummary {
  const tasks = chapter.taskIds
    .map((taskId: string) => state.syllabus.tasksById[taskId])
    .filter((task: StudyTask | undefined): task is StudyTask => task !== undefined);

  return summarizeTasks(tasks);
}

export function getSubjectProgress(state: StudentState, subject: Subject): ProgressSummary {
  const tasks = subject.chapterIds.flatMap((chapterId: string) => {
    const chapter = state.syllabus.chaptersById[chapterId];

    if (chapter === undefined) {
      return [];
    }

    return chapter.taskIds
      .map((taskId: string) => state.syllabus.tasksById[taskId])
      .filter((task: StudyTask | undefined): task is StudyTask => task !== undefined);
  });

  return summarizeTasks(tasks);
}

function summarizeTasks(tasks: StudyTask[]): ProgressSummary {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task: StudyTask) => task.status === "done").length;
  const percent = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);

  return {
    completedTasks,
    totalTasks,
    percent
  };
}
