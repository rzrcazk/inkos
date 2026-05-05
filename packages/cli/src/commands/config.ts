/* ── CLI configuration commands ── */

import { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, log, logError } from "../utils.js";
import { listModelsForService, loadSecrets, saveSecrets, loadGlobalSecrets, saveGlobalSecrets, type SecretsFile } from "@actalk/inkos-core";
import { homedir } from "node:os";

export const configCommand = new Command("config")
  .description("Manage project configuration");

configCommand
  .command("set")
  .description("Set a configuration value")
  .argument("<key>", "Config key (e.g., llm.apiKey)")
  .argument("<value>", "Config value")
  .action(async (key: string, value: string) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);

      const keys = key.split(".");

      const KNOWN_KEYS = new Set([
        "llm.provider", "llm.baseUrl", "llm.model", "llm.temperature",
        "llm.thinkingBudget", "llm.proxyUrl", "llm.apiFormat", "llm.stream",
        "inputGovernanceMode",
        "foundation.reviewRetries",
        "daemon.schedule.radarCron", "daemon.schedule.writeCron",
        "daemon.maxConcurrentBooks", "daemon.chaptersPerCycle",
        "daemon.retryDelayMs", "daemon.cooldownAfterChapterMs",
        "daemon.maxChaptersPerDay",
      ]);
      // Allow any key under llm.extra.* (passthrough to API)
      if (!KNOWN_KEYS.has(key) && !key.startsWith("llm.extra.")) {
        const candidates = [...KNOWN_KEYS];
        const inputParts = key.split(".");
        const samePrefixCandidates = candidates.filter(k => {
          const parts = k.split(".");
          return parts.length === inputParts.length && parts.slice(0, -1).join(".") === inputParts.slice(0, -1).join(".");
        });
        const editDist = (a: string, b: string): number => {
          const m = a.length, n = b.length;
          const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
          for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
            dp[i]![j] = Math.min(dp[i-1]![j]! + 1, dp[i]![j-1]! + 1, dp[i-1]![j-1]! + (a[i-1] !== b[j-1] ? 1 : 0));
          return dp[m]![n]!;
        };
        const inputLast = inputParts[inputParts.length - 1]!;
        const suggestion = samePrefixCandidates
          .map(k => ({ k, d: editDist(k.split(".").pop()!, inputLast) }))
          .sort((a, b) => a.d - b.d)
          .find(x => x.d <= 3)?.k;
        logError(`Unknown config key "${key}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}`);
        log(`Known keys: ${candidates.join(", ")}`);
        process.exit(1);
      }

      let target = config;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]!;
        if (!(k in target)) {
          target[k] = {};
        }
        target = target[k];
      }
      const finalKey = keys[keys.length - 1]!;
      if (/^\d+(\.\d+)?$/.test(value)) {
        target[finalKey] = parseFloat(value);
      } else if (value === "true") {
        target[finalKey] = true;
      } else if (value === "false") {
        target[finalKey] = false;
      } else {
        target[finalKey] = value;
      }

      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(`Set ${key} = ${value}`);
    } catch (e) {
      logError(`Failed to update config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("set-global")
  .description("Set global LLM config (~/.inkos/secrets.json), shared by all projects")
  .requiredOption("--service <service>", "Service ID (e.g., minimax, bailian, custom)")
  .requiredOption("--api-key <key>", "API key")
  .option("--model <model>", "Model name")
  .option("--base-url <url>", "API base URL (for custom services)")
  .option("--name <name>", "Display name (for custom services)")
  .action(async (opts) => {
    try {
      const globalDir = join(homedir(), ".inkos");
      await mkdir(globalDir, { recursive: true });

      const existing = await loadGlobalSecrets();
      const serviceKey = opts.service === "custom" && opts.name
        ? `custom:${opts.name}`
        : opts.service;

      const serviceEntry: { apiKey: string; baseUrl?: string; name?: string } = {
        apiKey: opts.apiKey,
      };
      if (opts.baseUrl) serviceEntry.baseUrl = opts.baseUrl;
      if (opts.name) serviceEntry.name = opts.name;

      const secrets: SecretsFile = {
        services: {
          ...existing.services,
          [serviceKey]: serviceEntry,
        },
      };

      await saveGlobalSecrets(secrets);
      log(`Global config saved to ${join(globalDir, "secrets.json")} (service: ${serviceKey})`);
      log("All projects will use this config unless overridden by project secrets.");
    } catch (e) {
      logError(`Failed to set global config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("show-global")
  .description("Show global LLM config (~/.inkos/secrets.json)")
  .action(async () => {
    try {
      const secrets = await loadGlobalSecrets();
      const masked: SecretsFile = {
        services: {},
      };
      for (const [key, value] of Object.entries(secrets.services)) {
        const rawKey = value.apiKey;
        masked.services[key] = {
          apiKey: rawKey.length > 8
            ? rawKey.slice(0, 4) + "..." + rawKey.slice(-4)
            : "***",
        };
      }
      log(JSON.stringify(masked, null, 2));
    } catch {
      log("No global config found. Run 'inkos config set-global --service <id> --api-key <key>' to create one.");
    }
  });

configCommand
  .command("show")
  .description("Show current project configuration")
  .action(async () => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      // Mask API key in secrets
      try {
        const secrets = await loadSecrets(root);
        for (const [key, value] of Object.entries(secrets.services)) {
          if (value.apiKey) {
            value.apiKey = value.apiKey.slice(0, 4) + "..." + value.apiKey.slice(-4);
          }
        }
        log("inkos.json:");
        log(JSON.stringify(config, null, 2));
        log("\nsecrets.json:");
        log(JSON.stringify(secrets, null, 2));
      } catch {
        log(JSON.stringify(config, null, 2));
      }
    } catch (e) {
      logError(`Failed to read config: ${e}`);
      process.exit(1);
    }
  });

const KNOWN_AGENTS = ["writer", "auditor", "reviser", "architect", "radar", "chapter-analyzer"] as const;

configCommand
  .command("set-model")
  .description("Set model override for a specific agent")
  .argument("<agent>", `Agent name (${KNOWN_AGENTS.join(", ")})`)
  .argument("<model>", "Model name")
  .option("--base-url <url>", "API base URL (for different provider)")
  .option("--provider <provider>", "Provider type (openai / anthropic / custom)")
  .option("--stream", "Enable streaming (default)")
  .option("--no-stream", "Disable streaming")
  .action(async (agent: string, model: string, opts: { baseUrl?: string; provider?: string; stream?: boolean }) => {
    if (!KNOWN_AGENTS.includes(agent as typeof KNOWN_AGENTS[number])) {
      logError(`Unknown agent "${agent}". Valid agents: ${KNOWN_AGENTS.join(", ")}`);
      process.exit(1);
    }

    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const overrides = config.modelOverrides ?? {};

      const hasProviderOpts = opts.baseUrl || opts.provider || opts.stream === false;
      if (hasProviderOpts) {
        const override: Record<string, unknown> = { model };
        if (opts.baseUrl) override.baseUrl = opts.baseUrl;
        if (opts.provider) override.provider = opts.provider;
        if (opts.stream === false) override.stream = false;
        config.modelOverrides = { ...overrides, [agent]: override };
      } else {
        config.modelOverrides = { ...overrides, [agent]: model };
      }

      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(`Model override: ${agent} → ${model}${opts.baseUrl ? ` (${opts.baseUrl})` : ""}`);
    } catch (e) {
      logError(`Failed to update config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("remove-model")
  .description("Remove model override for a specific agent (falls back to default)")
  .argument("<agent>", "Agent name")
  .action(async (agent: string) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const overrides = config.modelOverrides;
      if (!overrides || !(agent in overrides)) {
        log(`No model override for "${agent}".`);
        return;
      }
      const { [agent]: _, ...rest } = overrides;
      config.modelOverrides = Object.keys(rest).length > 0 ? rest : undefined;
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(`Removed model override for ${agent}. Will use default model.`);
    } catch (e) {
      logError(`Failed to update config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("show-models")
  .description("Show model routing for all agents")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const defaultModel = config.llm?.model ?? "(not set)";
      const overrides: Record<string, unknown> = config.modelOverrides ?? {};

      if (opts.json) {
        log(JSON.stringify({ defaultModel, overrides }, null, 2));
        return;
      }

      log(`Default model: ${defaultModel}\n`);
      if (Object.keys(overrides).length === 0) {
        log("No agent-specific overrides. All agents use the default model.");
        return;
      }
      log("Agent overrides:");
      for (const [agent, value] of Object.entries(overrides)) {
        if (typeof value === "string") {
          log(`  ${agent} → ${value}`);
        } else {
          const o = value as Record<string, unknown>;
          const parts = [o.model as string];
          if (o.baseUrl) parts.push(`@ ${o.baseUrl}`);
          if (o.stream === false) parts.push("[no-stream]");
          log(`  ${agent} → ${parts.join(" ")}`);
        }
      }
      log("");
      const usingDefault = KNOWN_AGENTS.filter((a) => !(a in overrides));
      if (usingDefault.length > 0) {
        log(`Using default: ${usingDefault.join(", ")}`);
      }
    } catch (e) {
      logError(`Failed to read config: ${e}`);
      process.exit(1);
    }
  });

// B17: list-models 命令 —— 列出指定 service 的可用模型（含元数据）
configCommand
  .command("list-models <service>")
  .description("List available models for a service (with maxOutput / contextWindow / abilities)")
  .requiredOption("--api-key <key>", "API Key")
  .option("--base-url <url>", "Live /models probe baseUrl (for custom/newapi)")
  .option("--json", "Output as JSON")
  .action(async (service: string, opts: { apiKey: string; baseUrl?: string; json?: boolean }) => {
    const models = await listModelsForService(service, opts.apiKey, opts.baseUrl);
    if (models.length === 0) {
      logError(`${service} 没有可用模型（可能需要 --api-key 和 --base-url）`);
      process.exit(1);
    }
    if (opts.json) {
      log(JSON.stringify(models, null, 2));
      return;
    }
    log(`${service}：${models.length} 个模型\n`);
    for (const m of models) {
      const maxOut = m.maxOutput ? `out=${m.maxOutput}` : "out=?";
      const ctx = m.contextWindow > 0 ? `ctx=${m.contextWindow}` : "ctx=?";
      log(`  ${m.id.padEnd(42)} ${maxOut.padEnd(14)} ${ctx}`);
    }
  });
