# P1-S3 — 关闭去向路由（disposition）+ 「保留」按钮

**状态**：✅ 已实施（2026-06-04；focused 87/87 绿；pending-delete mutation 非空转；待 commit）
**前置**：[[../P1-S2c_MasterDetail/README|S2c accordion]]（`0698edf64`）+ [[../../问题与Debug记录#B5|B5 关闭中止流式]]（`ed8314ec1`）
**设计**：[[../../../P1架构设计草案#3b|§3b 关闭（卡片 X）— S3 去向路由 · 定稿]]

> 关闭分支时按"去向"路由:**pending(默认)→ 静默 DELETE fork topic(吸收 orphan 债);kept → 不删**。给开着的分支加一个显式「保留」按钮。B5 的"流式中止"在两种去向下都先跑。

## 删除机制 + 隔离（Step 0 确认）
- fork topic 是 **v2 DataApi topic**(useBranchFork 经 `POST /topics` 建,刻意不进 Redux 侧边栏)。对称删除 = **DataApi `DELETE /topics/:id`** —— handler 已存在(`src/main/data/api/handlers/topics.ts:45` → `topicService.delete(id)`,事务级联删 messages + tags + pins + topic 行,`TopicService.ts:198`)。
- **隔离**:`topicService.delete(id)` 只按该 id 删它自己 + 它的 messages,**不碰主 topic / 其它分支 topic**。
- `TopicManager.removeTopic`(Dexie/v1)删不到 v2 SQLite 行 → 不用它;**只 CALL 现有 DataApi DELETE,不改 Redux/Dexie/DataApi 内部**。→ 不触 STOP。

## 改动逐项
| 文件 | 改动 |
|---|---|
| `BranchPanel/types.ts` | + `Branch.disposition: BranchDisposition`(`'pending' \| 'kept'`)+ 导出该 type |
| `BranchPanel/branchDisposition.ts` | **新建** —— `DEFAULT_BRANCH_DISPOSITION='pending'` / `toggleDisposition` / `disposeBranchTopicOnClose(branch, deleteForkTopic)`(pending+有 topic→删;kept 或 compose 态→不删)|
| `BranchPanel/scheduleForkTopicDeletion.ts` | **新建** —— delete-after-settle:非流式立即删 / 流式等本 topic 的 `MESSAGE_COMPLETE` 后删 + timeout 兜底 + cleanup |
| `BranchPanel/abortBranchTopicStream.ts` | **改**(B5 文件)—— 现**返回**中止的在途消息 id(给 delete-after-settle 等待)|
| `BranchPanel/BranchDetail.tsx` | + 「保留/Keep」toggle 按钮(`data-testid=branch-keep-toggle`,`aria-pressed`/`data-kept`,Bookmark↔BookmarkCheck,kept 时 filled)+ prop `onToggleKeep` |
| `BranchPanel/BranchAccordionItem.tsx` + `BranchPane.tsx` | 透传 `onToggleKeep`/`onToggleKeepBranch(branchId)` |
| `pages/home/Chat.tsx` | openBranchAnchor 设 `disposition: DEFAULT_BRANCH_DISPOSITION`;`toggleKeepBranch`;`useMutation('DELETE','/topics/:id',{refresh:['/topics']})`;**handleCloseBranch**:`abortBranchTopicStream`(返回在途 id)→ `disposeBranchTopicOnClose(branch, topicId => scheduleForkTopicDeletion(topicId, abortedIds, …))` → 其余 close 不变 |
| `i18n/{en,zh-cn,zh-tw}.json` | + `panel.keep`/`panel.kept` |

## 关闭路由（Chat.tsx handleCloseBranch）+ delete-after-settle
```
const branch = branches.find(b => b.id === branchId)
const abortedMessageIds = branch?.topic ? abortBranchTopicStream(branch.topic.id) : []  // B5：先中止，返回在途消息 id
if (branch) disposeBranchTopicOnClose(branch, topicId =>                                  // S3：pending 删 / kept 不删
  scheduleForkTopicDeletion(topicId, abortedMessageIds, id => deleteForkTopic({params:{id}})))
clearSourceHighlight(branchId); setBranches(filter ...); ...        // 既有 close 不变（分支**立即**移出面板）
```
**不删 topic 以外的东西**;**kept 仍从 branches[] 移除**(只 topic 留库)。

### delete-after-settle（修流式-pending-close 的 404 竞态）
诊断:pending 关闭一个**流式中**分支时,`deleteForkTopic`(DELETE /topics)会**赛过** abort 的 finalize PATCH(`StreamingService.finalize` → `PATCH /messages/:id`)→ message 已级联删 → **404 + finalize 重抛 → onError 未 await 的 promise → unhandled rejection**(诊断详见 [[../../问题与Debug记录]])。

修(**app 层,不碰 streaming/abort/finalize 内部**):
- `abortBranchTopicStream` 现**返回**它中止的在途(processing/pending)消息 id。
- 新 `scheduleForkTopicDeletion(topicId, awaitedMessageIds, deleteTopic, timeoutMs=8000)`:
  - **非流式**(ids 空)→ **立即删**(无 in-flight finalize,无竞态)。
  - **流式**→ 注册一次性 **`EVENT_NAMES.MESSAGE_COMPLETE`** 监听(只匹配该 topicId),等被中止的消息逐个 settle(MESSAGE_COMPLETE 在 finalize PATCH **之后**发,`baseCallbacks:278`)→ 全 settle 后才删;+ **兜底 timeout**(8s,事件不来也删,绝不漏 orphan);事件或超时后自动 cleanup 监听 + 清 timer。
  - **不监听 Redux message.status**:abort 在 finalize PATCH **之前**置 SUCCESS(`baseCallbacks:269`)→ 监听它仍会 race。`MESSAGE_COMPLETE` 才是"finalize 落地"信号。
- **多在途**:用 Set 跟踪所有被中止消息 id,全 settle 才删;timeout 是 backstop。
- 分支**立即**移出面板(setBranches 同步),只有 DB 删除被推迟。

## 测试（focused 85/85 含 delete-after-settle）
- `branchDisposition.test.ts`(5):默认 pending / toggle pending↔kept / **close pending→`deleteForkTopic('topic-fork-1')`** / close kept→不删 / compose 态(无 topic)→不删。
- `BranchDetail.test.tsx`(+2):Keep 按钮 pending↔kept / 点击 fire `onToggleKeep`。
- **`scheduleForkTopicDeletion.test.ts`(7,新)**:非流式→立即删且不注册监听 / 流式→**不同步删**、MESSAGE_COMPLETE(本 topic)后才删 + 一次性 cleanup / 忽略别的 topic 的事件 / 多消息等全 settle / **timeout 兜底**(fake timers)/ 不重复删 / 返回的 cleanup 移除监听。
- `abortBranchTopicStream.test.ts`(+返回值断言):返回在途消息 id(streaming→`['a1']`,非流式→`[]`)。
- 既有 BranchTab/AccordionItem/Pane fixtures 补 `disposition` + renders 补 `onToggleKeep`。
- **mutation(2 个)**:① `disposeBranchTopicOnClose` 去 delete → "close pending→删" RED;② `scheduleForkTopicDeletion` 改成总是立即删 → "流式不同步删"等 5 RED。均 revert。
- **SCOPE**:这些断言的是**时序**(删等 MESSAGE_COMPLETE);真正的"无 404 / 无 unhandled rejection"靠真实 finalize PATCH 竞态 → **manual-smoke**(jsdom 复现不了)。

## 保护文件 + build
`git diff --stat` 空:`sourceHighlight.ts`/`BranchAnchorContext.tsx`/`StreamingService.ts`/`messageThunk.ts`/`abortController.ts`/`InputbarCore.tsx`/`MessageEditor.tsx`/`store/*`/`useTopic.ts`/`src/main/data/*`。`pnpm lint` 全过(typecheck + i18n + format)。完整 `pnpm test` 未跑(已知 shutdown SIGSEGV)。

## 明确 P2 / 未做（按设计 §3b "P1↔P2 缝"）
- **本会话「保留列表」UI**(看到所有 kept 分支)= **P2**。
- **undo toast** = future。
- **清理历史 orphan topic**(本步只 going-forward 吸收新债)= 不做。
- **branches[] 跨刷新持久化 + 找回 kept**(点回去 + 高亮重建)= **P2**(S3 不顺手做持久化)。

## Manual-smoke（请你 dev 验）
- [ ] 开分支 → 直接关(pending,非流式)→ fork topic **立即被删**(不在 topic 列表 / 无 orphan)。
- [ ] **流式中**关闭 pending 分支 → 流停 + 分支**立即**移出面板 + 稍后(finalize 落地后)fork topic 被删 + **无 404、无 unhandled rejection / dev 红屏**。
- [ ] 开分支 → 点「保留」(视觉变 已保留 filled)→ 关 → fork topic **仍在**;关 kept 分支从面板移除但 topic 留库。
- [ ] B5 隔离:多分支,一个流式中关它,**其它分支 + 主聊天**的流式不受影响。
- [ ] 再点「保留」取消 → 回 pending → 关 → 又会删。
