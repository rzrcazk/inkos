/**
 * 讯飞星火 (Spark)
 *
 * - 官网：https://xinghuo.xfyun.cn/
 * - 控制台 / API key：https://console.xfyun.cn/services/cbm
 * - API 文档：https://www.xfyun.cn/doc/spark/Web.html
 */
import type { InkosEndpoint } from "../types.js";

export const SPARK: InkosEndpoint = {
  id: "spark",
  label: "讯飞星火",
  api: "openai-completions",
  baseUrl: "https://spark-api-open.xf-yun.com/v1",
  checkModel: "general",
  temperatureRange: [0, 1],
  defaultTemperature: 0.5,
  writingTemperature: 0.95,
  models: [
    { id: "spark-x", maxOutput: 131072, contextWindowTokens: 131072, enabled: true },
    { id: "x1", maxOutput: 65535, contextWindowTokens: 65535 },
    { id: "lite", maxOutput: 4096, contextWindowTokens: 12288, enabled: true },
    { id: "generalv3", maxOutput: 8192, contextWindowTokens: 16384 },
    { id: "pro-128k", maxOutput: 131072, contextWindowTokens: 131072 },
    { id: "generalv3.5", maxOutput: 8192, contextWindowTokens: 16384 },
    { id: "max-32k", maxOutput: 32768, contextWindowTokens: 65536 },
    { id: "4.0Ultra", maxOutput: 32768, contextWindowTokens: 65536 },
  ],
};
