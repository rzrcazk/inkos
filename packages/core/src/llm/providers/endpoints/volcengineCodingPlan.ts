/**
 * 火山 CodingPlan (豆包 coding)
 *
 * - 官网：https://www.volcengine.com/product/ark
 * - 火山方舟针对编程场景的 Doubao 模型套餐。
 */
import type { InkosEndpoint } from "../types.js";

export const VOLCENGINE_CODING_PLAN: InkosEndpoint = {
  id: "volcengineCodingPlan",
  label: "火山 Coding Plan",
  api: "anthropic-messages",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3/anthropic",
  checkModel: "doubao-seed-code",
  temperatureRange: [0, 1],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "doubao-seed-code", maxOutput: 32000, contextWindowTokens: 256000, enabled: true, releasedAt: "2025-11-01", deploymentName: "doubao-seed-code-preview-251028" },
    { id: "doubao-seed-2.0-code", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15", deploymentName: "doubao-seed-2-0-code-preview-260215" },
    { id: "doubao-seed-2.0-pro", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15", deploymentName: "doubao-seed-2-0-pro-260215" },
    { id: "doubao-seed-2.0-lite", maxOutput: 128000, contextWindowTokens: 256000, enabled: true, releasedAt: "2026-02-15", deploymentName: "doubao-seed-2-0-lite-260215" },
    { id: "MiniMax-M2.5", maxOutput: 131072, contextWindowTokens: 204800, enabled: true, releasedAt: "2026-02-12" },
    { id: "glm-4.7", maxOutput: 131072, contextWindowTokens: 200000, enabled: true, releasedAt: "2025-12-01" },
    { id: "deepseek-v3.2", maxOutput: 65536, contextWindowTokens: 262144, enabled: true, releasedAt: "2025-12-01" },
    { id: "kimi-k2.5", maxOutput: 32768, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-01-27" },
  ],
};
