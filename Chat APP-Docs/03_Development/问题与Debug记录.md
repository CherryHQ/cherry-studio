# 问题与 Debug 记录（索引）

> 滚动 issue 列表。每条 `D-NNN` 一行；详细诊断在对应的任务文件夹下的 `诊断.md`。
> 命名空间与任务 ID 独立 —— D 是 issue（问题），T 是 task（工程）。一个 issue 通常对应一个或多个 task。

## 当前 open 问题

| ID | 标题 | 复现 | 严重度 | 关联任务 | 诊断文档 |
|---|---|---|---|---|---|
| D-003 | Ollama 自动模型同步失败（Provider 显示 0/0 Enabled，日志 Invalid JSON response） | 启动 dev，前提是本地 ollama 正常（`ollama list` 有内容，`curl /v1/models` 正常 JSON）—— 进入 Ollama Provider 设置 → 看到 "Model list 0/0 Enabled" / Select Model 搜 ollama 无结果 | 🟡 non-blocking | （尚未建任务；待后续 T-006 诊断） | [本文 §D-003 详细记录](#d-003-详细记录) |

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
> **状态**：🟡 open / non-blocking
> **决策**：先记录，**不**深入排查；不阻塞 Phase 3 Expand Branch UI-only 原型

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

### 假设空间（**全部未验证，留给未来 T-006 诊断时核查**）

按可能性排序：

1. **Provider 配置数据/类型错位**
   - 用户看到 Ollama 设置页有 `Anthropic API Host` / `/v1/messages` 字段 —— 强提示 Ollama provider 的 schema / form 在某条路径上被当成了 Anthropic-like
   - 可能是 v2 PresetProviderSeeder 给 Ollama 写入的预设配置错了；或者前端 form 渲染时拿错了 schema
   - 需要看：`src/main/data/db/seeding/seeders/presetProviderSeeder.ts` 给 Ollama 的预设 + provider 设置页的 form schema
2. **自动同步请求打错 endpoint**
   - 若代码硬编码 `/v1/messages`（Anthropic 路径），而 Ollama 模型列表应该是 `/api/tags` 或 `/v1/models` → 返回不是 model list JSON → "Invalid JSON response"
   - 用户已经测过 ollama 的 `/v1/models` 返回正常 JSON —— 间接说明可能是 Cherry **没走** `/v1/models` 这条路径
3. **JSON parser 期望的形状不匹配 OpenAI/Ollama 返回结构**
   - `/v1/models` 返回的是 OpenAI 兼容形状（`{ data: [...] }`），而 parser 可能在 expect `{ models: [...] }`（Ollama 原生 `/api/tags` 形状）—— 单纯 shape mismatch
4. **provider type / category 字段错位**
   - v2 schema 里 provider 有 `type` / `endpointTypes` 等区分；如果 Ollama 行的 `type` 被错填为 `'anthropic'`，整条同步链都会走 Anthropic 适配器

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

### 待办（不在本次范围）

未来开 T-006 诊断时要核查：

- [ ] `src/main/data/db/seeding/seeders/presetProviderSeeder.ts` 中 Ollama 行的 `type` / `endpointTypes` / `baseUrl` / `apiPath` 等字段是否正确（应该是 `'openai'` 兼容路径或 `'ollama'` 专用类型）
- [ ] Provider auto-sync 的实现位置（grep `Provider auto model sync failed` 字符串可直达）
- [ ] Provider 设置页 form schema 是否按 `provider.type` 分支渲染；为何 Ollama 渲染出了 Anthropic 字段
- [ ] `Invalid JSON response` 是 sync 层包装的还是 fetch 层的；定位到具体 parse 调用，看期望 schema vs 实际返回 shape
- [ ] fresh install 时 Ollama provider 行是否正确入库（`SELECT * FROM user_provider WHERE id LIKE '%ollama%'`）

### 引用

- 索引一行：见上方 §当前 open 问题
- 影响 / 风险定位：[../01_Project/风险与限制.md#R0.3](../01_Project/风险与限制.md)
- 是否阻塞 Phase 3：见 [当前状态.md](./当前状态.md)

