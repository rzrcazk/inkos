import type { PlanningMaterials } from "../utils/planning-materials.js";

export interface PlannerPromptInput {
  readonly chapterNumber: number;
  readonly targetChapters: number;
  readonly genreName: string;
  readonly language: "zh" | "en";
  readonly materials: PlanningMaterials;
}

/**
 * Phase 1 transitional planner prompts.
 *
 * The previous prompts instructed the LLM to output ChapterBrief JSON with
 * beat outlines, cycle phases, and hook agendas. Phase 3 (new.txt) will
 * replace these with a seven-section memo prompt. For now the planner runs
 * deterministically without invoking the LLM, so these prompts are unused —
 * kept only as stable exports for external tooling and future Phase 3 work.
 */
export function buildPlannerSystemPrompt(language: "zh" | "en"): string {
  if (language === "en") {
    return "You are the InkOS chapter planner. Produce a structured chapter memo.";
  }
  return "你是 InkOS 的章节规划器，产出结构化的章节备忘。";
}

export function buildPlannerUserPrompt(input: PlannerPromptInput): string {
  const { materials } = input;
  return [
    `## Chapter`,
    `${input.chapterNumber}/${input.targetChapters}`,
    "",
    "## Genre",
    input.genreName,
    "",
    "## Goal Seed",
    materials.outlineNode ?? "(no matched outline slice)",
    "",
    "## Author Intent",
    materials.authorIntent,
    "",
    "## Current Focus",
    materials.currentFocus,
    "",
    "## Current State",
    materials.currentState,
    "",
    "## Story Bible",
    materials.storyBible,
    "",
  ].join("\n");
}
