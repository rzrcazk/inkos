import { fetchJson } from "../hooks/use-api";

export interface ServiceDetailModelInfo {
  readonly id: string;
  readonly name?: string;
}

export interface ServiceDetailDetectedConfig {
  readonly apiFormat?: "chat" | "responses" | "anthropic";
  readonly stream?: boolean;
  readonly baseUrl?: string;
  readonly modelsSource?: "api" | "fallback";
}

export type ServiceDetailConnectionStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "connected"; models: ServiceDetailModelInfo[] }
  | { state: "error"; message: string }
  | { state: "saving" }
  | { state: "saved" };

type JsonFetcher = typeof fetchJson;

interface ServiceProbeResponse {
  readonly ok: boolean;
  readonly models?: ServiceDetailModelInfo[];
  readonly selectedModel?: string;
  readonly detected?: ServiceDetailDetectedConfig;
  readonly error?: string;
}

export async function probeServiceForDetail(
  serviceId: string,
  body: {
    readonly apiKey: string;
    readonly apiFormat: "chat" | "responses" | "anthropic";
    readonly stream: boolean;
    readonly baseUrl?: string;
    readonly model?: string;
  },
  deps?: { readonly fetchJsonImpl?: JsonFetcher },
): Promise<ServiceProbeResponse> {
  const fetchJsonImpl = deps?.fetchJsonImpl ?? fetchJson;
  return await fetchJsonImpl<ServiceProbeResponse>(
    `/services/${encodeURIComponent(serviceId)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function rehydrateServiceConnectionStatus(args: {
  readonly effectiveServiceId: string;
  readonly shouldVerify: boolean;
  readonly isCustom: boolean;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses" | "anthropic";
  readonly stream: boolean;
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly apiKey: string;
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const secret = await fetchJsonImpl<{ apiKey?: string }>(
    `/services/${encodeURIComponent(args.effectiveServiceId)}/secret`,
  );
  const apiKey = String(secret.apiKey ?? "");

  return {
    apiKey,
    status: { state: "idle" },
    detectedConfig: null,
  };
}

export function matchServiceConfigEntryForDetail(
  entries: ReadonlyArray<Record<string, unknown>>,
  serviceId: string,
): Record<string, unknown> | undefined {
  return entries.find((entry) => {
    if (typeof entry.service !== "string") return false;
    if (serviceId.startsWith("custom:")) {
      return entry.service === "custom" && `custom:${String(entry.name ?? "")}` === serviceId;
    }
    if (serviceId === "custom") return false;
    return entry.service === serviceId;
  });
}

export async function saveServiceConfig(args: {
  readonly effectiveServiceId: string;
  readonly serviceId: string;
  readonly isCustom: boolean;
  readonly resolvedCustomName: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses" | "anthropic";
  readonly stream: boolean;
  readonly temperature: string;
  readonly selectedModels?: readonly string[];
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const trimmedKey = args.apiKey.trim();
  const trimmedBaseUrl = args.baseUrl.trim();

  if (!trimmedKey) {
    return {
      status: { state: "error", message: "请先输入 API Key" },
      detectedConfig: null,
    };
  }
  if (!trimmedBaseUrl) {
    return {
      status: { state: "error", message: "请先填写 Base URL" },
      detectedConfig: null,
    };
  }

  // Custom services: skip probe, save directly
  if (args.isCustom) {
    await fetchJsonImpl(`/services/${encodeURIComponent(args.effectiveServiceId)}/secret`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: trimmedKey }),
    });

    await fetchJsonImpl("/services/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: args.effectiveServiceId,
        services: [
          {
            service: "custom",
            name: args.resolvedCustomName,
            baseUrl: trimmedBaseUrl,
            apiFormat: args.apiFormat,
            stream: args.stream,
            temperature: parseFloat(args.temperature),
            ...(args.selectedModels && args.selectedModels.length > 0 ? { selectedModels: [...args.selectedModels] } : {}),
          },
        ],
      }),
    });

    return {
      status: { state: "connected", models: [] },
      detectedConfig: null,
    };
  }

  let probe: ServiceProbeResponse;
  try {
    probe = await probeServiceForDetail(args.effectiveServiceId, {
      apiKey: trimmedKey,
      apiFormat: args.apiFormat,
      stream: args.stream,
      baseUrl: trimmedBaseUrl,
      model: args.selectedModels?.[0],
    }, { fetchJsonImpl });
  } catch (error) {
    return {
      status: { state: "error", message: error instanceof Error ? error.message : "连接失败" },
      detectedConfig: null,
    };
  }

  if (!probe.ok) {
    return {
      status: { state: "error", message: probe.error ?? "连接失败" },
      detectedConfig: null,
    };
  }

  const detectedConfig = probe.detected ?? null;
  const savedApiFormat = detectedConfig?.apiFormat ?? args.apiFormat;
  const savedStream = typeof detectedConfig?.stream === "boolean" ? detectedConfig.stream : args.stream;
  const savedBaseUrl = trimmedBaseUrl;

  await fetchJsonImpl(`/services/${encodeURIComponent(args.effectiveServiceId)}/secret`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: trimmedKey }),
  });

  await fetchJsonImpl("/services/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: args.effectiveServiceId,
      services: [
        {
          service: args.serviceId,
          temperature: parseFloat(args.temperature),
          apiFormat: savedApiFormat,
          stream: savedStream,
          baseUrl: savedBaseUrl,
          ...(args.selectedModels && args.selectedModels.length > 0 ? { selectedModels: [...args.selectedModels] } : {}),
        },
      ],
    }),
  });

  return {
    status: { state: "connected", models: probe.models ?? [] },
    detectedConfig,
  };
}
