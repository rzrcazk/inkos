import { useMemo } from "react";
import type { ServiceInfo, ModelInfo } from "../store/service/types";

export interface RoutingRecommendation {
  agentKey: string;
  reasonKey: string;
  modelId: string;
  serviceName: string;
  tierKey: string;
  isFallback: boolean;
}

interface TierRule {
  tierKey: string;
  modelMatch: (modelId: string) => boolean;
  agentKeys: string[];
}

/**
 * Smart routing: assign each agent a recommended model based on connected
 * services and tier rules. Pure display — no actual routing is performed.
 *
 * Distributes models within each tier to avoid all agents getting the same model.
 */
export function useSmartRouting(
  connectedServices: ServiceInfo[],
  modelsByService: Record<string, ReadonlyArray<ModelInfo>>,
  defaultModel: string,
  defaultService: string,
): RoutingRecommendation[] {
  const agentMap = useMemo(() => {
    // Tier rules ordered from best → cheapest.
    // Models are matched by ID substring.
    const tiers: TierRule[] = [
      {
        tierKey: "top",
        modelMatch: (id) => {
          const lo = id.toLowerCase();
          return lo.includes("claude") && (lo.includes("opus") || lo.includes("sonnet"));
        },
        agentKeys: ["writer", "architect", "foundation-reviewer"],
      },
      {
        tierKey: "high",
        modelMatch: (id) =>
          id.toLowerCase().includes("minimax") ||
          id.toLowerCase().startsWith("minimax-"),
        agentKeys: ["auditor", "reviser"],
      },
      {
        tierKey: "midhigh",
        modelMatch: (id) => {
          const lo = id.toLowerCase();
          return (
            lo.includes("qwen3.6") ||
            lo.includes("qwen3-max") ||
            lo.includes("qwen-plus") ||
            lo.startsWith("glm-5") ||
            lo.startsWith("glm-4.5") ||
            lo.includes("kimi-k2")
          );
        },
        agentKeys: ["planner", "chapter-analyzer", "fanfic-canon-importer", "polisher", "state-validator", "length-normalizer"],
      },
      {
        tierKey: "mid",
        modelMatch: (id) => {
          const lo = id.toLowerCase();
          return lo.includes("gemini") || lo.startsWith("gpt-");
        },
        agentKeys: ["radar"],
      },
    ];

    // Build a lookup: for each connected service, get enabled text models.
    const available = connectedServices
      .filter((s) => s.connected && s.enabled !== false)
      .flatMap((svc) =>
        (modelsByService[svc.service] ?? []).map((m) => ({
          ...m,
          service: svc.service,
          label: svc.label,
        })),
      );

    // Agent key → i18n reason key (camelCase for i18n lookup)
    const reasonKeyMap: Record<string, string> = {
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

    // Collect ALL matching models per tier (not just the first one).
    // Deduplicate by model ID so the same model from different services doesn't repeat.
    const tierModelMap = new Map<string, typeof available[number]>();
    for (const model of available) {
      for (const tier of tiers) {
        if (tier.modelMatch(model.id)) {
          tierModelMap.set(`${tier.tierKey}:${model.id}`, model);
        }
      }
    }

    const usedModels = new Set<string>();

    const result: RoutingRecommendation[] = [];

    for (const tier of tiers) {
      // Get all unique models for this tier
      const tierModels = [...tierModelMap.entries()]
        .filter(([key]) => key.startsWith(`${tier.tierKey}:`))
        .map(([, model]) => model);

      for (const agentKey of tier.agentKeys) {
        // Find first unused model; if all used, pick any
        let match = tierModels.find((m) => !usedModels.has(m.id));
        if (!match && tierModels.length > 0) {
          // All models in this tier are used — reuse the first one
          match = tierModels[0];
        }

        if (match) {
          usedModels.add(match.id);
          result.push({
            agentKey,
            reasonKey: reasonKeyMap[agentKey] ?? agentKey,
            modelId: match.id,
            serviceName: match.label,
            tierKey: tier.tierKey,
            isFallback: false,
          });
        } else {
          // Fallback to default model
          result.push({
            agentKey,
            reasonKey: reasonKeyMap[agentKey] ?? agentKey,
            modelId: defaultModel || "—",
            serviceName:
              (connectedServices.find(
                (s) => s.service === defaultService,
              )?.label ?? ""),
            tierKey: tier.tierKey,
            isFallback: true,
          });
        }
      }
    }

    return result;
  }, [connectedServices, modelsByService, defaultModel, defaultService]);

  return agentMap;
}
