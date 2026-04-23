/**
 * DeepSeek
 *
 * - 官网：https://www.deepseek.com/
 * - 控制台：https://platform.deepseek.com/
 * - API key：https://platform.deepseek.com/api_keys
 * - API 文档：https://api-docs.deepseek.com/
 * - 模型列表：https://api-docs.deepseek.com/quick_start/pricing
 *
 * 官方 API 仅 2 个 id：deepseek-chat (V3.2 non-thinking) / deepseek-reasoner (V3.2 thinking)。
 * V4/R2 等新模型发布时会替换同 id 背后的底层模型（alias 模式），id 本身保持不变。
 */
import type { InkosEndpoint } from "../types.js";

export const DEEPSEEK: InkosEndpoint = {
  id: "deepseek",
  label: "DeepSeek",
  api: "openai-completions",
  baseUrl: "https://api.deepseek.com",
  checkModel: "deepseek-chat",
  temperatureRange: [0, 2],
  defaultTemperature: 1,
  writingTemperature: 1.5,
  temperatureHint: "创意写作推荐 1.5",
  models: [
    { id: "deepseek-chat", maxOutput: 8192, contextWindowTokens: 131072, enabled: true, releasedAt: "2025-12-01" },
    { id: "deepseek-reasoner", maxOutput: 65536, contextWindowTokens: 131072, enabled: true, releasedAt: "2025-12-01" },
  ],
};
