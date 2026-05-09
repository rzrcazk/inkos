import { useMemo } from "react";
import type { ServiceInfo } from "../store/service/types";
import type { ModelCapabilityProfile, ModelCapabilities } from "../types/model-capability";
import { QUOTA_LEVEL_FACTOR } from "../types/model-capability";

interface ModelLike {
  readonly id: string;
  readonly name?: string;
}

export interface RoutingRecommendation {
  agentKey: string;
  reasonKey: string;
  modelId: string;
  serviceName: string;
  tierKey: string;
  isFallback: boolean;
}

// Weights per agent: how much each capability dimension matters (0 = ignored)
const AGENT_WEIGHTS: Record<string, ModelCapabilities> = {
  writer:                { creative: 3, reasoning: 1, instruction: 2, longContext: 2, chinese: 2 },
  architect:             { creative: 1, reasoning: 3, instruction: 2, longContext: 1, chinese: 1 },
  "foundation-reviewer": { creative: 0, reasoning: 3, instruction: 3, longContext: 2, chinese: 1 },
  auditor:               { creative: 0, reasoning: 3, instruction: 3, longContext: 3, chinese: 2 },
  reviser:               { creative: 2, reasoning: 2, instruction: 2, longContext: 2, chinese: 2 },
  planner:               { creative: 1, reasoning: 3, instruction: 2, longContext: 1, chinese: 2 },
  "chapter-analyzer":    { creative: 1, reasoning: 3, instruction: 2, longContext: 2, chinese: 2 },
  polisher:              { creative: 3, reasoning: 1, instruction: 2, longContext: 1, chinese: 3 },
  "state-validator":     { creative: 0, reasoning: 2, instruction: 3, longContext: 1, chinese: 1 },
  "length-normalizer":   { creative: 1, reasoning: 1, instruction: 3, longContext: 2, chinese: 1 },
  "fanfic-canon-importer":{ creative: 1, reasoning: 2, instruction: 3, longContext: 2, chinese: 2 },
  radar:                 { creative: 1, reasoning: 2, instruction: 2, longContext: 1, chinese: 1 },
};

const REASON_KEY_MAP: Record<string, string> = {
  writer: "writer",
  architect: "architect",
  auditor: "auditor",
  reviser: "reviser",
  planner: "planner",
  "chapter-analyzer": "chapterAnalyzer",
  radar: "radar",
  "foundation-reviewer": "foundationReviewer",
  "fanfic-canon-importer": "fanficCanonImporter",
  polisher: "polisher",
  "state-validator": "stateValidator",
  "length-normalizer": "lengthNormalizer",
};

function scoreModel(profile: ModelCapabilityProfile, weights: ModelCapabilities): number {
  const capabilityScore = (Object.keys(weights) as Array<keyof ModelCapabilities>)
    .reduce((sum, dim) => sum + (profile.capabilities[dim] ?? 5) * weights[dim], 0);

  // Quota multiplier: amplifies or suppresses effective score based on available quota.
  // More quota → score amplified (承接更多任务); scarce quota → score suppressed
  // (只在能力差距大到压不住时才出来). Default moderate (0.5) if not set.
  const quotaFactor = QUOTA_LEVEL_FACTOR[profile.quotaLevel ?? "moderate"];

  return capabilityScore * quotaFactor;
}

/**
 * Smart routing: assign each agent a recommended model based on capability
 * profiles and agent-specific dimension weights.
 *
 * Models without a capability profile fall back to a default score of 5 on
 * all dimensions (treated as a generic capable model).
 */
export function useSmartRouting(
  connectedServices: ServiceInfo[],
  modelsByService: Record<string, ReadonlyArray<ModelLike>>,
  defaultModel: string,
  defaultService: string,
  capabilityProfiles: ModelCapabilityProfile[] = [],
): RoutingRecommendation[] {
  return useMemo(() => {
    const profileMap = new Map(capabilityProfiles.map((p) => [p.modelId, p]));

    // Build list of all available models across connected services
    const available = connectedServices
      .filter((s) => s.connected && s.enabled !== false)
      .flatMap((svc) =>
        (modelsByService[svc.service] ?? []).map((m) => ({
          id: m.id,
          service: svc.service,
          label: svc.label,
        })),
      );

    const agentKeys = Object.keys(AGENT_WEIGHTS);
    const result: RoutingRecommendation[] = [];
    // Track how many agents each model has been assigned
    const assignedCount = new Map<string, number>();

    for (const agentKey of agentKeys) {
      const weights = AGENT_WEIGHTS[agentKey];
      if (!weights) continue;

      if (available.length === 0) {
        result.push({
          agentKey,
          reasonKey: REASON_KEY_MAP[agentKey] ?? agentKey,
          modelId: defaultModel || "—",
          serviceName: connectedServices.find((s) => s.service === defaultService)?.label ?? "",
          tierKey: "fallback",
          isFallback: true,
        });
        continue;
      }

      const defaultProfile = { modelId: "", capabilities: { creative: 5, reasoning: 5, instruction: 5, longContext: 5, chinese: 5 }, source: "manual" as const, lastUpdated: "" };

      // Filter to models within their slot budget, fall back to all if none qualify
      const withinBudget = available.filter((m) => {
        const profile = profileMap.get(m.id);
        const maxSlots = profile?.maxSlots ?? null;
        if (maxSlots == null) return true;
        return (assignedCount.get(m.id) ?? 0) < maxSlots;
      });
      const candidates = withinBudget.length > 0 ? withinBudget : available;

      const scored = candidates.map((m) => {
        const profile = profileMap.get(m.id);
        const baseScore = scoreModel(profile ?? { ...defaultProfile, modelId: m.id }, weights);
        return { ...m, score: baseScore, hasProfile: Boolean(profile) };
      });

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0]!;
      assignedCount.set(best.id, (assignedCount.get(best.id) ?? 0) + 1);

      result.push({
        agentKey,
        reasonKey: REASON_KEY_MAP[agentKey] ?? agentKey,
        modelId: best.id,
        serviceName: best.label,
        tierKey: best.hasProfile ? "profile" : "generic",
        isFallback: false,
      });
    }

    return result;
  }, [connectedServices, modelsByService, defaultModel, defaultService, capabilityProfiles]);
}
