# T-006D-2 Branch Panel — Side-by-Side Branch（Preflight 后修订）

**日期**：2026-05-21
**阶段**：T-006 / T-006D
**状态**：
- D-2A（首版：fork → 跳转新 topic）：✅ 代码 + 自动化通过；❌ **手动验证产品方向不对**（跳转破坏 side-by-side 体验）— 不 commit、不上线
- D-2B（side-by-side 重设计）：🧠 架构方案 v2 → ⚠️ **被 preflight 推翻部分关键假设** → ✅ **preflight 完成，等批准实施**

## 一句话

D-2A 技术跑通但产品形态错（跳转 ≠ side-by-side）。**Preflight 验证**发现：
- 渲染层可清洁复用 MessageGroup（不能直接复用 Messages.tsx）
- 模型不自动读祖先消息，**buildBranchPrompt 是刚需**（D-2A 实际上模型完全瞎）
- `topic.prompt` 是天然的系统提示槽位，模式 A 零侵入达成 **prompt 隐藏**（用户看到干净 followUp，模型看到选区+指令）
- `DELETE /topics` 存在；**关闭即 DELETE + Redux removeTopic** 是最干净的"关闭即丢"语义

## 文件（按当前权威级别）

| 文件 | 角色 | 状态 |
|---|---|---|
| [preflight.md](./preflight.md) | **当前权威**：四块承重墙调查结论 + 修正后的最小实施步骤 + cleanup task 登记 | ✅ 写完 |
| [架构方案.md](./架构方案.md) | 旧的架构方案 v2 | ⚠️ **deprecated by preflight**（保留作 history 参考；新设计以 preflight 为准） |
| [实施.md](./实施.md) | D-2A 实施记录 | ✅ 历史归档；D-2A 不 commit |
| [验证.md](./验证.md) | D-2A 验证 + 手动失败现象 | ✅ 历史归档 |
| 完成总结.md | 待加 | ⏳ D-2B 实施 + 手动验证后补 |

## 与父 T-006D 的关系（preflight 后视图）

| 子步 | 范围 | 状态 |
|---|---|---|
| D-1 | Dialog 壳子 + state 串联 + 字段显示 + 占位 handler | ✅ commit `76ee326a0` |
| D-2A | POST /topics fork + setActiveTopic 跳转 + 既有 sendMessage | ❌ **产品方向不对，停止推进；代码不 commit** |
| **D-2B（preflight 修正版）** | side-by-side 并列 branch panel：Chat.tsx 持 branchTopic 本地 state；BranchPane 复用 MessageGroup 渲染流；topic.prompt 注入 selectedText 系统提示；关闭即 DELETE | 🧠 preflight 完成 → ⏳ 待批准 S1'–S7' 实施 |
| D-2C-0 | 流式中 disable Ask/Open（独立小任务，与 D-2B 正交） | ⏳ |
| D-2C-1..4 | preflight 登记的 cleanup（DELETE retry / abort-during-stream / Graduate / 服务端 branch kind） | ⏳ 仅记录 |
| D-2D | 主目标注入（W2 第 ② 段，看模板效果决定要不要做） | ⏳ |
| D-2E | 精确子串 `<mark>` 高亮 | ⏳ |
| D-3 | Sheet 改造 / "针对此处提问" 注入 inputbar | ⏳ |

## 不在 D-2B 范围（明确推后）

- `useCache('branch-anchor.*')` + cacheSchemas（→ T-006E 高亮做完才有消费者）
- BranchAnchor 扩字段（→ T-006E）
- 流式 disable Ask/Open（→ T-006D-2C-0）
- 多轮分支追问 / mini Inputbar（→ T-006D-2C-3 graduate）
- 精确子串高亮（→ D-2E）
- 主目标注入（→ D-2D，看 S4' 模型聚焦实测）
- 任何 DB schema / migration / Provider / Ollama / Chat picker 改动
- 任何 SelectionContextMenu 逻辑变更（仅接线变 Chat.tsx）

## 关联

- 上游：[[T-006D-1_Shell]] / [[T-006C_Menu]] / [[T-006B_TextSelection]]
- DataApi 契约：`packages/shared/data/api/schemas/topics.ts`
- 核心 hook 点（preflight 发现）：
  - `messageThunk.ts:855-857` — `topic.prompt` 拼接进 system prompt
  - `fetchAndProcessAssistantResponseImpl.ts:865-883` — 上下文仅来自 `selectMessagesForTopic`
- 工程纪律：[[../../../../../../CLAUDE.md]]
