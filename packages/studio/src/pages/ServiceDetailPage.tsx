import { useState, useEffect, useRef } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import {
  matchServiceConfigEntryForDetail,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo,
} from "./service-detail-state";
import type { ServiceInfo } from "../store/service/types";

type BankModel = { id: string; name?: string; maxOutput?: number; contextWindow?: number };
type DisplayModel = ServiceDetailModelInfo | BankModel;

interface Nav {
  toServices: () => void;
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [apiFormat, setApiFormat] = useState<"chat" | "responses" | "anthropic">("chat");
  const [stream, setStream] = useState(true);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [bankModels, setBankModels] = useState<BankModel[]>([]);
  const [customModelId, setCustomModelId] = useState("");

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  // Initialize form from preset + saved config
  useEffect(() => {
    let cancelled = false;
    const presetSvc = services.find((s) => s.service === serviceId);
    if (presetSvc?.baseUrl) setBaseUrl(presetSvc.baseUrl);
    if (presetSvc?.api === "anthropic-messages") setApiFormat("anthropic");
    else if (presetSvc?.api === "openai-responses") setApiFormat("responses");
    else setApiFormat("chat");

    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (!matched) return;
        if (isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
        }
        if (typeof matched.baseUrl === "string" && matched.baseUrl) setBaseUrl(matched.baseUrl);
        if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (matched.apiFormat === "chat" || matched.apiFormat === "responses" || matched.apiFormat === "anthropic") setApiFormat(matched.apiFormat);
        if (typeof matched.stream === "boolean") setStream(matched.stream);
        const savedModels = matched.selectedModels;
        if (Array.isArray(savedModels)) {
          const filtered = savedModels.filter((m): m is string => typeof m === "string");
          setSelectedModels(new Set(filtered));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId, services]);

  // Fetch bank models on mount
  const didInitBankModels = useRef(false);
  useEffect(() => {
    if (isCustom || didInitBankModels.current) return;
    didInitBankModels.current = true;
    let cancelled = false;
    fetchJson<{ models: BankModel[] }>(`/services/${encodeURIComponent(serviceId)}/models/bank`)
      .then((data) => {
        if (cancelled) return;
        const models = data.models ?? [];
        setBankModels(models);
        setSelectedModels((prev) => {
          if (prev.size > 0) return prev;  // already has saved config
          const next = new Set(prev);
          for (const m of models) next.add(m.id);
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || "自定义服务") : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  // Load API key once when service identity changes (not on every form edit)
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ apiKey?: string }>(`/services/${encodeURIComponent(effectiveServiceId)}/secret`)
      .then((secret) => {
        if (cancelled) return;
        setApiKey(String(secret.apiKey ?? ""));
      })
      .catch(() => {
        if (cancelled) return;
        setApiKey("");
      });
    return () => { cancelled = true; };
  }, [effectiveServiceId]);

  // Re-check connection status when config changes (does NOT touch apiKey)
  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const models = status.state === "connected" ? status.models : (storeModels ?? []);
  const isBusy = status.state === "testing" || status.state === "saving";
  const discoveredModels: DisplayModel[] = models.length > 0
    ? models.map((m) => ({ ...m }))
    : bankModels;

  const allModels: DisplayModel[] = discoveredModels;

  // Custom model IDs: IDs in selectedModels but not in allModels
  const bankModelIds = new Set(allModels.map((m) => m.id));
  const customModels: DisplayModel[] = Array.from(selectedModels)
    .filter((id) => !bankModelIds.has(id))
    .map((id) => ({ id, name: id }));

  const displayModels: DisplayModel[] = [...allModels, ...customModels];

  // -- Handlers --
  const handleResetModels = async () => {
    try {
      await fetchJson(`/services/${encodeURIComponent(serviceId)}/selected-models`, {
        method: "DELETE",
      });
      setSelectedModels(new Set(bankModels.map((m) => m.id)));
      setCustomModelId("");
    } catch {
      // silently ignore — config might not exist
    }
  };

  const handleAddCustomModel = () => {
    const trimmed = customModelId.trim();
    if (!trimmed) return;
    setSelectedModels((prev) => {
      if (prev.has(trimmed)) return prev;
      const next = new Set(prev);
      next.add(trimmed);
      return next;
    });
    setCustomModelId("");
  };

  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setStatus({ state: "error", message: "请先输入 API Key" });
      return;
    }
    if (!baseUrl.trim()) {
      setStatus({ state: "error", message: "请先填写 Base URL" });
      return;
    }
    setApiKey(trimmedKey);
    setStatus({ state: "testing" });
    try {
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        stream,
        baseUrl: baseUrl.trim(),
        model: selectedModels.size > 0
          ? [...selectedModels][0]
          : allModels.length > 0
            ? allModels[0].id
            : undefined,
      });
      if (result.ok) {
        const probedModels = result.models ?? [];
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setStatus({ state: "connected", models: probedModels });
        setStoreModels(effectiveServiceId, probedModels);
        const allModelIds = new Set([...selectedModels, ...probedModels.map((m) => m.id)]);
        if (allModelIds.size === 0) {
          for (const m of bankModels) allModelIds.add(m.id);
        }
        setSelectedModels(allModelIds);
      } else {
        setStatus({ state: "error", message: result.error ?? "连接失败" });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "连接失败" });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (!baseUrl.trim()) {
      setStatus({ state: "error", message: "请先填写 Base URL" });
      return;
    }
    setStatus({ state: "saving" });
    try {
      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        resolvedCustomName,
        apiKey: trimmedKey,
        baseUrl,
        apiFormat,
        stream,
        temperature,
        selectedModels: Array.from(selectedModels),
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "保存失败" });
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={nav.toServices}
        className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <ArrowLeft size={14} />
        返回服务商管理
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            已连接
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label="服务名称">
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：本地 Ollama" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {/* Base URL (all providers) */}
        {!isCustom && (
          <Field label="Base URL">
            <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
          </Field>
        )}

        {/* API Key */}
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            测试连接
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            保存
          </button>
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">
              连接成功，{models.length} 个模型
            </span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">已保存</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="协议类型">
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as "chat" | "responses" | "anthropic")}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
          </Field>

          <Field label="流式响应">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? "开启" : "关闭"}</span>
            </label>
          </Field>
        </div>

        {/* Models */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              模型（{displayModels.length}）
            </p>
            {!isCustom && bankModels.length > 0 && (
              <button
                type="button"
                onClick={handleResetModels}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
              >
                重置为默认
              </button>
            )}
          </div>
          {displayModels.length > 0 ? (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border/30 bg-secondary/10 p-2 space-y-1">
              {displayModels.map((m) => {
                const id = m.id;
                const name = m.name ?? m.id;
                const isCustom = !bankModelIds.has(id);
                const maxOut = "maxOutput" in m && typeof m.maxOutput === "number" ? m.maxOutput : null;
                const ctxWin = "contextWindow" in m && typeof m.contextWindow === "number" ? m.contextWindow : null;
                const checked = selectedModels.has(id);
                return (
                  <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedModels((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                      }}
                      className="accent-primary"
                    />
                    <span className="flex-1 font-mono text-xs text-foreground">{name}</span>
                    {isCustom && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-600 font-medium">自定义</span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                      {maxOut ? `${(maxOut / 1024).toFixed(0)}K out` : ""}{maxOut && ctxWin ? " · " : ""}{ctxWin ? `${(ctxWin / 1024).toFixed(0)}K ctx` : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">点击"测试连接"查看可用模型</p>
          )}
          {/* Custom model input */}
          {!isCustom && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customModelId}
                onChange={(e) => setCustomModelId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomModel(); }}
                placeholder="添加自定义模型 ID"
                className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-mono"
              />
              <button
                type="button"
                onClick={handleAddCustomModel}
                className="px-3 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors"
              >
                添加
              </button>
            </div>
          )}
        </div>

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            高级参数
          </summary>
          <div className="space-y-4 pt-2">
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
            </Field>
          </div>
        </details>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
