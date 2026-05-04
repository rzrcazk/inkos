import { describe, it, expect } from "vitest";
import { lookupModel, listEnabledModels } from "../llm/providers/lookup.js";

describe("lookupModel", () => {
  describe("Layer 1（已知 provider 精确查）", () => {
    it("anthropic 下 claude-sonnet-4-6 命中 provider.models", () => {
      const hit = lookupModel("anthropic", "claude-sonnet-4-6");
      expect(hit).toBeDefined();
      expect(hit?.maxOutput).toBe(64_000);
      expect(hit?.contextWindowTokens).toBe(1_000_000);
    });

    it("openai 下 gpt-4o 命中", () => {
      const hit = lookupModel("openai", "gpt-4o");
      expect(hit).toBeDefined();
      expect(hit?.maxOutput).toBe(4096);
      expect(hit?.contextWindowTokens).toBe(128_000);
    });

    it("大小写不敏感", () => {
      const hit = lookupModel("anthropic", "CLAUDE-SONNET-4-6");
      expect(hit?.maxOutput).toBe(64_000);
    });
  });

  describe("Layer 2（全局扫按优先级）", () => {
    it("custom 下 gpt-4o 命中 openai provider", () => {
      const hit = lookupModel("custom", "gpt-4o");
      expect(hit?.maxOutput).toBe(4096);
    });

    it("custom 下 claude-sonnet-4-6 命中 anthropic provider", () => {
      const hit = lookupModel("custom", "claude-sonnet-4-6");
      expect(hit?.maxOutput).toBe(64_000);
    });

    it("未知 id 返回 undefined", () => {
      const hit = lookupModel("custom", "my-private-llm-does-not-exist");
      expect(hit).toBeUndefined();
    });
  });

  describe("Layer 2 优先级排序（B 组之后会覆盖更多场景）", () => {
    it("当同 id 在多个 provider 都存在时按 PROVIDER_PRIORITY 排序", () => {
      const hit = lookupModel("custom", "deepseek-chat");
      expect(hit?.maxOutput).toBeGreaterThan(0);
    });
  });
});

describe("Layer 2 优先级（B5：PPIO vs OpenRouter 同 id）", () => {
  it("deepseek/deepseek-r1-0528 在 PPIO 和 OpenRouter 都有，按 PROVIDER_PRIORITY 取 ppio（第二梯队）而不是 openrouter（第三梯队）", () => {
    const hit = lookupModel("custom", "deepseek/deepseek-r1-0528");
    expect(hit).toBeDefined();
    // PPIO 的 maxOutput 是 65536（reasoner），OpenRouter 的是 4096
    expect(hit?.maxOutput).toBe(65536);
  });

  it("OpenRouter 专属带后缀 id（:free）命中 openrouter provider", () => {
    const hit = lookupModel("custom", "google/gemma-2-9b-it:free");
    expect(hit).toBeDefined();
    expect(hit?.maxOutput).toBe(4096);
  });

  it("PPIO 专属带斜线 id 命中 ppio provider", () => {
    const hit = lookupModel("ppio", "deepseek/deepseek-v3.2");
    expect(hit?.maxOutput).toBe(8192);
    expect(hit?.contextWindowTokens).toBe(131072);
  });
});

describe("listEnabledModels", () => {
  it("返回 provider 里 enabled !== false 的 models", () => {
    const models = listEnabledModels("anthropic");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.enabled !== false)).toBe(true);
  });

  it("未知 service 返回空数组", () => {
    const models = listEnabledModels("nope");
    expect(models).toEqual([]);
  });
});

describe("listEnabledModels with selectedModels", () => {
  it("非空 selectedModels 返回过滤后的子集", () => {
    const models = listEnabledModels("bailianCodingPlan", {
      selectedModels: ["qwen3.6-plus"],
    });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("qwen3.6-plus");
  });

  it("空 selectedModels 返回全部（向后兼容）", () => {
    const withFilter = listEnabledModels("bailianCodingPlan", { selectedModels: [] });
    const withoutFilter = listEnabledModels("bailianCodingPlan");
    expect(withFilter).toHaveLength(withoutFilter.length);
  });

  it("undefined selectedModels 返回全部（向后兼容）", () => {
    const withFilter = listEnabledModels("bailianCodingPlan", { selectedModels: undefined });
    const withoutFilter = listEnabledModels("bailianCodingPlan");
    expect(withFilter).toHaveLength(withoutFilter.length);
  });

  it("自定义模型 ID 返回合成 stub", () => {
    const models = listEnabledModels("bailianCodingPlan", {
      selectedModels: ["my-fine-tuned-model"],
    });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("my-fine-tuned-model");
    expect(models[0].maxOutput).toBe(24_576);
    expect(models[0].contextWindowTokens).toBe(128_000);
    expect(models[0].capabilities?.text).toBe(true);
  });

  it("bank 模型 + 自定义模型混合返回", () => {
    const models = listEnabledModels("bailianCodingPlan", {
      selectedModels: ["qwen3.6-plus", "my-custom-model"],
    });
    expect(models).toHaveLength(2);
    expect(models.find((m) => m.id === "qwen3.6-plus")).toBeDefined();
    expect(models.find((m) => m.id === "my-custom-model")).toBeDefined();
  });

  it("选中的 disabled 模型不返回", () => {
    // anthropic 的 claude-sonnet-4-6 是 enabled !== false
    const models = listEnabledModels("anthropic", {
      selectedModels: ["nonexistent-disabled-model"],
    });
    // nonexistent IDs that are not in the bank get synthetic stubs (enabled: true)
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("nonexistent-disabled-model");
  });
});
