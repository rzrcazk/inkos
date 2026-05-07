import { useEffect, useState, useMemo } from "react";
import { useApi, putApi, fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import type { TFunction, StringKey } from "../hooks/use-i18n";
import { useSmartRouting } from "../hooks/use-smart-routing";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import {
  ArrowLeft,
  Settings2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronDown,
} from "lucide-react";

interface Nav {
  toDashboard: () => void;
}

const AGENTS = [
  { key: "writer", labelKey: "config.agent.writer" as const },
  { key: "architect", labelKey: "config.agent.architect" as const },
  { key: "foundation-reviewer", labelKey: "config.agent.foundationReviewer" as const },
  { key: "planner", labelKey: "config.agent.planner" as const },
  { key: "auditor", labelKey: "config.agent.auditor" as const },
  { key: "reviser", labelKey: "config.agent.reviser" as const },
  { key: "polisher", labelKey: "config.agent.polisher" as const },
  { key: "length-normalizer", labelKey: "config.agent.lengthNormalizer" as const },
  { key: "chapter-analyzer", labelKey: "config.agent.chapterAnalyzer" as const },
  { key: "state-validator", labelKey: "config.agent.stateValidator" as const },
  { key: "radar", labelKey: "config.agent.radar" as const },
  { key: "fanfic-canon-importer", labelKey: "config.agent.fanficCanonImporter" as const },
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
    services: ReadonlyArray<{ service: string; connected: boolean; selectedModels?: readonly string[] }>;
  }>("/services/config");

  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const bankModelsLoading = useServiceStore((s) => s.bankModelsLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);
  const customModelsLoading = useServiceStore((s) => s.customModelsLoading);
  const fetchLiveModels = useServiceStore((s) => s.fetchLiveModels);

  const [form, setForm] = useState<Record<string, AgentOverride>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [showAdvanced, setShowAdvanced] = useState<Record<string, boolean>>({});
  const [showSmartRouting, setShowSmartRouting] = useState(false);

  // Default model state
  const [defaultService, setDefaultService] = useState(servicesConfig?.service ?? "");
  const [defaultModel, setDefaultModel] = useState(servicesConfig?.defaultModel ?? "");

  useEffect(() => {
    if (!servicesConfig) return;
    setDefaultService(servicesConfig.service ?? "");
    setDefaultModel(servicesConfig.defaultModel ?? "");
  }, [servicesConfig]);

  useEffect(() => {
    void fetchServices();
    void fetchBankModels();
    void fetchCustomModels();
  }, [fetchServices, fetchBankModels, fetchCustomModels]);

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
    () => services.filter((s) => s.connected && s.enabled !== false),
    [services],
  );

  // Live-probe models for connected services whose bank has no entry yet (e.g. newapi, ollama).
  // Intentionally checks key existence, not length, to avoid re-fetching when the probe
  // returned an empty list (e.g. no selectedModels configured).
  useEffect(() => {
    if (bankModelsLoading) return;
    for (const svc of connectedServices) {
      if (svc.service.startsWith("custom")) continue;
      if (!(svc.service in modelsByService)) {
        void fetchLiveModels(svc.service);
      }
    }
  }, [bankModelsLoading, connectedServices, modelsByService, fetchLiveModels]);

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
      // Save default model
      await putApi("/services/config", {
        service: defaultService || undefined,
        defaultModel: defaultModel || undefined,
      });

      // Save agent overrides
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

  const defaultModelChanged =
    defaultService !== (servicesConfig?.service ?? "") ||
    defaultModel !== (servicesConfig?.defaultModel ?? "");

  // Build a map: service key → allowed model IDs (from selectedModels config).
  // When selectedModels is set, only those models appear in routing dropdowns.
  const selectedByService = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const svc of servicesConfig?.services ?? []) {
      if (svc.selectedModels && svc.selectedModels.length > 0) {
        map.set(svc.service, new Set(svc.selectedModels.map((s) => s.toLowerCase())));
      }
    }
    return map;
  }, [servicesConfig?.services]);

  const defaultModels = defaultService
    ? (() => {
        const selected = selectedByService.get(defaultService);
        if (selected && selected.size > 0) {
          const bank = modelsByService[defaultService] ?? [];
          const fromBank = bank.filter((m) => selected.has(m.id.toLowerCase()));
          return fromBank.length > 0 ? fromBank : [...selected].map((id) => ({ id, name: id }));
        }
        return modelsByService[defaultService] ?? [];
      })()
    : [];

  const hasAgentOverride = Object.values(form).some((o) => o.enabled && o.model);

  const liveModelsLoadingMap = useServiceStore((s) => s.liveModelsLoading);
  const liveModelsLoading = Object.values(liveModelsLoadingMap).some(Boolean);

  const loading = overridesLoading || bankModelsLoading || customModelsLoading || liveModelsLoading;

  // Smart routing recommendations
  const recommendations = useSmartRouting(
    connectedServices,
    modelsByService,
    defaultModel,
    defaultService,
  );

  // Agent key → label map for the recommendations panel
  const agentLabelMap: Record<string, string> = {};
  for (const a of AGENTS) {
    agentLabelMap[a.key] = t(a.labelKey);
  }

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
      <div className="rounded-lg border border-border/30 bg-card/50 p-4 space-y-3">
        <div className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
          {t("config.defaultModel")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Service select */}
          <Select
            value={defaultService || null}
            onValueChange={(v) => {
              setDefaultService(v ?? "");
              setDefaultModel("");
            }}
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
            value={defaultModel || null}
            onValueChange={(v) => setDefaultModel(v ?? "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("config.selectModel")} />
            </SelectTrigger>
            <SelectContent>
              {defaultModels.length === 0 ? (
                <SelectGroup>
                  <SelectLabel>
                    {!defaultService
                      ? "先选择服务"
                      : liveModelsLoadingMap[defaultService]
                        ? "加载中..."
                        : "无可用模型"}
                  </SelectLabel>
                </SelectGroup>
              ) : (
                defaultModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.id}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        {defaultModel && (
          <div className="text-xs text-muted-foreground/60 font-mono">
            {defaultModel}
          </div>
        )}
      </div>

      {/* Smart routing panel */}
      {showSmartRouting && (
        <div className="rounded-lg border border-border/30 bg-card/50 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-500" />
            <span className="text-sm font-medium">{t("config.smartRoutingPanel")}</span>
          </div>

          {/* Routing rules (collapsible) */}
          <SmartRoutingRules t={t} />

          {/* Recommendations list */}
          <div className="space-y-2">
            {recommendations.map((r) => (
              <div
                key={r.agentKey}
                className="flex items-start gap-3 rounded-md border border-border/20 bg-background/50 p-3"
              >
                <div className="min-w-[72px] shrink-0 text-sm font-medium">
                  {agentLabelMap[r.agentKey]}
                </div>
                <div className="flex-1 min-w-0">
                  {r.isFallback ? (
                    <span className="text-xs text-muted-foreground/60 italic">
                      {t("config.usingDefaultModel")}: {r.modelId}
                    </span>
                  ) : (
                    <>
                      <span className="text-xs font-mono text-foreground">{r.modelId}</span>
                      {r.serviceName && (
                        <span className="ml-2 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary/80">
                          {r.serviceName}
                        </span>
                      )}
                      <div className="text-xs text-muted-foreground/60 mt-0.5">
                        ↳ {t(`config.reason.${r.reasonKey}` as StringKey) || ""}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Apply button (disabled) */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/20">
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-4 py-2 text-sm font-medium text-muted-foreground/60 cursor-not-allowed"
              title={t("config.notYetAvailable")}
            >
              {t("config.applyRecommendations")}
              <span className="text-[11px] opacity-70">({t("config.notYetAvailable")})</span>
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 size={20} className="mr-2 animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="space-y-3">
          {AGENTS.map((agent) => {
            const o = form[agent.key]!;
            const selected = o.service ? selectedByService.get(o.service) : undefined;
            const models = (() => {
              if (!o.service) return [];
              if (selected && selected.size > 0) {
                const bank = modelsByService[o.service] ?? [];
                const fromBank = bank.filter((m) => selected.has(m.id.toLowerCase()));
                return fromBank.length > 0 ? fromBank : [...selected].map((id) => ({ id, name: id }));
              }
              return modelsByService[o.service] ?? [];
            })();

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
                        value={o.service || null}
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
                        value={o.model || null}
                        onValueChange={(v) => updateAgent(agent.key, { model: v ?? "" })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("config.selectModel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {models.length === 0 ? (
                            <SelectGroup>
                              <SelectLabel>
                                {!o.service
                                  ? "先选择服务"
                                  : liveModelsLoadingMap[o.service]
                                    ? "加载中..."
                                    : "无可用模型"}
                              </SelectLabel>
                            </SelectGroup>
                          ) : (
                            models.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name || m.id}
                              </SelectItem>
                            ))
                          )}
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSmartRouting((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              showSmartRouting
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-card/50 text-foreground hover:bg-secondary/50"
            }`}
          >
            <Sparkles size={14} />
            {t("config.smartRouting")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (!hasAgentOverride && !defaultModelChanged)}
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
    </div>
  );
}

// Collapsible routing rules section
const TIERS = [
  { tierKey: "top", color: "text-purple-600" as const, agents: "写手, 建筑师, 审核" },
  { tierKey: "high", color: "text-amber-600" as const, agents: "审计员, 修订者" },
  { tierKey: "midhigh", color: "text-blue-600" as const, agents: "规划师, 章节分析, 同人导入" },
  { tierKey: "mid", color: "text-green-600" as const, agents: "雷达, 润色, 状态校验, 字数规范化" },
];

function SmartRoutingRules({ t }: { t: TFunction }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-md border border-border/20 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <ChevronDown
            size={12}
            className={`transition-transform ${open ? "" : "-rotate-90"}`}
          />
          {t("config.routingRules")}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {TIERS.map((tier) => (
            <div key={tier.tierKey} className="flex items-start gap-2 text-xs">
              <span className={`shrink-0 font-medium ${tier.color}`}>
                {t(`config.tier.${tier.tierKey}` as StringKey)}
              </span>
              <span className="text-muted-foreground/60">
                {t(`config.tier.${tier.tierKey}.desc` as StringKey)}
              </span>
              <span className="text-muted-foreground/40 ml-auto shrink-0">
                → {tier.agents}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
