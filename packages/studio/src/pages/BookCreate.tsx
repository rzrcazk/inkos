import { useCallback, useEffect, useRef, useState } from "react";
import type { BookCreationDraft } from "@actalk/inkos-core";
import { fetchJson, useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
}

interface PlatformOption {
  readonly value: string;
  readonly label: string;
}

export interface DraftSummaryRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

interface AgentResponse {
  readonly response?: string;
  readonly error?: string;
  readonly session?: {
    readonly activeBookId?: string;
  };
}

interface BookSessionSummary {
  readonly sessionId: string;
  readonly bookId: string | null;
  readonly title: string | null;
  readonly messageCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface SessionsResponse {
  readonly sessions: BookSessionSummary[];
}

interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

interface LoadedSession {
  readonly sessionId: string;
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
}

const PLATFORMS_ZH: ReadonlyArray<PlatformOption> = [
  { value: "tomato", label: "番茄小说" },
  { value: "qidian", label: "起点中文网" },
  { value: "feilu", label: "飞卢" },
  { value: "other", label: "其他" },
];

const PLATFORMS_EN: ReadonlyArray<PlatformOption> = [
  { value: "royal-road", label: "Royal Road" },
  { value: "kindle-unlimited", label: "Kindle Unlimited" },
  { value: "scribble-hub", label: "Scribble Hub" },
  { value: "other", label: "Other" },
];

// -- Pure utility functions (exported for tests) --

export function pickValidValue(current: string, available: ReadonlyArray<string>): string {
  if (current && available.includes(current)) {
    return current;
  }
  return available[0] ?? "";
}

export function defaultChapterWordsForLanguage(language: "zh" | "en"): string {
  return language === "en" ? "2000" : "3000";
}

export function platformOptionsForLanguage(language: "zh" | "en"): ReadonlyArray<PlatformOption> {
  return language === "en" ? PLATFORMS_EN : PLATFORMS_ZH;
}

export function resolveDraftInstruction(input: string, hasDraft: boolean): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  return hasDraft ? trimmed : `/new ${trimmed}`;
}

export function canCreateFromDraft(draft?: BookCreationDraft): boolean {
  if (!draft) {
    return false;
  }
  if (draft.readyToCreate) {
    return true;
  }
  return Boolean(
    draft.title?.trim()
      && draft.genre?.trim()
      && typeof draft.targetChapters === "number"
      && typeof draft.chapterWordCount === "number",
  );
}

export function buildCreationDraftSummary(
  draft: BookCreationDraft,
  language: "zh" | "en",
): ReadonlyArray<DraftSummaryRow> {
  const rows = language === "en"
    ? [
        draft.title ? { key: "title", label: "Title", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "World", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "Protagonist", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "Core Conflict", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "Volume Direction", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "Blurb", value: draft.blurb } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "Next", value: draft.nextQuestion } : undefined,
      ]
    : [
        draft.title ? { key: "title", label: "书名", value: draft.title } : undefined,
        draft.worldPremise ? { key: "worldPremise", label: "世界观", value: draft.worldPremise } : undefined,
        draft.protagonist ? { key: "protagonist", label: "主角", value: draft.protagonist } : undefined,
        draft.conflictCore ? { key: "conflictCore", label: "核心冲突", value: draft.conflictCore } : undefined,
        draft.volumeOutline ? { key: "volumeOutline", label: "卷纲方向", value: draft.volumeOutline } : undefined,
        draft.blurb ? { key: "blurb", label: "简介", value: draft.blurb } : undefined,
        draft.nextQuestion ? { key: "nextQuestion", label: "下一步", value: draft.nextQuestion } : undefined,
      ];

  return rows.filter((row): row is DraftSummaryRow => Boolean(row));
}

interface WaitForBookReadyOptions {
  readonly fetchBook?: (bookId: string) => Promise<unknown>;
  readonly fetchStatus?: (bookId: string) => Promise<{ status: string; error?: string }>;
  readonly maxAttempts?: number;
  readonly delayMs?: number;
  readonly waitImpl?: (ms: number) => Promise<void>;
}

const DEFAULT_BOOK_READY_MAX_ATTEMPTS = 120;
const DEFAULT_BOOK_READY_DELAY_MS = 250;

export async function waitForBookReady(
  bookId: string,
  options: WaitForBookReadyOptions = {},
): Promise<void> {
  const fetchBook = options.fetchBook ?? ((id: string) => fetchJson(`/books/${id}`));
  const fetchStatus = options.fetchStatus ?? ((id: string) => fetchJson<{ status: string; error?: string }>(`/books/${id}/create-status`));
  const maxAttempts = options.maxAttempts ?? DEFAULT_BOOK_READY_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_BOOK_READY_DELAY_MS;
  const waitImpl = options.waitImpl ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));

  let lastError: unknown;
  let lastKnownStatus: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fetchBook(bookId);
      return;
    } catch (error) {
      lastError = error;
      try {
        const status = await fetchStatus(bookId);
        lastKnownStatus = status.status;
        if (status.status === "error") {
          throw new Error(status.error ?? `Book "${bookId}" failed to create`);
        }
      } catch (statusError) {
        if (statusError instanceof Error && statusError.message !== "404 Not Found") {
          throw statusError;
        }
      }
      if (attempt === maxAttempts - 1) {
        if (lastKnownStatus === "creating") {
          break;
        }
        throw error;
      }
      await waitImpl(delayMs);
    }
  }

  if (lastKnownStatus === "creating") {
    throw new Error(`Book "${bookId}" is still being created. Wait a moment and refresh.`);
  }

  throw lastError instanceof Error ? lastError : new Error(`Book "${bookId}" was not ready`);
}

// -- Component --

export function BookCreate({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: project } = useApi<{ language: string }>("/project");
  const projectLang = (project?.language ?? "zh") as "zh" | "en";

  const [view, setView] = useState<"list" | "chat">("list");
  const [sessions, setSessions] = useState<BookSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await fetchJson<SessionsResponse>("/sessions?bookId=null");
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (view === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, view]);

  const enterChat = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMessages([]);
    setError(null);
    setInput("");
    try {
      const data = await fetchJson<{ session: LoadedSession }>(`/sessions/${sessionId}`);
      const loaded = (data.session?.messages ?? [])
        .filter((m): m is ChatMessage => m.role === "user" || m.role === "assistant");
      setMessages(loaded);
    } catch {
      // Start with empty history if load fails
    }
    setView("chat");
  };

  const handleNewIdea = async () => {
    const newSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fetchJson<unknown>("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: newSessionId, bookId: null }),
      });
    } catch {
      // Session creation failure is non-fatal; agent will handle missing session
    }
    setActiveSessionId(newSessionId);
    setMessages([]);
    setInput("");
    setError(null);
    setView("chat");
  };

  const handleDeleteSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await fetchJson<unknown>(`/sessions/${sessionId}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const handleBack = () => {
    setView("list");
    setActiveSessionId(null);
    setMessages([]);
    setError(null);
    void loadSessions();
  };

  const handleSend = async () => {
    if (!input.trim() || !activeSessionId || submitting || creating) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setSubmitting(true);
    setError(null);

    try {
      const data = await fetchJson<AgentResponse>("/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: userMessage, sessionId: activeSessionId }),
      });

      if (data.response) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.response! }]);
      }

      if (data.session?.activeBookId) {
        setCreating(true);
        setSubmitting(false);
        try {
          await waitForBookReady(data.session.activeBookId);
          nav.toBook(data.session.activeBookId);
        } finally {
          setCreating(false);
        }
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      // Roll back the optimistically added user message
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSend();
    }
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString(projectLang === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // -- Chat view --
  if (view === "chat" && activeSessionId) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col h-full space-y-0">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
          <span className="text-border">/</span>
          <button onClick={handleBack} className={c.link}>{t("bread.newBook")}</button>
          <span className="text-border">/</span>
          <span>{projectLang === "zh" ? "对话" : "Chat"}</span>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={handleBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← {projectLang === "zh" ? "返回列表" : "Back to list"}
          </button>
        </div>

        <div className="flex-1 space-y-4 min-h-0 overflow-y-auto pb-4">
          {messages.length === 0 && !submitting && (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/50 px-5 py-8 text-center">
              <div className="font-medium text-foreground">
                {projectLang === "zh" ? "从一句话开始" : "Start with a rough idea"}
              </div>
              <p className="mt-2 text-sm text-muted-foreground leading-7">
                {projectLang === "zh"
                  ? "描述题材、世界观、主角或核心冲突，助手会帮你逐步完善。"
                  : "Describe your genre, world, protagonist, or conflict — the assistant will guide you from there."}
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-7 whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border/60 text-foreground"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {(submitting || creating) && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-card border border-border/60 px-4 py-3 text-sm text-muted-foreground">
                {creating
                  ? (projectLang === "zh" ? "创建书籍中…" : "Creating book…")
                  : (projectLang === "zh" ? "思考中…" : "Thinking…")}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className={`border ${c.error} rounded-md px-4 py-3 text-sm mt-2`}>
            {error}
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-border/60 bg-card/70 p-4 space-y-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={4}
            disabled={submitting || creating}
            className={`w-full ${c.input} rounded-xl px-4 py-3 focus:outline-none text-sm leading-7 resize-none disabled:opacity-50`}
            placeholder={
              projectLang === "zh"
                ? "描述你的想法…（Ctrl+Enter 发送）"
                : "Describe your idea… (Ctrl+Enter to send)"
            }
          />
          <div className="flex justify-end">
            <button
              onClick={() => void handleSend()}
              disabled={submitting || creating || !input.trim()}
              className={`px-4 py-2 ${c.btnPrimary} rounded-md disabled:opacity-50 font-medium text-sm`}
            >
              {submitting
                ? (projectLang === "zh" ? "处理中…" : "Working…")
                : (projectLang === "zh" ? "发送" : "Send")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -- List view --
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <span>{t("bread.newBook")}</span>
      </div>

      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl">{t("create.title")}</h1>
          <p className="text-sm text-muted-foreground leading-7">
            {projectLang === "zh"
              ? "每个想法独立保存，可随时继续或放弃。"
              : "Each idea is saved independently — continue or discard any time."}
          </p>
        </div>
        <button
          onClick={() => void handleNewIdea()}
          className={`px-4 py-2 ${c.btnPrimary} rounded-md font-medium text-sm shrink-0 mt-1`}
        >
          {projectLang === "zh" ? "+ 新想法" : "+ New idea"}
        </button>
      </div>

      {error && (
        <div className={`border ${c.error} rounded-md px-4 py-3 text-sm`}>
          {error}
        </div>
      )}

      {loadingSessions ? (
        <div className="text-sm text-muted-foreground">
          {projectLang === "zh" ? "加载中…" : "Loading…"}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-background/50 px-6 py-12 text-center">
          <div className="font-medium text-foreground">
            {projectLang === "zh" ? "还没有任何想法" : "No ideas yet"}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {projectLang === "zh"
              ? "点击「+ 新想法」开始创作你的第一本书。"
              : "Click the button above to start building your first book."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className="rounded-2xl border border-border/60 bg-card/70 px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:border-border transition-colors"
              onClick={() => void enterChat(session.sessionId)}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {session.title ?? (projectLang === "zh" ? "未命名想法" : "Untitled idea")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(session.updatedAt)}
                  {session.messageCount > 0 && (
                    <span className="ml-2">
                      · {session.messageCount}{projectLang === "zh" ? " 条消息" : " messages"}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => void enterChat(session.sessionId)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md ${c.btnPrimary}`}
                >
                  {projectLang === "zh" ? "继续" : "Continue"}
                </button>
                <button
                  onClick={(e) => void handleDeleteSession(session.sessionId, e)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
                >
                  {projectLang === "zh" ? "删除" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
