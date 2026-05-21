# T-006D-2 Branch Panel — Side-by-Side Branch

**日期**：2026-05-21 起 → 2026-05-22 主体实施
**阶段**：T-006 / T-006D
**状态**：
- D-2A（首版：fork → 跳转新 topic）：✅ 代码 + 自动化通过；❌ **手动验证产品方向不对** — 废弃不 commit
- **D-2B Side-by-side（重设计）**：✅ S1'–S4' 全部入库（commits `c278f5c0a` + `e49d1cc0f` + `3e2ecec41`），**S4' 产品 go/no-go 闸门 2026-05-22 视觉验证通过**
- **D-008 scroll bug**：✅ closed 2026-05-22（高度链断裂修在 RowFlex 层）
- **D-009 regenerate/edit/delete 模型瞎**：🟡 Option 1 (BranchAssistantContext) 代码已实施，未 commit，**待视觉验证**

## 一句话

D-2A 技术跑通但产品形态错（跳转 ≠ side-by-side）。**D-2B 实施完 S1'–S4'，用户视觉验证通过 — 模型回复围绕 selectedText、prompt 通过 `topic.prompt` 隐藏、侧边栏不污染**。后续两个发现的硬伤：scroll 修在 RowFlex 高度链层（D-008 closed）；regenerate/edit/delete 根因 = Redux 全局 useAssistant 取不到带 prompt 的 branch topic，Option 1 (BranchAssistantContext) 边界注入已实施待视觉验证（D-009）。

## 文件（按当前权威级别）

| 文件 | 角色 | 状态 |
|---|---|---|
| [preflight.md](./preflight.md) | **当前权威**：四块承重墙调查结论 + 修正后的最小实施步骤 + cleanup task 登记 | ✅ 写完 |
| [架构方案.md](./架构方案.md) | 旧的架构方案 v2 | ⚠️ **deprecated by preflight**（保留作 history 参考；新设计以 preflight 为准） |
| [实施.md](./实施.md) | D-2A 实施记录 | ✅ 历史归档；D-2A 不 commit |
| [验证.md](./验证.md) | D-2A 验证 + 手动失败现象 | ✅ 历史归档 |
| 完成总结.md | 待加 | ⏳ D-2B 实施 + 手动验证后补 |

## 与父 T-006D 的关系（实施后视图）

| 子步 | 范围 | 状态 |
|---|---|---|
| D-1 | Dialog 壳子 + state 串联 + 字段显示 + 占位 handler | ✅ commit `76ee326a0` |
| D-2A | POST /topics fork + setActiveTopic 跳转 + 既有 sendMessage | ❌ **产品方向不对，废弃；代码不 commit** |
| **D-2B Side-by-side** | Chat.tsx 持 branchTopic 本地 state；BranchPane 复用 MessageGroup 渲染流；topic.prompt 注入 selectedText 系统提示 | ✅ **S1'–S4' commits `c278f5c0a` + `e49d1cc0f` + `3e2ecec41` 入库；S4' 闸门通** |
| D-008 | 分支 panel 滚动失效 | ✅ closed 2026-05-22（RowFlex h-full 修高度链；详见 [问题与Debug记录.md D-008](../../../问题与Debug记录.md)） |
| D-009 | 分支内 regenerate/edit/delete 模型瞎 | 🟡 Option 1 (BranchAssistantContext) 实施完，未 commit 待视觉验证（详见 [问题与Debug记录.md D-009](../../../问题与Debug记录.md)） |
| D-2C-0 | 流式中 disable Ask/Open（独立小任务，与 D-2B 正交） | ⏳ |
| D-2C-1..5 | preflight 登记的 cleanup（DELETE retry / abort-during-stream / Graduate / 服务端 branch kind / **分支侧 Dexie 0-row 静默写**） | ⏳ 仅记录 |
| D-2D | 主目标注入（W2 第 ② 段；看模板效果决定要不要做） | ⏳ |
| D-2E | 精确子串 `<mark>` 高亮 | ⏳ |
| D-3 | Sheet 改造 / "针对此处提问" 注入 inputbar | ⏳ |
| Task 3 | MAIN \| BRANCH resizable divider（仅两栏宽度比例） | ⏳ 用户排队下一步 |

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
