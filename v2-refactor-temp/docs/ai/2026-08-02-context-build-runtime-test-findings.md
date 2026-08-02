# 上下文构建/压缩运行时测试发现的问题

> 更新日期:2026-08-02
> 测试方式:克隆档案 `CherryStudioCtxTest`(阈值 5000→100000、`context_window` 缩至 16000)+ cherry-electron-dev 实例,真实模型(aihubmix::claude-sonnet-4-6 / gemini::gemini-2.5-flash)驱动长程工具任务。
> 范围:feat/context-build-truncation 分支 @ `7f0a0fbd34`(其中 #1、#5、#6 为 main 既有问题,与本分支无关)。
> 已验证正常的部分见 `tool-result-db-trim.md` 文末「实施结论」;此文只记问题。

## #1 tool_invoke 的 inputExamples 与序列化 schema 不匹配 → Anthropic 端点上 defer 一触发整请求 400

**严重度:高(main 既有 bug,建议单独开 issue)**

- **现象**:tool defer 触发(auto 池 > 窗口 10% 等三条件)后,meta 工具进入请求,Anthropic 系端点(实测 aihubmix)返回
  `tools.N.custom: Example at index 0 is invalid: False schema does not allow "cherry studio latest release". Each example must match the tool's input_schema.`
  整个请求失败;同一请求去掉 MCP(defer 不触发)即成功;换 Gemini 端点(不校验示例)defer 全链路正常(tool_search/tool_invoke 均验证通过)。
- **根因**:`src/main/ai/tools/adapters/aiSdk/meta/toolInvoke.ts` 的
  `inputExamples: [{ input: { name: 'web_search', params: { query: 'cherry studio latest release' } } }]`
  与 `params: z.record(z.string(), z.unknown()).optional()` 经 zod→JSON Schema 序列化后的结果不匹配(子 schema 落成 `false`),Anthropic API 新增的示例校验按 schema 拒绝该 example。
- **影响面**:Anthropic 家族端点 + auto 池过线(默认 200k 窗口需 ≈20k tokens 的 MCP 工具描述,约几十个工具;小窗口模型更容易)。多 MCP 重度用户会真实命中,且表现为"开了很多 MCP 后 Claude 突然全部请求报错"。
- **修复方向**(任一):对齐 example 与序列化后的 schema;去掉 `inputExamples`;anthropic provider 侧在发送前丢弃与 schema 不符的 examples。注意 `toolSearch.ts`/`toolInspect.ts` 的 examples 需一并核查。

## #2 durable 压缩折叠附件消息后,read_file 失联、细节不可恢复

**严重度:中(本分支相关的交互缺口)**

- **现象**:16k 窗口下第一轮(20 页 read_file)结束后,第二轮 turn 开始触发 durable 压缩,带附件的 user 消息被折进 `compaction_summary`。此后:
  1. served 消息里没有 file part → `collectFileAttachments` 为空 → `hasFileAttachments=false` → **read_file 不再注册**,模型想重读附件也做不到(实测模型自报工具列表无 read_file);
  2. 只能凭摘要回答细节,实测答错(问 LOG-0001 的 temperature,答 119,实际 21.1)。
- **对比**:工具输出有 `<persisted-output>` marker + fs_read 幸存通道(信封渲染 + 历史 allow-list 注入,跨压缩仍可读回);**普通附件没有对应通道**。
- **修复方向**:压缩 serve 视图时保留被折叠消息的 fileAttachments(allow-list 独立于 served parts 收集,如从原始路径行收集);或摘要中保留附件清单提示并保持 read_file 挂载。
- **位置**:`PersistentChatContextProvider.resolveCompactedHistory`(折叠)× `buildAgentParams.collectFileAttachments`(从 request.messages 收集)。

## #3 read 类工具回声全量占库(v1 裁剪范围边界,两轮测试均出现)

**严重度:中(已知范围决策,量化后建议提优先级)**

- **现象**:
  - 测试 1:模型跟随 marker 用 fs_read 读回 3 份全文,fs_read 的结构化输出(`{kind,text,...}`,truncatable:false + 非 string/mcp-content 形状)不参与 persist 裁剪 → 95KB 消息中 ~66KB 是 fs_read 回声;
  - 测试 2:20 个 read_file 结构化输出 169KB 全量入 `message.data`。
- **本质**:v1 裁剪范围只收 string 与全文本 MCP 信封;read 工具(fs_read/read_file)的结构化输出即使巨大也全量入库。**模型越勤快读回,DB 省得越少**。
- **修复方向**:扩展 `shape:'json'`(结构化输出序列化后裁剪+重建);或单独让 read 类工具输出参与 persist 裁剪——persist 层裁剪不会引发 in-flight 循环(fs_read 的 in-flight 豁免可保留)。

## #4 in-loop 压缩无记忆化的成本放大(代码已注明 accepted cost,此处量化实测)

**严重度:低-中(优化项)**

- **实测**:16k 窗口、20 步 read_file 循环中,主循环步输入被正确压至 9-11k tokens,但每个超限步全量重折叠旧轮次:摘要化调用输入 44k→50k→60k→66k 递增。整轮 20 请求共 446k input tokens($0.83,prompt cache 吸收 cacheRead 252k)。
- **方向**:循环内 memoize 已折叠摘要(增量折叠),`inLoopCompaction.ts` 头注释已标 "no memoization in v1"。

## #5 turn 以 ToolLoopTerminalError 终止时 AiTurnTrace 持久化崩溃

**严重度:低(main 既有,观测性缺口)**

- **现象**:`WARN [AiTurnTrace] Failed to persist root span ai.turn TypeError: Cannot read properties of undefined (reading '0') at AiStreamManager.onExecutionError` —— 恰好在最需要 trace 的异常终止路径上丢了 trace。
- **位置**:`AiStreamManager.onExecutionError` → AiTurnTrace 持久化。

## #6 mcpToolIds 空数组不回落到助手绑定(行为待确认,可能按设计)

**严重度:待确认**

- **现象**:`resolveTools` 中 `request.mcpToolIds` 只有 **undefined** 才回落到 `resolveAssistantMcpToolIds(assistantId)`;渲染端 composer 传空数组时,助手在 DB 里绑定的 MCP 服务器完全不进请求。实测两个新话题行为不一致:重启后 renderer 首个新话题带上了助手绑定的服务器,同一 renderer 会话内再新建的话题则为空选。
- **待确认**:新话题的 composer MCP 默认选中集是否应继承助手绑定;若是,渲染端初始化逻辑可能有状态残留问题。

---

### 附:测试中确认不是 bug 的现象

- 第一轮长循环以 `ToolLoopTerminalError`(20 步工具上限)终止 —— 步数护栏,按设计。
- gemma 免费层配额报错 —— 外部配额限制。
- 压缩后细节回答不精确本身是摘要化的固有代价;#2 记录的是"想重读也读不到"的通道缺失。
