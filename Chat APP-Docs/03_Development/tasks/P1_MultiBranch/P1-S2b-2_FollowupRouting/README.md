# P1-S2b-2 — Multi-Branch follow-up：conversation-state composer + per-card 路由

**状态**：✅ 已实施（2026-06-01；focused 94/94 绿；路由 mutation 双向命中 expected-red；待 commit）
**前置**：[[../P1-S2b-1_MultiBranchUI/README|P1-S2b-1 Multi-Branch UI 基础]]（commit `5c7071a69`）
**前一篇**：[[../README|P1 概览]]

---

## 目标

补上 S2b-1 明确推后的那块：**conversation 态卡片的 follow-up composer**——在已建立的某条分支里继续追问，并保证 N 个分支共存时 follow-up 被路由到**那张卡自己的 branch topic**，而不是 `branches[0]` 或某个全局 "active" 分支。

这一步触碰发消息路径（send path），所以单独隔离、带 mutation/red-test 纪律。S2b-1 正是因为它触碰 streaming 才把它推后。

## 触碰边界（守住）

- **复用现有 send path**：`dispatch(sendMessage(message, blocks, assistant, topicId))` 是公共 thunk。本步只用正确的 `branchTopic.id` + synthetic assistant 调用它，**没有改 sendMessage / streaming / messageThunk / model-picker / provider 任何内部**。
- **未动** `sourceHighlight.ts`（`git diff` 空，已验证）
- **未动** `__BRANCH_ANCHOR_CTX_CACHE__` HMR 缓存模式、`BranchAnchorContext.tsx`
- **未动** fork creation（`useBranchFork`）、Redux / Dexie
- **未做**（明确推后）：
  - hover↔highlight 联动 → S2b-2 精修步（styling polish）
  - 新分支创建后 auto-scroll-into-view → 精修步
  - 凸起/斜角 folder-tab 视觉 + 动画 → 精修步
  - 每卡 streaming/loading 视觉态（composer 发送后禁用/转圈）→ 精修步（当前回复进 BranchMessageStream，composer 提交即清空、不阻塞）
  - discard vs save 关闭语义 → S3

> 注：S2b-1 README 把 "follow-up composer" 和 hover/auto-scroll/folder-tab 一起统称 "S2b-2"。本轮把 S2b-2 拆成两半：**S2b-2(本文) = follow-up 路由（动 send path、单独隔离）**；剩下的纯视觉精修（hover / auto-scroll / folder-tab styling）仍叫 "S2b-2 精修步"，未做。

## 关键发现：初始提问 vs follow-up 的 send path

`useBranchFork.fork()`（S1'）的五步里，真正发消息的是最后两步：

```
getUserMessage({ assistant: synthetic, topic: branchTopic, content: followUp })
dispatch(sendMessage(message, blocks, synthetic, branchTopic.id))
```

follow-up = 给**已存在**的 branch topic 追加一轮，所以它**只需要这两步**，跳过 `POST /topics`（topic 已建）。两个非显然的要求都从 fork 继承：

1. **target topic id**：`sendMessage(..., branchTopic.id)` 把 user 消息 + 流式回复路由进该分支的 topic。N 分支共存时，调用方必须传那张卡自己的 branch topic——**路由正确性在调用点**（Chat.tsx 把 `branchId` 解析成 `branch.topic`）。
2. **synthetic assistant 携带该 branch topic + 它的 prompt**：`messageThunk.ts:853` 在**每次** send 都 `origAssistant.topics.find(t => t.id === topicId)?.prompt` 重建 system prompt。branch topic 的 `topic.prompt` 携带隐藏的 Mode-A system prompt（selectedText + 主目标）。若 follow-up 传了普通 Redux assistant（它的 `.topics` 从不含 branch topic——刻意不进侧边栏），第二轮就会丢掉 selectedText 上下文、模型变瞎。所以 hook 重建和 fork 同款的 `{ ...assistant, topics: [...topics, branchTopic] }` synthetic。

**结论 = 干净复用，不触 STOP**：无需改 send-thunk / streaming 内部，只是用正确参数调用公共 thunk。

## 路由 + 隔离怎么实现

| 层 | 做法 |
|---|---|
| `useBranchFollowUp({ assistant }).send(branchTopic, followUp)`（**新 hook**）| 镜像 useBranchFork 的 dispatch 尾段、去掉 POST /topics。空白 followUp 防御性不 dispatch。返回 void（回复进 stream，不需要状态机）|
| `BranchFollowUpComposer`（**新组件**）| 极简 textarea + Send + 非空守卫 + 提交清空。**本地 draft state** = 每卡输入隔离（在 B 打字不漏到 A/C）。**不复用 BranchComposer**：后者是 compose 态表单（quote + "创建分支" 按钮 + Cancel=关闭分支），语义不符 in-conversation 追问；与其加 mode flag，不如独立一个 ~60 行组件更清晰 |
| `BranchCard` | conversation 态在 `BranchMessageStream` 下挂 `<BranchFollowUpComposer onSend={onSendFollowUp}>`；compose 态不挂 |
| `BranchPane` | 新 prop `onSendFollowUp(branchId, followUp)`；每卡闭包 `onSendFollowUp={(f) => onSendFollowUp(branch.id, f)}`（镜像现有 `onCreate` 模式）。**这是路由闭包——mutation 靶点** |
| `Chat.tsx` | `const branchFollowUp = useBranchFollowUp({ assistant })`；`handleSendBranchFollowUp(branchId, f)` = `branches.find(b => b.id === branchId)?.topic` → `branchFollowUp.send(topic, f)`；compose 态（topic===null）no-op |

**每卡隔离的三条腿**：① composer 本地 draft（输入不串）② 路由只命中 `B.topic.id`（send 不串）③ 每卡 `BranchMessageStream` 走 `useTopicMessages(topic.id)`（回复只显示在自己卡）。**没有建并发流处理**——若 provider 串行化流式，可接受。

## 改的文件（12 src + 5 docs）

### 8 product/test src（4 new + 4 modified；以 `git status` 为准）

| 文件 | 改动 |
|---|---|
| `src/renderer/src/hooks/useBranchFollowUp.ts` | **新建** —— per-card follow-up send hook（复用 sendMessage thunk，无 POST /topics）|
| `src/renderer/src/pages/home/Messages/BranchPanel/BranchFollowUpComposer.tsx` | **新建** —— 极简 conversation 态 composer（本地 draft + 非空守卫 + 提交清空）|
| `src/renderer/src/pages/home/Messages/BranchPanel/BranchCard.tsx` | + prop `onSendFollowUp`；conversation body 末尾挂 `<BranchFollowUpComposer>` |
| `src/renderer/src/pages/home/Messages/BranchPanel/BranchPane.tsx` | + prop `onSendFollowUp(branchId, followUp)`；每卡闭包 `(f) => onSendFollowUp(branch.id, f)` |
| `src/renderer/src/pages/home/Chat.tsx` | + `useBranchFollowUp({ assistant })` + `handleSendBranchFollowUp(branchId, f)`（branchId→topic 解析 + 调 hook）+ 传给 BranchPane |
| `src/renderer/src/i18n/locales/{en-us,zh-cn,zh-tw}.json` | + `chat.message.anchor.panel.send`（Send / 发送 / 傳送）|

### 4 test src

| 文件 | 用例 |
|---|---|
| `hooks/__tests__/useBranchFollowUp.test.ts` | **新建**（5）：dispatch 命中传入 topic.id / 路由到 A 不到 B / synthetic 携带该 topic+prompt / 用 raw followUp + 绑该 topic / 空白不 dispatch |
| `BranchPanel/__tests__/BranchFollowUpComposer.test.tsx` | **新建**（4）：trim 后 emit / 提交清空 / 空白不 emit + 校验提示 / 再输入清掉校验 |
| `BranchPanel/__tests__/BranchCard.test.tsx` | +2（12→14）：conversation 渲染 composer & compose 不渲染 / 提交转发 onSendFollowUp(text) |
| `BranchPanel/__tests__/BranchPane.test.tsx` | +3（10→13）：conv 卡渲染 composer & compose 不渲染 / **[A,B,C] 在 B 提交只命中 B、A/C 无** / 在 A 提交命中 A（首卡不特殊）；外加全部旧 render 补 `onSendFollowUp` 必填 prop |

## 测试矩阵（focused 94/94）

| 文件 | 用例数 | 备注 |
|---|---|---|
| useBranchFollowUp.test.ts | 5 | 新建 |
| BranchFollowUpComposer.test.tsx | 4 | 新建 |
| BranchCard.test.tsx | 14 | 12 → 14 |
| BranchPane.test.tsx | 13 | 10 → 13 |
| useBranchFork.test.ts | 9 | 回归（未改）|
| MainTextBlock.test.tsx | 23 | 回归（未改）|
| constants.test.ts | 7 | 回归（未改）|
| sourceHighlight.test.ts | 19 | 回归（**字节未改**）|
| **focused 合计** | **94** | （S2b-1 时 84 → S2b-2 94）|

## 路由 mutation 验证（Step 4）

路由闭包 `onSendFollowUp(branch.id, ...)` 是核心。做了两个 mutation：

| Mutation | `[A,B,C] 在 B 提交` 测试 | `[A,B] 在 A 提交` 测试 | 结论 |
|---|---|---|---|
| **M1**：`branch.id` → `branches[0].id`（总是首卡）| **RED ✓** | GREEN（构造使然：A 恰是 branches[0]，本 mutation 检测不到）| B 测试是 branches[0] mutation 的守卫 |
| **M2**：`branch.id` → `branches[branches.length-1].id`（总是末卡）| **RED ✓** | **RED ✓** | 证明 A 测试本身非空转 |

**结论**：B 路由测试（非首卡、`[A,B,C]` 中间卡）在 M1+M2 都 RED——是真正的路由守卫。A 路由测试在 M1 保持 GREEN **是预期、不是 fake-green**：A 恰好等于 `branches[0]`，该 mutation 无法被它区分；M2 下 A 测试 RED 证明它确实在断言真实路由。**没有任何路由测试是全局空转的**。每个 mutation 后已 revert，`BranchPane.tsx` 回到 `branch.id`。

**唯一未单测的胶水**：Chat.tsx 的 `branches.find(b => b.id === branchId)?.topic`（branchId→topic 解析）。它没在 Chat 层单测（Chat 组件依赖图过重，渲染成本高）——与 S2b-1 的 `handleCreateBranchFollowUp` / `handleCloseBranch` 同一先例（都靠 BranchPane 转发正确 id + 上下游单测夹逼）。BranchPane 证 card→branchId（mutation 守卫），hook 证 topic→dispatch(topic.id)，中间一行标准 `.find` 视为可信。

## build:check

- `pnpm lint`：typecheck（web/node/aicore 全 exit 0）+ i18n check 通过 + biome format（幂等）+ format check —— **全过**。
- focused 套件 94/94 绿（format 后复跑确认）。
- 完整 `pnpm test`：据 [[../../../下一步|下一步]] 记录，完整跑会在 vitest 主进程 shutdown 阶段 SIGSEGV（已确认环境问题、非测试失败、不阻塞 renderer 改动）。本轮未跑完整套件，以 focused + lint 为准。

## Manual smoke checklist（用户跑 dev）

- [ ] 开 1 个分支并发首问 → 进 conversation 态，卡底部出现 follow-up composer
- [ ] 在该 composer 输入第二个问题 → 回复进**同一张卡**的 stream，主对话不受影响
- [ ] 开第 2 个分支（B）也发首问进 conversation 态 → 两张卡各有自己的 composer
- [ ] 在 B 的 composer 打字 → A 的 composer **不出现**这段文字（本地 draft 隔离）
- [ ] 在 B 提交 follow-up → 回复进 **B 的 stream**，A 的 stream 不动
- [ ] 在 A 提交 follow-up → 回复进 **A 的 stream**
- [ ] 空 / 纯空格提交 → 不发送、提示 "请输入追问"
- [ ] conversation 态卡折叠（chevron）→ composer 随 body 一起隐藏；展开恢复
- [ ] 对话进行中关闭某卡（X）→ 该卡消失、其高亮清除，其它卡 stream/composer 不动

## S2b-2 精修步 / S3 留下的

**S2b-2 精修步（纯视觉，未做）**：hover 卡 ↔ 主对话对应段高亮联动；新分支 auto-scroll-into-view；凸起/斜角 folder-tab 视觉 + 动画；每卡发送中的 loading/禁用态。

**S3（未做）**：close 语义分裂——discard（DELETE topic + UI close）vs save（留 SQLite + 折叠为可重开 chip）。当前 follow-up 与 S2b-1 关闭路径一致：仍是 "discard 但不 DELETE"，SQLite topic 行留 orphan（path Y / T-006D-2C-5）。
