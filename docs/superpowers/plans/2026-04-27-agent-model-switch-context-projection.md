# Agent Native Google 与模型切换上下文修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 目标

修复 InkOS pi-agent 在 Google Gemini / DeepSeek / MiniMax 等模型之间切换时的上下文污染、工具调用失败和错误信息失真问题。

## 执行记录

2026-04-27 已执行：

- Google service 默认调用协议已切到 pi-ai native `google-generative-ai`。
- Agent cache identity 已从 `modelId` 升级为 `api + provider + baseUrl + modelId`。
- JSONL transcript 继续保存 raw `AgentMessage`；恢复时按目标模型协议投影上下文。
- 同模型同协议保留 native thinking/tool history；跨模型/跨协议把旧工具结果文本化为普通 user 语义上下文。
- Studio `/api/v1/agent` 已优先透传 final assistant error，避免被 fallback probe 改写成 `LLM returned empty response`。

验证结果：

- `pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/service-resolver.test.ts src/__tests__/provider.test.ts src/__tests__/effective-llm-config.test.ts src/__tests__/config-loader.test.ts` 通过。
- `pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/session-transcript-restore.test.ts src/__tests__/agent-session.test.ts` 通过。
- `pnpm --filter @actalk/inkos-studio exec vitest run src/api/server.test.ts` 通过。
- `pnpm --filter @actalk/inkos-core typecheck` 通过。
- `pnpm --filter @actalk/inkos-studio typecheck` 通过。
- `git diff --check` 通过。
- 真实 `createLLMClient + chatCompletion` 调 `google/gemini-pro-latest` 三次，3/3 HTTP success，3/3 包含 `【完整结束】`。
- 真实 Studio agent + Gemini 工具调用普通提示三次，3/3 HTTP 200，未出现 XML `<function-calls>` 泄漏，JSONL 中 assistant tool call 为 `api: "google-generative-ai"` / `provider: "google"`。
- 严格“最终回复必须完全等于固定字符串”的工具提示下，观测到 1 次 native Google provider 返回 `An unknown error occurred`；transcript 显示这是 pi-ai Google provider 在 `stopReason: "error"` 且无内容时给出的 generic upstream error，不是 JSONL 恢复污染，也不是 OpenAI-compatible `MALFORMED_FUNCTION_CALL`。

根因分两层：

1. **Google 传输协议选错**：pi-ai 已有 native `google-generative-ai` provider，但 InkOS 当前 `google` service 走 `openai-completions + https://generativelanguage.googleapis.com/v1beta/openai`。这会让 Gemini 工具调用落在 OpenAI-compatible 适配层，现场已复现 `function_call_filter: MALFORMED_FUNCTION_CALL`、XML `<function-calls>` 文本泄漏和空 assistant。
2. **Agent cache identity 太窄**：当前 cache 只比较 `modelId`。同一个 `gemini-pro-latest` 从 OpenAI-compatible 切到 native Google 时，模型 id 不变，但 `api/provider/baseUrl` 已经变了，继续复用旧 Agent 会保留错误协议的内存态。

最终状态：

- Google service 默认走 pi-ai native `google-generative-ai`。
- Agent cache 使用完整模型协议身份：`api + provider + baseUrl + modelId`。
- JSONL transcript 继续保存 raw `AgentMessage`。
- 恢复上下文时，同一完整模型协议身份保留原生 history；跨协议/跨模型只保留语义文本。
- OpenAI-compatible Gemini 只作为 legacy/custom fallback，不再作为 InkOS Google 默认路径。
- Studio API 透传 pi-agent-core / pi-ai 的真实上游错误，不再全部折叠成 `LLM returned empty response`。

## 架构边界

本计划只处理 Studio agent chat 这条链路：

`Studio /api/v1/agent -> resolveServiceModel/createLLMClient -> runAgentSession -> pi-agent-core Agent -> pi-ai streamSimple -> JSONL transcript`

不处理专业 agent pipeline 的写作质量策略，不调整章节生成的业务 prompt。

## 关键设计

### 1. Google Provider 默认 native

当前事实：

- pi-ai `@mariozechner/pi-ai` 已注册 `api: "google-generative-ai"`。
- `getModel("google", "gemini-2.5-flash")` 返回：
  - `api: "google-generative-ai"`
  - `provider: "google"`
  - `baseUrl: "https://generativelanguage.googleapis.com/v1beta"`
- InkOS 当前 `packages/core/src/llm/providers/endpoints/google.ts` 仍配置为 `openai-completions` 和 `/v1beta/openai`。

修改原则：

- `google` endpoint 的主调用协议改为 native `google-generative-ai`。
- `modelsBaseUrl` 可以继续指向 OpenAI-compatible `/v1beta/openai`，只服务模型列表探测；模型调用必须走 native baseUrl。
- 不新增 `maxTokensField` 之类 OpenAI-compatible 参数。`maxTokens` 仍由 model card 的 `maxOutput` 决定。

### 2. Cache Identity 从 modelId 升级为模型协议身份

旧规则：

```ts
cached.modelId !== requestedModelId
```

新规则：

```ts
agentModelIdentity(model) =
  `${model.api}::${model.provider}::${model.baseUrl ?? ""}::${model.id}`
```

推导：

1. `modelId` 只描述模型名称。
2. agent 的 LLM 调用行为由 `api/provider/baseUrl/modelId` 共同决定。
3. Google 从 OpenAI-compatible 切到 native 后，`modelId` 不变，`api/baseUrl/provider` 改变。
4. cache 比较必须覆盖所有影响 LLM message schema 的字段。

### 3. Transcript 恢复只在同协议身份下保留原生状态

保留规则：

- `assistant.api === target.api`
- `assistant.provider === target.provider`
- `assistant.model === target.id`

跨协议/跨模型规则：

- `user` 文本保留。
- assistant 可见 `text` 保留。
- `thinking` 丢弃，尤其是 DeepSeek `reasoning_content` 和 Gemini thought signature。
- `toolCall + toolResult` 合并为普通 `user` 上下文文本，例如 `[Tool results] read(tool-1): ...`。
- synthetic bridge 文本不进入最终 LLM context。

原因：

1. thinking / reasoning signature 是 provider 协议状态，不是可跨 provider 携带的语义。
2. tool call id 只在对应 assistant tool call 的协议回合里有意义。
3. 跨模型恢复的目标是保存“模型已经看过哪些工具结果”的语义，不恢复旧协议的 pending state。

### 4. OpenAI-compatible Gemini 只保留 legacy 防线

`convertAgentMessagesForModel()` 对 `baseUrl.includes("generativelanguage.googleapis.com") && api === "openai-completions"` 的文本化逻辑可以保留，但它是 fallback：

- 用于旧 transcript、custom provider 或临时回滚。
- native Google 不应该触发这层文本化。
- 真实工具调用由 pi-ai Google provider 的 `part.functionCall -> toolCall` 处理。

## 文件结构

- Modify: `packages/core/src/llm/providers/types.ts`
  - `ApiProtocol` 增加 `google-generative-ai`。
- Modify: `packages/core/src/llm/providers/endpoints/google.ts`
  - Google 主协议切到 native。
  - 保留 `modelsBaseUrl` 或测试中明确 fallback 行为。
- Modify: `packages/core/src/llm/service-presets.ts`
  - `resolveServicePiProvider("google")` 返回 `google`。
- Modify: `packages/core/src/llm/service-resolver.ts`
  - `resolveServiceModel("google", ...)` 产出 native `Model<Api>`。
  - OpenAI-compatible compat 只在 `api === "openai-completions"` 时注入。
- Modify: `packages/core/src/llm/provider.ts`
  - `createLLMClient()` 构造的 Google `_piModel` 使用 native `api/provider/baseUrl`。
- Modify: `packages/core/src/agent/agent-session.ts`
  - cache identity 使用完整模型协议身份。
  - legacy Gemini OpenAI-compatible `convertToLlm` 只作为 fallback。
  - final assistant error 继续透传。
- Modify: `packages/core/src/interaction/session-transcript-restore.ts`
  - 按目标模型身份恢复 raw transcript。
- Modify: `packages/studio/src/api/server.ts`
  - `/api/v1/agent` 使用 resolved native Google model。
  - 保留真实错误返回。
- Tests:
  - `packages/core/src/__tests__/service-resolver.test.ts`
  - `packages/core/src/__tests__/provider.test.ts`
  - `packages/core/src/__tests__/effective-llm-config.test.ts`
  - `packages/core/src/__tests__/config-loader.test.ts`
  - `packages/core/src/__tests__/agent-session.test.ts`
  - `packages/core/src/__tests__/session-transcript-restore.test.ts`
  - `packages/studio/src/api/server.test.ts`

---

## Task 1: 用测试锁定 Google native provider

**Files:**
- Modify: `packages/core/src/__tests__/service-resolver.test.ts`
- Modify: `packages/core/src/__tests__/provider.test.ts`
- Modify: `packages/core/src/__tests__/effective-llm-config.test.ts`
- Modify: `packages/core/src/__tests__/config-loader.test.ts`

- [ ] **Step 1: service resolver 测试 Google native identity**

更新 `resolveServiceModel("google", "gemini-pro-latest", root)` 断言：

```ts
expect(result.model.api).toBe("google-generative-ai");
expect(result.model.provider).toBe("google");
expect(result.model.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
```

同时断言不再带 OpenAI-compatible compat：

```ts
expect(result.model.compat).toBeUndefined();
```

- [ ] **Step 2: provider client 测试 Google native `_piModel`**

在 `provider.test.ts` 覆盖：

```ts
const client = createLLMClient({
  service: "google",
  provider: "openai",
  model: "gemini-pro-latest",
  apiKey: "test",
});

expect(client._piModel?.api).toBe("google-generative-ai");
expect(client._piModel?.provider).toBe("google");
expect(client._piModel?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta");
```

- [ ] **Step 3: 更新配置类测试的 baseUrl 期望**

把 `effective-llm-config.test.ts` 和 `config-loader.test.ts` 里 Google service 的默认 baseUrl 期望从：

```ts
https://generativelanguage.googleapis.com/v1beta/openai
```

改为：

```ts
https://generativelanguage.googleapis.com/v1beta
```

- [ ] **Step 4: 运行失败测试**

```bash
pnpm --filter @actalk/inkos-core exec vitest run \
  src/__tests__/service-resolver.test.ts \
  src/__tests__/provider.test.ts \
  src/__tests__/effective-llm-config.test.ts \
  src/__tests__/config-loader.test.ts
```

Expected before implementation: Google 相关断言失败。

---

## Task 2: 实现 Google native provider

**Files:**
- Modify: `packages/core/src/llm/providers/types.ts`
- Modify: `packages/core/src/llm/providers/endpoints/google.ts`
- Modify: `packages/core/src/llm/service-presets.ts`
- Modify: `packages/core/src/llm/service-resolver.ts`
- Modify: `packages/core/src/llm/provider.ts`

- [ ] **Step 1: 扩展 InkOS provider schema**

在 `ApiProtocol` 增加：

```ts
| "google-generative-ai"
```

- [ ] **Step 2: 修改 Google endpoint**

把 `GOOGLE` endpoint 改为：

```ts
api: "google-generative-ai",
baseUrl: "https://generativelanguage.googleapis.com/v1beta",
modelsBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
```

删除 Google endpoint 上 OpenAI-compatible 专用的：

```ts
compat: { supportsStore: false, requiresAssistantAfterToolResult: true }
```

该 compat 只属于 `/v1beta/openai`，不属于 native Google。

- [ ] **Step 3: 修正 service -> pi provider 映射**

`resolveServicePiProvider("google")` 必须返回：

```ts
"google"
```

`SERVICE_TO_PI_PROVIDER` 也要包含：

```ts
google: "google"
```

- [ ] **Step 4: 修正 `createLLMClient()` 的 pi provider 选择**

`packages/core/src/llm/provider.ts` 当前默认会把非特殊 provider 映射成 `openai`。增加 Google 分支：

```ts
if (inkosProvider?.id === "google") piProvider = "google";
```

该分支必须早于默认 `else piProvider = provider`。

- [ ] **Step 5: 修正 `resolveServiceModel()` 的 model 合成**

`resolveServiceModel()` 对 Google 应优先使用：

```ts
getModel("google", modelId)
```

如果 pi-ai 内置 model 能命中，保留它的 `reasoning/input/contextWindow/maxTokens`，再覆盖 `id/name/baseUrl` 以匹配 InkOS provider bank。

- [ ] **Step 6: 运行 Task 1 测试**

```bash
pnpm --filter @actalk/inkos-core exec vitest run \
  src/__tests__/service-resolver.test.ts \
  src/__tests__/provider.test.ts \
  src/__tests__/effective-llm-config.test.ts \
  src/__tests__/config-loader.test.ts
```

Expected: pass。

- [ ] **Step 7: Commit**

```bash
git add \
  packages/core/src/llm/providers/types.ts \
  packages/core/src/llm/providers/endpoints/google.ts \
  packages/core/src/llm/service-presets.ts \
  packages/core/src/llm/service-resolver.ts \
  packages/core/src/llm/provider.ts \
  packages/core/src/__tests__/service-resolver.test.ts \
  packages/core/src/__tests__/provider.test.ts \
  packages/core/src/__tests__/effective-llm-config.test.ts \
  packages/core/src/__tests__/config-loader.test.ts
git commit -m "fix: use native google provider"
```

---

## Task 3: 升级 Agent cache identity

**Files:**
- Modify: `packages/core/src/agent/agent-session.ts`
- Modify: `packages/core/src/__tests__/agent-session.test.ts`

- [ ] **Step 1: 写 cache identity 回归测试**

覆盖三种情况：

1. 同 `sessionId + bookId + readPermission + api/provider/baseUrl/modelId`：复用 Agent。
2. 同 `modelId` 但 `api` 从 `openai-completions` 变为 `google-generative-ai`：重建 Agent。
3. 同 `modelId/api` 但 `baseUrl` 改变：重建 Agent。

断言方式：

- 用 mock `streamSimple` 记录 `context.model` 或构造时状态。
- 或检查 `streamCalls` 中第二次请求没有继承第一次 Agent 的旧 messages。

- [ ] **Step 2: 实现 `agentModelIdentity()`**

在 `agent-session.ts` 中增加局部函数：

```ts
function agentModelIdentity(model: Model<Api>): string {
  return [
    model.api,
    model.provider,
    model.baseUrl ?? "",
    model.id,
  ].join("::");
}
```

- [ ] **Step 3: cache value 保存完整 identity**

把 `CachedAgent` 中的：

```ts
modelId: string | undefined;
```

替换为：

```ts
modelIdentity: string;
```

创建 Agent 前先解析本次 `model`，用 `agentModelIdentity(model)` 比较 cache。

- [ ] **Step 4: 保留原有 book/readPermission 失效规则**

cache 失效条件为：

```ts
modelIdentityChanged || bookChanged || readPermissionChanged
```

- [ ] **Step 5: 运行 agent-session 测试**

```bash
pnpm --filter @actalk/inkos-core exec vitest run src/__tests__/agent-session.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/agent-session.ts packages/core/src/__tests__/agent-session.test.ts
git commit -m "fix: key agent cache by model protocol"
```

---

## Task 4: 保留 raw JSONL，并按目标协议恢复上下文

**Files:**
- Modify: `packages/core/src/interaction/session-transcript-restore.ts`
- Modify: `packages/core/src/__tests__/session-transcript-restore.test.ts`
- Modify: `packages/core/src/agent/agent-session.ts`
- Modify: `packages/core/src/__tests__/agent-session.test.ts`

- [ ] **Step 1: 测同协议保留 native Google tool/thought**

构造 assistant：

```ts
{
  role: "assistant",
  api: "google-generative-ai",
  provider: "google",
  model: "gemini-pro-latest",
  content: [
    { type: "thinking", thinking: "plan", thinkingSignature: "google-signature" },
    { type: "toolCall", id: "tool-1", name: "ls", arguments: { subdir: "story/roles" } },
  ],
}
```

目标模型同为 `api/provider/id` 时，恢复结果必须保留原始 blocks。

- [ ] **Step 2: 测跨协议文本化**

用旧 OpenAI-compatible Gemini assistant：

```ts
api: "openai-completions",
provider: "openai",
model: "gemini-pro-latest",
content: [{ type: "toolCall", id: "tool-1", name: "ls", arguments: {} }]
```

目标模型是 native Google 或 DeepSeek 时：

- 不出现 `toolCall`。
- 不出现 `toolResult` role。
- 出现 `[Tool results]` user 文本。

- [ ] **Step 3: 测 DeepSeek reasoning 不跨到 Google**

DeepSeek 历史中 `thinkingSignature: "reasoning_content"`，目标模型为 native Google 时：

- `reasoning_content` 不进入目标 context。
- assistant 可见 text 保留。
- 工具结果文本化。

- [ ] **Step 4: 实现恢复投影**

恢复规则：

- `isSameAssistantModel(message, target)` 只比较 `api/provider/model`。
- 同模型：保留 raw assistant/toolResult。
- 异模型：丢弃 thinking，保留 text，工具结果合并为 user 文本。
- synthetic bridge 文本过滤。

注意：不要把只服务单一线性流程的步骤拆成多个无复用价值的顶层 helper；保持函数内局部 helper。

- [ ] **Step 5: legacy OpenAI-compatible Gemini runtime projection 只作为 fallback**

`agent-session.ts` 中如果保留 `convertAgentMessagesForModel()`，触发条件必须严格为：

```ts
model.api === "openai-completions" &&
model.baseUrl?.includes("generativelanguage.googleapis.com")
```

native Google 不触发该分支。

- [ ] **Step 6: 运行恢复与 agent 测试**

```bash
pnpm --filter @actalk/inkos-core exec vitest run \
  src/__tests__/session-transcript-restore.test.ts \
  src/__tests__/agent-session.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add \
  packages/core/src/interaction/session-transcript-restore.ts \
  packages/core/src/__tests__/session-transcript-restore.test.ts \
  packages/core/src/agent/agent-session.ts \
  packages/core/src/__tests__/agent-session.test.ts
git commit -m "fix: project restored history by model protocol"
```

---

## Task 5: 真实错误透传

**Files:**
- Modify: `packages/core/src/agent/agent-session.ts`
- Modify: `packages/core/src/__tests__/agent-session.test.ts`
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/api/server.test.ts`

- [ ] **Step 1: `AgentSessionResult` 保留 final assistant error**

如果最终 assistant：

```ts
stopReason === "error" || stopReason === "aborted"
```

且带 `errorMessage`，`runAgentSession()` 返回：

```ts
errorMessage
```

- [ ] **Step 2: Studio API 优先返回真实错误**

`/api/v1/agent` 中，如果：

```ts
!result.responseText && result.errorMessage
```

返回：

```ts
status 502
error.code = "AGENT_LLM_ERROR"
response = result.errorMessage
```

该分支必须早于 fallback probe 和 `LLM returned empty response`。

- [ ] **Step 3: 覆盖真实错误测试**

测试至少覆盖：

- `400 The reasoning_content ... must be passed back`
- `Provider finish_reason: function_call_filter: MALFORMED_FUNCTION_CALL`

- [ ] **Step 4: Commit**

```bash
git add \
  packages/core/src/agent/agent-session.ts \
  packages/core/src/__tests__/agent-session.test.ts \
  packages/studio/src/api/server.ts \
  packages/studio/src/api/server.test.ts
git commit -m "fix: surface agent upstream errors"
```

---

## Task 6: 验证真实 Google 场景

**Files:**
- No code changes expected.

- [ ] **Step 1: 单纯 Google 文本流三次**

使用 InkOS `createLLMClient + chatCompletion` 调 `google/gemini-pro-latest` 三次，提示词要求输出结束标记：

```text
【完整结束】
```

Expected:

- 3/3 HTTP success。
- 3/3 包含结束标记。
- 不出现 `LLM returned empty response from stream`。

- [ ] **Step 2: Studio agent + Gemini 工具调用三次**

对新 session 发送三次：

```text
请调用工具查看当前书的 story/roles 目录。工具调用完成后，只回复：Google agent 测试通过。【完整结束】
```

Expected:

- 3/3 HTTP 200。
- 3/3 包含结束标记。
- 不出现 XML `<function-calls>`。
- 不出现 `MALFORMED_FUNCTION_CALL`。
- JSONL 中 assistant tool call 的 `api` 为 `google-generative-ai`，`provider` 为 `google`。

- [ ] **Step 3: 污染 transcript 恢复验证**

用旧 session `1777003372863-8uq0sb` 或构造等价 fixture，包含：

- 旧 Gemini OpenAI-compatible `toolCall/toolResult`
- DeepSeek `reasoning_content`
- 空 error assistant
- XML `<function-calls>` 文本

分别切到：

- native Google
- DeepSeek

Expected:

- 请求不因为旧 thinking/tool protocol 400。
- 恢复 context 中跨协议工具结果是普通 user 文本。
- 旧 XML 文本不被当成可执行 tool call。

- [ ] **Step 4: 类型检查和 diff 检查**

```bash
pnpm --filter @actalk/inkos-core typecheck
pnpm --filter @actalk/inkos-studio typecheck
git diff --check
```

---

## Self-Review Checklist

- [ ] `google` service 默认 `api` 是 `google-generative-ai`。
- [ ] `google` service 默认 `provider` 是 `google`。
- [ ] `google` service 默认调用 baseUrl 是 `https://generativelanguage.googleapis.com/v1beta`。
- [ ] OpenAI-compatible `/v1beta/openai` 不再用于默认 Gemini agent 调用。
- [ ] Agent cache identity 覆盖 `api/provider/baseUrl/modelId`。
- [ ] 同协议同模型恢复保留 native thinking/tool history。
- [ ] 跨协议恢复不传递 DeepSeek `reasoning_content` 或 Gemini thought signature。
- [ ] 跨协议工具结果降级为普通 user 语义文本。
- [ ] `LLM returned empty response` 不再吞掉真实上游错误。
- [ ] 真实 Gemini 工具调用三次稳定通过。
