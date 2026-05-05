import { useState, useEffect } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { fetchJson } from "../hooks/use-api";
import { TrendingUp, Loader2, Target } from "lucide-react";
import { useServiceStore } from "../store/service";

interface Recommendation {
  readonly confidence: number;
  readonly platform: string;
  readonly genre: string;
  readonly concept: string;
  readonly reasoning: string;
  readonly benchmarkTitles: ReadonlyArray<string>;
}

interface RadarResult {
  readonly marketSummary: string;
  readonly recommendations: ReadonlyArray<Recommendation>;
  readonly timestamp?: string;
}

interface CachedRadarResult {
  result: RadarResult;
  scannedAt: string;
}

interface Nav { toDashboard: () => void }

export function RadarView({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [result, setResult] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // -- Service / model selection --
  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const bankModelsLoading = useServiceStore((s) => s.bankModelsLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);

  useEffect(() => {
    void fetchServices();
    void fetchBankModels();
    void fetchCustomModels();
  }, [fetchServices, fetchBankModels, fetchCustomModels]);

  const connectedServices = services.filter((s) => s.connected);

  const STORAGE_KEY_SVC = "radar:selectedService";
  const STORAGE_KEY_MDL = "radar:selectedModel";
  const STORAGE_KEY_RESULT = "radar:lastResult";

  const [selectedService, setSelectedService] = useState(
    () => localStorage.getItem(STORAGE_KEY_SVC) ?? ""
  );
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(STORAGE_KEY_MDL) ?? ""
  );

  const loadCached = (): CachedRadarResult | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RESULT);
      return raw ? (JSON.parse(raw) as CachedRadarResult) : null;
    } catch {
      return null;
    }
  };

  const [cached, setCached] = useState<CachedRadarResult | null>(() => loadCached());

  const handleServiceChange = (svc: string) => {
    setSelectedService(svc);
    setSelectedModel("");
    localStorage.setItem(STORAGE_KEY_SVC, svc);
    localStorage.removeItem(STORAGE_KEY_MDL);
  };

  const handleModelChange = (mdl: string) => {
    setSelectedModel(mdl);
    localStorage.setItem(STORAGE_KEY_MDL, mdl);
  };

  // Fallback: if saved service is no longer connected, pick first connected
  useEffect(() => {
    if (connectedServices.length === 0) return;
    const saved = localStorage.getItem(STORAGE_KEY_SVC);
    const stillValid = saved && connectedServices.some((s) => s.service === saved);
    if (!stillValid) {
      handleServiceChange(connectedServices[0].service);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedServices]);

  // Auto-select model once models load for the current service
  useEffect(() => {
    if (!selectedService) return;
    const models = modelsByService[selectedService] ?? [];
    if (models.length === 0) return;
    const saved = localStorage.getItem(STORAGE_KEY_MDL);
    const stillValid = saved && models.some((m) => m.id === saved);
    if (!stillValid) {
      handleModelChange(models[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService, modelsByService]);

  const availableModels = modelsByService[selectedService] ?? [];
  const modelsLoadedForSelected = availableModels.length > 0;
  const isLoadingModels = bankModelsLoading && selectedService && !modelsLoadedForSelected;
  const modelsReady = !isLoadingModels && modelsLoadedForSelected;

  const handleScan = async () => {
    if (!selectedService || !selectedModel) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await fetchJson<RadarResult>("/radar/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: selectedService, model: selectedModel }),
      });
      const entry: CachedRadarResult = { result: data, scannedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY_RESULT, JSON.stringify(entry));
      setCached(entry);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.radar")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <TrendingUp size={28} className="text-primary" />
          {t("radar.title")}
        </h1>
        <button
          onClick={handleScan}
          disabled={loading || !modelsReady}
          className={`px-5 py-2.5 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30 flex items-center gap-2`}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Target size={14} />}
          {loading ? t("radar.scanning") : !modelsReady ? t("radar.loadingModels") : t("radar.scan")}
        </button>
      </div>

      {/* Service & Model selector */}
      <div className="flex gap-4 items-end">
        <div className="flex-1 space-y-1.5">
          <label className="text-xs text-muted-foreground/70 font-medium">{t("radar.service")}</label>
          <select
            value={selectedService}
            onChange={(e) => handleServiceChange(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
          >
            {connectedServices.length === 0 && (
              <option value="">{t("radar.noConnectedService")}</option>
            )}
            {connectedServices.map((svc) => (
              <option key={svc.service} value={svc.service}>{svc.label}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 space-y-1.5">
          <label className="text-xs text-muted-foreground/70 font-medium">{t("radar.model")}</label>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={loading || !modelsReady}
            className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
          >
            {isLoadingModels ? (
              <option value="">{t("radar.loadingModels")}</option>
            ) : availableModels.length === 0 ? (
              <option value="">{t("radar.noModelsHint")}</option>
            ) : (
              availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
              ))
            )}
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {(() => {
        const display = result ?? cached?.result ?? null;
        const scannedAt = result ? null : cached?.scannedAt ?? null;
        if (!display) return null;
        return (
          <div className="space-y-6">
            {scannedAt && (
              <p className="text-xs text-muted-foreground/60 text-right">
                {t("radar.cachedAt")}{new Date(scannedAt).toLocaleString()}
              </p>
            )}
            <div className={`border ${c.cardStatic} rounded-lg p-5`}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">{t("radar.summary")}</h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{display.marketSummary}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {display.recommendations.map((rec, i) => (
                <div key={i} className={`border ${c.cardStatic} rounded-lg p-5 space-y-3`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {rec.platform} · {rec.genre}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      rec.confidence >= 0.7 ? "bg-emerald-500/10 text-emerald-600" :
                      rec.confidence >= 0.4 ? "bg-amber-500/10 text-amber-600" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {(rec.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-sm font-semibold">{rec.concept}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{rec.reasoning}</p>
                  {rec.benchmarkTitles.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {rec.benchmarkTitles.map((bt) => (
                        <span key={bt} className="px-2 py-0.5 text-[10px] bg-secondary rounded">{bt}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {!result && !cached && !loading && !error && (
        <div className={`border border-dashed ${c.cardStatic} rounded-lg p-12 text-center text-muted-foreground text-sm italic`}>
          {t("radar.emptyHint")}
        </div>
      )}
    </div>
  );
}
