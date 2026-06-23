# B6-Upstream — 流式 message 状态语义清理（上游重构，待排期）

> **状态**:🟡 open / 待排期 —— **仅文档,未写代码**。下游已用 B6-A 绕过(见 §3),上游本体留作独立任务。
> **类型**:上游重构(触保护区,跨"主聊天 + 分支")
> **关联**:[[问题与Debug记录]] §B6 ·  [[tasks/P1_MultiBranch/P1-S3_Disposition/README]] ·  T-009/D-005(本议题的来源副作用)
> **命名**:原建议 `T-007_StreamingMessageStatusLifecycle` 与已存在的 `T-007_OllamaProviderFix` 撞号,故用本名。

---

## 1. 背景

P1-B6 调查发现:**assistant message 在第一个 block 完成时就被 reducer 提前标成 `success`,而底层 stream / HTTP / provider 可能仍在运行。**

后果:**用 `message.status` 判断"是否仍在流式中"不可靠。** 任何"按 status 过滤正在生成的消息"的逻辑(中止、loading、禁用输入等)都会在"首个 block 完成 → 真正流结束"这段窗口里误判。B6 里它表现为:流式中关分支 → 取靶按 status 命中 0 → abort 信号从未发出 → Ollama 跑到底 → finalize 打 404 + unhandled rejection;Ollama 串行时还阻塞下一个分支。

**这是系统性问题,不是分支特有** —— 主聊天 `pauseMessages` 用同款 status 过滤,在首个 block 完成后点 Stop 同样停不住后端。

---

## 2. 已知链路(file:line)

过早置 success 的同步链:

| 步骤 | 位置 |
|---|---|
| AI SDK `text-end` → 发 `TEXT_COMPLETE` chunk(仍在 `readFullStream` 循环内,流未结束) | `aiCore/chunk/AiSdkToChunkAdapter.ts:253-262` |
| `onTextComplete`:block 状态设 SUCCESS,调 `smartBlockUpdate(..., isComplete=true)` | `services/messageStreaming/callbacks/textCallbacks.ts:90-100` |
| `smartBlockUpdate` 立即 `streamingService.updateBlock` | `services/messageStreaming/BlockManager.ts:119` |
| `updateBlock` dispatch `upsertBlockReference` | `services/messageStreaming/StreamingService.ts:386-393` |
| **reducer:`block===SUCCESS && message===PROCESSING → message=SUCCESS`**(= T-009/D-005 修复,本意消 BeatLoader) | `store/newMessage.ts:270-283` |

真正的流结束发生在**更晚**:

| 步骤 | 位置 |
|---|---|
| AI SDK `finish` → 发 `BLOCK_COMPLETE`(在 `done=true` 前) | `aiCore/chunk/AiSdkToChunkAdapter.ts:354-392` |
| `onComplete` 触发 | `services/StreamProcessingService.ts:73-75` |
| `finalize` PATCH `/messages/:id` | `services/messageStreaming/callbacks/baseCallbacks.ts:375` |
| `readFullStream` 循环 `done=true` 才真正读完 HTTP | `aiCore/chunk/AiSdkToChunkAdapter.ts:115-138` |

相关 abort 机制(本议题旁证):

- `addAbortController(userMessageId, …)` 注册,键 = `assistantMessage.askId` —— `store/thunk/messageThunk.ts:925-926`;signal 接到 fetch —— `:950`。
- **`removeAbortController` 生产代码从不调用**(只在 `abortCompletion` 内部),`utils/abortController.ts:11-31` → **abortMap 泄漏**:已完成消息的控制器永久留存。

---

## 3. 当前已采取的下游修复(已完成,不在本任务内)

P1-S3 / **B6-A**(commit `0452c70c4`):

- `pages/home/Messages/BranchPanel/abortBranchTopicStream.ts` 取靶改为**按 abortMap live controller**(`role==='assistant' && askId && abortMap.has(askId)`),**不再依赖 `message.status`**。
- 对已结束控制器调 `abortCompletion` 是无害幂等 no-op;branch close abort 已通过 **smoke**(Network 里 Ollama 请求 canceled、token 停、后端不再全量完成)。
- 仅 app 层一文件,未碰保护区。

→ 分支侧症状已解决。**但 message.status 的语义问题本体仍在**(主聊天 `pauseMessages` 仍按 status 过滤),故立此任务。

---

## 4. 上游本体暂不修的原因

1. **触保护区**:`newMessage.ts` reducer、`StreamingService`、`baseCallbacks`、`messageThunk`、`abortController` 都在本分支的"保持 byte-identical"保护清单内。
2. **可能复活 T-009/D-005**:那个 PROCESSING→SUCCESS 提前转换是**有意**加的,用来消掉"BeatLoader 三个点不消失 / message action bar(复制·重发·引用)不出现"。直接推迟 success 会把这俩 bug 带回来。
3. **需要重新设计**四者关系:loading / streaming / block status / message status —— 不是改一行能收口的,值得单独评估。

---

## 5. 未来可选方向(待评估,未拍板)

| 方案 | 思路 | 初步评估 |
|---|---|---|
| **A** | message 只有在 stream 真 `onComplete`/`finalize` 后才变 success | 最治本,但**直接复活 BeatLoader/action-bar 问题**,必须同时把 `isMessageProcessing` 的判定从 message.status 解耦(否则 loading 永真)。改动面最大。 |
| **B** | 保留 message success,新增更准确的 **stream-active / abortable** 状态(或复用已有 `loadingByTopic`)作为"是否仍在流式"的唯一可信信号 | 侵入小、不动既有 UI 语义;`useMessageOperations.ts:35` 已有 `selectNewTopicLoading`(读 `loadingByTopic[topicId]`)可作起点。需确认它在"首个 block 完成→真结束"窗口内仍为 true。**推荐优先评估。** |
| **C** | `finalize`/`onComplete` 后**清理 abortController**(`removeAbortController`),解决 abortMap 泄漏 | 独立小修,顺带让 B6-A 的"按 abortMap 取靶"更精确(消除已完成项的误命中 → 去掉那 8s timeout 权衡)。与 A/B 不冲突,可先做。 |
| **D** | 统一主聊天 `pauseMessages`(`useMessageOperations.ts:142`)与 branch abort 的取靶逻辑 | 抽一个共享 helper(如 `collectAbortTargets(topicId)`),两处都按同一可信信号取靶。等 B/C 定了信号源后再做收口。 |

> 组合建议(供排期参考):**C(清泄漏)→ B(引入可信 stream-active 信号)→ D(统一取靶)**;A 作为更大的"状态机重设计"另议,且必须连带处理 BeatLoader/action-bar。

---

## 6. 完成标准(将来谁接手时)

- [ ] "是否仍在流式中"有**单一可信信号**(非 message.status),且在"首个 block 完成 → 真 onComplete"窗口内正确为 true。
- [ ] 主聊天 Stop **和** 分支 close abort 都用该信号取靶,首个 block 完成后点停**仍能真停后端**(Network 请求 canceled)。
- [ ] T-009/D-005 的 BeatLoader/action-bar 行为**不回归**(有测试守住)。
- [ ] (若做 C)abortMap 不再泄漏;B6-A 里"已完成分支关闭走 8s timeout"的权衡可移除。
- [ ] 主聊天与分支取靶逻辑统一(D),无重复实现。

---

## 7. 关联

- 真因 + B6-A 详述:[[问题与Debug记录]] §B6
- 下游修复落地:[[tasks/P1_MultiBranch/P1-S3_Disposition/README]]
- 来源副作用:T-009/D-005(`store/newMessage.ts:274-282` 注释)
- 提交:`0452c70c4`(B6-A)
