# 调研：面向未来的知识库 Agent 工具面 + 越用越准的检索

Date: 2026-06-09

> 本文是一次**面向未来（v2.x 终态）**的设计调研，回答两个问题：
>
> - **Q1**：未来 file-mode 知识库虽然本质是文件，但 Agent 不应通过通用 filesystem 工具访问，而应由 knowledge 子系统暴露专用工具。该给 Agent 暴露几个、哪些工具？（需同时支撑企业版云端 + 独立 knowledge 工具；有向量库时 hybrid、无向量库时 BM25、agent 直接读文件扩上下文等情况都要覆盖。）
> - **Q2**：既然本质是文件、用户本可自建文件夹当知识库，为什么还要做成独立栏目/子系统？其检索算法能否让知识库"越用越贴合该用户、效果越来越好"？（看 arxiv 论文。）
>
> **定位**：当前内部工具（`kb__list` / `kb__search`）被视为**迁移起点的对照基线**，不是设计约束——目标态以本文的工具面与检索蓝图为准。
>
> **方法**：多 agent workflow——Q1 由 4 个不同立场（极简 / 表达力 / 检索模式抽象 / 本地↔云端等价）brainstorm 收敛；Q2 由 5 路 web/arxiv 研究 + 对抗式论文存在性核验（39 篇去重论文全部确认存在，0 篇被纠正）。
>
> **关于"延伸阅读"的说明**：论文清单经联网核验，但核验器倾向宽松；2026 年新近 arxiv id（`2602.*` 等）请使用时再做一次抽查。

---

# Q1：File-mode 知识库该给 Agent 暴露几个、哪些 knowledge 专用工具

## 一句话结论

**推荐 5 个 knowledge 专用工具：`kb__list` / `kb__search` / `kb__read` / `kb__tree` / `kb__manage`**——其中 `kb__list` + `kb__search` 是已实现的最小检索闭环，`kb__read` 是 v2.x 必须立即兑现的"locator 驱动扩上下文"入口，`kb__tree`（按结构浏览）与 `kb__manage`（add/delete/refresh 收口为带确认协议的单工具）延后到 provenance/scanner 落地后再上。**坚决不暴露任何 raw filesystem 工具**，且本地与企业云端共用同一套以 opaque locator 为坐标的契约。

> 这个数字是四个立场的"加权收敛"：极简派主张 2 个（search+read），能力协商派主张 2 个（search+list），正交派主张 12 个（search/read/read_around/tree/glob/grep/get_material/add/delete/refresh/list_bases/edit_content_index），抽象派主张 5 个（list/search/read/tree/manage）。下文逐节说明为什么落在 5 而不是 2、也不是 12。

## 推荐工具清单

| 工具 | 签名（伪 TS，省略部分字段） | 用途 | 覆盖场景 | v2.x 必需 / 延后 |
|---|---|---|---|---|
| `kb__list` | `(input:{query?,groupId?}) -> Array<{id,name,groupId,backend:'local'\|'cloud',access:'read'\|'read_write',status,capabilities:{canRead,canTree,canAdd,canDelete,canRefresh},retrieval:{mode:'hybrid'\|'bm25',reranked},itemCount\|null,sampleSources[]}>` | 发现当前用户**可见**的知识库，并把后端差异/检索能力编码成显式字段，供选 baseIds 与软能力协商 | list-bases, cloud-enterprise, bm25-no-vector, hybrid-with-vector | **必需**（已实现，需补 `capabilities`/`retrieval`/`backend`/`access` 字段） |
| `kb__search` | `(input:{query,baseIds,topK?,cursor?}) -> {hits:Array<{id,content,score:[0,1],scoreKind:'relevance'\|'ranking',mode:'hybrid'\|'bm25',locator,sourceLabel}>,nextCursor?,scopeNotices:Array<{baseId,reason:'forbidden'\|'not_found'\|'unindexed'\|'rate_limited'}>}` | 唯一检索入口：per-base hybrid/BM25 + dedup + rerank，自适应模式，**每条命中回传 retrievalMode/scoreKind/locator** | hybrid-with-vector, bm25-no-vector, read-expand-context, cloud-enterprise | **必需**（已实现，需补 locator/scoreKind/mode/scopeNotices，并把 dedup 从 pageContent 改为 contentHash） |
| `kb__read` | `(input:{locator, window?:{before?,after?,wholeUnit?}}) -> {status:'ok'\|'snippet_only'\|'forbidden'\|'stale'\|'not_found',content?,charStart?,charEnd?,truncated?,prevLocator?,nextLocator?,sourceLabel,message?}` | 凭 search locator 取命中片段的**邻近上下文（read-around）/ 整段（wholeUnit）**；判别式 status 统一表达降级与拒绝 | read-expand-context, cloud-enterprise, refresh-snapshot, content-index-edit | **必需**（依赖 content.text + char offset 落地；当前 chunker 未返回 offset，先以 unitId+chunkIndex 退化为整 chunk 读取） |
| `kb__tree` | `(input:{baseId,path?,cursor?,limit?}) -> {status,nodes:Array<{unitRef:locator,label,kind:'file'\|'folder'\|'url'\|'note',childCount?,readable}>,nextCursor?}` | 受知识库边界约束的逻辑节点树浏览（非 UI watcher 裸接口、非 fs），节点带 unitRef 可直喂 read | browse-tree, cloud-enterprise | **延后**（依赖 material scanner/relation 落地；纯探索型问法的补充能力） |
| `kb__manage` | `(input:{baseId,op:'add'\|'delete'\|'refresh',payload?,unitRef?,confirmToken?,dryRun?}) -> {status:'ok'\|'confirm_required'\|'forbidden'\|'unsupported'\|'conflict',confirmToken?,preview?:{affectedUnits,willOverwrite,description},jobId?}` | 把 3 个写操作收口成**带两段式确认协议**的单工具；云端只读库返回 `unsupported` 而非伪装成功 | manage-add-delete, refresh-snapshot, cloud-enterprise | **延后**（破坏性写，需人类确认通道；非 Agent 自主检索的一部分，最后做） |

### 为什么是 5，不是 2，也不是 12

- **为什么不止 2 个**：极简派/能力协商派把工具压到 2 个（search + read 或 search + list），代价是放弃了"按结构浏览"和"Agent 代管知识库"。但用户诉求里明确把 list/tree/refresh/add/delete 列为"已规划工具语义"，且企业云端场景下 `kb__list` 的 `capabilities`/`access` 字段是**权限与能力协商的承载点**——没有它，Agent 会盲目对 read-only 云端库尝试写操作。所以 list 必须独立存在，不能被吸进 search 的"baseIds 省略=搜全部"里（那会让 50+ base 的用户每次都全库扇出，且丢掉 capabilities 协商）。
- **为什么不到 12 个**：正交派把检索拆成 search/grep/glob、读取拆成 read/read_around、管理拆成 add/delete/refresh，理由是"窄工具更难误用"。这在 Claude Code 式本地代码库成立，但**与本项目两条硬约束冲突**：(1) grep/glob 是"扫目录/正则定位"式探索，违反"search 优先、locator 驱动 read、UI 以真实目录为准、read 优先输入是 locator 而非任意路径"的不变量；(2) 云端 RAG 后端**不保证**有 grep/glob 能力，拆出来会让"本地↔云端等价"破裂。正交派自己也承认 grep/glob/get_material/edit_content_index 全部"依赖 scanner+material provenance，v2 仅建表未实现"——把未实现 schema 当既成事实去开 7 个工具，违反 Simplicity First。
- **5 个的切分逻辑**：按 Agent 的**心智动作**切——发现(list)→检索(search)→扩上下文(read)→按结构浏览(tree)→改库(manage)，每个动作对应一个不可压缩的语义。`read` 不并入 `search`（按 locator 精确取数 vs 按 query 模糊召回，输入语义正交）；add/delete/refresh **合**进 `kb__manage`（三者共享同一"确认协议 + 破坏性预览 + 云端 unsupported 降级"骨架，拆三个会让确认协议重复三遍、Agent 要记三套返回形状）。
- **read-around 不单列为 `kb__read_around`**：正交派坚持 read（整篇）与 read_around（扩窗）拆开以省 token。我们采纳"代价分层"的诉求，但用 `kb__read` 的 `window` 参数承载（`{before,after}` = read-around，`{wholeUnit:true}` = 整段），而非新增工具——少一个工具、少一份 description，且 default 行为就是"只扩命中窗口"，模型不会习惯性拉整篇。

## 二、有向量库(hybrid) vs 无向量库(BM25) 如何在契约里统一

**明确推荐：单一 `kb__search` + 后端按 base 能力自适应模式 + 把模式作为出参（`retrievalMode`/`mode` + `scoreKind`）回传；mode 不进 Agent 入参，也不拆工具。** 四个立场在这一点上**罕见地完全一致**，分歧只在"是否保留一个可选软提示"。

### 三条路线的取舍

| 路线 | 评价 | 否决/采纳理由 |
|---|---|---|
| **拆成 `kb__search_vector` / `kb__search_bm25`** | ❌ 最差 | 强迫模型先知道每个 base 的索引状态才能选对工具，把后端运行态泄露进工具选择；云端 RAG 不暴露内部用没用向量；hybrid（向量+BM25+RRF）无处安放；**无法表达"一次 fan-out 跨多库、A 库 hybrid / B 库 BM25"的逐库异构** |
| **`mode` 入参（auto/semantic/keyword/hybrid）** | ⚠️ 不推荐主路径 | `auto` 之外的值多为误用源；同样无法表达一次调用内逐库异构；把检索工程概念泄漏给不掌握底层状态的模型 |
| **单一 search + 自适应 + 出参回传模式** | ✅ 推荐 | 代码已证实模式是 **per-base 持久配置**（`KnowledgeService.ts:242` 用 `base.searchMode ?? 'default'` dispatch），底层 vector store 本就是"传 mode → 内部 dispatch bm25/hybrid"的单入口；自适应是系统该承担、模型不该承担的复杂度 |

### 关键修正：score 语义必须随模式回传（当前实现的真实缺陷）

当前 `KnowledgeSearchTool.ts:84` 把 score **硬 clamp 到 [0,1] 并丢弃 scoreKind**，输出只有 `{id, content, score}`，没有 locator、没有 retrievalMode。这会把 **hybrid 的 RRF 排名分当成相关度分**，是语义错误。必须修正为：

- `scoreKind:'relevance'`（semantic，= 1−cos 距离，**跨查询可比、可做绝对阈值过滤**）
- `scoreKind:'ranking'`（keyword/hybrid 的 BM25 原始分 / RRF 排名分，**仅同查询内可比，不可跨查询比较、不宜做绝对阈值**）

Agent 拿到 `scoreKind` 就知道这条分数能不能跨 base 比较、能不能做阈值过滤，无需关心底层有没有向量库。现有 `applyRelevanceThreshold` 只对 relevance 生效是正确的，需保持。

### 优雅降级

- **能力协商在选库阶段（list），不在每次查询（search）**：`kb__list` 暴露 `capabilities:{semantic,fulltext}` / `retrieval.mode` / `embeddingState:'ready'|'pending'|'absent'`，让 Agent 在选 baseIds 时就知道哪些库只能 BM25，从而对纯 keyword 库写更关键词化的 query。
- **结果侧兜底**：list 时 `ready` 但 search 时 embedding 已失效 → 以 `search` 实际为准，每条命中 `retrievalMode:'bm25'` 自我描述 + 顶层 `scopeNotices`/`meta.perBase.degraded:'embedding_not_ready'` 显式告知降级原因。
- **降级对模型透明但可解释**：本地未配 embedding 或索引未完成 → 后端自动落到 `search_text_fts`(BM25)，模型代码零分支；这正是 v2.x"未配置 embedding 时纯 BM25 也可用"目标的契约表达。

> 唯一分歧：能力协商派/极简派主张保留一个**可选软提示** `intent?:'lookup'|'broad'`（影响 topK/alpha，不暴露算法名）。建议**保留为可选、后端容错**，最坏退化为默认行为——它不是 mode，不逼模型背检索工程概念。

## 三、Agent 直接读知识库文件/扩上下文：read(locator) / read-around / whole-file

**全部由 `kb__read` 一个工具承载，分三层，优先输入永远是 locator 而非任意路径。**

```ts
// 三层取法，都吃 search/tree 产出的 opaque locator
kb__read({ locator })                                   // 默认：取命中 unit 邻近窗口（read-around）
kb__read({ locator, window:{ before:1200, after:1200 }})// 显式控制扩窗字符数
kb__read({ locator, window:{ wholeUnit:true }})         // 整段/整文件投影（带 max 上限防 token 爆）
// 返回 prevLocator/nextLocator，让 Agent 像翻页一样顺着读邻接 unit，避免一次拉整篇
```

- **为什么 read-around 是 locator 的首要消费者**：schema 规划的 `content.text` + `char_start/char_end` 正好支撑"扩窗口"这个比"读整篇"代价低一个量级的高频动作。search 只回短片段 + locator 保持低 token，真正需要时才由 read 按需放大，扩上下文的成本由模型按需付。
- **强制 staleness 校验**：read 必须校验 `material.status=active ∧ current_content_hash=locator.contentHash ∧ index_policy=index ∧ 路径仍在库内`，否则返回 `stale`（快照被 refresh 覆盖、hash 不匹配）/ `missing`（unit 已删）让 Agent 重搜，而非静默返回错段落。**这是最危险的正确性坑**——locator 内嵌 contentHash 正是为此失效检测服务。

### 为什么不能给 raw filesystem 工具（这是用户 Q1 的核心约束）

raw fs 工具会同时击穿三条边界，**每一条单独就足以否决**：

1. **泄露后端形态**：fs 路径只在本地存在，云端 RAG 没有"路径"概念 → 本地与云端不等价；
2. **绕过 ACL**：`fs.read` 无身份校验，Agent 可越过权限边界读未授权材料；企业版员工可能根本无本地 fs 访问权；
3. **产生不可移植 locator**：charRange 绑死本地编码，换后端即失效。

所以：read 只接受 search/tree 产出的 **opaque locator**（Agent 永不解析、永不凭空构造），后端按身份重新校验 `locator.baseId` 属于当前可见集（不信任 locator 自带的 baseId）。grep 式精确串匹配**归到 `kb__search` 的 BM25 mode 承载**（FTS5 命中即字面量匹配），不另开 grep 工具——本地有 FTS、云端不一定有 grep，合一个工具让两端等价。

## 四、本地 ↔ 企业云端等价：契约必须抽象的不变量

这套工具的可移植性靠**五条抽象**支撑，让 Agent 代码对 local/cloud **零分支**：

| 不变量 | 本地实现 | 云端实现 | 抽象点 |
|---|---|---|---|
| **locator 可移植性** | 编码 `{baseId,path,unitId,contentHash,charStart,charEnd}` | 编码 `{baseId,docId,blockId,page,version}` | locator 是**不透明令牌**，Agent 只回传不解析；同一 `kb__read` 签名走完全不同取数实现 |
| **无原文权限降级** | 通常给完整窗口 | `supportsOriginalText=false` 时返回 `status:'snippet_only'`，content 退回**已索引的 search_text 投影文本** | 降级是返回值不是异常；content_index_entry 的手编 question/summary/keyword 天然成为无原文权时的降级语料 |
| **权限拒绝表达** | 默认全可见 | 权限被撤销返回 `status:'forbidden'`，不返回内容 | 拒绝与降级同在一个 status 判别式里，Agent 零分支区分 |
| **可见性边界 = ACL** | 默认全库 | list/search/tree 返回的就是**按员工身份过滤后**的集合，不返回无权 base | 候选 baseId 是**提示不是 allowlist**，真正边界由后端每次调用按身份重判；search 对显式传入但无权的 baseId 进 `scopeNotices.forbidden` 而非静默成空（否则 Agent 会误判"资料里没有"） |
| **add/delete/refresh 云端差异** | 本地落盘/删除/覆盖快照 | read-only 云端库返回 `status:'unsupported'`；版本冲突 `conflict`；配额经 `jobId` 异步化 + `rate_limited` 挂账 | `kb__manage` 的判别式 status 统一编码语义差异，绝不伪装成功 |

**关键安全点**：opaque locator 仍是结构化对象，若不与 baseId 绑定/不重新校验，越界 locator 可跨 base 取数；企业版还需决定 `forbidden` 是否连命中都不返回（否则泄露"存在该文档"的元信息）。

## 五、与当前已实现 / 已规划的差距与演进路径

**已实现（经代码核实）**：`kb__list` + `kb__search`，均 `defer:'auto'`（不占 always-inline 预算，按 tool_search 命中曝光），`applies` 用 `assistant.knowledgeBaseIds` 做候选提示+服务侧收敛，list 已有 concurrency=8 兜底。

**核实到的具体差距**：

| 现状（代码位置） | 差距 | 演进动作 | 阶段 |
|---|---|---|---|
| `kb__search` 输出仅 `{id,content,score}`，score 在 `KnowledgeSearchTool.ts:84` 硬 clamp 到 [0,1] | 缺 locator / scoreKind / retrievalMode | 给 search 输出补这三字段；同步改 `src/shared/ai/builtinTools.ts` 的 outputSchema | **v2.x P0** |
| dedup 按 `pageContent` 字符串等值（`KnowledgeSearchTool.ts:70`） | material 级后近似重复漏合并 | 改按 `contentHash`/locator 去重 | v2.x P0 |
| chunker 尚未返回 char offset；schema `knowledge.ts` 无 char/offset/search_text/content_index/fts 列 | locator 缺 charStart/charEnd，read-around 无法精确扩窗 | 先以 `unitId(=search_unit.unit_id)+chunkIndex` 形态回传 locator，`kb__read` 退化为整 chunk 读取；待 content.text+offset 落地再升级 read-around | v2.x P1 |
| `kb__list` 输出无 capabilities | 无法做能力协商、云端能力声明 | 补 `capabilities`/`retrieval.mode`/`backend`/`access`/`embeddingState` | v2.x P1 |
| 无 read 工具 | locator 价值未兑现 | 实装 `kb__read`（先整 chunk，后 read-around/wholeUnit + staleness 校验） | v2.x P1 |
| material scanner / relation / content_index_entry "仅建表未实现"（migration plan §2/§3） | tree/manage/edit 的 provenance 落不了地 | 待 scanner+relation 启用后实装 `kb__tree`、`kb__manage` | v2 后续 |

**演进顺序**：先把 `search 补 locator/scoreKind/retrievalMode + dedup 改 contentHash` 做掉（不依赖任何未建 schema，纯契约修正），再上 `kb__read`（先退化整 chunk）兑现 locator 闭环，再补 `kb__list.capabilities`，最后等 scanner/provenance 落地后做 `kb__tree` 与 `kb__manage`。即"**先把 检索→读上下文 闭环做扎实，再补浏览与代管**"。

> 注意"为终态铺契约"与"过度实现"的边界（Simplicity First）：locator/scoreKind/retrievalMode 是**字段透传**，应立即落；但**不要预建未启用的 keyword-only 降级分支**——v2 当前仍强制 embedding，keyword-only 路线在 v2.x 才真正可达，先打通字段与语义，不预写未用逻辑。

## 六、立场间的分歧与未决问题

**主要分歧**（已在上文给出推荐裁决）：

1. **工具个数 2 vs 5 vs 12**：极简/能力协商派 2 个，抽象派 5 个，正交派 12 个。本报告采抽象派的 **5 个**为收敛点——比 2 个多保留了 list 的能力协商与 tree/manage 的代管能力，比 12 个少了违反"search 优先/本地云端等价"的 grep/glob 和未实现的 provenance 工具。
2. **add/delete/refresh：合 1 个 vs 拆 3 个 vs 完全不给**：极简派**完全不给**（破坏性、会幻觉、候选 id 非删权 allowlist）；正交派拆 3 个（确认语义不同）；抽象派合成 `kb__manage`（确认协议一致性 > 入参纯净）。本报告采 `kb__manage` 但**延后**，并强调它需强制人类确认通道——这与极简派"add/refresh 本质是需人类确认的写、不是 Agent 自主项"并不矛盾：放进工具面但用两段式 confirmToken 钉死破坏性边界。
3. **read-around 单列 vs 并入 read 的 window 参数**：正交派单列 `kb__read_around` 省 token；本报告并入 `kb__read({window})` 省工具数。倾向后者，但承认这是可逆决定。
4. **是否保留检索软提示**：能力协商派/极简派保留 `intent?`/`mode?` 软提示，正交派/抽象派完全不给。建议保留**可选、后端容错**的软提示，不暴露算法名。

**未决问题（需产品/架构拍板）**：

- **企业版 `forbidden` 粒度**：无权材料是"连 search 命中都不返回"（不泄露存在性），还是"命中后 read 时才 forbidden"（暴露存在性）？影响安全模型。
- **confirmToken 的 TTL 与 preview 绑定**：避免 Agent 拿旧 token 确认一个已变化的破坏性操作。
- **opaque locator 是否需签名**：防止越界/伪造 locator 跨 base 取数——是在 read/tree 入口按身份重校验 baseId（轻量），还是给 locator 加密签名（重）？
- **50+ base 大用户的扇出上限**：即使保留 list，search 显式传入多 base 时仍需候选 base 上限 + 并发上限（沿用现 concurrency=8 思路）。
- **content_index_entry 的写回（"越用越贴合用户"）落点**：正交派主张专门的 `kb__edit_content_index` 工具显式写回（可解释、可审计，但需 Agent 主动沉淀）；其余立场主张**对 Agent 透明、由后端在 search 内基于命中反馈持续优化 search_text 投影与排序**（工具签名永不变）。本报告**未把它列入 5 工具**——它依赖 content_index_entry 启用（v2 仅建表），且"显式写回 vs 隐式优化"是独立的产品决策，建议作为 v2.x 之后的专项讨论，而非现在定工具面。

文件锚点：`src/main/ai/tools/adapters/aiSdk/builtin/KnowledgeSearchTool.ts`（score clamp:84 / dedup:70）、`KnowledgeListTool.ts`（concurrency:56）、`src/main/features/knowledge/KnowledgeService.ts`（per-base searchMode dispatch:242）、`src/shared/ai/builtinTools.ts`（需同步改 input/output schema）、`src/main/data/db/schemas/knowledge.ts`（当前无 char/offset/search_text/content_index/fts 列，证实 read-around 依赖项未落地）。

---

# Q2：为什么要做"独立知识库子系统"，以及它能否"越用越准"

> 结论先行：**"文件本质是文件"为真，但"让 Agent 用通用 filesystem 工具读它"是伪命题**；而"越用越准"不仅可行，且 Cherry 已规划的 `content_index_entry` / `search_text` 表恰好是落地它的天然载体。

## 第一部分：为什么要做独立子系统，而不是"裸文件夹 + 通用 fs 工具"

### 1.1 一句话定位主张

> **知识库不是文件夹，是文件夹之上的"检索资产层"。**

文件夹满足用户"无脑往里塞"的**存储心智**；但裸文件夹 + 通用 `grep/cat` 只能给 Agent 提供"字节流"。知识库子系统额外沉淀了六类裸文件夹**结构上给不了**的持久资产，这正是 Cherry 已规划的 9 张表想表达的东西：

| 资产层 | 对应 Cherry 表/字段 | 裸文件夹能否提供 |
|---|---|---|
| ① 语义索引（BM25 + 向量） | `search_text` / `search_text_fts` / `embedding` | 否（grep 是子串匹配，无 BM25 排序、无语义） |
| ② 来源身份 / provenance（URL/笔记/云端快照，可刷新的源标识） | `material.source` / `material_relation` | 否（文件系统只有 mtime，无来源类型与刷新身份） |
| ③ 可移植 locator | `search_unit.locator_json` / `char_start` / `char_end` / `content_hash` | 否（path 在迁移/云端即失效，无片段级锚点与 score） |
| ④ 派生增强层（chunk 级 question/summary/keyword/tag） | `content_index_entry` | 否（这是入库时构建的派生产物） |
| ⑤ 个性化 / 反馈状态 | 规划中可扩展（见第二部分） | 否（文件夹无反馈、巩固、时间维度） |
| ⑥ 可观测 / 可审计 | `index_meta` + 带 locator/score/mode 的检索结果 | 否（grep 无状态、不可审计） |

本质区别：**子系统把"检索质量"做成了持久化资产，而不是每次现算**。

### 1.2 技术/能力线：四类不可替代价值（含外部证据）

**A. 离线索引富化（content_index_entry 的硬核学术依据）**
- **EnrichIndex**（arXiv:2504.03598）证明：用 LLM 在"入库/离线"阶段一次性给每个 chunk 富化 purpose/summary/QA 对并随原文索引，把昂贵的相关性计算从"每次 query 在线算"前移到"入库时算一次"，提升质量同时大幅降低在线成本。
- **doc2query / docTTTTTquery**（arXiv:1904.08375）：给文档预测它能回答的问题拼进索引，**纯靠重建倒排索引即可让 BM25 提升约 +15%，检索期零成本**。
- **QuIM-RAG**（arXiv:2501.02702）：把检索从 `query↔chunk` 变成 `query↔question` 的倒排匹配，Context Precision 0.45→0.92。
- 这三者共同证明：Cherry 的 `content_index_entry`（question/summary/keyword/tag）**不只是给人编辑的索引，更是可独立提升召回的"索引侧投影"**——这是裸文件夹 + grep 永远拿不到的能力。

**B. Contextual Retrieval（双通道索引增强）**
- Anthropic 官方数字：给每个 chunk 预置定位性上下文前缀后分别建 contextual embedding 与 contextual BM25，top-20 检索失败率下降 **35%（仅 contextual embedding）→ 49%（叠加 contextual BM25）→ 67%（再加 rerank）**。
- 关键旁证：**contextual BM25 单路就有显著价值**——直接支撑 v2.x"未配 embedding 也能纯 BM25 检索"的目标。

**C. 可移植 locator + read(locator) 取邻近上下文**
- Cherry 的 `search_unit.locator_json` / `char_start..char_end` / `content_hash` 是企业云端"材料不一定是本地文件"时**唯一可移植的引用方式**。
- **A-RAG**（arXiv:2602.03442）几乎是 Cherry 设计的论文级原型：把检索暴露为三层逐渐细化的工具——keyword search / semantic search / chunk read，search 返回 `chunk_id + snippet`，agent 再决定是否 full read 或读相邻 chunk。
- **HyDE**（arXiv:2212.10496）与 **Self-RAG**（arXiv:2310.11511）说明：检索结果**必须带 score 和可判定 locator**，Agent 才能自适应决定"要不要继续检索/读 locator"。通用 fs 的 grep 给不了 score，而 Cherry 的 `kb__search` 返回 `content + score[0,1]` 已具备这个接口面。

**D. 多粒度 / 派生结构**
- **RAPTOR**（arXiv:2401.18059）与 **GraphRAG**（arXiv:2404.16130）证明分层摘要/实体图谱能回答跨文档全局问题——对应 Cherry 的 `material` / `content` / `search_unit` 多粒度结构与 `material_relation`。这类层级结构是"索引时构建的派生产物"，文件夹结构本身无法承载。

### 1.3 产品/个性化线 + 安全/权限：为什么"不能让 Agent 走通用 fs 工具"

这是把知识库做成独立子系统**最硬的架构红线**，有三条可引用的外部证据：

1. **权限必须在"结果进入模型上下文之前"裁剪**——这是 fs 工具结构上做不到的。
   - **Glean**：爬内容同时爬 ACL，支持 per-document/per-field 权限；查询时先取候选再按用户权限过滤，只把安全片段交给 LLM。
   - **Notion AI Q&A**：只检索用户有权限看的页面，回答带引用。
   - 对应 Cherry 企业版约束：员工可能无本地 fs 访问权、有权限边界、search 命中材料不一定是本地文件。**只有专用 search 工具能在内部检索全集后、返回前留一个 ACL 裁剪点**（个人本地场景空实现，符合"候选 id 是提示不是 allowlist"不变量）。

2. **通用 fs MCP 工具的越权风险**：path 参数未校验、可被 path traversal 越权读取、提示注入可触发 read/edit/delete 破坏性操作（MCP 威胁分类研究 + Anthropic *Code execution with MCP*）。专用 knowledge 工具用 `locator`（`baseId + contentHash` 校验）而非任意路径作输入，天然收敛攻击面——这与 Cherry"read 的优先输入是 search locator 而非任意路径"不变量完全一致。

3. **token 效率**：Anthropic *Code execution with MCP* 把工作流从 ~15 万 token 降到 ~2k（-98.7%）。search 命中的大材料应留在引擎侧、只回传"片段 + locator"，把"物化全文"的决定权交给 agent。

### 1.4 同类产品取舍对比

| 产品 | 做法 | 对 Cherry 的启示 |
|---|---|---|
| **腾讯 ima.copilot** | 多源导入个人知识库，search-read-write 一体"第二大脑"，copilot 显式宣传"记住你的偏好、越用越懂你" | 印证"独立子系统 + 个性化记忆 + 统一来源展示"是产品共识；可学其"越用越贴合"的对外叙事 |
| **Notion AI Q&A** | 只搜有权限的页面，回答带引用 | 权限感知 + 引用溯源是子系统级能力 |
| **Glean** | per-document/per-field ACL，查询时先取候选再按权限过滤 | 最强的"为什么不能让 Agent 直接读文件"论据 |
| **FastGPT** | 可编辑内容索引（question/summary）提升问答 | Cherry `content_index_entry` 的产品化先例（命名即源于此）；证明"可编辑索引层"是成熟做法而非过度设计 |
| **RAGFlow** | 深度解析 + 可解释分块 + 分块可视化 + 引用溯源 | 支撑 `content_index_entry` 可编辑 + locator 引用溯源 |
| **Dify** | 整条 RAG pipeline + 可观测日志（检索了哪些 chunk/token/延迟/成本） | 可观测性是子系统独有价值；Cherry `index_meta` + 带 locator/score/mode 的结果可支撑同等审计 |
| **Cursor** | 本地 tree-sitter 切块 + Merkle 树增量同步 + 仅传 embedding；grep + 语义结合比纯 grep +12.5%（大库收益最大），**明确保留 grep 不替换** | (a) Merkle/contentHash 增量索引适配 watcher 场景；(b) hybrid(BM25 + 向量)不该二选一；(c)"越用越好"靠使用信号学习，而非换更大模型 |
| **记忆类（Mem0）** | 动态抽取/巩固/检索显著信息，多信号检索（语义 + BM25 + 实体），token -90%、p95 延迟 -91% | "个性化记忆"是独立可检索状态层，**必须有子系统承载，不可能寄生于裸文件夹** |

**共识**：检索质量、来源溯源、权限边界、可观测性、个性化记忆，全是子系统级能力，不是文件操作能给的。

## 第二部分：让检索"越用越准"——分层可落地路线

把"越用越好"拆成三条成本递增的轨道，**绝大多数收益在 (a) 和 (b) 的前几项**。每条标注：收益 / 成本 / 本地优先与隐私适配 / 优先级。

### (a) 建索引即提升（离线增强，导入时一次性算清）

> 核心思想：把相关性计算前移到入库时（EnrichIndex），检索期零成本。这是 ROI 最高、最透明、最本地友好的一档。

| 技法 | 收益 | 实现/算力成本 | 本地优先 & 隐私 | 优先级 |
|---|---|---|---|---|
| **doc2query 式反向问题生成**（写入 `content_index_entry.kind=question`，投影进 `search_text.kind=question`） | 纯 BM25 态约 +15% 召回；query↔question 倒排匹配 | 离线一次性 LLM 生成（本地小模型或可选联网），可批量可缓存；检索期零成本 | 极高：产物纯文本入 FTS，可手编兜底，离线可降级 | **P0** |
| **small-to-big / parent-child chunking**（小 unit 建索引，命中后用 `char_start/char_end` 扩展返回给 `read`） | 命中精度 + 返回上下文兼得 | 极低：纯切分逻辑，无 LLM；与 locator 天然契合 | 极高：无算力/隐私负担，是 read(locator) 的基础 | **P0** |
| **Contextual Retrieval / summary 上下文化**（写入 `content_index_entry.kind=summary`，同进 embedding 与 BM25） | top-20 失败率最高降 67%（叠 rerank） | 每 chunk 一次轻量 LLM；建议设**知识库大小阈值**（Anthropic：< ~20 万 token / 500 页直接全量喂入，跳过重管线） | 高：可用本地模型；小库跳过避免无谓开销 | **P1** |
| **keyword/tag 富化**（`content_index_entry.kind=keyword/tag` → `search_text`） | 提升术语/同义命中，BM25F 字段加权抓手 | 离线生成，可手编；离线时仅用 keyword/tag | 高：纯文本入 FTS | **P1** |
| **HyDE / Query2doc / 查询改写 / RAG-Fusion**（查询期，不改索引） | RAG-Fusion 约 +9%；Query2doc 对 BM25 +3~15% | 每次检索多一次 LLM 调用；Cherry 已有 RRF，RAG-Fusion 融合层零改动 | 中：依赖 LLM，离线/低算力时降级关闭 | **P2**（做成 `kb__search` 可选 flag，非默认） |
| **CRAG 式置信评估**（基于现有 score 阈值，低置信打告警让 Agent 决定复查/外搜） | 让 Agent 在命中差时自适应 | 极低：复用现有 `score[0,1]` 阈值，无需训练 Self-RAG | 较高：几乎零额外成本 | **P2** |
| 命题索引 / RAPTOR / GraphRAG | 极高精度 / 跨篇全局问答 | 重：大量 LLM 改写/摘要/抽取，索引膨胀 | 低：算力重，依赖强 LLM | **P2（高级档，显式开启）** |

> ⚠️ 已核验的工程边界（写入设计）：question 文本帮助稀疏检索，但拼进 embedding 可能注入语义噪声——**question 通道宜偏向只进 FTS 投影，对 embedding 通道更克制**。

### (b) 从使用信号自适应（轻量隐式反馈，越用越贴合该用户）

> 核心张力：**点击/采纳信号即偏**（Joachims, arXiv:1608.04468）——位置偏置会让"排在前面"被误学成"更相关"。桌面单用户无大规模日志，正解是"相关性反馈/索引回填"而非"训练黑盒排序器"。

**可落地的轻量信号清单**（无需向量库外任何 ML 基础设施）：打开结果详情 / Agent 引用并产出答案 / 用户复制片段 / 就此结果追问 / 手动置顶收藏 / 手动删除结果 / 手动编辑 question/summary/keyword/tag。

| 技法 | 收益 | 实现/算力成本 | 本地优先 & 隐私 | 优先级 |
|---|---|---|---|---|
| **可编辑内容索引作为"人/Agent 在环反馈"**（高频命中问法回填为新 `content_index_entry.question`；被采纳片段补强 keyword） | 等价于"持续 doc2query"，越用 FTS 越准；透明可编辑 | 低：复用已规划表，增量更新 | 极高：可查看/编辑/删除，随库迁移 | **P0** |
| **usage 信号 + RRF 后轻量 re-score**（一张 `usage_event` 表：unitId/baseId/query 摘要/event_type/当时 rank/ts；融合分后做小幅时间衰减 boost、删除 penalty） | "我常用的材料自然靠前"，零 ML | 一张表 + 一个聚合查询 + re-score 函数，零联网 | 高：完全本地，可一键清空（满足 unlearning） | **P1** |
| **满意度加权信号**（"Agent 引用并产出答案/复制/置顶"=强正；"返回未被用"=弱负；"手动删除结果"=显式强负） | 避免把裸曝光当正反馈 | 仅 event_type 权重表，无额外算力；采集点复用产品已规划的 provenance/locator 引用记录 | 高：把已有 provenance 转成权重，无新依赖 | **P1** |
| **位置/倾向纠偏**（短列表用固定位置先验如 `1/log2(rank+1)` 逆权） | 防止"第一名=最相关"的过拟合 | 纯算术，无需训练点击模型 | 高：无依赖、可解释的低成本护栏 | **P1**（一旦 usage 进排序就必须叠加） |
| **探索 + 去偏护栏**（top-k 给 1-2 个未被采纳过的候选留位；对高采纳材料做对数压缩降权） | 防退化反馈环/回音壁（Jiang 2019, arXiv:1902.10730；小数据库尤其易锁死） | 低：排序组装阶段插入，无 ML | 高：纯排序逻辑，可解释 | **P1**（与 usage re-score 同时上） |
| **查询级 PRF / 会话内自适应**（Rocchio / ColBERT-PRF：上一轮被采纳 chunk 就地修正下一轮查询，不持久化） | "越问越准"，无状态污染、无反馈环风险 | 零训练：dense 版几行向量运算，sparse 版关键词扩展 | 高：完全本地、即时，最安全的自适应形式 | **P1** |
| **记忆型个性化**（把"反复采纳的术语/实体/常问问题"抽取成特殊 `material` 或 `content_index_entry`，走普通召回路径，可查看/编辑/删除） | "系统懂我的黑话/我关心的子领域" | 中：周期性抽取（本地或可选联网），复用现有索引管线 | 中高：本地存储，需可编辑可删除防隐私/过拟合 | **P2** |
| 训练式 LTR（LambdaMART/神经排序/专有 embedding，Cursor 模式） | 模型级个性化 | 高：需算力 + 大规模日志 + IPS 纠偏 + unlearning | 低-中：本地算力挑战，宜云端可选 | **P2（远期可选）** |

> **隐私一等公民**：usage/偏好数据只存本库 `.cherry/index.sqlite`、绝不出设备；提供"查看/清空我的使用痕迹"（machine unlearning）与"关闭自适应排序"开关；企业版团队共享时只共享模型更新/聚合统计，不共享原始 query（FOLTR，arXiv:2412.19069）。

### (c) 混合检索与无向量库降级

> 目标：两态**共用同一管线**，差异只在"是否启用 dense 一路 + 融合方式"。BM25-only 不是"降级凑合"，而是可独立成立的检索栈（BEIR arXiv:2104.08663；*Keyword search is all you need* arXiv:2602.23368 在 agentic 框架下纯关键词达 RAG 90%+）。

| 技法 | 收益 | 实现/算力成本 | 本地优先 & 隐私 | 优先级 |
|---|---|---|---|---|
| **BM25-only 设为一等检索模式**（embedding 未配置/未完成/语言不匹配时自动只走 FTS5，并在 locator.mode 标 `bm25-only` vs `hybrid`） | "导入即可用"，不再强依赖 embedding 配置（直接服务 v2.x 目标） | 极低：FTS5 内置 BM25，零联网；把 mode 透出 | 极高：本地优先天然主力路径 | **P0** |
| **CJK tokenizer 分流**（CJK 内容写 `search_text.text` 时离线做 bigram 切分或 trigram 子串；拉丁语用 unicode61+porter） | 修复 unicode61 单字索引召回过宽/无序约束——**Cherry FTS 最易被低估的瓶颈** | 纯本地字符串处理，零模型 | 极高：无联网/无大模型 | **P0** |
| **hybrid + RRF 融合 + 可选 rerank**（Cherry 当前栈，合理默认） | 稳妥零调参；RRF 免归一化、对量纲鲁棒 | BM25 零成本；向量需 embedding；rerank 可选 | 高：BM25 路完全本地 | **保持（已实现）** |
| **RM3 伪相关反馈**（纯 BM25 态默认叠加，限扩展词数防主题漂移） | 无 embedding 时性价比最高的质量提升，弥补查询过短/用词不一致 | 纯统计、零模型零联网；多一轮 FTS 查询 | 极高：完全本地、可解释 | **P1** |
| **BM25F 字段加权**（对 question/title 等字段设独立权重，FTS5 `bm25()` 列权重） | question 字段高权重 = doc2query 收益最大化 | 几乎零成本，但需注意 `index_meta` 当前非目标列了"第一版不提供权重/排序字段"——属 v2.x 范畴 | 高：纯算术，本地可算 | **P1** |
| **CC 凸组合融合**（`score = α·norm(dense) + (1-α)·norm(bm25)`，min-max 归一，单参数 α；按 query 形态动态调：短词↓α、长句↑α） | 域内外都优于 RRF、样本高效、可"越调越准"（Bruch, arXiv:2210.11934） | 几乎零额外成本；需选归一化 + 调一个 α（默认 0.5） | 高：比 RRF 更可调，是个性化抓手 | **P2**（保留 RRF 作 score 不可归一化时兜底） |
| **"最弱链路"保护**（dense 路平均分明显低于 BM25 路时自动降权或退回纯 BM25） | 避免融入弱路拉低整体（arXiv:2508.01405） | 低：阈值判断 | 高：纯逻辑 | **P1** |
| SPLADE/uniCOIL（学习型稀疏）、ColBERT（late-interaction） | 稀疏带语义 / 域内外 SOTA | 重：在线推理 / 多向量 + 专用索引，与"每库一 sqlite、可无向量库降级"冲突 | 低：仅借鉴"离线扩展词入索引"的 inference-free 子集 | **P2（远期/企业服务端）** |

## 第三部分：Cherry 知识库自我改进闭环——落地蓝图

下面是一个闭环，**最大化复用已规划的 `index.sqlite` 9 张表**，每一环标注复用的表：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ① 导入（导入即复制）                                                       │
│     用户/Agent 往 KnowledgeBase/{baseId}/ 塞 file/folder/URL快照/笔记快照    │
│     → material(relative_path, current_content_hash) + content(content_hash) │
│     → Cursor 式 Merkle/contentHash 增量比对，只重建变更材料（不全量重扫）    │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ② 索引增强（离线一次性，EnrichIndex 思想）                                  │
│     small-to-big chunk → search_unit(char_start/char_end/locator_json)      │
│     doc2query 反向问题 → content_index_entry(kind=question)  [P0]            │
│     Contextual summary  → content_index_entry(kind=summary)  [P1, 阈值触发]  │
│     keyword/tag 富化    → content_index_entry(kind=keyword/tag) [P1]         │
│     全部投影进 search_text(kind∈body/title/question/summary/keyword/tag)     │
│     → search_text_fts(FTS5/BM25) + embedding(可选)                          │
│     CJK bigram 在写 search_text.text 时切分  [P0]                            │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ③ 检索（kb__search，两态共用管线）                                          │
│     有 embedding → hybrid: BM25 路 + dense 路 → RRF(或可选 CC) → 可选 rerank │
│     无 embedding → bm25-only: FTS5(BM25F) + 可选 RM3 → 可选 rerank          │
│     返回：content 片段 + score[0,1] + locator(含 mode=bm25-only/hybrid)      │
│     → Agent 用 read(locator) 取邻近上下文（char_start/char_end 扩展父块）     │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ④ 使用反馈（轻量隐式信号，复用已规划 provenance）                            │
│     新增 usage_event 表（建议放每库 .cherry/index.sqlite，随库迁移）：        │
│       unitId/baseId/query摘要/event_type{open,cite,copy,followup,pin,delete}│
│       /当时rank/ts                                                          │
│     采集点复用产品已规划的"Agent 引用 search locator"+ provenance 记录        │
│     满意度加权 + 位置纠偏(1/log2(rank+1)) + 探索配额(防退化反馈环)            │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ⑤ 再增强（闭环回写）                                                        │
│     (a) usage → RRF 后轻量 re-score（带时间衰减的 boost/penalty）  [P1]      │
│     (b) 高频命中问法 → 回填新 content_index_entry(kind=question)（持续doc2query）│
│     (c) 反复采纳的术语/实体 → 特殊 material / content_index_entry（记忆型）[P2]│
│     (d) 会话内 PRF：上一轮采纳 chunk 就地修正下一轮查询（无持久化）  [P1]      │
│     全部可一键清空 / 可关闭自适应 → 回到纯 RRF/BM25 基线                       │
└─────────────────────────────────────────────────────────────────────────┘
```

**复用已规划表的关键点**：
- 闭环 ②⑤ 的核心增强**完全落在已规划的 `content_index_entry` + `search_text`**（kind 枚举已含 question/summary/keyword/tag）——无需新表，只需启用生成/编辑/检索（当前 v2 这两表已建但"不生成、不写入、不展示"，v2.x 启用）。
- 闭环 ④ 唯一需要**新增一张 `usage_event` 表**（轻量、本地、可清空），是"越用越准"反馈轨道的唯一新增结构。
- locator/read(locator) 已规划在 `search_unit.locator_json` / `char_start` / `char_end`，无需新增。
- 检索 mode（bm25-only/hybrid）建议写进 locator metadata 透出，既支撑可观测，也让 Agent 知道当前质量档位。

**验证（按 CLAUDE.md 目标驱动方式）**：为下列断言写 Vitest，数据库测试用 `setupTestDatabase()` 跑真实 `.cherry/index.sqlite`——
- "采纳过的 chunk 在后续同类 query 中排名应上升，但不应压过明显更相关的新材料"
- "删除的结果不应再出现在 top-k"
- "关闭自适应 = 纯 RRF/BM25 基线"
- "embedding 未配置时 search 返回 mode=bm25-only 且结果非空"

## 延伸阅读（仅列经核验确认存在的论文，按主题分组）

> 注：论文存在性经联网核验通过，但 2026 年新近 arxiv id（`2602.*`）建议使用时再抽查。

### 混合检索与融合 / 无向量库降级
- **BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of IR Models**（arXiv:2104.08663）— 18 数据集证明 BM25 是强鲁棒零样本基线，未微调 dense 在 OOD 上常掉点。
- **An Analysis of Fusion Functions for Hybrid Retrieval**（arXiv:2210.11934）— 凸组合(CC)域内外都优于 RRF，单参数 α、样本高效。
- **Balancing the Blend: Trade-offs in Hybrid Search**（arXiv:2508.01405）— "最弱链路效应"；短词偏 FTS、长句偏向量。
- **Keyword search is all you need (without vector databases)**（arXiv:2602.23368）— agentic 框架下纯关键词达 RAG 90%+。
- **CUBO: Self-Contained RAG on Consumer Laptops**（arXiv:2602.03731）— 稀疏 BM25 为主、dense 轻量按需、CPU 单机可行，几乎是 Cherry 架构的学术镜像。

### 离线索引增强 / 内容索引（content_index_entry 的依据）
- **Document Expansion by Query Prediction (doc2query/docTTTTTquery)**（arXiv:1904.08375）— 反向问题拼进索引，BM25 +15%，检索期零成本。
- **EnrichIndex: Using LLMs to Enrich Retrieval Indices Offline**（arXiv:2504.03598）— 离线富化 purpose/summary/QA，相关性计算前移到入库。
- **QuIM-RAG: Inverted Question Matching**（arXiv:2501.02702）— query↔question 倒排匹配，Context Precision 0.45→0.92。
- **The Expando-Mono-Duo Design Pattern**（arXiv:2101.05667）— BM25+RM3 仍有效，expando→mono→duo 多阶段范式。

### chunk 策略 / 检索粒度
- **RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval**（arXiv:2401.18059）— 递归聚类+逐层摘要建树，跨抽象层检索。
- **Dense X Retrieval: What Retrieval Granularity Should We Use?**（arXiv:2312.06648）— 命题(自包含原子事实句)粒度优于 passage/sentence。
- **Late Chunking**（arXiv:2409.04701）— 长上下文模型 pooling 前切块，Contextual Retrieval 的零 LLM 平替。
- **From Local to Global: A Graph RAG Approach (GraphRAG)**（arXiv:2404.16130）— 实体图谱+社区摘要回答全局问题。

### 查询期增强 / 检索决策
- **Precise Zero-Shot Dense Retrieval without Relevance Labels (HyDE)**（arXiv:2212.10496）— 生成假设文档再检索。
- **Query2doc: Query Expansion with LLMs**（arXiv:2303.07678）— 伪文档拼进 query，BM25 +3~15%。
- **Query Rewriting for RAG (Rewrite-Retrieve-Read)**（arXiv:2305.14283）— 查询改写前置范式。
- **RAG-Fusion**（arXiv:2402.03367）— 多改写 query 并行检索 + RRF 融合，约 +9%。
- **Self-RAG**（arXiv:2310.11511）— 反思 token 自适应决定是否检索/质量是否足够。
- **Corrective RAG (CRAG)**（arXiv:2401.15884）— 轻量评估器打置信度触发纠错。
- **Active RAG (FLARE)**（arXiv:2305.06983）— 生成时低置信触发临场检索。
- **Pseudo Relevance Feedback with Deep LMs and Dense Retrievers**（arXiv:2108.11044）— RM3 为主流 PRF 基线的得失分析。
- **ColBERT-PRF: Semantic Pseudo-Relevance Feedback**（dl.acm.org/doi/10.1145/3572405）— 零训练的查询级"越用越准"。

### 学习型稀疏 / late-interaction（远期候选）
- **SPLADE v2**（arXiv:2109.10086）— 学习型稀疏，term impact + 语义扩展。
- **A Few Brief Notes on DeepImpact, COIL...**（arXiv:2106.14807）— uniCOIL+doc2query 的 inference-free 路线。
- **ColBERTv2: Lightweight Late Interaction**（arXiv:2112.01488）— 多向量晚交互，域内外 SOTA。

### 从使用信号学习 / 反馈去偏 / 个性化记忆
- **Unbiased Learning-to-Rank with Biased Feedback**（arXiv:1608.04468）— IPS 纠位置偏置。
- **Learning from User Interactions with Rankings: A Unification**（arXiv:2012.06576）— 偏置处理首要、算法选型次要。
- **Degenerate Feedback Loops in Recommender Systems**（arXiv:1902.10730）— 退化反馈环，必须保留探索曝光。
- **Effective and secure federated online LTR (FOLTR)**（arXiv:2412.19069）— 交互不出设备 + unlearning。
- **Bias and Debias in Recommender System: A Survey**（arXiv:2010.03240）— 偏置/去偏检查清单。
- **Query Chains: Learning to Rank from Implicit Feedback**（arXiv:cs/0605035）— 从查询链与点击序列学习。
- **Estimating Clickthrough Bias in the Cascade Model**（dl.acm.org/doi/10.1145/3269206.3269315）— 短列表级联位置偏置估计。
- **Preference-Aware Memory Update for Long-Term LLM Agents**（arXiv:2510.09720）— 偏好记忆个性化。
- **Mem0: Production-Ready Long-Term Memory**（arXiv:2504.19413）— 多信号检索记忆，token -90%、p95 延迟 -91%。

### Agentic 检索工具设计
- **Agentic RAG: A Survey**（arXiv:2501.09136）— agentic RAG 分类框架。
- **A-RAG: Hierarchical Retrieval Interfaces**（arXiv:2602.03442）— keyword/semantic search + chunk read 三层工具，Cherry 设计的论文级原型。
- **Question Decomposition for RAG**（arXiv:2507.00355）— 子问题分解，MRR@10 +36.7%。
- **Reasoning RAG via System 1 or System 2: A Survey**（arXiv:2506.10408）— Predefined vs Agentic Reasoning 范式区分。

---

**相关 Cherry 规划文档**：
- Schema 设计：`docs/references/knowledge/experiment/index-sqlite-schema-design.md`
- Agent 产品语义：`docs/references/knowledge/experiment/agent-managed-knowledge-product.md`
- 当前迁移计划：`docs/references/knowledge/experiment/current-v2-knowledge-index-migration-plan.md`
