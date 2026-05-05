/* ── Auto-init & environment detection for TUI ── */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import readline from "node:readline/promises";
import {
  c, bold, dim, italic,
  cyan, green, yellow, gray, red,
  brightCyan, brightGreen, brightWhite,
} from "./ansi.js";
import { resolveTuiLocale, type TuiLocale } from "./i18n.js";
import { loadConfig } from "../utils.js";
import { ensureProjectGitignore } from "../project-bootstrap.js";
import { loadSecrets, saveSecrets, loadGlobalSecrets, saveGlobalSecrets, type SecretsFile } from "@actalk/inkos-core";

const PROVIDERS = ["openai", "anthropic", "custom"] as const;
type SetupProvider = typeof PROVIDERS[number];

export function resolveSetupProvider(provider: string, baseUrl: string): SetupProvider {
  const normalizedProvider = PROVIDERS.includes(provider.trim() as SetupProvider)
    ? provider.trim() as SetupProvider
    : "openai";
  const normalizedUrl = baseUrl.trim().toLowerCase();
  if (normalizedUrl.includes("api.kimi.com/coding")) {
    return "anthropic";
  }
  return normalizedProvider;
}

interface SetupResult {
  readonly projectRoot: string;
  readonly hasLlmConfig: boolean;
}

export interface InteractiveSetupCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly steps: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly model: string;
    readonly scope: string;
  };
  readonly hints: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly model: string;
    readonly scope: string;
  };
  readonly defaults: {
    readonly provider: string;
    readonly baseUrl: string;
    readonly scope: string;
  };
  readonly scopeChoices: {
    readonly global: string;
    readonly project: string;
  };
  readonly savedTo: string;
}

export function buildInteractiveSetupCopy(locale: TuiLocale): InteractiveSetupCopy {
  if (locale === "en") {
    return {
      title: "LLM Setup",
      subtitle: "Configure your model provider to start writing.",
      steps: {
        provider: "Provider",
        baseUrl: "Base URL",
        apiKey: "API Key",
        model: "Model",
        scope: "Save scope",
      },
      hints: {
        provider: "openai / anthropic / custom (OpenAI-compatible proxy)",
        baseUrl: "Your API endpoint",
        model: "e.g. gpt-4o, claude-sonnet-4-20250514, deepseek-chat",
        scope: "global = all projects, project = this directory only",
      },
      defaults: {
        provider: "openai",
        baseUrl: "(default)",
        scope: "[global]",
      },
      scopeChoices: {
        global: "all projects",
        project: "this directory",
      },
      savedTo: "Saved to",
    };
  }

  return {
    title: "模型配置",
    subtitle: "配置模型服务后即可开始使用。",
    steps: {
      provider: "服务提供方",
      baseUrl: "接口地址",
      apiKey: "API 密钥",
      model: "模型",
      scope: "保存范围",
    },
    hints: {
      provider: "openai / anthropic / custom（兼容 OpenAI 的代理）",
      baseUrl: "你的 API 入口地址",
      model: "例如 gpt-5.4、claude-sonnet-4-20250514、deepseek-chat",
      scope: "global = 所有项目，project = 仅当前目录",
    },
    defaults: {
      provider: "openai",
      baseUrl: "（默认）",
      scope: "[global]",
    },
    scopeChoices: {
      global: "所有项目",
      project: "当前目录",
    },
    savedTo: "已保存到",
  };
}

export function buildAutoInitMessages(projectName: string, locale: TuiLocale): {
  readonly initializing: string;
  readonly initialized: string;
} {
  if (locale === "en") {
    return {
      initializing: `Initializing project in ${projectName}/ ...`,
      initialized: "Project initialized",
    };
  }

  return {
    initializing: `正在初始化项目：${projectName}/ ...`,
    initialized: "项目已初始化",
  };
}

export async function ensureProject(cwd: string): Promise<SetupResult> {
  const configPath = join(cwd, "inkos.json");
  const hasConfig = await fileExists(configPath);

  if (!hasConfig) {
    await autoInit(cwd);
  }

  const hasLlm = await hasLlmConfig(cwd);
  return { projectRoot: cwd, hasLlmConfig: hasLlm };
}

export async function interactiveLlmSetup(
  projectRoot: string,
): Promise<void> {
  const projectLanguage = await detectProjectLanguage(projectRoot);
  const locale = resolveTuiLocale(process.env, projectLanguage);
  const copy = buildInteractiveSetupCopy(locale);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log();
    console.log(`  ${c("◈", brightCyan)} ${c(copy.title, bold, brightWhite)}`);
    console.log(c(`  ${copy.subtitle}`, dim));
    console.log();

    // Provider
    console.log(`  ${c("1", cyan)}  ${c(copy.steps.provider, gray)}`);
    console.log(c(`     ${copy.hints.provider}`, dim));
    const providerInput = await rl.question(`     ${c("❯", cyan)} `);
    const provider = PROVIDERS.includes(providerInput.trim() as SetupProvider)
      ? providerInput.trim() as SetupProvider
      : copy.defaults.provider as SetupProvider;
    console.log(`     ${c("✓", brightGreen)} ${provider}`);
    console.log();

    // Base URL
    console.log(`  ${c("2", cyan)}  ${c(copy.steps.baseUrl, gray)}`);
    console.log(c(`     ${copy.hints.baseUrl}`, dim));
    const baseUrl = await rl.question(`     ${c("❯", cyan)} `);
    console.log(`     ${c("✓", brightGreen)} ${baseUrl.trim() || copy.defaults.baseUrl}`);
    console.log();

    // API Key
    console.log(`  ${c("3", cyan)}  ${c(copy.steps.apiKey, gray)}`);
    const apiKey = await rl.question(`     ${c("❯", cyan)} `);
    const maskedKey = apiKey.trim().length > 8
      ? apiKey.trim().slice(0, 4) + "···" + apiKey.trim().slice(-4)
      : "···";
    console.log(`     ${c("✓", brightGreen)} ${maskedKey}`);
    console.log();

    // Model
    console.log(`  ${c("4", cyan)}  ${c(copy.steps.model, gray)}`);
    console.log(c(`     ${copy.hints.model}`, dim));
    const model = await rl.question(`     ${c("❯", cyan)} `);
    console.log(`     ${c("✓", brightGreen)} ${model.trim()}`);
    console.log();

    // Scope
    console.log(`  ${c("5", cyan)}  ${c(copy.steps.scope, gray)}`);
    console.log(c(`     ${copy.hints.scope}`, dim));
    const scope = await rl.question(`     ${c("❯", cyan)} ${c(copy.defaults.scope, dim)} `);
    const useGlobal = scope.trim().toLowerCase() !== "project";
    const finalProvider = resolveSetupProvider(provider, baseUrl.trim());

    const serviceKey = finalProvider === "custom" ? `custom:${baseUrl.trim()}` : finalProvider;
    const secrets: SecretsFile = {
      services: {
        [serviceKey]: { apiKey: apiKey.trim() },
      },
    };

    if (useGlobal) {
      await saveGlobalSecrets(secrets);
      console.log();
      console.log(`  ${c("✓", brightGreen, bold)} ${c(copy.savedTo, dim)} ${c("~/.inkos/secrets.json", gray)}`);
    } else {
      await saveSecrets(projectRoot, secrets);
      console.log();
      console.log(`  ${c("✓", brightGreen, bold)} ${c(copy.savedTo, dim)} ${c(".inkos/secrets.json", gray)}`);
    }
    console.log();
  } finally {
    rl.close();
  }
}

async function autoInit(cwd: string): Promise<void> {
  const projectName = basename(cwd);
  const locale = resolveTuiLocale();
  const messages = buildAutoInitMessages(projectName, locale);
  console.log();
  console.log(`  ${c("◌", cyan)} ${c(messages.initializing, dim)}`);

  await mkdir(join(cwd, "books"), { recursive: true });
  await mkdir(join(cwd, "radar"), { recursive: true });

  const config = {
    name: projectName,
    version: "0.1.0",
    language: "zh",
    llm: {
      provider: "openai",
      baseUrl: "",
      model: "",
    },
    notify: [],
    daemon: {
      schedule: {
        radarCron: "0 */6 * * *",
        writeCron: "*/15 * * *",
      },
      maxConcurrentBooks: 3,
    },
  };

  await writeFile(
    join(cwd, "inkos.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );

  await ensureProjectGitignore(cwd);

  console.log(`  ${c("✓", brightGreen, bold)} ${c(messages.initialized, dim)}`);
}

async function hasLlmConfig(projectRoot: string): Promise<boolean> {
  const projectSecrets = await checkSecretsForKey(projectRoot);
  if (projectSecrets) return true;
  return checkGlobalSecretsForKey();
}

async function checkGlobalSecretsForKey(): Promise<boolean> {
  try {
    const secrets = await loadGlobalSecrets();
    return Object.values(secrets.services).some((s) => s?.apiKey && !s.apiKey.includes("your-api-key"));
  } catch {
    return false;
  }
}

async function checkSecretsForKey(projectRoot: string): Promise<boolean> {
  try {
    const secrets = await loadSecrets(projectRoot);
    return Object.values(secrets.services).some((s) => s?.apiKey && !s.apiKey.includes("your-api-key"));
  } catch {
    return false;
  }
}

export interface ModelInfo {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string;
}

export async function detectModelInfo(projectRoot: string): Promise<ModelInfo | undefined> {
  try {
    const config = await loadConfig({ requireApiKey: false, projectRoot });
    const service = config.llm.service?.trim();
    const provider = service || config.llm.provider || "openai";
    const model = config.llm.model?.trim() || "unknown";
    return {
      provider,
      model,
      baseUrl: config.llm.baseUrl ?? "",
    };
  } catch {
    return undefined;
  }
}

export async function detectProjectLanguage(projectRoot: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(projectRoot, "inkos.json"), "utf-8");
    const parsed = JSON.parse(raw) as { language?: string };
    return parsed.language;
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
