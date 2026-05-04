import type { InkosModel } from "./types.js";
import { getAllEndpoints, getEndpoint } from "./index.js";

/**
 * provider id 优先级。Layer 2 全局扫时同 id 多条匹配按这个顺序取第一条，
 * 保证结果确定性。白名单外的 provider 视同 999（排最后）。
 */
const PROVIDER_PRIORITY: readonly string[] = [
  "anthropic", "openai", "google", "deepseek", "bailian", "moonshot", "kimicode",
  "zhipu", "minimax", "xai",
  "siliconcloud", "ppio",
  "openrouter", "aihubmix", "novita",
];

/** 合成不在 provider bank 中的自定义模型 ID */
function makeSyntheticModel(id: string): InkosModel {
  return {
    id,
    maxOutput: 24_576,
    contextWindowTokens: 128_000,
    enabled: true,
    capabilities: { text: true },
  };
}

/**
 * 两层 lookup：
 * - Layer 1: 已知 provider 精确查（整串比较，不拆斜线）
 * - Layer 2: 全局扫所有 provider 的 models，按 provider id 优先级取第一条
 * - 都 miss: 返回 undefined，调用方走保守默认
 *
 * 不做斜线前缀拆分。lobe 的 processModelList 证实了"靠调用入口带 provider 消歧"
 * 是对的做法，斜线拆分对 PPIO / SiliconCloud 原生命名会误匹配。
 */
export function lookupModel(
  serviceId: string,
  modelId: string,
): InkosModel | undefined {
  const lowerId = modelId.toLowerCase();

  const provider = getEndpoint(serviceId);
  if (provider) {
    const hit = provider.models.find((m) => m.id.toLowerCase() === lowerId);
    if (hit) return hit;
  }

  const matches: Array<{ model: InkosModel; providerId: string }> = [];
  for (const p of getAllEndpoints()) {
    const hit = p.models.find((m) => m.id.toLowerCase() === lowerId);
    if (hit) matches.push({ model: hit, providerId: p.id });
  }
  if (matches.length === 0) return undefined;

  matches.sort((a, b) => {
    const ai = PROVIDER_PRIORITY.indexOf(a.providerId);
    const bi = PROVIDER_PRIORITY.indexOf(b.providerId);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  return matches[0].model;
}

export interface ListModelsOptions {
  readonly selectedModels?: readonly string[];
}

/** 某 service 下可用（enabled !== false）的模型列表 */
export function listEnabledModels(
  serviceId: string,
  options?: ListModelsOptions,
): InkosModel[] {
  const provider = getEndpoint(serviceId);
  if (!provider) return [];

  const ids = options?.selectedModels;
  if (!ids || ids.length === 0) {
    return provider.models.filter((m) => m.enabled !== false);
  }

  const selected = new Set(ids.map((id) => id.toLowerCase()));
  const result: InkosModel[] = [];
  for (const m of provider.models) {
    if (selected.has(m.id.toLowerCase()) && m.enabled !== false) {
      result.push(m);
    }
  }
  // Append synthetic stubs for custom model IDs not in the bank
  for (const id of ids) {
    if (!provider.models.some((m) => m.id.toLowerCase() === id.toLowerCase())) {
      result.push(makeSyntheticModel(id));
    }
  }
  return result;
}

export function isActiveTextModel(model: InkosModel): boolean {
  if (model.enabled === false) return false;
  if (model.status === "disabled" || model.status === "deprecated" || model.status === "nonText") return false;
  if (model.capabilities?.text === false) return false;
  if (model.capabilities?.imageOutput === true && model.capabilities?.text !== true) return false;
  return true;
}

export function listActiveTextModels(
  serviceId: string,
  options?: ListModelsOptions,
): InkosModel[] {
  const provider = getEndpoint(serviceId);
  if (!provider) return [];

  const ids = options?.selectedModels;
  if (!ids || ids.length === 0) {
    return provider.models.filter(isActiveTextModel);
  }

  const selected = new Set(ids.map((id) => id.toLowerCase()));
  const result: InkosModel[] = [];
  for (const m of provider.models) {
    if (selected.has(m.id.toLowerCase()) && isActiveTextModel(m)) {
      result.push(m);
    }
  }
  // Append synthetic stubs for custom model IDs not in the bank
  for (const id of ids) {
    if (!provider.models.some((m) => m.id.toLowerCase() === id.toLowerCase())) {
      result.push(makeSyntheticModel(id));
    }
  }
  return result;
}
