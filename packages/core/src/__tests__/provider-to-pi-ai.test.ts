import { describe, it, expect } from "vitest";
import { resolvePiAiProvider } from "../llm/providers/provider-to-pi-ai.js";
import { getEndpoint } from "../llm/providers/index.js";

describe("resolvePiAiProvider (R3)", () => {
  it("zhipu 显式映射到 zai（pi-ai 识别不到 open.bigmodel.cn）", () => {
    const ep = getEndpoint("zhipu");
    expect(ep).toBeDefined();
    expect(resolvePiAiProvider(ep!)).toBe("zai");
  });

  it("openrouter 显式映射到 openrouter", () => {
    const ep = getEndpoint("openrouter");
    expect(ep).toBeDefined();
    expect(resolvePiAiProvider(ep!)).toBe("openrouter");
  });

  it("githubCopilot 显式映射到 githubCopilot", () => {
    const ep = getEndpoint("githubCopilot");
    expect(ep).toBeDefined();
    expect(resolvePiAiProvider(ep!)).toBe("githubCopilot");
  });

  it("anthropic-messages 协议统一映射到 anthropic（anthropic / minimax / bailian / xxxCodingPlan）", () => {
    for (const id of [
      "anthropic",
      "minimax",
      "bailian",
      "kimiCodingPlan",
      "minimaxCodingPlan",
      "bailianCodingPlan",
      "glmCodingPlan",
      "volcengineCodingPlan",
      "opencodeCodingPlan",
    ]) {
      const ep = getEndpoint(id);
      expect(ep, `${id}`).toBeDefined();
      expect(resolvePiAiProvider(ep!), `${id}`).toBe("anthropic");
    }
  });

  it("其余 OpenAI 兼容默认映射到 openai（pi-ai 再按 baseUrl 嗅探 deepseek/xai/ollama 等）", () => {
    for (const id of ["deepseek", "qwen", "moonshot", "siliconcloud", "ppio", "mistral", "xai", "ollama", "google"]) {
      const ep = getEndpoint(id);
      expect(ep, `${id}`).toBeDefined();
      expect(resolvePiAiProvider(ep!), `${id}`).toBe("openai");
    }
  });

  it("openai-responses 默认映射到 openai（OpenAI 官方）", () => {
    const ep = getEndpoint("openai");
    expect(resolvePiAiProvider(ep!)).toBe("openai");
  });
});
