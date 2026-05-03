/**
 * 百炼 CodingPlan (通义灵码订阅)
 *
 * - 官网：https://tongyi.aliyun.com/lingma
 * - 订阅套餐，非即用即付。具体模型取决于套餐权益。
 * - 模型列表：https://help.aliyun.com/zh/model-studio/coding-plan
 */
import type { InkosEndpoint } from "../types.js";

export const BAILIAN_CODING_PLAN: InkosEndpoint = {
  id: "bailianCodingPlan",
  label: "百炼 Coding Plan",
  group: "codingPlan",
  api: "anthropic-messages",
  baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
  checkModel: "qwen3.6-plus",
  temperatureRange: [0, 2],
  defaultTemperature: 0.7,
  writingTemperature: 1,
  models: [
    { id: "qwen3.6-plus", maxOutput: 65536, contextWindowTokens: 1000000, enabled: true, releasedAt: "2026-04-09" },
    { id: "kimi-k2.5", maxOutput: 32768, contextWindowTokens: 262144, enabled: true, releasedAt: "2026-01-27", temperature: 1 },
    { id: "glm-5", maxOutput: 131072, contextWindowTokens: 200000, enabled: true, releasedAt: "2026-02-12" },
  ],
};
