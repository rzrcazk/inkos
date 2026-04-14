import { relative } from "node:path";
import type { PlanChapterOutput } from "../agents/planner.js";

/**
 * Phase 1: persisted governed plans are disabled.
 *
 * The previous implementation serialized ChapterBrief/HookAgenda into the
 * intent markdown, but those schemas no longer exist. Rather than write a
 * migration, we return null so the pipeline regenerates the plan from scratch.
 * Phase 3 will introduce a new memo-based persistence format if needed.
 */
export async function loadPersistedPlan(
  _bookDir: string,
  _chapterNumber: number,
): Promise<PlanChapterOutput | null> {
  return null;
}

export function relativeToBookDir(bookDir: string, absolutePath: string): string {
  return relative(bookDir, absolutePath).replaceAll("\\", "/");
}
