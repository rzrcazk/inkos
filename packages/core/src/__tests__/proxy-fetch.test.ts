import { afterEach, describe, expect, it, vi } from "vitest";

const proxyAgentMock = vi.fn((url: string) => ({ kind: "proxy-agent", url }));

vi.mock("undici", () => ({
  ProxyAgent: proxyAgentMock,
}));

describe("proxy fetch helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses explicit llm proxyUrl to create dispatcher", async () => {
    const { fetchWithProxy, resolveProxyUrl } = await import("../utils/proxy-fetch.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(resolveProxyUrl("http://explicit-proxy:9910")).toBe("http://explicit-proxy:9910");
    await fetchWithProxy("https://api.example/v1/chat/completions", { method: "POST" }, "http://explicit-proxy:9910");

    expect(proxyAgentMock).toHaveBeenCalledWith("http://explicit-proxy:9910");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        dispatcher: { kind: "proxy-agent", url: "http://explicit-proxy:9910" },
      }),
    );
  });

  it("does not attach a dispatcher when no proxy is configured", async () => {
    const { fetchWithProxy, resolveProxyUrl } = await import("../utils/proxy-fetch.js");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(resolveProxyUrl(undefined)).toBeUndefined();
    await fetchWithProxy("https://api.example/v1/models", { headers: { Authorization: "Bearer test" } });

    expect(proxyAgentMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/v1/models",
      { headers: { Authorization: "Bearer test" } },
    );
  });

  it("throws on unsupported proxy protocol", async () => {
    const { resolveProxyUrl } = await import("../utils/proxy-fetch.js");

    expect(() => resolveProxyUrl("socks5://proxy:1080")).toThrow(/Unsupported proxy protocol/);
  });
});
