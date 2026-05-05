import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEffectiveLLMConfig } from "../utils/effective-llm-config.js";

describe("resolveEffectiveLLMConfig", () => {
  let root = "";

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  async function writeProject(llm: Record<string, unknown>) {
    root = await mkdtemp(join(tmpdir(), "inkos-effective-llm-"));
    await writeFile(join(root, "inkos.json"), JSON.stringify({
      name: "effective-project",
      version: "0.1.0",
      language: "zh",
      llm,
      notify: [],
    }, null, 2), "utf-8");
  }

  async function writeSecrets(services: Record<string, { apiKey: string }>) {
    await mkdir(join(root, ".inkos"), { recursive: true });
    await writeFile(join(root, ".inkos", "secrets.json"), JSON.stringify({ services }, null, 2), "utf-8");
  }

  it("Studio consumer 使用 service 配置并从 secrets 获取 API key", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      provider: "custom",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.5",
      services: [{ service: "google", apiFormat: "chat", stream: true }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      requireApiKey: true,
    });

    expect(result.llm.configSource).toBe("studio");
    expect(result.diagnostics.configMode).toBe("studio-project");
    expect(result.llm.service).toBe("google");
    expect(result.llm.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("sk-google");
    expect(result.diagnostics.apiKeySource).toBe("studio-secret");
  });

  it("CLI 通过 --service 切换服务", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "moonshot", temperature: 1 }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({
      google: { apiKey: "sk-google" },
      moonshot: { apiKey: "sk-moon" },
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      cli: { service: "moonshot", model: "kimi-k2.5" },
    });

    expect(result.llm.service).toBe("moonshot");
    expect(result.llm.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(result.llm.model).toBe("kimi-k2.5");
    expect(result.llm.apiKey).toBe("sk-moon");
    expect(result.diagnostics.serviceSource).toBe("cli");
    expect(result.diagnostics.modelSource).toBe("cli");
  });

  it("默认使用第一个 service", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
    });

    expect(result.llm.service).toBe("google");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("sk-google");
  });

  it("CLI --service 覆盖会切换到目标 service 的 endpoint 默认值", async () => {
    await writeProject({
      configSource: "studio",
      service: "moonshot",
      provider: "custom",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.5",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      cli: {
        service: "google",
        model: "gemini-2.5-flash",
      },
      requireApiKey: false,
    });

    expect(result.llm.service).toBe("google");
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(result.llm.apiFormat).toBe("chat");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("");
  });

  it("CLI transport 覆盖", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google", apiFormat: "chat", stream: true }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      cli: {
        apiFormat: "responses",
        stream: false,
      },
    });

    expect(result.llm.apiFormat).toBe("responses");
    expect(result.llm.stream).toBe(false);
  });

  it("CLI override 优先级高于 project 配置", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "zhipu" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" }, zhipu: { apiKey: "sk-zhipu" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      cli: { service: "zhipu", model: "glm-4-flash" },
    });

    expect(result.llm.service).toBe("zhipu");
    expect(result.llm.model).toBe("glm-4-flash");
    expect(result.llm.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(result.diagnostics.serviceSource).toBe("cli");
    expect(result.diagnostics.modelSource).toBe("cli");
  });

  it("CLI 指定 service 时不会继承旧配置的 baseUrl/model/apiKey", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "moonshot" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" }, moonshot: { apiKey: "sk-moon" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      cli: { service: "google" },
    });

    expect(result.llm.service).toBe("google");
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(result.llm.model).toBe("gemini-2.5-flash");
    expect(result.llm.apiKey).toBe("sk-google");
    expect(result.diagnostics.serviceSource).toBe("cli");
    expect(result.diagnostics.modelSource).toBe("project");
    expect(result.diagnostics.apiKeySource).toBe("studio-secret");
  });

  it("拒绝不属于最终 service 的模型", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }],
      defaultModel: "gemini-2.5-flash",
    });
    await writeSecrets({ google: { apiKey: "sk-google" } });

    await expect(resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      cli: { model: "kimi-k2.5" },
    })).rejects.toThrow(/模型.*kimi-k2\.5.*不属于.*google/);
  });

  it("CLI env 指向 Ollama 时允许用户本地安装的动态模型", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }, { service: "ollama" }],
      defaultModel: "gemini-2.5-flash",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: {
        global: {
          INKOS_LLM_SERVICE: "ollama",
          INKOS_LLM_PROVIDER: "openai",
          INKOS_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
          INKOS_LLM_MODEL: "qwen3.6:35b-a3b",
        },
        project: {},
        process: {},
      },
      requireApiKey: false,
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.provider).toBe("openai");
    expect(result.llm.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(result.llm.model).toBe("qwen3.6:35b-a3b");
    expect(result.llm.apiKey).toBe("");
  });

  it("CLI 使用 Studio Ollama 配置时保留不在内置 bank 的默认模型", async () => {
    await writeProject({
      configSource: "studio",
      service: "ollama",
      services: [{ service: "ollama", apiFormat: "chat", stream: true }],
      defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
      requireApiKey: false,
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.llm.model).toBe("Qwen3.6-35B-A3B-APEX-I-Mini.gguf");
  });

  it("CLI 建书路径使用 Studio Ollama 配置时不要求 API key", async () => {
    await writeProject({
      configSource: "studio",
      service: "ollama",
      services: [{ service: "ollama", apiFormat: "chat", stream: false }],
      defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.llm.model).toBe("Qwen3.6-35B-A3B-APEX-I-Mini.gguf");
    expect(result.llm.apiKey).toBe("");
  });

  it("Studio 建书路径使用 Studio Ollama 配置时不要求 API key", async () => {
    await writeProject({
      configSource: "studio",
      service: "ollama",
      services: [{ service: "ollama", apiFormat: "chat", stream: false }],
      defaultModel: "Qwen3.6-35B-A3B-APEX-I-Mini.gguf",
    });

    const result = await resolveEffectiveLLMConfig({
      consumer: "studio",
      projectRoot: root,
      envLayers: { global: {}, project: {}, process: {} },
    });

    expect(result.llm.service).toBe("ollama");
    expect(result.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.llm.model).toBe("Qwen3.6-35B-A3B-APEX-I-Mini.gguf");
    expect(result.llm.apiKey).toBe("");
  });

  it("从 provider bank 应用 service transport 默认值", async () => {
    await writeProject({
      configSource: "studio",
      service: "minimaxCodingPlan",
      services: [{ service: "minimaxCodingPlan" }],
      defaultModel: "MiniMax-M2.7",
    });
    await writeSecrets({ minimaxCodingPlan: { apiKey: "sk-minimax" } });

    const result = await resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
    });

    expect(result.llm.service).toBe("minimaxCodingPlan");
    expect(result.llm.stream).toBe(false);
  });

  it("没有 API key 且 requireApiKey 为 true 时抛出错误", async () => {
    await writeProject({
      configSource: "studio",
      service: "google",
      services: [{ service: "google" }],
      defaultModel: "gemini-2.5-flash",
    });

    await expect(resolveEffectiveLLMConfig({
      consumer: "cli",
      projectRoot: root,
      requireApiKey: true,
    })).rejects.toThrow(/Studio LLM API key not set/);
  });
});
