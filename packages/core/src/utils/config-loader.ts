import type { ProjectConfig } from "../models/project.js";
import {
  resolveEffectiveLLMConfig,
  type LLMConfigCliOverrides,
  type LLMConsumer,
} from "./effective-llm-config.js";
import { isApiKeyOptionalForEndpoint } from "./llm-endpoint-auth.js";

export { isApiKeyOptionalForEndpoint };

export async function loadProjectConfig(
  root: string,
  options?: {
    readonly requireApiKey?: boolean;
    readonly cli?: LLMConfigCliOverrides;
    readonly consumer?: LLMConsumer;
  },
): Promise<ProjectConfig> {
  const result = await resolveEffectiveLLMConfig({
    consumer: options?.consumer ?? "cli",
    projectRoot: root,
    cli: options?.cli,
    requireApiKey: options?.requireApiKey,
  });
  return result.config;
}
