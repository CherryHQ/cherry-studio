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

---

## 补充测试:网络搜索 × 压缩召回率 × 前缀缓存命中(AI_SDK_DEVTOOLS=1)

> 场景:16k 窗口(aihubmix::claude-sonnet-4-6,前两轮 gemini-2.5-flash),4 轮联网搜索(巴黎奥运金牌/C919 航程/SQLite 版本/珠峰高程)+ 4 轮禁搜索召回测验;devtools 捕获全部 24 个请求载荷于 `.devtools/generations.json`。

### 结论 1:web 搜索结果没有持久化/截断通道(设计如此,记录为潜在跟进)

`web_search`/`web_fetch` 均 `truncatable: false`(引用工具,citation 抽取需要原文)——搜索结果**双份全量**:出站 prompt 内联 + `message.data` 全量,唯一的瘦身通道是压缩层(折叠旧轮)。另有独立的 `chat.web_search.compression`(method/cutoff_limit,本档案为 none)在结果进入上下文前做源级压缩,与 context-build 无关。若给 citable 工具开 persist 通道,需先解决 citation 与 marker 的共存。

### 结论 2:durable 压缩对搜索轮生效,prompt -68%,写一次服务多次

搜索 4 轮后估算过线,durable 压缩在 turn 开始触发一次(边界行写入 2,391 字符摘要;耐人寻味:边界行是一条 error 消息,收尾时仍被正确选中)。devtools 实测出站 prompt 从 28KB 降到 9KB(-68%);之后 8 个请求全部复用同一摘要行,**无重复摘要化调用**(对照 in-loop 的每步重折叠,durable 是 write-once-serve-many)。

### 结论 3:召回测验 4/4 全对(含被折叠轮次)

- 被折叠的 R1(巴黎奥运 40 金):精确召回,模型自述"根据对话摘要中保留的信息" ✅
- 被折叠的 R2(C919):精确复述了失败情形(页面内容为空、无 web_fetch、未给最终数字),摘要甚至保留了"备用知识 5555km 但当时未作为答案"的区分 ✅
- 未折叠的 R3/R4(SQLite 3.51.0 / 2025-11-04、珠峰 8848.86 米):逐字召回 ✅
- 摘要质量注记:摘要为结构化英文 digest(✅ Completed / ❌ Failed/Incomplete / Context to Preserve),对"数字型事实"的保真明显好于 read_file 测试中对 2000 行日志明细的保真(#2 的 LOG-0001 答错)——**摘要保真度与信息密度强相关**,事实型 QA 场景召回率高,海量明细场景仍需读回通道。

### 结论 4:前缀缓存命中率 ≈99.9%(字节稳定的直接证据)

压缩启用后连续 9 个成功请求的 Anthropic usage:每步 `noCache` 仅 **1-3 tokens**,`cacheRead` 3,087→4,604 递增,`cacheWrite` 只覆盖新增后缀——摘要行渲染 + 全量 web 结果在多轮间字节完全稳定,provider 前缀缓存几乎满命中。Gemini 两轮的隐式缓存命中率约 60-80%。

### 过程中复现的既有问题

- **#1 再次命中且路径更真实**:重启后新话题自动继承助手绑定的 MCP(即 #6 行为),16k 窗口下 auto 池过线 → defer 触发 → aihubmix(Anthropic API)连续 6 个请求 400,用户无任何显式操作即全灭;取消话题 MCP 选择后恢复。
- anthropic 直连与 gemini 免费层的配额/余额错误为外部因素(gemini free tier 5 req/day)。

---

## #7 web_fetch/web_search 是否应参与截断——分析与分层建议

**性质:改进方案(承接补充测试结论 1;web_fetch 建议尽快做)**

### 豁免现在真正保护的两层

1. **In-flight 引用诚实性**:两工具输出为 `[{id:'<prefix>-<n>', title, url, content}]` JSON 数组(`webLookup.ts` `mapResponse`),模型靠"看见的条目"回写 `[cite:id]`。截断器对 json 是 stringify 后掐 head/tail——cite id 与 content 的映射会被从中间切碎,模型对未见条目要么弃引(信息损失)要么幻引(更糟)。
2. **落库后的 citation 渲染**:`src/renderer/utils/message/citations.ts` 的 citation registry **就地从 message.data 的工具输出 parts 解析**("no persisted reference metadata")。输出被信封替换后,历史消息的角标/来源卡/导出/复制全部失解。

### 现状的真实风险(实测支撑)

- 压缩层从不折当前 turn(durable 只折 keep 边界前,in-loop 至少保一 turn)——**当前轮一发超大 fetch 结果没有任何防线**。`web_fetch` 的 readable content 无工具级上限(长文档页 50-200k chars),是目前唯一完全裸奔的上下文洪水源;search(max_results=5×snippet)实测单轮仅 3-6k chars。
- 双份全量落库,重复搜索不去重。
- 源级压缩 `chat.web_search.compression`(`postProcessing.ts`,cutoff/rag)存在但默认 none。

### 分层建议

1. **web_fetch:应改为可截断,优先做**。引用身份是 URL 且在 **input** 里(result 骨架也有),截 content 不损失引用身份;内容为单篇正文,head/tail + marker + fs_read 读回与 filesystem read 语义同构;又是最大单发洪水源。in-flight 翻 flag 即止血;persist 侧待 `shape:'json'`(#3)配 citation-aware 信封(保留 `{id,url,title}` 骨架)。
2. **web_search:不建议裸翻 flag**。默认 100k 阈值下几乎永不触发(no-op),触发时伤的恰是引用结构。正确杠杆是**给源级 cutoff 一个温和默认值**(逐条裁 content、天然保留每条 id/url/title),而非动 truncatable。
3. **终局抽象:结构感知截断**。布尔 flag 表达不了 citable 工具的需求——按 result 条目为单位裁 content、永不裁引用骨架。可在 truncator `perTool` 上扩展 per-tool 自定义 reducer,让 web_search/web_fetch/kb_search 都能安全参与截断+持久化。

**行动排序**:① web_fetch 翻 flag(一行,立即止血)→ ② search 源级 cutoff 默认值 → ③ `shape:'json'` + citation-aware 信封(与 #3 合并)→ ④ per-tool reducer。

**量级 sanity check**:200k 正常窗口下 search 需 ~100+ 轮才顶满(压缩层足够);fetch 一发长页即可 50k+——优先级由此而来。

---

## #7 附:根本修复设计——内容/结构分离的「实体级裁剪」(Tool Output Codec)

> 根因一句话:现在的截断把工具输出当**不透明字节流**(extractText → head/tail),而工具输出实际是**有结构的**——身份字段(id/url/title)+ 大体积内容字段。字节级掐断毁结构,整工具豁免弃防线;布尔 `truncatable` 表达不了"裁内容、保骨架"。根本修复 = 把裁剪单位从字节流改成**实体的内容字段**。

### 核心抽象:每个工具注册一个输出编解码器(codec)

```ts
// ToolEntry 上替代布尔 truncatable 的声明(与工具 schema 同文件,单一事实源)
interface ToolOutputCodec<TOutput> {
  /** 拆分:骨架(身份/引用字段,永不裁)+ 可裁文本块(每实体一块) */
  deflate(output: TOutput): { skeleton: unknown; blobs: Array<{ key: string; text: string }> } | null
  /** 重建:骨架 + 全文块 → 原始输出(渲染端展开 / ai.tool.get_result 用) */
  inflate(skeleton: unknown, blobs: Record<string, string>): TOutput
}
// 未注册 codec = 现状 'opaque'(字符串/全文本 MCP 走既有 head/tail);
// 'exempt' 仅留给真正永不裁的场景(如 fs_read 的 in-flight 防循环豁免)。
```

预置 codec:
- **web_search / web_fetch / kb_search**:`entities` 形——骨架 = `[{id,url,title}]`,blobs = 各条 `content`。超阈值只裁单条 content 为 head/tail + marker,**引用骨架在 prompt 与 DB 双侧永不有损**。
- **fs_read / read_file(#3 顺带解决)**:`json-text-field` 形——骨架 = `{kind,startLine,...}`,blob = `text` 字段。fs_read 保留 in-flight 豁免(防循环),但 **persist 侧裁回声**;整页读回的 blob 经 contentHash 去重直接命中它刚读的那个 entry,零额外存储。

### 统一管线(两条 lane 共享一个裁剪原语)

```
trimToolOutput(toolName, output, budget)          // 唯一入口,查 registry codec
  ├─ in-flight(truncator):裁后的实体渲染 per-entity marker → 出站 prompt
  └─ persist(trimToolOutputs):信封扩展为多 blob 形态
       $persistedToolOutput: {
         shape: 'text' | 'mcp-content' | 'entities' | 'json-text-field',
         skeleton,                       // 引用骨架原样落库 → citation registry 照常就地解析
         blobRefs: [{ key, fileEntryId, vfsFilename, head, tail, totalChars, totalLines }]
       }
```

每个 blobRef 一条 `tool_output` file ref(一消息多 ref 已支持);fs_read 的 per-request allow-list 收集全部 blobRefs 路径;`ai.tool.get_result` / 渲染端展开走 `inflate`。

### 五条不变量(「根本」的定义)

1. **引用骨架永不有损**——prompt 侧模型看全每条 id/url/title(内容为摘录),DB 侧 citation registry 解析不变;
2. **单一裁剪原语**——形状判断只写在 codec 里一处,in-flight 与 persist 永不漂移(今天的 `extractPersistableText`/truncator `extractText` 双实现合并);
3. **确定性渲染**——marker/骨架为存储字段的纯函数,字节稳定,前缀缓存维持 ≈100% 命中(已有契约测试模式直接沿用);
4. **全文永可读回**——每个被裁 blob 都有 marker + fs_read 通道 + UI 展开;
5. **失败回退全量**——codec 抛错则该输出原样落库(宁胖勿丢,沿用现有 per-part try/catch)。

### 落地阶段

| 阶段 | 内容 | 消化的问题 |
|---|---|---|
| P1 | codec 接口 + web_fetch entities codec(仅 in-flight) | #7 最大洪水源止血 |
| P2 | 多 blob 信封 + skeleton 落库 + inflate 读回/展开 | #7 persist 侧、citation 共存 |
| P3 | web_search/kb_search codec + 源级 cutoff 默认值;fs_read/read_file 回声 codec | #3 全量消化 |
| P4 | 删除布尔 `truncatable`(迁移为 codec/exempt 声明),truncator 的 `extractText` 与 `extractPersistableText` 合并进 codec | 双实现漂移风险清零 |

**触点**:`src/main/ai/tools/adapters/aiSdk/types.ts`(ToolEntry 声明)、`packages/aiCore/src/core/context/truncator.ts`(改查 codec)、`src/shared/ai/transport/persistedToolOutput.ts`(信封扩展,守卫向后兼容)、`src/main/ai/streamManager/persistence/trimToolOutputs.ts` + `src/main/ai/messages/persistedOutputRendering.ts`(走统一原语)、`src/main/ai/tools/webLookup.ts` / `FsReadTool.ts`(codec 定义)、`src/renderer/utils/message/citations.ts`(skeleton 解析,预期零改动)。
