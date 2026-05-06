import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProjectConfigSchema, type LLMConfig, type ProjectConfig } from "../models/project.js";
import { loadSecrets } from "../llm/secrets.js";
import { getEndpoint } from "../llm/providers/index.js";
import { resolveServicePreset, resolveServiceProviderFamily } from "../llm/service-presets.js";
import { isApiKeyOptionalForEndpoint } from "./llm-endpoint-auth.js";

export type LLMConsumer = "studio" | "cli" | "daemon" | "deploy";
export type LLMConfigMode = "studio-project";
export type LLMValueSource = "project" | "studio-secret" | "cli" | "default";

export interface LLMConfigCliOverrides {
  readonly service?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
}

export interface ResolveEffectiveLLMConfigInput {
  readonly consumer: LLMConsumer;
  readonly projectRoot: string;
  readonly cli?: LLMConfigCliOverrides;
  readonly requireApiKey?: boolean;
}

export interface EffectiveLLMDiagnostics {
  readonly configMode: LLMConfigMode;
  readonly serviceSource: LLMValueSource;
  readonly modelSource: LLMValueSource;
  readonly apiKeySource: LLMValueSource;
  readonly warnings: readonly string[];
}

export interface EffectiveLLMConfigResult {
  readonly config: ProjectConfig;
  readonly llm: LLMConfig;
  readonly diagnostics: EffectiveLLMDiagnostics;
}

interface ServiceConfigEntry {
  readonly service: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly apiFormat?: "chat" | "responses" | "anthropic";
  readonly stream?: boolean;
  readonly selectedModels?: readonly string[];
  readonly enabled?: boolean;
}

interface MutableDiagnostics {
  configMode: LLMConfigMode;
  serviceSource: LLMValueSource;
  modelSource: LLMValueSource;
  apiKeySource: LLMValueSource;
  warnings: string[];
}

export async function resolveEffectiveLLMConfig(
  input: ResolveEffectiveLLMConfigInput,
): Promise<EffectiveLLMConfigResult> {
  const config = await readProjectConfig(input.projectRoot);
  const llm = { ...((config.llm ?? {}) as Record<string, unknown>) };
  const services = normalizeServiceEntries(llm.services).filter((s) => s.enabled !== false);
  const diagnostics: MutableDiagnostics = {
    configMode: "studio-project",
    serviceSource: "project",
    modelSource: "project",
    apiKeySource: "project",
    warnings: [],
  };

  if (services.length > 0) {
    llm.services = services;
  }

  await applyProjectServiceConfig(config, llm, services, input.projectRoot, diagnostics, {
    requireApiKey: input.requireApiKey,
    ignoreTopLevelModel: services.length > 0,
    cli: input.cli,
  });

  if (input.requireApiKey === false) {
    fillNoopLLMDefaults(llm);
  }

  const provider = typeof llm.provider === "string" ? llm.provider : undefined;
  const baseUrl = typeof llm.baseUrl === "string" ? llm.baseUrl : undefined;
  const apiKey = typeof llm.apiKey === "string" ? llm.apiKey : "";
  if (!apiKey && input.requireApiKey !== false && !isApiKeyOptionalForEndpoint({ provider, baseUrl })) {
    throw new Error(
      "Studio LLM API key not set. Open Studio services and save an API key for the selected service.",
    );
  }

  llm.apiKey = apiKey;
  config.llm = llm;

  const parsed = ProjectConfigSchema.parse(config);
  return {
    config: parsed,
    llm: parsed.llm,
    diagnostics,
  };
}

async function readProjectConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  try {
    await access(configPath);
  } catch {
    throw new Error(
      `inkos.json not found in ${root}.\nMake sure you are inside an InkOS project directory (cd into the project created by 'inkos init').`,
    );
  }

  const raw = await readFile(configPath, "utf-8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`inkos.json in ${root} is not valid JSON. Check the file for syntax errors.`);
  }
}

async function applyProjectServiceConfig(
  config: Record<string, unknown>,
  llm: Record<string, unknown>,
  services: readonly ServiceConfigEntry[],
  projectRoot: string,
  diagnostics: MutableDiagnostics,
  options: {
    readonly requireApiKey?: boolean;
    readonly ignoreTopLevelModel: boolean;
    readonly cli?: LLMConfigCliOverrides;
  },
): Promise<void> {
  llm.configSource = "studio";
  const selectedEntry = selectServiceEntry(services, options.cli?.service ?? llm.service)
    ?? synthesizeServiceEntry(options.cli?.service ?? llm.service);

  if (selectedEntry) {
    applyServiceEntry(llm, selectedEntry);
    diagnostics.serviceSource = options.cli?.service ? "cli" : "project";
  }

  const requestedModel = options.cli?.model;
  const modelSource: LLMValueSource = requestedModel ? "cli" : "project";
  const model = requestedModel
    ?? resolveServiceModel(
      selectedEntry,
      options.ignoreTopLevelModel ? undefined : stringValue(llm.model),
      stringValue(llm.defaultModel),
    );
  if (model) {
    assertModelBelongsToService(selectedEntry, model);
    llm.model = model;
    diagnostics.modelSource = modelSource;
  }

  if (options.cli?.baseUrl) llm.baseUrl = options.cli.baseUrl;
  if (options.cli?.apiFormat) llm.apiFormat = options.cli.apiFormat;
  if (options.cli?.stream !== undefined) llm.stream = options.cli.stream;

  const serviceKey = selectedEntry ? serviceEntryKey(selectedEntry) : stringValue(llm.service);
  const secretApiKey = serviceKey ? await getStudioServiceApiKey(projectRoot, serviceKey) : "";
  llm.apiKey = secretApiKey;
  diagnostics.apiKeySource = secretApiKey ? "studio-secret" : "project";
}

function applyServiceEntry(llm: Record<string, unknown>, entry: ServiceConfigEntry): void {
  const endpoint = getEndpoint(entry.service);
  const transportDefaults = endpoint?.transportDefaults;
  llm.service = entry.service;
  llm.provider = deriveProviderFromService(entry.service);
  llm.baseUrl = entry.baseUrl ?? resolveServicePreset(entry.service)?.baseUrl ?? "";

  // Clear stale top-level model — the correct model will be resolved from
  // the service's endpoint definition (checkModel / selectedModels) rather
  // than a model ID that belonged to a previously selected service.
  delete llm.model;

  if (entry.temperature !== undefined) llm.temperature = entry.temperature;
  if (entry.apiFormat !== undefined) llm.apiFormat = entry.apiFormat;
  else if (transportDefaults?.apiFormat !== undefined) llm.apiFormat = transportDefaults.apiFormat;
  else {
    const presetApi = resolveServicePreset(entry.service)?.api;
    llm.apiFormat = presetApi?.startsWith("openai-responses") ? "responses"
      : presetApi?.startsWith("anthropic") ? "anthropic"
      : "chat";
  }
  if (entry.stream !== undefined) llm.stream = entry.stream;
  else if (transportDefaults?.stream !== undefined) llm.stream = transportDefaults.stream;
  if (entry.selectedModels !== undefined) llm.selectedModels = entry.selectedModels;
}

async function getStudioServiceApiKey(projectRoot: string, serviceKey: string): Promise<string> {
  const secrets = await loadSecrets(projectRoot);
  return secrets.services[serviceKey]?.apiKey ?? "";
}

function normalizeServiceEntries(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(typeof entry.maxTokens === "number" ? { maxTokens: entry.maxTokens } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" || entry.apiFormat === "anthropic" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
        ...(Array.isArray(entry.selectedModels) ? {
          selectedModels: entry.selectedModels.filter((m): m is string => typeof m === "string"),
        } : {}),
        ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
      }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntryFromPatch(serviceId, value as Record<string, unknown>));
  }

  return [];
}

function normalizeServiceEntryFromPatch(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" || value.apiFormat === "anthropic" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...(Array.isArray(value.selectedModels) ? {
        selectedModels: value.selectedModels.filter((m): m is string => typeof m === "string"),
      } : {}),
    };
  }

  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" || value.apiFormat === "anthropic" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...(Array.isArray(value.selectedModels) ? {
        selectedModels: value.selectedModels.filter((m): m is string => typeof m === "string"),
      } : {}),
    };
  }

  return {
    service: serviceId,
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" || value.apiFormat === "anthropic" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    ...(Array.isArray(value.selectedModels) ? {
      selectedModels: value.selectedModels.filter((m): m is string => typeof m === "string"),
    } : {}),
  };
}

function selectServiceEntry(
  services: readonly ServiceConfigEntry[],
  configuredService: unknown,
): ServiceConfigEntry | undefined {
  if (typeof configuredService === "string" && configuredService.length > 0) {
    return services.find((entry) => entry.service === configuredService || serviceEntryKey(entry) === configuredService)
      ?? synthesizeServiceEntry(configuredService);
  }
  return services[0];
}

function synthesizeServiceEntry(service: unknown): ServiceConfigEntry | undefined {
  if (typeof service !== "string" || service.length === 0) return undefined;
  if (service.startsWith("custom:")) {
    return { service: "custom", name: service.slice("custom:".length) || "Custom" };
  }
  if (service === "custom" || getEndpoint(service) || resolveServicePreset(service)) {
    return { service };
  }
  return undefined;
}

function resolveServiceModel(
  entry: ServiceConfigEntry | undefined,
  currentModel: string | undefined,
  defaultModel: string | undefined,
): string {
  if (!entry) return defaultModel || currentModel || "noop-model";
  if (entry.service === "custom") return defaultModel || currentModel || "noop-model";

  const endpoint = getEndpoint(entry.service);
  const candidate = [defaultModel, currentModel]
    .find((model): model is string => Boolean(model && modelBelongsToService(entry.service, entry.selectedModels, model)));
  if (candidate) return candidate;

  // Prefer first selected model when available
  if (entry.selectedModels && entry.selectedModels.length > 0) {
    return entry.selectedModels[0];
  }

  return endpoint?.checkModel
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id
    ?? defaultModel
    ?? currentModel
    ?? "noop-model";
}

function assertModelBelongsToService(entry: ServiceConfigEntry | undefined, model: string): void {
  if (!entry || entry.service === "custom") return;
  const endpoint = getEndpoint(entry.service);
  if (!endpoint) return;
  if (!modelBelongsToService(entry.service, entry.selectedModels, model)) {
    throw new Error(`模型 ${model} 不属于 ${entry.service} 服务，请切换服务或选择该服务下的模型。`);
  }
}

function modelBelongsToService(service: string, selectedModels: readonly string[] | undefined, model: string): boolean {
  if (serviceAllowsUnlistedModels(service)) return true;
  const endpoint = getEndpoint(service);
  if (!endpoint) return true;
  // Custom model IDs in selectedModels are valid by user choice
  if (selectedModels?.some((id) => id.toLowerCase() === model.toLowerCase())) return true;
  return endpoint.models.some((knownModel) => knownModel.id.toLowerCase() === model.toLowerCase());
}

function serviceAllowsUnlistedModels(service: string): boolean {
  return service === "ollama";
}

function serviceEntryKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function deriveProviderFromService(service: string): "anthropic" | "openai" | "custom" {
  if (service === "custom") return "custom";
  return resolveServiceProviderFamily(service) ?? "openai";
}

function fillNoopLLMDefaults(llm: Record<string, unknown>): void {
  if (typeof llm.provider !== "string" || llm.provider.length === 0) llm.provider = "openai";
  if (typeof llm.baseUrl !== "string" || llm.baseUrl.length === 0) llm.baseUrl = "https://example.invalid/v1";
  if (typeof llm.model !== "string" || llm.model.length === 0) llm.model = "noop-model";
  if (typeof llm.apiKey !== "string") llm.apiKey = "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
