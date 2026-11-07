# Agent Note: 限制智能体轮次首次有效输出前的等待时间

Status: implemented

[English](2026-11-07-agent-turn-startup-output-bound.md) | 中文

## 问题

智能体轮次可能持续数分钟没有任何模型输出。唯一的时限是获取数据源后才生效的 120 分钟逐项空闲计时器，因此获取数据源本身可能无限等待。到期时结果为 `paused`，而不是可见的超时错误。

[聊天流空闲决策](2026-10-29-chat-stream-idle-bound.md) 继续负责较长的逐项空闲额度。本决策为满足条件的智能体执行增加独立启动时限，同时保留已有输出的流和其他调用方的空闲额度。

## 决策

`AiStreamManager` 仅为 `runtime.kind === 'agent-session'` 且没有显式 `requestOptions.timeout` 的执行提供首次有效输出前的 90 秒预算。单调时钟起点为执行的 `startedAt`，包含执行循环设置截止计时器之前已经流逝的时间。数据源获取和消费都与中止信号竞争；迟到的数据源会被取消而不被消费，不配合取消的操作不能延迟可见失败。

明确的有效输出白名单接受非空且不裁剪空白的文本、推理和工具输入增量；工具输入、审批控制和结果事件，包括合法的空输入或空结果；以及可用的文件或来源 URL、文档标题。权威消息部分采用对应内容检查。管理控制、边界、空的开始事件或骨架、`data-*` 部分和心跳都不会终止启动计时。正常完成的空响应仍为成功。有效输出永久终止启动计时，保留既有空闲策略。

原生智能体推理穿过进程内网关时，线协议无法表达的上游进度（增量工具参数）会在进程内回传给持有启动期限的执行。网关与执行侧共用同一有效输出判定表，避免仍在产出的模型因协议转换缓冲而被误判超时。

连接建立、压缩和待处理审批暂停剩余启动预算。所有重叠或重复的准备阶段共用累计 120 分钟上限；准备结束后继续使用剩余额度，不会刷新预算，累计额度耗尽后即使仍在准备，也恢复倒计时。准备 sink 是可选的进程内回调。权威快照中的 `approval-requested` 仅提供暂停计时所需的工具调用记录：它不算输出、不发布审批、不更改审批计时器，也不创建待处理或已发布的审批锚点。既有控制块路径仍是唯一的审批发布路径。

启动计时器触发的到期通过 `request_timeout` 显示为错误，沿用既有可见错误和手动恢复路径，不会自动重试。真实的用户取消以及此前观察到的提供商错误保留原分类。同步终态认领阻止迟到发布和重复终态派发。Home 和内部提示词流保留 120 分钟默认值；网关的 20 分钟覆盖值和其他显式覆盖值保留既有行为。

## 考虑过的替代方案

- SDK `chunkMs`：衡量 SDK 块而非有效输出，无法统一覆盖原生连接和数据源获取。
- 缩短共享空闲常量：会中断其他调用方合法的长时间推理和输出后等待。
- 修改网关的 20 分钟常量：无法覆盖普通智能体轮次，而且会改变另一项显式策略。
- 仅增加渲染进程提示：无法限制主进程负责的数据源获取、持久化失败，或在窗口关闭后结算轮次。
- 按提供商设置：增加配置和提供商专属策略，却没有修复共同的执行边界。

## 影响

在本层，输出前的静默推理和心跳无法与停滞区分。合法但缓慢的推理阶段现在可能出现可见失败，需要手动重试。准备阶段只有有限的累计豁免。原生关闭和准入屏障仍由运行时负责，不会为了制造重试可用性而清除。没有新增设置、IPC schema、数据库变更或语言键。

## 验证

- Regression — `src/main/ai/streamManager/__tests__/StartupDeadline.test.ts`：精确到期、输出后永久解除限制、嵌套和重复暂停的剩余预算核算、累计准备上限和释放行为。
- Regression — `src/main/ai/streamManager/__tests__/AiStreamManager.test.ts` 和 `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts`：进程内回传解除零块执行的启动期限、会话和助手消息匹配及回退、未受限执行与输出后空闲不变，以及跨 91 秒的缓冲工具参数进度、控制块和普通请求隔离。
- Regression — `src/main/features/apiGateway/__tests__/proxyStream.startupBoundary.test.ts`：同一次运行里的真实网关与真实 manager——91 条被缓冲的工具参数增量让零 chunk 的智能体执行越过预算仍存活，同一 fixture 在上游无输出时仍在 90 秒到期。
- Regression — `src/main/ai/streamManager/__tests__/AiStreamManager.test.ts`：受限的数据源获取和消费、有效输出、仅快照审批的暂停且不发布、不改变计时、不留下终态锚点、真实审批发布且快照不重复发布、错误分类、单次终态派发、迟到数据源取消、显式覆盖值以及输出后的空闲行为。
- Regression — `src/main/ai/agentSession/__tests__/AgentSessionRuntimeService.handoff.test.ts`：连接及压缩的成对报告、重放和清理、错误持久化以及原生关闭归属。
- Regression — `src/main/utils/__tests__/withIdleTimeout.test.ts`：首个读取一直等待及既有逐项空闲契约；`src/main/ai/runtime/aiSdk/loop/__tests__/agentLoop.test.ts` 和 `src/main/features/apiGateway/__tests__/proxyStream.stream.test.ts`：受影响调用方的覆盖。两组指定测试分别通过 266 项和 127 项。
- Electron — `tests/e2e/smoke/agentStartupOutputBound.test.ts`：在隔离 profile 下针对已构建应用的真实运行 1.7 分钟通过。真实模拟 SSE 响应在发出响应头和空助手增量后保持打开，Agent 轮次在 90,484 ms 后显示 `An error occurred / Request timed out`，处理中占位符消失，填写但不发送恢复草稿后 Send 可用，随后 5 秒内只观察到一次推理请求。截图与 `{ requestCount: 1, errorText, elapsedMs }` JSON 随运行结果一并留存。
