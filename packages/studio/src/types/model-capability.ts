export type QuotaLevel = "unlimited" | "sufficient" | "moderate" | "limited" | "scarce";

export const QUOTA_LEVEL_LABELS: Record<QuotaLevel, string> = {
  unlimited: "无限",
  sufficient: "充足",
  moderate: "一般",
  limited: "少量",
  scarce: "很少",
};

export const QUOTA_LEVEL_FACTOR: Record<QuotaLevel, number> = {
  unlimited: 1.0,
  sufficient: 0.75,
  moderate: 0.5,
  limited: 0.25,
  scarce: 0.1,
};

export interface ModelCapabilities {
  creative: number;
  reasoning: number;
  instruction: number;
  longContext: number;
  chinese: number;
}

export interface ModelCapabilityProfile {
  modelId: string;
  displayName?: string;
  provider?: string;
  contextWindow?: number | null;
  capabilities: ModelCapabilities;
  quotaLevel?: QuotaLevel;
  maxSlots?: number | null;
  notes?: string;
  analysisText?: string;
  source: "manual" | "analyzed";
  lastUpdated: string;
}
