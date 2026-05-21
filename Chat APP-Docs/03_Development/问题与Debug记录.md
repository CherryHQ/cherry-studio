# 问题与 Debug 记录（索引）

> 滚动 issue 列表。每条 `D-NNN` 一行；详细诊断在对应的任务文件夹下的 `诊断.md`。
> 命名空间与任务 ID 独立 —— D 是 issue（问题），T 是 task（工程）。一个 issue 通常对应一个或多个 task。

## 当前 open 问题

| ID | 标题 | 复现 | 严重度 | 关联任务 | 诊断文档 |
|---|---|---|---|---|---|
| D-006 | fresh install 默认模型仍是 CherryAI Qwen，不自动选 Ollama | `rm -rf ~/Library/Application\ Support/CherryStudioDev && pnpm dev` → 新建 topic 默认 model 是 Qwen \| CherryAI | 🟢 小毛刺，可手动切；非 baseline 阻塞 | 暂未建任务；等 v2 用户偏好 / 默认模型策略迁移时一起处理 | （无） |
| D-007 | Regenerate 切到 Ollama 后点旧回复 refresh 无明显反应 | 切到 Ollama 模型 → 在历史 assistant 消息上点 refresh / regenerate | 🟢 候选 issue；主聊天侧；与 D-009 分支侧无关 | 用户在 T-009 关闭后可单独复测；如仍存在则开 T-010 | （无） |
| D-009 | 分支 panel 内 regenerate / edit / delete 让模型瞎（系统提示丢失） | 主对话→选 assistant 文本→Open as branch→Create→在分支 assistant 消息上点 regenerate | 🟡 闸门级；首发 OK，二次操作不聚焦 selectedText | T-006D-2B 范围；Option 1 (BranchAssistantContext) 代码已实施，未 commit 等用户视觉验证 | **见下方 D-009 根因** |

> 注：D-006 / D-007 是用户明确要求**先记录、不优先修**的候选 issue。D-009 是 D-2B 范围内发现，Option 1 代码已实施，视觉验证通过后即 closed + commit。

### D-009 根因 + 修法

**根因**（源码追溯）：
- `Message.tsx:73` `const { assistant } = useAssistant(message.assistantId)` — 从 Redux `state.assistants[].assistants[]` 全局查
- 分支 user message 的 `assistantId` 等于主 assistant 的 id（同源），所以查得到，但 **Redux assistant 对象的 `.topics[]` 不含 branch topic**（preflight §W4：useBranchFork 故意不 `dispatch(addTopic)` 保持侧边栏干净）
- 取到的 assistant 沿 `resendMessage(msg, assistant)` / `regenerateAssistantMessage(msg, assistant)` 传到 thunks，再到 `fetchAndProcessAssistantResponseImpl(...origAssistant)`
- `messageThunk.ts:854` `origAssistant.topics.find(t => t.id === topicId)` → **undefined**（branch topic 不在 Redux assistant.topics）→ `topic?.prompt` 三元 → 用 origAssistant 原样 → **branch system prompt 丢失** → 模型瞎
- **不是** EventEmitter 缺注册：MessageMenubar 走 hook + props，不依赖 Messages.tsx 顶层的 SEND_MESSAGE/NEW_BRANCH 等事件

**修法（Option 1，已实施，未 commit）**：
- 新建 `src/renderer/src/context/BranchAssistantContext.tsx`：`BranchAssistantOverride` Context（default `null`）+ `useBranchAssistantOverride` reader + `resolveAssistantSource(id, reduxAssistant, override)` 纯函数承载 strict-match guardrail
- `useAssistant.ts` 三行接入：`override = useBranchAssistantOverride()` → `reduxAssistant = useAppSelector(...)` → `assistant = resolveAssistantSource(id, reduxAssistant, override)`。其余逻辑 bit-for-bit 未动
- `Chat.tsx` 计算 synthetic = `{ ...assistant, topics: [...assistant.topics, branchTopic] }` 并用 `<BranchAssistantContext value={...}>` **仅包 `<BranchPane>` 子树**（主聊天在 Provider 外，行为零变化）
- `useBranchFork.ts` 撤掉 `[T-006D-2B watch#1]` / `[T-006D-2B watch#3]` 调试日志（含 promptPreview / setTimeout redux 回读），保留 silent-killer warn 守卫
- 回归测试：`src/renderer/src/context/__tests__/BranchAssistantContext.test.ts` 4 用例覆盖 (1) null override → Redux (2) Provider + 严格匹配 → synthetic (3) Provider + id 不匹配 → Redux (4) stale Provider value → Redux

**待视觉验证**：分支内 regenerate / edit / delete 模型仍聚焦 selectedText；主聊天行为零变化；console 不出现 watch# 字样。

**附带遗留（不在 D-009 修复范围）**：
- **T-006D-2C-5** (preflight cleanup task)：`resendMessageThunk:1340` 和 `regenerateAssistantResponseThunk:1461` 调 `db.topics.update(branchTopicId, ...)` 写 Dexie。分支 topic 仅走 v2 SQLite，Dexie 不存在 → update 0 rows，不抛错也不写入。**功能不受影响**但产生静默状态不一致。Cleanup 留到分支识别机制做完时一起修

## 已 closed 问题

> 关闭判定：自动化修复 + 用户 fresh install 端到端手测确认现象消失。

| ID | 标题 | 关联任务 / 修复 | 关闭日期 | 关闭依据 |
|---|---|---|---|---|
| D-001 | v2 fresh install 创建 Topic 立即 FK 失败 | [T-003](./tasks/T-003_BaselineDebug/) 诊断；[T-004](./tasks/T-004_修复DefaultAssistantSentinel/) 修复 — commit `15ad2eb08` | 2026-05-21 | 用户 2026-05-21 同轮 fresh install 实测 baseline FK 未复现 |
| D-002 | assistant message 写入 SQLite FK 失败（`model_id='qwen'` 非 UniqueModelId） | [T-005A](./tasks/T-005A_AssistantMessageFK/) 诊断；[T-005B](./tasks/T-005B_修复ModelIdFK/) 修复 — commit `15ad2eb08` | 2026-05-21 | 用户 2026-05-21 同轮 fresh install 实测 gemma4:e4b 正常流式回复，无 FK 报错 |
| D-003 | Ollama 自动模型同步失败（Provider 0/0 Enabled + Chat picker 看不到 Ollama） | D-003A 诊断 [T-007](./tasks/T-007_OllamaProviderFix/) + D-003B 修复（`providers.json` 加 `defaultChatEndpoint: "ollama-chat"`）；D-003C 诊断 [T-008](./tasks/T-008_ChatPickerV1V2Gap/) + 评估 [T-008B](./tasks/T-008_ChatPickerV1V2Gap/方案B评估.md) + 实施 [T-008C](./tasks/T-008C_ChatPickerV2Migration/)（chat-model-popup 切 v2 + CHERRYAI fallback） | 2026-05-21 | 用户 2026-05-21 fresh install 实测：Ollama Provider 同步模型 ✅、Chat picker 可选 Ollama ✅、gemma4:e4b 正常生成 assistant 回复 ✅ |
| D-005 | assistant 回复结束后底部 3 个点（BeatLoader）一直转 | [T-009](./tasks/T-009_StreamingNotDispatchedToRedux/) 修复 — `newMessage.ts:275` 取消注释 SUCCESS 转换 + `StreamingService.finalize` 末尾防御性 dispatch | 2026-05-21 | 用户 2026-05-21 fresh install 实测：回复完成后 BeatLoader 消失 ✅、操作栏正常出现 ✅ |
| D-004 | Ask about this / Open as branch 在 assistant 回复文本上仍 disabled | 与 D-005 同源修复（PROCESSING→SUCCESS 转换打通后 MainTextBlock wrapper 正常渲染）；不需要 T-009B | 2026-05-21 | 用户 2026-05-21 fresh install 实测：DevTools 能看到 `role: assistant` 的 `data-message-id` + `data-block-id` wrapper ✅、选中文本后 Ask about this / Open as branch 可点击 ✅ |
| D-008 | 分支 panel 内消息流无法滚动，超出一屏的内容看不到 | 主对话 fork 分支 → 让分支 assistant 生成超长 markdown → 分支 panel 内无 scrollbar，底部被裁切 | T-006D-2B 范围；修 = `RowFlex` 加 `h-full`（主聊天靠 `<Main style={height: mainHeight}>` 强撑高度，不依赖 RowFlex；BranchPane 不带这个 override，h-full 链断在 RowFlex 处）；同时 BranchPane motion.div 加 `h-full` 作 belt-and-suspenders；BranchMessageStream 自挂 `overflow-y-auto`；删除 jsdom 跑通但实际无效的 false-green scroll 单测 | 2026-05-22 | 用户 2026-05-22 视觉验证：long branch reply 可滚 ✅、quote box 留在 scroll 上方 ✅、宽窄不同 branch width 都能滚 ✅ |

## 命名约定

- `D-NNN` —— issue 编号，单调递增，跨任务跨日不重置
- 一条 issue 在被工程任务关闭前，始终列在「当前 open」
- 关闭时移到「已 closed」并记录关闭日期 + 关闭 commit / 任务

## 模板（新增 issue 时）

```markdown
| D-XXX | 简短标题 | 一句话复现步骤 | 🔴阻塞 / 🟡 影响功能 / 🟢 小毛刺 | T-YYY | tasks/T-YYY_*/诊断.md |
```

---

## D-003 详细记录

> **记录日期**：2026-05-20 深夜
> **D-003A 诊断完成**：2026-05-21（T-007）
> **D-003B 修复实施**：2026-05-21（T-007）—— `providers.json:425` 加 `"defaultChatEndpoint": "ollama-chat"`，自动化校验过，用户 fresh install 验证 Provider 设置页 ✅
> **D-003C 诊断完成**：2026-05-21（T-008）—— Chat 弹窗仍读 v1 Redux，与 v2 DataApi 无桥接；CherryAI 显示是 selector 硬编码
> **T-008B 方案 B 可行性确认**：2026-05-21 —— 实际只需改 1 文件 ~50 行
> **T-008C 方案 B 实施完成**：2026-05-21 —— `chat-model-popup.tsx` 数据源切 v2 + CHERRYAI fallback 保留；下游 0 改动；自动化 98/98 ✅
> **D-003 端到端手测通过**：2026-05-21 —— Provider 同步 ✅、Chat picker 可选 Ollama ✅、gemma4:e4b 正常生成 assistant 回复 ✅；同轮顺带验过 D-001/D-002 baseline FK 不复现
> **状态**：✅ **D-003 已 closed**（A/B/C 三段全部修复 + 手测通过）
> **完整诊断/实施**：[T-007](./tasks/T-007_OllamaProviderFix/) + [T-008](./tasks/T-008_ChatPickerV1V2Gap/) + [T-008C](./tasks/T-008C_ChatPickerV2Migration/)
> **手测步骤**（历史参考）：[T-007 验证](./tasks/T-007_OllamaProviderFix/验证.md) + [T-008C 验证](./tasks/T-008C_ChatPickerV2Migration/验证.md)

### 现象（用户观察，未代码验证）

| 维度 | 观察 |
|---|---|
| **Ollama 本身** | ✅ 正常 —— `ollama list` 能看到本地模型；`curl http://localhost:11434/api/tags` 正常 JSON；`curl http://localhost:11434/v1/models` 正常 JSON |
| **Cherry Studio Ollama Provider 显示** | ❌ "Model list 0/0 Enabled" |
| **Select Model 弹窗搜索** | ❌ 搜 "ollama" 无结果 |
| **日志关键字** | `Provider auto model sync failed` / `Invalid JSON response` |
| **Ollama 设置页 UI 异常** | ⚠️ 疑似显示了 **Anthropic 风格字段**：`Anthropic API Host`、`/v1/messages` —— 这本不该出现在 Ollama 配置里 |

### 复现步骤

1. 已修复 T-004 + T-005B 的状态下启动 `pnpm dev`（即 baseline FK 都通了）
2. 本机已运行 `ollama serve`，且 `ollama list` 有至少 1 个模型
3. 在 Cherry Studio 设置中找到 Ollama Provider
4. 观察：模型列表为空、auto sync 报错、Select Model 搜不到

### 根因（T-007 诊断确认）

`packages/provider-registry/data/providers.json` 里 Ollama 条目**没有 `defaultChatEndpoint` 字段**，且 endpointConfigs 同时含 `ollama-chat` 和 `anthropic-messages`。`getProviderHostTopology.resolvePrimaryEndpoint` 的优先级表是 `[openai-chat-completions, openai-responses, anthropic-messages, google-generate-content, ollama-chat]` —— Ollama 在前两位都没有，于是**第 3 位 `anthropic-messages` 命中**（永远轮不到第 5 位的 `ollama-chat`）。

三个错位现象同源：

1. **form 渲染 Anthropic 字段** —— `ApiHost.tsx:65–82` 用 `primaryEndpoint === 'anthropic-messages'` 切换组件 → 渲染 `AnthropicApiHostField`（i18n key `settings.provider.anthropic_api_host`，副本预览带 `/v1/messages`）。
2. **auto sync 用错 type** —— `v1ProviderShim.v1ProviderTypeFromV2` 在 `defaultChatEndpoint` 为 null 时 fallback 到 `OPENAI_CHAT_COMPLETIONS` → switch 走 `default: return 'openai'`。
3. **auto sync 用空 apiHost** —— `v1ProviderShim.defaultChatBaseUrl` 同样 fallback 到 OPENAI_CHAT_COMPLETIONS → 查 `endpointConfigs['openai-chat-completions'].baseUrl` 不存在 → 返回 `''`。Legacy AiProvider 拿到 `{ type: 'openai', apiHost: '' }` 去请求模型列表 → 命中 OpenAI 默认 host 或空 URL → 非 JSON 响应 → "Invalid JSON response"。

横向对照：63 个 provider 里有 8 个没写 `defaultChatEndpoint`，其中 ovms / new-api / lmstudio 的 endpointConfigs 含 `openai-chat-completions` → 优先级表第 1 位命中 → "运气好"没事。Ollama 是**唯一一个主端点 key 不是 OpenAI 兼容**且缺 `defaultChatEndpoint` 的 provider，所以单点暴雷。

### 跟既有 baseline bug 的关系

- 与 T-004 / T-005B 不同：这两个是 **v2 数据层 FK 校验失败**（fresh install 状态下数据缺失）
- D-003 看起来更像是 **provider 配置层 schema/数据错位**（PresetProviderSeeder 或 provider form 的 bug）
- 不属于已经修过的「v1 sentinel / 短 id 类」同源链路

### 影响范围

- ✅ **不阻塞** Expand Branch UI-only 原型 —— UI 原型走 mock `BranchMessagesResponse` 数据驱动
- ✅ **不阻塞** baseline 二连修的手动验证（topic 创建、message 写入都不依赖 Ollama）
- ⚠️ **阻塞** "用 Ollama 做真实模型回复测试" —— 选不到 Ollama 模型 → 没法发到 ollama → 流式回复测不出来
- ⚠️ **阻塞** Ollama 用户的端到端可用性（这是产品功能层，不是工程 baseline 层）

如果只是要测真实 AI 回复，**临时绕路**：手动添加一个非 Ollama provider（OpenAI / Anthropic 等只要 API key 通），不阻塞 Phase 3。

### 已实施修复（D-003B，2026-05-21）

在 `packages/provider-registry/data/providers.json:425` 给 Ollama 条目加一行：

```diff
   {
     "id": "ollama",
     "name": "Ollama",
     "description": "Ollama - AI model provider",
+    "defaultChatEndpoint": "ollama-chat",
     "endpointConfigs": { ... }
   }
```

Schema 安全（`ProviderConfigSchema.refine` 只要求该值是 endpointConfigs 的某个 key，`ollama-chat` 符合）。

**自动化校验已过**：
- seeder 测试 4/4（real RegistryLoader + zod schema + DB row transform）
- ApiHost / useProviderAutoModelSync / useProviderEndpoints 共 16/16
- typecheck:web + typecheck:node 静默通过

⏳ 手动 fresh install 验证步骤见 [tasks/T-007_OllamaProviderFix/验证.md](./tasks/T-007_OllamaProviderFix/验证.md)。

这一行同时治三个错位：

| 现象 | 修复路径 |
|---|---|
| form 显 Anthropic 字段 | `resolvePrimaryEndpoint` 在 `provider.defaultChatEndpoint` 上短路 → `'ollama-chat'` → `isAnthropicPrimaryEndpoint = false` |
| sync 用 `type: 'openai'` | `v1ProviderTypeFromV2` 的 `ep = v2.defaultChatEndpoint` = `'ollama-chat'` → switch 命中 OLLAMA_CHAT → `'ollama'` |
| sync 用空 apiHost | `defaultChatBaseUrl` 同一路径 → `endpointConfigs['ollama-chat'].baseUrl` = `http://localhost:11434` |

详细验证步骤见 [tasks/T-007_OllamaProviderFix/诊断.md §5](./tasks/T-007_OllamaProviderFix/诊断.md)。

**未做 / 待后续**：

- 老用户 DB 升级路径（已入库 `defaultChatEndpoint = null` 的行如何迁移到 `'ollama-chat'`）—— 待用户决定是否做迁移或要求 fresh install
- 把 `defaultChatEndpoint` 改为 schema required（cleanup task）
- 调整 `PRIMARY_CHAT_ENDPOINT_PRIORITY` 顺序（防御层，影响面大，不必要）

### 引用

- 索引一行：见上方 §当前 open 问题
- 影响 / 风险定位：[../01_Project/风险与限制.md#R0.3](../01_Project/风险与限制.md)
- 是否阻塞 Phase 3：见 [当前状态.md](./当前状态.md)

