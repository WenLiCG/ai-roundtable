"use client";

import {
  Bot,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  History,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/constants";
import type { RunEvent } from "@/lib/events";

type ExecutionMode = "concurrent" | "sequential";
type ThemeMode = "light" | "dark";
type AuthState = "checking" | "authenticated" | "guest";

type AiModelView = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  maxInputChars: number | null;
};

type ResponseStatus = "pending" | "streaming" | "success" | "failed" | "timeout" | "cancelled";

type ResponseView = {
  id: string;
  modelId: string;
  modelName: string;
  modelRef: string;
  status: ResponseStatus;
  content: string;
  error?: string;
  attempts?: number;
  latencyMs?: number;
};

type RoundView = {
  id: string;
  roundNumber: number;
  prompt: string;
  stitchedContent: string;
  responses: ResponseView[];
};

type LiveDiscussion = {
  id?: string;
  question: string;
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  rounds: RoundView[];
};

type HistoryItem = {
  id: string;
  question: string;
  status: string;
  maxRounds: number;
  createdAt: string;
  completedAt?: string | null;
  roundCount: number;
  responseCount: number;
  failedCount: number;
};

type DiscussionDetail = {
  id: string;
  question: string;
  status: LiveDiscussion["status"];
  rounds: Array<{
    id: string;
    roundNumber: number;
    prompt: string;
    stitchedContent: string | null;
    responses: Array<{
      id: string;
      aiModelId: string | null;
      modelName: string;
      modelRef: string;
      status: ResponseStatus;
      content: string;
      error: string | null;
      attemptCount: number;
      latencyMs: number | null;
    }>;
  }>;
};

const emptyModelForm = {
  name: "",
  baseUrl: "https://api.openai.com",
  apiKey: "",
  model: "",
  enabled: true,
  timeoutMs: 120000,
  maxInputChars: "",
};

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function StatusIcon({ status }: { status: ResponseStatus | LiveDiscussion["status"] | string }) {
  if (status === "success" || status === "completed") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  }

  if (status === "streaming" || status === "running") {
    return <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />;
  }

  if (status === "failed" || status === "timeout") {
    return <XCircle className="h-4 w-4 text-rose-400" />;
  }

  return <Clock className="h-4 w-4 text-zinc-400" />;
}

function CopyButton({ text, label = "复制" }: { text?: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!text?.trim()) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text?.trim()}
      className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-700 px-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      title={label}
    >
      <Copy className="h-3.5 w-3.5" />
      {copied ? "已复制" : label}
    </button>
  );
}

function MarkdownBlock({ content, empty = "暂无内容" }: { content?: string; empty?: string }) {
  if (!content?.trim()) {
    return <p className="text-sm text-zinc-500">{empty}</p>;
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

function OutputPanel({
  title,
  content,
  empty,
  tone = "default",
}: {
  title: string;
  content?: string;
  empty?: string;
  tone?: "default" | "prompt" | "answer" | "error";
}) {
  const [expanded, setExpanded] = useState(false);
  const maxPreviewLength = 420;
  const shouldCollapse = Boolean(content && content.length > maxPreviewLength);
  const visibleContent =
    shouldCollapse && !expanded ? `${content?.slice(0, maxPreviewLength)}\n\n...` : content;

  return (
    <div
      className={classNames(
        "rounded-lg border p-4",
        tone === "prompt" && "border-cyan-900/70 bg-cyan-950/20",
        tone === "answer" && "border-zinc-800 bg-neutral-950",
        tone === "error" && "border-rose-900/70 bg-rose-950/25",
        tone === "default" && "border-zinc-800 bg-neutral-950",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-zinc-200">{title}</h4>
      </div>
      <MarkdownBlock content={visibleContent} empty={empty} />
      <div className="mt-4 flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="h-8 rounded-md border border-zinc-700 px-2 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          >
            {expanded ? "收起" : "显示全部"}
          </button>
        )}
        <CopyButton text={content} />
      </div>
    </div>
  );
}

export function RoundtableApp() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [activeView, setActiveView] = useState<"run" | "models" | "history">("run");
  const [models, setModels] = useState<AiModelView[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [maxRounds, setMaxRounds] = useState(3);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("concurrent");
  const [promptTemplate, setPromptTemplate] = useState(DEFAULT_PROMPT_TEMPLATE);
  const [selectedAiPage, setSelectedAiPage] = useState<string>("");
  const [liveDiscussion, setLiveDiscussion] = useState<LiveDiscussion>({
    question: "",
    status: "idle",
    rounds: [],
  });
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const enabledModels = useMemo(() => models.filter((model) => model.enabled), [models]);
  const selectedModels = useMemo(
    () => models.filter((model) => selectedModelIds.includes(model.id)),
    [models, selectedModelIds],
  );

  useEffect(() => {
    void checkAuth();
  }, []);

  useEffect(() => {
    if (authState === "authenticated") {
      void refreshModels();
      void refreshHistory();
    }
  }, [authState]);

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      const data = (await response.json()) as { authenticated?: boolean };
      setAuthState(data.authenticated ? "authenticated" : "guest");
    } catch {
      setAuthState("guest");
    }
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSigningIn(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "登录失败。");
      }

      setLoginPassword("");
      setAuthState("authenticated");
      setMessage("已登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败。");
    } finally {
      setIsSigningIn(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    abortRef.current?.abort();
    setAuthState("guest");
    setModels([]);
    setHistoryItems([]);
    setLiveDiscussion({ question: "", status: "idle", rounds: [] });
    setMessage("已退出。");
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage("两次输入的新密码不一致。");
      return;
    }

    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      }),
    });
    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(data.error ?? "密码修改失败。");
      return;
    }

    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setMessage("访问密码已更新。");
  }

  async function refreshModels() {
    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("模型列表加载失败，请确认数据库正在运行。");
      }

      const data = (await response.json()) as { models: AiModelView[] };
      setModels(data.models);
      setSelectedModelIds((current) => {
        if (current.length > 0) {
          return current.filter((id) => data.models.some((model) => model.id === id && model.enabled));
        }

        return data.models.filter((model) => model.enabled).map((model) => model.id);
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "模型列表加载失败。");
    }
  }

  async function refreshHistory() {
    try {
      const response = await fetch("/api/discussions", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("历史记录加载失败，请确认数据库正在运行。");
      }

      const data = (await response.json()) as { discussions: HistoryItem[] };
      setHistoryItems(data.discussions);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "历史记录加载失败。");
    }
  }

  function applyRunEvent(event: RunEvent) {
    setLiveDiscussion((current) => {
      if (event.type === "discussion_created") {
        return { ...current, id: event.discussionId, status: "running" };
      }

      if (event.type === "round_started") {
        return {
          ...current,
          rounds: [
            ...current.rounds,
            {
              id: event.roundId,
              roundNumber: event.roundNumber,
              prompt: event.prompt,
              stitchedContent: "",
              responses: [],
            },
          ],
        };
      }

      if (event.type === "model_started") {
        return {
          ...current,
          rounds: current.rounds.map((round) =>
            round.id === event.roundId
              ? {
                  ...round,
                  responses: [
                    ...round.responses,
                    {
                      id: event.responseId,
                      modelId: event.modelId,
                      modelName: event.modelName,
                      modelRef: event.modelRef,
                      status: "streaming",
                      content: "",
                    },
                  ],
                }
              : round,
          ),
        };
      }

      if (event.type === "content_delta") {
        return {
          ...current,
          rounds: current.rounds.map((round) =>
            round.id === event.roundId
              ? {
                  ...round,
                  responses: round.responses.map((response) =>
                    response.id === event.responseId
                      ? { ...response, content: response.content + event.delta }
                      : response,
                  ),
                }
              : round,
          ),
        };
      }

      if (event.type === "model_finished") {
        return {
          ...current,
          rounds: current.rounds.map((round) =>
            round.id === event.roundId
              ? {
                  ...round,
                  responses: round.responses.map((response) =>
                    response.id === event.responseId
                      ? {
                          ...response,
                          status: event.status,
                          content: event.content || response.content,
                          error: event.error,
                          attempts: event.attempts,
                          latencyMs: event.latencyMs,
                        }
                      : response,
                  ),
                }
              : round,
          ),
        };
      }

      if (event.type === "round_finished") {
        return {
          ...current,
          rounds: current.rounds.map((round) =>
            round.id === event.roundId ? { ...round, stitchedContent: event.stitchedContent } : round,
          ),
        };
      }

      if (event.type === "discussion_finished") {
        return {
          ...current,
          status: event.status,
          id: event.discussionId === "unknown" ? current.id : event.discussionId,
        };
      }

      return current;
    });
  }

  async function startDiscussion() {
    setMessage("");

    if (!question.trim()) {
      setMessage("请先输入问题。");
      return;
    }

    if (selectedModelIds.length === 0) {
      setMessage("请至少选择一个启用的模型。");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSelectedAiPage("");
    setLiveDiscussion({ question, status: "running", rounds: [] });

    try {
      const response = await fetch("/api/discussions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          modelIds: selectedModelIds,
          maxRounds,
          promptTemplate,
          executionMode,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            applyRunEvent(JSON.parse(line) as RunEvent);
          }
        }
      }

      await refreshHistory();
    } catch (error) {
      if (controller.signal.aborted) {
        setLiveDiscussion((current) => ({ ...current, status: "cancelled" }));
        setMessage("讨论已停止，已完成内容会保留在历史记录中。");
      } else {
        setLiveDiscussion((current) => ({ ...current, status: "failed" }));
        setMessage(error instanceof Error ? error.message : "讨论执行失败。");
      }
    } finally {
      abortRef.current = null;
    }
  }

  function newDiscussion() {
    abortRef.current?.abort();
    setQuestion("");
    setSelectedAiPage("");
    setLiveDiscussion({ question: "", status: "idle", rounds: [] });
    setMessage("已创建新讨论。");
  }

  async function stopDiscussion() {
    const discussionId = liveDiscussion.id;
    if (discussionId) {
      await fetch(`/api/discussions/${discussionId}/cancel`, { method: "POST" }).catch(() => undefined);
    }
    abortRef.current?.abort();
    setLiveDiscussion((current) => ({
      ...current,
      status: "cancelled",
      rounds: current.rounds.map((round) => ({
        ...round,
        responses: round.responses.map((response) =>
          response.status === "pending" || response.status === "streaming"
            ? {
                ...response,
                status: "cancelled",
                error: "Discussion cancelled by client.",
              }
            : response,
        ),
      })),
    }));
  }

  async function addModel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const payload = {
      name: modelForm.name,
      baseUrl: modelForm.baseUrl,
      model: modelForm.model,
      enabled: modelForm.enabled,
      timeoutMs: Number(modelForm.timeoutMs),
      maxInputChars: modelForm.maxInputChars ? Number(modelForm.maxInputChars) : null,
      ...(modelForm.apiKey ? { apiKey: modelForm.apiKey } : {}),
    };

    if (!editingModelId && !modelForm.apiKey) {
      setMessage("新增模型需要填写 API Key。");
      return;
    }

    const response = await fetch(editingModelId ? `/api/models/${editingModelId}` : "/api/models", {
      method: editingModelId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(data.error ?? "模型保存失败。");
      return;
    }

    setModelForm(emptyModelForm);
    setEditingModelId(null);
    await refreshModels();
    setMessage(editingModelId ? "模型已更新。" : "模型已保存。");
  }

  function editModel(model: AiModelView) {
    setEditingModelId(model.id);
    setModelForm({
      name: model.name,
      baseUrl: model.baseUrl,
      apiKey: "",
      model: model.model,
      enabled: model.enabled,
      timeoutMs: model.timeoutMs,
      maxInputChars: model.maxInputChars ? String(model.maxInputChars) : "",
    });
    setActiveView("models");
    setMessage("正在编辑模型；API Key 留空则保持不变。");
  }

  function copyModel(model: AiModelView) {
    setEditingModelId(null);
    setModelForm({
      name: `${model.name} copy`,
      baseUrl: model.baseUrl,
      apiKey: "",
      model: model.model,
      enabled: model.enabled,
      timeoutMs: model.timeoutMs,
      maxInputChars: model.maxInputChars ? String(model.maxInputChars) : "",
    });
    setActiveView("models");
    setMessage("已复制模型配置，请补充 API Key 后保存。");
  }

  function cancelModelEdit() {
    setEditingModelId(null);
    setModelForm(emptyModelForm);
  }

  async function deleteModel(id: string) {
    await fetch(`/api/models/${id}`, { method: "DELETE" });
    await refreshModels();
  }

  async function testModel(id: string) {
    setMessage("正在测试模型连接...");
    const response = await fetch(`/api/models/${id}/test`, { method: "POST" });
    const data = (await response.json()) as { status?: string; error?: string; content?: string };
    setMessage(
      response.ok
        ? `连接成功：${data.content?.slice(0, 120) || "OK"}`
        : `连接失败：${data.error ?? data.status ?? "unknown"}`,
    );
  }

  async function loadDiscussion(id: string) {
    setIsLoadingDetail(true);
    setActiveView("run");
    setMessage("");
    setSelectedAiPage("");

    try {
      const response = await fetch(`/api/discussions/${id}`, { cache: "no-store" });
      const data = (await response.json()) as { discussion: DiscussionDetail; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "历史加载失败。");
      }

      setLiveDiscussion({
        id: data.discussion.id,
        question: data.discussion.question,
        status: data.discussion.status,
        rounds: data.discussion.rounds.map((round) => ({
          id: round.id,
          roundNumber: round.roundNumber,
          prompt: round.prompt,
          stitchedContent: round.stitchedContent ?? "",
          responses: round.responses.map((response) => ({
            id: response.id,
            modelId: response.aiModelId ?? response.modelName,
            modelName: response.modelName,
            modelRef: response.modelRef,
            status: response.status,
            content: response.content,
            error: response.error ?? undefined,
            attempts: response.attemptCount,
            latencyMs: response.latencyMs ?? undefined,
          })),
        })),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "历史加载失败。");
    } finally {
      setIsLoadingDetail(false);
    }
  }

  const aiPages = useMemo(() => {
    const map = new Map<string, { id: string; name: string; modelRef: string }>();

    for (const model of selectedModels) {
      map.set(model.id, { id: model.id, name: model.name, modelRef: model.model });
    }

    for (const round of liveDiscussion.rounds) {
      for (const response of round.responses) {
        if (!map.has(response.modelId)) {
          map.set(response.modelId, {
            id: response.modelId,
            name: response.modelName,
            modelRef: response.modelRef,
          });
        }
      }
    }

    return Array.from(map.values());
  }, [liveDiscussion.rounds, selectedModels]);

  const selectedAi = aiPages.find((page) => page.id === selectedAiPage);
  const selectedAiRounds = selectedAiPage
    ? liveDiscussion.rounds.map((round) => ({
        round,
        response: round.responses.find((response) => response.modelId === selectedAiPage),
      }))
    : [];
  const finalRound = liveDiscussion.rounds.at(-1);
  const selectedFinalResponse = selectedAiPage
    ? finalRound?.responses.find((response) => response.modelId === selectedAiPage)
    : undefined;

  if (authState !== "authenticated") {
    return (
      <main
        className={classNames(
          "flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-zinc-100",
          themeMode === "light" ? "theme-light" : "theme-dark",
        )}
      >
        <section className="w-full max-w-md rounded-lg border border-zinc-800 bg-[#12161d] p-6 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-400 text-neutral-950">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">AI Roundtable</h1>
              <p className="text-sm text-zinc-400">请输入访问密码</p>
            </div>
          </div>

          {authState === "checking" ? (
            <div className="mt-6 flex items-center gap-2 rounded-md border border-zinc-800 bg-neutral-950 p-4 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在检查登录状态...
            </div>
          ) : (
            <form onSubmit={signIn} className="mt-6 space-y-4">
              <label className="block text-sm">
                <span className="text-zinc-300">访问密码</span>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  autoFocus
                  placeholder="默认密码：admin"
                  className="mt-2 h-11 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 outline-none focus:border-emerald-400"
                />
              </label>
              <button
                type="submit"
                disabled={isSigningIn || !loginPassword}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-400 font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSigningIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                登录
              </button>
            </form>
          )}

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-zinc-500">首次部署默认密码为 admin，登录后可在设置中修改。</p>
            <button
              type="button"
              onClick={() => setThemeMode((mode) => (mode === "light" ? "dark" : "light"))}
              className="h-8 rounded-md border border-zinc-700 px-2 text-xs text-zinc-300"
            >
              {themeMode === "light" ? "Light" : "Dark"}
            </button>
          </div>

          {message && <p className="mt-4 rounded-md border border-zinc-800 bg-neutral-950 p-3 text-sm text-zinc-300">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className={classNames("min-h-screen bg-neutral-950 text-zinc-100", themeMode === "light" ? "theme-light" : "theme-dark")}>
      <div className="border-b border-zinc-800 bg-neutral-950/95">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-neutral-950">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">AI Roundtable</h1>
              <p className="text-sm text-zinc-400">多模型并行或串行讨论，按模型查看输出</p>
            </div>
          </div>
          <nav className="flex gap-2">
            <button
              type="button"
              onClick={() => setThemeMode((mode) => (mode === "light" ? "dark" : "light"))}
              className="inline-flex h-9 items-center rounded-md border border-zinc-700 px-3 text-sm text-zinc-300 transition hover:bg-[#1f242b] hover:text-white"
            >
              {themeMode === "light" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm text-zinc-300 transition hover:bg-[#1f242b] hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
            {[
              ["run", Play, "讨论"],
              ["models", Settings, "模型"],
              ["history", History, "历史"],
            ].map(([key, Icon, label]) => (
              <button
                key={key as string}
                onClick={() => setActiveView(key as "run" | "models" | "history")}
                className={classNames(
                  "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm transition",
                  activeView === key ? "bg-zinc-100 text-neutral-950" : "text-zinc-300 hover:bg-[#1f242b] hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label as string}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1800px] gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
        {activeView === "run" && (
          <>
            <section className="space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-200">问题</label>
                  <CopyButton text={question} />
                </div>
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className="min-h-36 w-full resize-y rounded-md border border-zinc-700 bg-neutral-950 p-3 text-sm outline-none focus:border-emerald-400"
                  placeholder="输入需要多个 AI 协同讨论的问题..."
                />
              </div>

              <div className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-200">参与模型</label>
                  <button onClick={() => setActiveView("models")} className="text-sm text-cyan-300">
                    管理
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {enabledModels.length === 0 && <p className="text-sm text-zinc-500">还没有启用模型。</p>}
                  {enabledModels.map((model) => (
                    <label
                      key={model.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-800 bg-neutral-950 p-3"
                    >
                      <input
                        type="checkbox"
                        checked={selectedModelIds.includes(model.id)}
                        onChange={(event) => {
                          setSelectedModelIds((current) =>
                            event.target.checked ? [...current, model.id] : current.filter((id) => id !== model.id),
                          );
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{model.name}</span>
                        <span className="block truncate text-xs text-zinc-500">{model.model}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
                <label className="text-sm font-medium text-zinc-200">执行方式</label>
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-md bg-neutral-950 p-1">
                  {[
                    ["concurrent", "并发"],
                    ["sequential", "逐个 AI"],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setExecutionMode(mode as ExecutionMode)}
                      className={classNames(
                        "h-9 rounded px-3 text-sm font-medium transition",
                        executionMode === mode ? "bg-emerald-400 text-neutral-950" : "text-zinc-400 hover:bg-zinc-800",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="mt-4 block text-sm font-medium text-zinc-200">轮数上限</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxRounds}
                  onChange={(event) => setMaxRounds(Number(event.target.value))}
                  className="mt-2 h-10 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 text-sm outline-none focus:border-emerald-400"
                />

                <div className="mt-4 flex items-center justify-between">
                  <label className="block text-sm font-medium text-zinc-200">多轮提示词</label>
                  <CopyButton text={promptTemplate} />
                </div>
                <textarea
                  value={promptTemplate}
                  onChange={(event) => setPromptTemplate(event.target.value)}
                  className="mt-2 min-h-28 w-full resize-y rounded-md border border-zinc-700 bg-neutral-950 p-3 text-sm outline-none focus:border-emerald-400"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={startDiscussion}
                  disabled={liveDiscussion.status === "running"}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 text-sm font-semibold text-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Play className="h-4 w-4" />
                  开始
                </button>
                <button
                  onClick={stopDiscussion}
                  disabled={liveDiscussion.status !== "running"}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-rose-400 px-4 text-sm font-semibold text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Square className="h-4 w-4" />
                  停止
                </button>
                <button
                  onClick={newDiscussion}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:border-zinc-500"
                >
                  <Plus className="h-4 w-4" />
                  新讨论
                </button>
              </div>
            </section>

            <section className="min-w-0 space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <StatusIcon status={liveDiscussion.status} />
                      <span>{liveDiscussion.status}</span>
                      <span>·</span>
                      <span>{executionMode === "concurrent" ? "并发执行" : "逐个 AI 执行"}</span>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold">讨论过程</h2>
                  </div>
                  {liveDiscussion.id && (
                    <div className="flex gap-2">
                      <a href={`/api/discussions/${liveDiscussion.id}/export?format=md`} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm">
                        <Download className="h-4 w-4" />
                        MD
                      </a>
                      <a href={`/api/discussions/${liveDiscussion.id}/export?format=json`} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm">
                        <Download className="h-4 w-4" />
                        JSON
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {liveDiscussion.rounds.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
                  <h3 className="text-base font-semibold">状态总览</h3>
                  <div className="mt-4 space-y-4">
                    {liveDiscussion.rounds.map((round) => (
                      <div key={round.id} className="rounded-lg border border-zinc-800 bg-neutral-950 p-3">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-sm font-semibold">第 {round.roundNumber} 轮</span>
                          <CopyButton text={round.prompt} label="复制提示词" />
                        </div>
                        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {aiPages.map((ai) => {
                            const response = round.responses.find((item) => item.modelId === ai.id);
                            return (
                              <button
                                key={`${round.id}-${ai.id}`}
                                onClick={() => setSelectedAiPage(ai.id)}
                                className={classNames(
                                  "flex min-h-14 items-center gap-3 rounded-md border p-3 text-left transition",
                                  selectedAiPage === ai.id
                                    ? "border-amber-300 bg-amber-300 text-neutral-950"
                                    : "border-zinc-800 bg-[#12161d] hover:border-zinc-600",
                                )}
                              >
                                <StatusIcon status={response?.status ?? "pending"} />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">{ai.name}</span>
                                  <span className="block truncate text-xs opacity-70">
                                    {response?.status ?? "pending"}
                                    {response?.latencyMs ? ` · ${response.latencyMs}ms` : ""}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {aiPages.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-[#12161d]">
                  <div className="flex gap-2 overflow-x-auto border-b border-zinc-800 p-3">
                    {aiPages.map((page) => (
                      <button
                        key={page.id}
                        onClick={() => setSelectedAiPage(page.id)}
                        className={classNames(
                          "shrink-0 rounded-md px-3 py-2 text-left text-sm",
                          selectedAiPage === page.id
                            ? "bg-amber-300 text-neutral-950"
                            : "bg-neutral-950 text-zinc-300 hover:bg-zinc-800",
                        )}
                      >
                        <span className="block font-medium">{page.name}</span>
                        <span className="block text-xs opacity-70">{page.modelRef}</span>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-4 p-4">
                    {!selectedAiPage && (
                      <div className="rounded-lg border border-dashed border-zinc-700 bg-neutral-950 p-8 text-center text-sm text-zinc-400">
                        默认不渲染 AI 输出内容。点击上方某个 AI，查看它每一轮收到的问题和回答。
                      </div>
                    )}

                    {selectedAi && (
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-lg font-semibold">{selectedAi.name}</h3>
                          <p className="text-sm text-zinc-500">{selectedAi.modelRef}</p>
                        </div>

                        {selectedFinalResponse && (
                          <OutputPanel
                            title="最后一轮最终答案"
                            content={
                              selectedFinalResponse.status === "success"
                                ? selectedFinalResponse.content
                                : selectedFinalResponse.error
                            }
                            empty="该 AI 最后一轮还没有成功答案。"
                            tone={selectedFinalResponse.status === "success" ? "answer" : "error"}
                          />
                        )}

                        {selectedAiRounds.map(({ round, response }) => (
                          <article key={`${round.id}-${response?.id ?? selectedAiPage}`} className="space-y-3 rounded-lg border border-zinc-800 bg-neutral-950 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="text-base font-semibold">第 {round.roundNumber} 轮</h3>
                              <div className="flex items-center gap-2 text-sm text-zinc-400">
                                <StatusIcon status={response?.status ?? "pending"} />
                                <span>{response?.status ?? "pending"}</span>
                                {response?.attempts ? <span>{response.attempts} 次尝试</span> : null}
                              </div>
                            </div>

                            <OutputPanel
                              title={`第 ${round.roundNumber} 轮发送的提示词`}
                              content={round.prompt}
                              empty="暂无提示词"
                              tone="prompt"
                            />

                            <OutputPanel
                              title={`第 ${round.roundNumber} 轮回答`}
                              content={response?.status === "success" ? response.content : response?.error}
                              empty={response ? "该轮暂无可显示内容。" : "该 AI 还没有进入这一轮。"}
                              tone={response?.status === "failed" || response?.status === "timeout" ? "error" : "answer"}
                            />
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {activeView === "models" && (
          <section className="grid gap-5 xl:col-span-2 xl:grid-cols-[420px_1fr]">
            <form onSubmit={updatePassword} className="rounded-lg border border-zinc-800 bg-[#12161d] p-4 xl:col-span-2">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-400 text-neutral-950">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">访问密码</h2>
                  <p className="text-sm text-zinc-500">首次部署默认密码为 admin，修改后默认密码失效。</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="block text-sm">
                  <span className="text-zinc-300">当前密码</span>
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-300">新密码</span>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-300">确认新密码</span>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 outline-none focus:border-emerald-400"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 font-semibold text-neutral-950"
              >
                <KeyRound className="h-4 w-4" />
                修改访问密码
              </button>
            </form>

            <form onSubmit={addModel} className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{editingModelId ? "编辑模型" : "新增 OpenAI 兼容模型"}</h2>
                {editingModelId && (
                  <button
                    type="button"
                    onClick={cancelModelEdit}
                    className="h-8 rounded-md border border-zinc-700 px-2 text-xs text-zinc-300 hover:border-zinc-500"
                  >
                    取消编辑
                  </button>
                )}
              </div>
              {editingModelId && <p className="mt-2 text-xs text-zinc-500">API Key 留空则保持原值不变。</p>}
              <div className="mt-4 space-y-3">
                {[
                  ["名称", "name", "例如 GPT-5.4"],
                  ["Base URL", "baseUrl", "https://api.openai.com"],
                  ["API Key", "apiKey", "sk-..."],
                  ["模型名", "model", "gpt-5.4"],
                ].map(([label, key, placeholder]) => (
                  <label key={key} className="block text-sm">
                    <span className="text-zinc-300">{label}</span>
                    <input
                      type={key === "apiKey" ? "password" : "text"}
                      value={String(modelForm[key as keyof typeof modelForm])}
                      onChange={(event) => setModelForm((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder={placeholder}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 outline-none focus:border-emerald-400"
                    />
                  </label>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-zinc-300">超时毫秒</span>
                    <input
                      type="number"
                      value={modelForm.timeoutMs}
                      onChange={(event) => setModelForm((current) => ({ ...current, timeoutMs: Number(event.target.value) }))}
                      className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 outline-none focus:border-emerald-400"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-zinc-300">最大输入字符</span>
                    <input
                      type="number"
                      value={modelForm.maxInputChars}
                      onChange={(event) => setModelForm((current) => ({ ...current, maxInputChars: event.target.value }))}
                      placeholder="可空"
                      className="mt-1 h-10 w-full rounded-md border border-zinc-700 bg-neutral-950 px-3 outline-none focus:border-emerald-400"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={modelForm.enabled}
                    onChange={(event) => setModelForm((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  启用
                </label>
              </div>
              <button className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-400 font-semibold text-neutral-950">
                <Plus className="h-4 w-4" />
                {editingModelId ? "更新模型" : "保存模型"}
              </button>
            </form>

            <div className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">模型列表</h2>
                <button onClick={refreshModels} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm">
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {models.map((model) => (
                  <article key={model.id} className="rounded-lg border border-zinc-800 bg-neutral-950 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium">{model.name}</h3>
                        <p className="truncate text-sm text-zinc-500">{model.model}</p>
                        <p className="truncate text-xs text-zinc-600">{model.baseUrl}</p>
                      </div>
                      <span className={classNames("rounded px-2 py-1 text-xs", model.enabled ? "bg-emerald-950 text-emerald-200" : "bg-zinc-800 text-zinc-400")}>
                        {model.enabled ? "启用" : "停用"}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      <button onClick={() => testModel(model.id)} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-700 text-sm">
                        <RefreshCw className="h-4 w-4" />
                        测试
                      </button>
                      <button onClick={() => editModel(model)} className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 px-2 text-sm text-zinc-200">
                        编辑
                      </button>
                      <button onClick={() => copyModel(model)} className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 px-2 text-sm text-zinc-200">
                        复制
                      </button>
                      <button onClick={() => deleteModel(model.id)} className="inline-flex h-9 items-center justify-center rounded-md border border-rose-800 px-3 text-rose-200">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === "history" && (
          <section className="xl:col-span-2">
            <div className="rounded-lg border border-zinc-800 bg-[#12161d] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">历史记录</h2>
                <button onClick={refreshHistory} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm">
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </button>
              </div>
              <div className="mt-4 divide-y divide-zinc-800">
                {historyItems.map((item) => (
                  <div key={item.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-zinc-400">
                        <StatusIcon status={item.status} />
                        <span>{item.status}</span>
                        <span>{new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="mt-2 truncate font-medium">{item.question}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {item.roundCount} 轮 · {item.responseCount} 条回答 · {item.failedCount} 条失败/未成功
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => loadDiscussion(item.id)}
                        disabled={isLoadingDetail}
                        className="h-9 rounded-md bg-amber-300 px-3 text-sm font-semibold text-neutral-950"
                      >
                        打开
                      </button>
                      <a href={`/api/discussions/${item.id}/export?format=md`} className="h-9 rounded-md border border-zinc-700 px-3 py-2 text-sm">
                        MD
                      </a>
                      <a href={`/api/discussions/${item.id}/export?format=json`} className="h-9 rounded-md border border-zinc-700 px-3 py-2 text-sm">
                        JSON
                      </a>
                    </div>
                  </div>
                ))}
                {historyItems.length === 0 && <p className="py-10 text-center text-sm text-zinc-500">还没有历史讨论。</p>}
              </div>
            </div>
          </section>
        )}
      </div>

      {message && (
        <div className="fixed bottom-4 left-1/2 z-20 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-zinc-700 bg-neutral-900 px-4 py-3 text-sm shadow-xl">
          {message}
        </div>
      )}
    </main>
  );
}
