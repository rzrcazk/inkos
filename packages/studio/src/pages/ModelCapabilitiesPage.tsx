import { useState, useCallback } from "react";
import { useApi, putApi, fetchJson } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";
import type { ModelCapabilityProfile, ModelCapabilities, QuotaLevel } from "../types/model-capability";
import { QUOTA_LEVEL_LABELS, QUOTA_LEVEL_FACTOR } from "../types/model-capability";
import { ArrowLeft, Plus, Trash2, Sparkles, Loader2, ChevronDown, ChevronUp, Pencil, Check, X } from "lucide-react";

interface Nav {
  toDashboard: () => void;
}

const DIM_LABELS: Record<keyof ModelCapabilities, string> = {
  creative: "创意写作",
  reasoning: "推理分析",
  instruction: "指令遵循",
  longContext: "长上下文",
  chinese: "中文能力",
};

const DIM_KEYS = Object.keys(DIM_LABELS) as Array<keyof ModelCapabilities>;

const DEFAULT_CAPS: ModelCapabilities = {
  creative: 5,
  reasoning: 5,
  instruction: 5,
  longContext: 5,
  chinese: 5,
};

const QUOTA_LEVELS = Object.keys(QUOTA_LEVEL_LABELS) as QuotaLevel[];

function CapBar({ value }: { value: number }) {
  const pct = Math.round((value / 10) * 100);
  const color =
    value >= 8 ? "bg-emerald-500" : value >= 6 ? "bg-blue-500" : value >= 4 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-border/30 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums w-4 text-right text-muted-foreground">{value}</span>
    </div>
  );
}

interface ProfileCardProps {
  profile: ModelCapabilityProfile;
  onDelete: (id: string) => void;
  onAnalyze: (id: string) => void;
  onSave: (profile: ModelCapabilityProfile) => void;
  analyzing: boolean;
}

function ProfileCard({ profile, onDelete, onAnalyze, onSave, analyzing }: ProfileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ModelCapabilityProfile>(profile);

  const startEdit = () => {
    setDraft(profile);
    setEditing(true);
    setExpanded(true);
  };

  const cancelEdit = () => {
    setDraft(profile);
    setEditing(false);
  };

  const saveEdit = () => {
    onSave(draft);
    setEditing(false);
  };

  const setDim = (dim: keyof ModelCapabilities, val: number) => {
    setDraft((d) => ({ ...d, capabilities: { ...d.capabilities, [dim]: val } }));
  };

  return (
    <div className="rounded-lg border border-border/30 bg-card/50">
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium truncate">{profile.modelId}</span>
            {profile.displayName && profile.displayName !== profile.modelId && (
              <span className="text-xs text-muted-foreground/60 truncate">({profile.displayName})</span>
            )}
            {profile.source === "analyzed" && (
              <span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary/70">
                AI 分析
              </span>
            )}
          </div>
          {profile.provider && (
            <div className="text-xs text-muted-foreground/50 mt-0.5">{profile.provider}</div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAnalyze(profile.modelId)}
            disabled={analyzing}
            className="inline-flex items-center gap-1 rounded border border-border/40 bg-background/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="用 AI 分析能力"
          >
            {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            分析
          </button>
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center rounded border border-border/40 bg-background/50 p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            title="编辑"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center rounded border border-border/40 bg-background/50 p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            type="button"
            onClick={() => onDelete(profile.modelId)}
            className="inline-flex items-center rounded border border-red-500/20 bg-background/50 p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
            title="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Capability bars preview (collapsed) */}
      {!expanded && (
        <div className="px-4 pb-3 grid grid-cols-3 gap-x-4 gap-y-1">
          {DIM_KEYS.map((dim) => (
            <div key={dim}>
              <div className="text-[10px] text-muted-foreground/50 mb-0.5">{DIM_LABELS[dim]}</div>
              <CapBar value={profile.capabilities[dim] ?? 5} />
            </div>
          ))}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/20 px-4 py-3 space-y-3">
          {/* Capability scores */}
          <div className="grid grid-cols-2 gap-3">
            {DIM_KEYS.map((dim) => (
              <div key={dim}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground/70">{DIM_LABELS[dim]}</span>
                  {editing ? (
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={draft.capabilities[dim] ?? 5}
                      onChange={(e) => setDim(dim, Math.min(10, Math.max(0, Number(e.target.value))))}
                      className="w-12 rounded border border-border/40 bg-background px-1.5 py-0.5 text-xs text-right tabular-nums"
                    />
                  ) : null}
                </div>
                <CapBar value={editing ? (draft.capabilities[dim] ?? 5) : (profile.capabilities[dim] ?? 5)} />
              </div>
            ))}
          </div>

          {/* Notes / analysis text */}
          {editing ? (
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">额度</label>
                <select
                  value={draft.quotaLevel ?? "moderate"}
                  onChange={(e) => setDraft((d) => ({ ...d, quotaLevel: e.target.value as QuotaLevel }))}
                  className="mt-1 w-full rounded border border-border/40 bg-background px-2 py-1.5 text-xs"
                >
                  {QUOTA_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {QUOTA_LEVEL_LABELS[level]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">备注</label>
                <textarea
                  value={draft.notes ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded border border-border/40 bg-background px-2 py-1.5 text-xs resize-none"
                  placeholder="人工备注..."
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">上下文窗口</label>
                <input
                  type="number"
                  value={draft.contextWindow ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, contextWindow: e.target.value ? Number(e.target.value) : undefined }))}
                  placeholder="如 128000"
                  className="mt-1 w-full rounded border border-border/40 bg-background px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">最多分配 Agent 数</label>
                <input
                  type="number"
                  min={1}
                  value={draft.maxSlots ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, maxSlots: e.target.value ? Math.max(1, Number(e.target.value)) : undefined }))}
                  placeholder="留空不限"
                  className="mt-1 w-full rounded border border-border/40 bg-background px-2 py-1.5 text-xs"
                />
                <p className="mt-0.5 text-[10px] text-muted-foreground/40">限制此模型最多被分配给几个 Agent，超出后路由自动选次优模型</p>
              </div>
            </div>
          ) : (
            <>
              {profile.analysisText && (
                <p className="text-xs text-muted-foreground/70 leading-relaxed">{profile.analysisText}</p>
              )}
              {profile.notes && (
                <p className="text-xs text-muted-foreground/60 italic">{profile.notes}</p>
              )}
              {profile.contextWindow && (
                <div className="text-[10px] text-muted-foreground/40">
                  上下文窗口：{profile.contextWindow.toLocaleString()} tokens
                </div>
              )}
              {profile.quotaLevel && (
                <div className="text-[10px] text-muted-foreground/50">
                  额度：{QUOTA_LEVEL_LABELS[profile.quotaLevel]}
                  {" "}（路由系数 {QUOTA_LEVEL_FACTOR[profile.quotaLevel]}）
                </div>
              )}
              {profile.maxSlots != null && (
                <div className="text-[10px] text-amber-500/70">
                  最多分配 {profile.maxSlots} 个 Agent
                </div>
              )}
            </>
          )}

          {/* Edit action buttons */}
          {editing && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={saveEdit}
                className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <Check size={12} />
                保存
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="inline-flex items-center gap-1 rounded border border-border/40 bg-background/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                <X size={12} />
                取消
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AddModelModalProps {
  onAdd: (modelId: string) => void;
  onClose: () => void;
}

function AddModelModal({ onAdd, onClose }: AddModelModalProps) {
  const [modelId, setModelId] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border/30 bg-card shadow-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold">添加模型</h2>
        <div>
          <label className="text-xs text-muted-foreground/70">模型 ID</label>
          <input
            autoFocus
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && modelId.trim() && onAdd(modelId.trim())}
            placeholder="如 claude-opus-4-5"
            className="mt-1 w-full rounded border border-border/40 bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[10px] text-muted-foreground/40">
            填写后可手动打分或点「分析」让 AI 自动评估
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => modelId.trim() && onAdd(modelId.trim())}
            disabled={!modelId.trim()}
            className="flex-1 rounded border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            添加
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-border/40 bg-background/50 px-3 py-2 text-sm text-muted-foreground hover:bg-secondary/50 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModelCapabilitiesPage({ nav, t: _t }: { nav: Nav; t: TFunction }) {
  const { data, refetch } = useApi<{ profiles: ModelCapabilityProfile[] }>("/model-capabilities");
  const profiles = data?.profiles ?? [];

  const [showAddModal, setShowAddModal] = useState(false);
  const [analyzingSet, setAnalyzingSet] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const filtered = search
    ? profiles.filter(
        (p) =>
          p.modelId.toLowerCase().includes(search.toLowerCase()) ||
          (p.displayName ?? "").toLowerCase().includes(search.toLowerCase()) ||
          (p.provider ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : profiles;

  const handleAdd = useCallback(async (modelId: string) => {
    setShowAddModal(false);
    const newProfile: ModelCapabilityProfile = {
      modelId,
      capabilities: { ...DEFAULT_CAPS },
      source: "manual",
      lastUpdated: new Date().toISOString(),
    };
    await putApi(`/model-capabilities/${encodeURIComponent(modelId)}`, newProfile);
    refetch?.();
  }, [refetch]);

  const handleSave = useCallback(async (profile: ModelCapabilityProfile) => {
    await putApi(`/model-capabilities/${encodeURIComponent(profile.modelId)}`, profile);
    refetch?.();
  }, [refetch]);

  const handleDelete = useCallback(async (modelId: string) => {
    await fetchJson(`/model-capabilities/${encodeURIComponent(modelId)}`, { method: "DELETE" });
    refetch?.();
  }, [refetch]);

  const handleAnalyze = useCallback(async (modelId: string) => {
    setAnalyzingSet((s) => new Set(s).add(modelId));
    try {
      await fetchJson(`/model-capabilities/${encodeURIComponent(modelId)}/analyze`, { method: "POST" });
      refetch?.();
    } finally {
      setAnalyzingSet((s) => {
        const next = new Set(s);
        next.delete(modelId);
        return next;
      });
    }
  }, [refetch]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          onClick={nav.toDashboard}
          className="inline-flex items-center rounded-lg border border-border/50 bg-card/60 px-3 py-1.5 font-medium text-foreground hover:bg-secondary/50 transition-colors"
        >
          <ArrowLeft size={14} className="mr-1" />
          首页
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">模型能力档案</span>
      </div>

      {/* Title */}
      <div>
        <h1 className="font-serif text-2xl">模型能力档案</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          记录各模型在写作场景下的能力评分，智能路由据此分配最合适的模型给每个 Agent。
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索模型..."
          className="flex-1 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          <Plus size={14} />
          添加模型
        </button>
      </div>

      {/* Profiles list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/30 bg-card/30 py-16 text-center">
          <p className="text-sm text-muted-foreground/60">
            {profiles.length === 0 ? "暂无模型档案，点击「添加模型」开始" : "没有匹配的模型"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((profile) => (
            <ProfileCard
              key={profile.modelId}
              profile={profile}
              onDelete={handleDelete}
              onAnalyze={handleAnalyze}
              onSave={handleSave}
              analyzing={analyzingSet.has(profile.modelId)}
            />
          ))}
        </div>
      )}

      {/* Add modal */}
      {showAddModal && (
        <AddModelModal onAdd={handleAdd} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
