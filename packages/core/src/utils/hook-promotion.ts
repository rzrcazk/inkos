/**
 * Phase 7 — hook promotion rules.
 *
 * Architect produces a pool of hook seeds (every row in the initial
 * pending_hooks table is conceptually a seed). Not every seed belongs in
 * the live `pending_hooks.md` ledger — pushing all of them there turns the
 * ledger into noise within a few chapters.
 *
 * A seed is *promoted* into the ledger when any of these four conditions
 * holds. The consolidator (maintains pending_hooks.md post-chapter) calls
 * `shouldPromoteHook` for every tracked seed, and the ledger retains only
 * the hooks that cross the threshold.
 *
 *   1. cross_volume — the hook spans volume boundaries. It either pays off
 *      in a later volume, or depends on hooks declared in a later volume.
 *   2. advanced_count >= 2 — the hook has been advanced/pushed in two or
 *      more chapters since planting, proving readers already track it.
 *   3. depends_on non-empty — the hook has upstream causal dependencies
 *      worth tracking, even if it hasn't been touched recently.
 *   4. core_hook === true — architect marked this hook as main-line
 *      load-bearing; it always belongs in the ledger.
 */

import type { StoredHook } from "../state/memory-db.js";

export interface VolumeBoundary {
  readonly name: string;
  readonly startCh: number;
  readonly endCh: number;
}

export interface PromotionContext {
  /** Volume boundaries parsed from outline/volume_map.md, ordered by startCh. */
  readonly volumeBoundaries: ReadonlyArray<VolumeBoundary>;
  /** Current chapter number (0 at book creation). */
  readonly currentChapter: number;
  /** Hook id -> advanced count (how many chapters advanced this hook since planting). */
  readonly advancedCounts: ReadonlyMap<string, number>;
  /**
   * Hook id -> start chapter lookup for every seed (including unpromoted ones).
   * Used to tell whether a `depends_on` target is declared in a later volume.
   */
  readonly allSeedStartChapters: ReadonlyMap<string, number>;
}

export interface PromotionDecision {
  readonly promote: boolean;
  readonly reasons: ReadonlyArray<PromotionReason>;
}

export type PromotionReason =
  | "cross_volume"
  | "advanced_count"
  | "depends_on"
  | "core_hook";

export function shouldPromoteHook(
  hook: StoredHook,
  context: PromotionContext,
): PromotionDecision {
  const reasons: PromotionReason[] = [];

  if (hook.coreHook === true) {
    reasons.push("core_hook");
  }

  if ((hook.dependsOn?.length ?? 0) > 0) {
    reasons.push("depends_on");
  }

  const advancedCount = hook.advancedCount
    ?? context.advancedCounts.get(hook.hookId)
    ?? 0;
  if (advancedCount >= 2) {
    reasons.push("advanced_count");
  }

  if (isCrossVolume(hook, context)) {
    reasons.push("cross_volume");
  }

  return {
    promote: reasons.length > 0,
    reasons,
  };
}

function isCrossVolume(hook: StoredHook, context: PromotionContext): boolean {
  const { volumeBoundaries, allSeedStartChapters } = context;
  if (volumeBoundaries.length < 2) return false;

  const seedVolumeIndex = findVolumeIndex(volumeBoundaries, hook.startChapter);
  if (seedVolumeIndex < 0) return false;

  // Case A: upstream hook is declared in a later volume than this seed.
  for (const upstreamId of hook.dependsOn ?? []) {
    const upstreamStart = allSeedStartChapters.get(upstreamId);
    if (upstreamStart === undefined) continue;
    const upstreamVolumeIndex = findVolumeIndex(volumeBoundaries, upstreamStart);
    if (upstreamVolumeIndex > seedVolumeIndex) return true;
  }

  // Case B: pays_off_in_arc mentions a different volume. We stay prose-friendly
  // and only detect obvious "第 N 卷" / "volume N" tokens. When parsing fails
  // we fall back to payoff timing heuristics.
  const arcVolumeIndex = extractVolumeIndexFromArc(hook.paysOffInArc ?? "");
  if (arcVolumeIndex !== null && arcVolumeIndex !== seedVolumeIndex) {
    return true;
  }

  // Case C: payoff timing marks it as endgame / slow-burn while the hook is
  // planted in an early volume — that alone qualifies as cross-volume.
  if (
    (hook.payoffTiming === "endgame" || hook.payoffTiming === "slow-burn")
    && seedVolumeIndex < volumeBoundaries.length - 1
  ) {
    return true;
  }

  return false;
}

function findVolumeIndex(
  boundaries: ReadonlyArray<VolumeBoundary>,
  chapter: number,
): number {
  for (let i = 0; i < boundaries.length; i++) {
    const vol = boundaries[i]!;
    if (chapter >= vol.startCh && chapter <= vol.endCh) return i;
  }
  // Chapter 0 (seed time) counts as volume 0 if volumes start at 1.
  if (chapter <= 0 && boundaries.length > 0) return 0;
  return -1;
}

const VOLUME_PATTERNS: ReadonlyArray<RegExp> = [
  /第\s*([一二三四五六七八九十百千\d]+)\s*卷/u,
  /volume\s+(\d+)/i,
  /vol\.?\s*(\d+)/i,
];

function extractVolumeIndexFromArc(arc: string): number | null {
  const trimmed = arc.trim();
  if (!trimmed) return null;

  for (const pattern of VOLUME_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const token = match[1] ?? "";
    const n = parseVolumeNumber(token);
    if (n !== null) return n - 1; // 1-indexed in prose, 0-indexed here.
  }
  return null;
}

const CHINESE_NUMERALS: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseVolumeNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  if (token.length === 1 && CHINESE_NUMERALS[token]) return CHINESE_NUMERALS[token]!;
  if (token === "十") return 10;
  return null;
}

/**
 * Derive the default half-life (in chapters) for a hook that did not set it
 * explicitly. Mirrors the prompt defaults: immediate/near-term = 10,
 * mid-arc = 30, slow-burn/endgame = 80. Unknown timing falls to mid-arc.
 */
export function defaultHalfLifeChapters(
  payoffTiming: StoredHook["payoffTiming"] | undefined,
): number {
  switch (payoffTiming) {
    case "immediate":
    case "near-term":
      return 10;
    case "slow-burn":
    case "endgame":
      return 80;
    case "mid-arc":
    default:
      return 30;
  }
}

export function resolveHalfLifeChapters(hook: StoredHook): number {
  return hook.halfLifeChapters ?? defaultHalfLifeChapters(hook.payoffTiming);
}
