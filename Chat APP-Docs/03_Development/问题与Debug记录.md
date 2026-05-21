# 问题与 Debug 记录（索引）

> 滚动 issue 列表。每条 `D-NNN` 一行；详细诊断在对应的任务文件夹下的 `诊断.md`。
> 命名空间与任务 ID 独立 —— D 是 issue（问题），T 是 task（工程）。一个 issue 通常对应一个或多个 task。

## 当前 open 问题

| ID | 标题 | 复现 | 严重度 | 关联任务 | 诊断文档 |
|---|---|---|---|---|---|
| D-003 | Ollama 自动模型同步失败（Provider 显示 0/0 Enabled，日志 Invalid JSON response；Chat 弹窗仍搜不到 Ollama） | 启动 dev，前提是本地 ollama 正常（`ollama list` 有内容，`curl /v1/models` 正常 JSON）—— 进入 Ollama Provider 设置 / Chat Select Model 弹窗 | 🟡 non-blocking | 🩺 [T-007 D-003A](./tasks/T-007_OllamaProviderFix/) 诊断 ✅ + [D-003B](./tasks/T-007_OllamaProviderFix/) 修复 ✅（Provider 设置页通了）；🩺 [T-008 D-003C](./tasks/T-008_ChatPickerV1V2Gap/) 诊断 ✅；[T-008B 方案 B 可行性](./tasks/T-008_ChatPickerV1V2Gap/方案B评估.md) ✅ —— **~50 行 src 单文件改动，推荐直接实施，跳过 A** | [tasks/T-008_ChatPickerV1V2Gap/方案B评估.md](./tasks/T-008_ChatPickerV1V2Gap/方案B评估.md) |

## 待终态确认（自动化已修，手动验证 pending）

| ID | 标题 | 复现 | 关联任务 | 诊断文档 | 状态 |
|---|---|---|---|---|---|
| D-001 | v2 fresh install 创建 Topic 立即 FK 失败 | 删 `~/Library/Application Support/CherryStudioDev` → `pnpm dev` → 新建 topic | [T-003](./tasks/T-003_BaselineDebug/) 诊断；[T-004](./tasks/T-004_修复DefaultAssistantSentinel/) 修复 | [tasks/T-003_BaselineDebug/诊断.md](./tasks/T-003_BaselineDebug/诊断.md) | ⏳ 待 `rm + pnpm dev` 手动验证 |
| D-002 | assistant message 写入 SQLite FK 失败（model_id='qwen' 非 UniqueModelId） | T-004 后发送任意消息 → AI 回复瞬间报 FK | [T-005A](./tasks/T-005A_AssistantMessageFK/) 诊断；[T-005B](./tasks/T-005B_修复ModelIdFK/) 修复 | [tasks/T-005A_AssistantMessageFK/诊断.md](./tasks/T-005A_AssistantMessageFK/诊断.md) | ⏳ 待 `rm + pnpm dev + 发消息` 手动验证 |

## 已 closed 问题

（暂无）

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
> **T-008B 方案 B 可行性确认**：2026-05-21 —— 重新评估后只需改 **1 个文件 ~50 行**（chat-model-popup.tsx）+ 重写测试，复用现成 `toV1ProviderShim`/`toV1ModelShim`，下游 0 改动。**比方案 A（双写桥）更干净，推荐直接走 B**
> **状态**：🩺 D-003A/C 诊断 ✅；🔧 D-003B 修复 ✅（部分）；⏳ D-003C 待用户拍板实施 B
> **完整诊断**：[T-007 D-003A/B](./tasks/T-007_OllamaProviderFix/诊断.md) + [T-008 D-003C](./tasks/T-008_ChatPickerV1V2Gap/诊断.md) + [T-008B 方案 B 评估](./tasks/T-008_ChatPickerV1V2Gap/方案B评估.md)
> **手测步骤**：[T-007 验证](./tasks/T-007_OllamaProviderFix/验证.md)

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

