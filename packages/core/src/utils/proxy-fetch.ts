import { ProxyAgent } from "undici";

type FetchInitWithDispatcher = RequestInit & { dispatcher?: unknown };

export function resolveProxyUrl(explicitProxyUrl?: string): string | undefined {
  const candidate = explicitProxyUrl?.trim();
  if (!candidate) return undefined;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);
  }
  return candidate;
}

export function buildProxyFetchInit(
  init: RequestInit = {},
  explicitProxyUrl?: string,
): FetchInitWithDispatcher {
  const proxyUrl = resolveProxyUrl(explicitProxyUrl);
  if (!proxyUrl) return init;
  return {
    ...init,
    dispatcher: new ProxyAgent(proxyUrl),
  };
}

export function fetchWithProxy(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  explicitProxyUrl?: string,
): ReturnType<typeof fetch> {
  return fetch(input, buildProxyFetchInit(init, explicitProxyUrl));
}
