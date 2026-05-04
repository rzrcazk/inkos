import { useEffect, useState, useMemo } from "react";
import { useApi, putApi } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import type { TFunction } from "../hooks/use-i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { ArrowLeft, Settings2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface Nav {
  toDashboard: () => void;
}

const AGENTS = [
  { key: "writer", labelKey: "config.agent.writer" as const },
  { key: "auditor", labelKey: "config.agent.auditor" as const },
  { key: "reviser", labelKey: "config.agent.reviser" as const },
  { key: "architect", labelKey: "config.agent.architect" as const },
  { key: "radar", labelKey: "config.agent.radar" as const },
  { key: "chapter-analyzer", labelKey: "config.agent.chapterAnalyzer" as const },
] as const;

interface AgentOverride {
  enabled: boolean;
  service: string;
  model: string;
  baseUrl?: string;
  stream?: boolean;
}

export function ModelRoutingPage({ nav, t }: { nav: Nav; t: TFunction }) {
  const { data: overridesData, loading: overridesLoading } = useApi<{
    overrides: Record<string, unknown>;
  }>("/project/model-overrides");

  const { data: servicesConfig } = useApi<{
    service: string | null;
    defaultModel: string | null;
  }>("/services/config");

  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const bankModelsLoading = useServiceStore((s) => s.bankModelsLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);

  const [form, setForm] = useState<Record<string, AgentOverride>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [showAdvanced, setShowAdvanced] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void fetchServices();
    void fetchBankModels();
  }, [fetchServices, fetchBankModels]);

  useEffect(() => {
    if (overridesLoading) return;
    const initial: Record<string, AgentOverride> = {};
    for (const agent of AGENTS) {
      const raw = overridesData?.overrides?.[agent.key];
      if (typeof raw === "string" && raw) {
        initial[agent.key] = { enabled: true, service: "", model: raw };
      } else if (raw && typeof raw === "object" && "model" in raw) {
        const obj = raw as Record<string, unknown>;
        initial[agent.key] = {
          enabled: true,
          service: (obj.service as string) || "",
          model: (obj.model as string) || "",
          baseUrl: (obj.baseUrl as string) || undefined,
          stream: (obj.stream as boolean) ?? undefined,
        };
      } else {
        initial[agent.key] = { enabled: false, service: "", model: "" };
      }
    }
    setForm(initial);
    setSaveStatus("idle");
  }, [overridesData, overridesLoading]);

  const connectedServices = useMemo(
    () => services.filter((s) => s.connected),
    [services],
  );

  const updateAgent = (agentKey: string, patch: Partial<AgentOverride>) => {
    setForm((prev) => ({
      ...prev,
      [agentKey]: { ...prev[agentKey]!, ...patch },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      const overrides: Record<string, unknown> = {};
      for (const [agent, override] of Object.entries(form)) {
        if (!override.enabled || !override.model) continue;
        const entry: Record<string, unknown> = { model: override.model };
        if (override.service) entry.service = override.service;
        if (override.baseUrl) entry.baseUrl = override.baseUrl;
        if (override.stream !== undefined) entry.stream = override.stream;
        overrides[agent] = entry;
      }
      await putApi("/project/model-overrides", { overrides });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const defaultServiceLabel = servicesConfig?.service
    ? services.find((s) => s.service === servicesConfig.service)?.label || servicesConfig.service
    : null;

  const loading = overridesLoading || bankModelsLoading;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={nav.toDashboard}
          className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 px-3 py-1.5 font-medium text-foreground hover:bg-secondary/50 transition-colors"
        >
          <ArrowLeft size={14} className="mr-1" />
          首页
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("config.modelRouting")}</span>
      </div>

      <div>
        <h1 className="font-serif text-2xl">{t("config.modelRouting")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("config.modelRoutingDesc")}</p>
      </div>

      {/* Default model card */}
      <div className="rounded-lg border border-border/30 bg-card/50 p-4">
        <div className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">
          {t("config.defaultModel")}
        </div>
        <div className="text-sm font-medium">
          {defaultServiceLabel && servicesConfig?.defaultModel
            ? `${servicesConfig.defaultModel} (${defaultServiceLabel})`
            : servicesConfig?.defaultModel || "未设置"}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="mr-2 animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="space-y-3">
          {AGENTS.map((agent) => {
            const o = form[agent.key]!;
            const models = o.service ? (modelsByService[o.service] ?? []) : [];

            return (
              <div key={agent.key} className="rounded-lg border border-border/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Settings2 size={16} className="text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{t(agent.labelKey)}</span>
                    {o.enabled && o.model && (
                      <span className="text-xs text-muted-foreground/60 font-mono truncate">
                        → {o.model}
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={o.enabled}
                    onCheckedChange={(checked) => updateAgent(agent.key, { enabled: checked })}
                  />
                </div>

                {o.enabled && (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-2 gap-3">
                      {/* Service select */}
                      <Select
                        value={o.service}
                        onValueChange={(v) => updateAgent(agent.key, { service: v ?? "", model: "" })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("config.selectService")} />
                        </SelectTrigger>
                        <SelectContent>
                          {connectedServices.map((svc) => (
                            <SelectItem key={svc.service} value={svc.service}>
                              {svc.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Model select */}
                      <Select
                        value={o.model}
                        onValueChange={(v) => updateAgent(agent.key, { model: v ?? "" })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("config.selectModel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {models.length === 0 && (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              {o.service ? "加载中..." : "先选择服务"}
                            </div>
                          )}
                          {models.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.name || m.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Advanced section */}
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          setShowAdvanced((prev) => ({
                            ...prev,
                            [agent.key]: !prev[agent.key],
                          }))
                        }
                        className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        {showAdvanced[agent.key] ? "收起" : t("config.advanced")}
                      </button>

                      {showAdvanced[agent.key] && (
                        <div className="mt-2 space-y-3">
                          <input
                            type="text"
                            value={o.baseUrl || ""}
                            onChange={(e) => updateAgent(agent.key, { baseUrl: e.target.value || undefined })}
                            placeholder={t("config.baseUrl") + " (" + t("config.optional") + ")"}
                            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary/50"
                          />
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={o.stream ?? true}
                              onChange={(e) => updateAgent(agent.key, { stream: e.target.checked })}
                              className="rounded border-border/60"
                            />
                            {t("config.streamToggle")}
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Save bar */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2 text-sm">
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle2 size={14} /> {t("config.saved")}
            </span>
          )}
          {saveStatus === "error" && (
            <span className="flex items-center gap-1 text-red-600">
              <AlertCircle size={14} /> {t("config.saveError")}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !Object.values(form).some((o) => o.enabled && o.model)}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("config.saving")}
            </>
          ) : (
            t("config.saveOverrides")
          )}
        </button>
      </div>
    </div>
  );
}
