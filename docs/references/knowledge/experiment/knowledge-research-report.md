# Cherry Studio 知识库调研报告

> 日期：2026-06-09
> 配套文档：[产品文档](./knowledge-product-spec.md) · [技术方案](./knowledge-technical-design.md)

## 本文整合来源

本报告整合自以下飞书调研文档（去重、统一术语后）：

- 《File Mode + RAG 未来知识库产品方案调研与多 Agent 共识报告》
- 《企业内网 Remote File Mode 知识库调研》
- 《本地 Embedding 与 Rerank 方案调研报告：Qwen3 + Transformers.js + AI SDK》
- 《Cherry Studio 知识库产品说明：Agent 管理型知识库》第 13 章（面向未来的知识库工具与检索调研）

本报告是[产品文档](./knowledge-product-spec.md)与[技术方案](./knowledge-technical-design.md)引用的**单一调研来源**。两篇文档需要展开调研论证（为什么这样选、对比了什么、论文依据）时，统一链接回本报告对应小节，不在自身重复展开。

---

## 0. 调研概览

### 0.1 调研问题清单

本报告回答四组面向 v2.x 终态的调研问题：

1. **File Mode + RAG 整体方案**：未来知识库本质是文件夹，但产品如何超越「普通文件夹」、让检索越用越懂用户？
2. **企业内网 Remote File Mode**：企业内网 20GB+ 共享知识库场景下，Agent 如何在不整库同步、不本地挂载的前提下读取与检索？
3. **本地 Embedding / Rerank 选型**：如何把「选模型、配模型」降级为「一键下载默认模型」，跨平台、TS 友好地在本地完成两阶段检索？
4. **Agent 工具面与自适应检索**：给 Agent 暴露几个、哪些专用工具？知识库为什么要做成独立子系统？检索能否「越用越准」？

### 0.2 方法论

- **多 Agent 辩论 / brainstorm**：File Mode+RAG 调研用四角色辩论（产品策略 / 检索推荐架构 / Cherry 代码约束 / 反方评审）；工具面调研用四立场（主张暴露 2 / 2 / 5 / 12 个工具）并行 brainstorm 后收敛。
- **arxiv / web 研究 + 对抗式存在性核验**：工具面调研做了 5 路 arxiv/web 研究，并对 39 篇论文做了对抗式「是否真实存在」核验后才纳入引用。
- **代码约束对照**：所有调研结论均对照当前 Cherry 仓库的实际实现（content model、FileModeIndexStore、external_id 运行时等）做可行性收口。

### 0.3 引用关系与时序提示

- 本报告产出的是**方向性结论**与**设计论证**。落地形态（最终接口、表结构、PR 拆分、as-built 状态）以本地最新代码与[技术方案](./knowledge-technical-design.md)为准。
- **时序提示**：仓库内已存在 `FileModeIndexStore`（含 `file_mode_document` / `file_mode_chunk` / `file_mode_chunk_fts` 与 BM25 查询），但当前 v2 主线运行时仍是**旧单表 `libsql_vectorstores_embedding` + `external_id` API**，二者并存。部分计划文档对 FileModeIndexStore 仍以「待实现」口径描述，存在轻微时序差。本报告以 FileModeIndexStore 为方向性参照，但凡涉及当前落地状态，一律以技术方案的 as-built 章节为准。

---

## 1. 子调研一 · File Mode + RAG 未来知识库产品方案与多 Agent 共识

### 1.1 背景与问题

核心调研问题：File Mode + RAG 知识库本质是「文件夹」，但产品不应等同于普通文件夹（否则会被 Finder / Everything / VSCode 直接替代）；同时它应「越用越懂用户」，类比推荐算法 / 搜索引擎。

当前 Cherry 架构约束（迁移起点）：仓库已把两套内容模型分开——

| 维度 | 传统 RAG | File Mode |
| --- | --- | --- |
| 事实源 | `knowledge_item` + `file_ref` + `FileManager` | `Data/KnowledgeBase/{baseId}/` 真实目录 |
| 文档身份 | `knowledge_item.id` | base-relative path（如 `wiki/concepts/rag.md`） |
| 索引位置 | 传统 vector store artifact | `.cherry/index.sqlite` |
| 默认搜索 | 需 embedding | BM25 默认，后续 hybrid（rerank 可选、本地默认不启用） |
| 文件 UI | 知识条目树 | 真实目录 live scan，逐层取 children |
| 删除语义 | 清理 item / file_ref / vector | 真实文件送系统 Trash，索引派生删除 |

### 1.2 调研结论

**一句话方案**：未来知识库不是「带搜索的文件夹」，而是「**以真实文件夹为事实源的本地知识工作区**」；技术上是 **Filesystem-first + BM25-first hybrid retrieval + 可选 rerank（本地 cross-encoder 默认不启用，详见 §3）+ bounded personalization + explainable recommendations**。

要点：

- **越用越懂 ≠ 单一聚类驱动**，而是「检索 + 重排 + 解释 + 轻量个性化」的流水线；聚类只承担主题分组 / 相关文件 / 知识地图。
- **三大产品原则**：可控（用户掌控文件，不锁格式、不强制导入、不擅自整理）、可懂（索引 / 主题 / 常用来源 / 引用历史 / 搜索反馈逐步理解用户）、可解释（搜索 / 问答 / 推荐都说明来源与排序原因，不输出无引用断言）。
- **排序管线**：硬过滤（base/folder/type/exclude）→ BM25 召回 + Vector 召回 → Hybrid 融合（优先 RRF 或归一化加权）→ 候选补强（pin/recent/context）→（可选）rerank（默认不启用本地 cross-encoder，见 §3）→ 最终 bounded boost → MMR 去重与探索 → 输出结果 + reason codes。
- **六层职责边界**：BM25 永久保留（处理文件名 / 路径 / 标题 / 错误码 / 代码 / 短 query）；Vector 补语义但不压过高置信 exact match；Hybrid 保留 `bm25_score` / `vector_score` / `field_match` 便于解释；Rerank 只对 topK；Personalization 有上限可关闭、不压过相关性；Diversity 让 top3 求准、探索放第 6-10 位。
- **解释接口**：返回 reason codes 而非仅 score。`RankingReason` 枚举：`filename_match | path_match | heading_match | body_match | semantic_match | recently_used | pinned | positive_feedback | same_folder | same_session | authority_source | diversity_selected`；`FileModeRankedResult = { relativePath, chunkId, score, rank, reasons }`。
- **用户信号四分类**：
  - 显式信号（收藏 / 置顶 / 有用无用 / 标记权威 / 排除目录 / 手动提升）：权重最高、可撤销，按 base-relative path 保存。
  - 低敏隐式信号（搜索后打开 / 被引用 / 会话使用 / 最近打开 / 改写后成功点击）：本地保存，单次点击 ≠ 相关、不点击 ≠ 负反馈。
  - 衍生信号（权威度 / path affinity / topic affinity / co-access graph / query-success pair）：聚合 + 时间衰减，区分长期与会话画像。
  - 默认不采集（正文复制 / 停留时长 / 鼠标轨迹 / 窗口外 / 跨设备画像）：启用须 opt-in。
- **八个 Pass 方案及理由**：普通文件夹 + 搜索（区分度不足）、传统 RAG 条目树升级（双重事实源违背事实源原则）、本地 Notion/Wiki/图谱（复杂度高、偏离 AI 场景）、推荐流优先（信息流制造噪音）、纯 Vector Search（路径 / 文件名 / 版本号 / 错误码 / 代码 / 短 query 质量不稳）、LLM 直接排序（慢 / 贵 / 不可复现 / 难解释）、全局长期画像（隐私敏感 / 难解释 / 污染新项目）、自动整理真实文件夹（破坏用户控制权）。
- **三阶段路线**：
  - 阶段一 可信搜索闭环（真实文件夹 CRUD + Rescan、BM25 默认、可诊断、最小反馈）。
  - 阶段二 本地语义增强（按 base 启用 embedding 写 vector 表、RRF hybrid；本地 rerank 暂缓，见 §3；低敏事件聚合成 `document_usage` / `query_success` 带 TTL）。
  - 阶段三 知识工作区智能层（topic clusters、co-access graph、contextual recommendation、local LTR、整理建议；须本地、可解释、可关闭）。

### 1.3 对 Cherry 的建议

- **存储落点**（落地细节见[技术方案](./knowledge-technical-design.md)）：File Mode 的 manifest / chunk / FTS / 向量 / 使用信号一律放每个 base 的 `.cherry/index.sqlite`（`FileModeIndexStore` 管理），不进主库 `knowledge_item`；使用信号不出设备、不做云端 / 全局画像。
- **搜索分派**：由 `KnowledgeOrchestrationService.search` 按 `base.mode` 分派；File Mode 文件操作走 `KnowledgeFileModeService` 的 base-scoped IPC，不用通用绝对路径 File IPC。
- **使用信号三张表（DDL 草案，供未来阶段二 / 三参考）**：

```sql
file_mode_usage_event(
  id PK, relative_path NOT NULL, chunk_id, query_signature,
  action NOT NULL, rank, created_at NOT NULL, expires_at
);
file_mode_document_usage(
  relative_path PK, open_count, citation_count,
  positive_feedback_count, negative_feedback_count,
  last_used_at, authority_score
);
file_mode_search_preference(
  id PK, relative_path NOT NULL, preference_type NOT NULL,
  value REAL NOT NULL, created_at NOT NULL
);
```

- **降级语义**：本地模型失败必须显式降级，不能悄悄返回「完整智能搜索」；分层降级、批处理、topK 限制、进度与诊断面板控制本地模型性能。
- **文案纪律**：避免「真正理解你」「第二大脑」等不可验证表达；稳妥表述 = 基于本地文件、搜索记录和显式反馈优先显示更可能相关的内容。
- **最终衡量标准**：产品只需在三个动作上明显更好——搜记不清文件名的内容、打开文件时发现相关材料、基于多个本地文件生成带引用答案；其它高级能力都服务于这三个动作。

---

## 2. 子调研二 · 检索栈（hybrid / RRF / rerank / 向量索引 / 分数语义 / 降级）

> 本节是四篇调研在「检索栈」上的交集整合（File Mode+RAG、Remote File Mode、本地 Embedding/Rerank、工具面调研），作为检索算法层的唯一权威章节。

### 2.1 背景与问题

四篇调研都触及检索栈：要不要拆「向量搜索 / 关键词搜索」两个工具？要不要让 Agent 选检索模式？无向量库（未配 embedding）时如何工作？分数怎么表达？CJK 文本怎么处理？这些问题需要统一裁决，避免各文档各说各话。

### 2.2 调研结论

- **裁决一 · 单一 search 后端自适应**（四立场罕见一致）：不拆检索工具、不让 Agent 选模式，用**单一 `search` 后端自适应**——有向量库走 hybrid，无向量 / 未配 embedding / 索引未完成走纯 BM25，**实际模式作为返回值回传**。能力协商前移到 `list`（选库阶段就知道哪些库只能 BM25），不在每次查询把检索算法概念泄漏给模型。
- **裁决二 · 分数必须带类型**：相关度分（语义，跨查询可比、可做绝对阈值）vs 排名分（BM25 / RRF，仅同查询内可比）。当前实现把两者混为一个 0~1 分是**语义缺陷，需修正**。
- **裁决三 · BM25-only 是一等模式**：纯 BM25 不是降级凑数，而是「无 embedding 也能用」契约的表达；并需修复 **CJK 分词（bigram）**，可在纯 BM25 上叠加 RM3 伪相关反馈 / 字段加权。
- **混合检索栈**：BM25 召回（path / title / body）+ Vector 召回（semantic chunks）→ Hybrid 融合（RRF 优先或归一化加权）→（可选）rerank（本地 cross-encoder 默认不启用，见 §3）→ 可选 bounded boost → MMR。
- **向量索引选型**：HNSW（approximate nearest neighbor）保大库低延迟；语义召回用 Sentence-BERT / E5 / DPR 类 dual-encoder；rerank（如启用）用 Cross-encoder 或 ColBERT late interaction，但本地 cross-encoder 实测过慢、默认不启用（见 §3）；主题层用 BERTopic / Top2Vec（必要时 HDBSCAN / k-means）；多样化用 MMR；个性化先显式反馈 boost，数据足够后再考虑 BPR / LightGCN。
  - **落地约束（引擎可移植）**：向量须以引擎可移植的**纯 BLOB**（little-endian float32）存储，ANN / 相似度索引作为**可重建的派生产物**藏在适配层后，以便 libsql ↔ 未来 better-sqlite3 + sqlite-vec **零用户迁移**切换；详见[技术方案 §5.6](./knowledge-technical-design.md)。
- **本地 ↔ 企业云端等价的契约不变量**（详见 §5）：`locator` 是不透明令牌（本地编码字符位移、云端编码块号 / 页码 / 版本），同一 `read` 签名走不同取数实现；无原文权限时返回「仅片段」状态（退回投影文本）而非异常。

### 2.3 对 Cherry 的建议

- 落地只保留一个 `KnowledgeIndexStore.search`，内部按 base 能力自适应 vector / BM25 / hybrid，并把实际检索模式与 `score` 类型透出到 `KnowledgeSearchResult`（接口与参数表见[技术方案](./knowledge-technical-design.md)）。
- 检索参数建议（来自本地 Embedding/Rerank 调研 §3.7）：向量召回 topK 30~100；dtype q4 优先；本地推理用低并发队列。（rerank topN 5~12 / rerank `max_length` 4096~8192 仅在未来启用可选重排时适用；本地 cross-encoder 默认不启用，见 §3。）
- 先修分数语义缺陷与 CJK 分词，再谈 hybrid 增益；把检索模式作为返回值，不让 Agent 在每次查询里选算法。

---

## 3. 子调研三 · 本地 Embedding / Rerank 选型（Qwen3 + Transformers.js + AI SDK）

> **as-built（2026-06-09）：本节的本地 Qwen3 embedding / rerank 选型最终未被采纳。** 实际落地把 embedding / rerank 统一路由到 `AiService` → 用户配置的 provider API（`#15796` 删除了旧 embedjs 栈与本地 reranker 策略适配器），详见[技术方案 §5.5](./knowledge-technical-design.md)。本节内容保留为「本地 / 完全离线」路线的原始调研，可作为未来 AiService 之外的可选 provider 接入参考；其中 Qwen3-Reranker-0.6B 因本地实测过慢（≈6s/次、50 次 ≈ 5 分钟）本就已 Pass。

### 3.1 背景与问题

产品目标是把「选模型 / 配模型」降级为「一键下载默认模型」，让小白可用：用户只看到「可用 / 不可用」状态，下载 / 校验 / 加载 / 删除都在应用内完成。

工程约束：

- **不用 Ollama**（当前不支持 rerank，无法满足两阶段检索核心需求）。
- 跨平台可运行、TS 友好、尽量轻量。
- 参考 5ire 的本地 ONNX embedding 下载思路，但需补齐 rerank。

### 3.2 调研结论

**核心选型**：文本 embedding 用 `onnx-community/Qwen3-Embedding-0.6B-ONNX`，经 **Transformers.js** 在本地运行，封装为 **AI SDK 6** 的 `EmbeddingModelV3`。**本地 cross-encoder rerank 暂不选型**：原候选 `onnx-community/Qwen3-Reranker-0.6B-ONNX` 经实测本地性能不可接受（详见下方「被 Pass 的方案」），故默认检索止于 embedding 召回 + hybrid RRF 融合；rerank 作为可选未来项（待更轻量模型 / WebGPU 加速 / 云端 API 再评估），AI SDK 的 `RerankingModelV3` 封装能力保留但默认不内置本地重排模型。Qwen3-VL embedding/rerank 已存在但最小 2B、官方暂无成熟 Transformers.js 路线，留作后续 Python / vLLM sidecar 多模态扩展。

**两阶段检索价值与现实约束**：理论上「embedding 召回 + reranker 精排」能让传给 LLM 的片段更少更准（对长文档、相似标题、多语言内容、代码片段尤其明显）。但本地 cross-encoder 精排经实测过慢（见下方 Pass 理由），因此当前**默认只做 embedding 召回 + hybrid RRF 融合，精排留作可选**；embedding 本地化仍能降低 API 成本与数据外发。

**关键工程要点**：

- **模型格式**：官方 `Qwen/Qwen3-Embedding-0.6B` / `Qwen/Qwen3-Reranker-0.6B` 是 safetensors，**不能直接被 Transformers.js 本地加载**；必须用 ONNX community 仓库，或自行用 Optimum 转换并按 Transformers.js 结构放置文件。
- **下载架构**：不要把 HF URL 写死（5ire main 分支把 bge-m3 的 4 个文件硬编码到 Hugging Face，无国内外分流 / 镜像 / ModelScope fallback）。改为 manifest + 多源策略：

```ts
type ModelFile = {
  name: string; path: string; size?: number; sha256?: string;
  sources: Array<{ type: 'huggingface' | 'mirror' | 'cdn' | 'modelscope'; url: string }>;
};
type LocalModelManifest = { id: string; revision: string; files: ModelFile[] };
```

- **本地缓存 / 加载**：模型管理拆为下载 / 校验 / 加载 / 释放四阶段；首次使用才下载，之后从本地目录加载并禁远程模型：

```ts
import { env } from '@huggingface/transformers';
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = application.getPath('models.transformers');
```

- **Embedding 推理**：query 侧加 instruction（`Instruct: ${TASK}\nQuery:${query}`，`TASK = 'Given a web search query, retrieve relevant passages that answer the query'`），document 侧不加；`pooling='last_token'`、`normalize=true`；`pipeline('feature-extraction', MODEL_ID, { dtype:'q4', device:'wasm' })`；`maxEmbeddingsPerCall=32`、`supportsParallelCalls=false`。服务层区分 `embedQuery` 与 `embedDocuments`。
- **Rerank 推理（⚠️ 已被 Pass，仅留作未来参考）**：Qwen3 reranker 是 CausalLM-based，用结构化 prompt（`<|im_start|>system/user/assistant`）让模型答 yes/no，读最后 token 的 yes/no logits 算概率：

```ts
// SYSTEM = 'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".'
const yes = Math.exp(logits[yesId]);
const no = Math.exp(logits[noId]);
return yes / (yes + no); // relevanceScore
// AutoTokenizer + AutoModelForCausalLM, dtype q4, device wasm, max_length 8192 truncation
```

- **AI SDK 封装**：AI SDK 6 原生支持 `EmbeddingModelV3` / `RerankingModelV3`，本地模型无需伪装成 OpenAI-compatible HTTP，直接用 `customProvider` 封装：

```ts
customProvider({
  embeddingModels: { 'qwen3-embedding-0.6b': createQwenEmbeddingModel() },
  // rerankingModels 暂不内置 Qwen3-Reranker-0.6B（本地过慢被 Pass）；封装能力保留，待轻量 / 加速方案再启用
});
// 默认经 embedMany 调用；rerank({ topN }) 为可选、默认不启用本地重排
```

- **检索参数建议**：向量召回 topK 30~100、dtype q4 优先（必要时 q8）、本地 WASM/WebGPU 用低并发队列。（rerank topN 5~12 / rerank `max_length` 4096~8192 等参数仅在未来启用可选重排时才适用。）

**被 Pass 的方案及理由**：
- **`onnx-community/Qwen3-Reranker-0.6B-ONNX`（本地 cross-encoder rerank）—— 经实测本地约 50 次 rerank 需 5 分钟（≈6s/次），交互体验不可接受，故 Pass**。本地精排暂缓，默认检索止于 hybrid RRF；待更轻量 reranker / WebGPU 加速 / 云端 API 等更快路径出现后再评估是否启用。
- 其余：Ollama（不支持 rerank）、直接复用 5ire（无 rerank 流程，仅借鉴下载与本地加载）、SentenceTransformers / FlagEmbedding（Python 生态需引入 runtime/sidecar）、FastEmbed（TS 友好度不足、偏服务端 / 脚本）、TEI / Infinity（需 Docker/Python/Rust 服务、桌面内置偏重）、vLLM / SGLang（GPU/server 取向超出轻量范围）、Open WebUI（完整 WebUI 产品）、Qwen3-VL（最小 2B、无成熟 TS 版，留作多模态）、LangChain.js / LlamaIndex.TS（只需轻量 adapter，不引入额外编排层）。

### 3.3 对 Cherry 的建议

- **短期落地** 仅 Qwen3-Embedding-0.6B ONNX 文本 embedding（**不含本地 reranker**，默认检索止于 hybrid RRF），接口统一封装 AI SDK；下载 / 校验 / 加载 / 释放独立成服务，模型懒加载 + 空闲释放 + 限并发控内存；默认 WASM、可配 WebGPU 并失败自动 fallback。
- **路径集中化**：模型目录走 `application.getPath('models.transformers')`（集中式 path 命名空间），不要 ad-hoc 拼路径。
- **中期** 保留 Qwen3-VL 多模态路线；**先做文本 RAG 闭环**，不一开始引入 VL / 多服务 / Docker，否则显著抬高交付复杂度。
- **风险与验证 checklist**：① 固定 query/document 样例的 embedding 相似度符合模型卡趋势；② macOS/Windows/Linux 上下载 / 加载 / 取消 / 删除流程；③ WASM 与 WebGPU 两种 device 的 fallback 行为；④ 接入 AI SDK 后跑端到端索引与检索测试；⑤ 任何未来候选 reranker 必须先过本地延迟基准（以 Qwen3-Reranker-0.6B 的 ≈6s/次 为反例阈值）再决定是否启用。
- 落地接口与服务边界（`EmbeddingModelV3` / `RerankingModelV3` 封装、模型下载 / 缓存 / 加载服务）见[技术方案](./knowledge-technical-design.md)，本报告负责模型选型与实现细节，技术方案不重复展开。

---

## 4. 子调研四 · Agent 工具面与自适应检索（2026-06-09）

> 来自《知识库产品说明》第 13 章，面向 v2.x 终态，回答两问：Q1 给 Agent 暴露几个 / 哪些工具？Q2 知识库为何要做独立子系统、检索能否越用越准？

### 4.1 背景与问题

- **Q1**：知识库到底给 Agent 暴露几个、哪些工具？要不要直接给通用文件系统工具（grep / glob / cat）？
- **Q2**：知识库是不是「带搜索的文件夹」就够了？为什么要做成一个独立子系统？检索能否越用越准？

### 4.2 调研结论

#### Q1 · 推荐 5 个 `kb__*` 专用工具

四立场分别主张暴露 2 / 2 / 5 / 12 个工具，最终收敛到 **5 个知识库专用工具**：`kb__list` / `kb__search` / `kb__read` / `kb__tree` / `kb__manage`。

- 比「2 个」多保留 list 的能力协商，以及 tree / manage 的 Agent 代管能力。
- 比「12 个」砍掉违反「搜索优先 / 本地云端等价」的 grep、glob 等通用文件式工具，以及依赖未实现来源表的工具。
- `add` / `delete` / `refresh` 合成 `kb__manage`，因为三者共享确认协议 + 破坏性预览 + 云端降级骨架。

| 工具 | 角色 | 要点 |
| --- | --- | --- |
| `kb__list` | 发现 | 列可见库并声明每库能力（本地 / 云端、只读 / 可写、hybrid / BM25、是否已配 embedding）；已有，需补能力字段。 |
| `kb__search` | 检索 | 唯一检索入口，后端按库能力自适应；每条命中回传 `score` / 检索模式 / `locator`；已有，需补 locator 与模式。 |
| `kb__read` | 扩上下文 | 凭 locator 取邻近上下文或整段，参数控窗口；v2.x 待建核心闭环。 |
| `kb__tree` | 浏览 | 受边界约束的目录浏览，依赖材料扫描器，延后。 |
| `kb__manage` | 改库 | add / delete / refresh 收口为带两段式确认 + 破坏性预览 + 云端降级的单工具；云端只读库返回 unsupported；延后。 |

**坚决不暴露通用文件系统工具**，三条技术红线：① 泄露后端形态（云端无路径概念）；② 绕过权限（文件读无身份校验）；③ 产生不可移植引用（字符位移绑死本地编码）。对应三条约束：`kb__read` 只接受不透明 locator、Agent 永不解析 / 构造路径、后端按身份重校验归属。

#### Q2 结论一 · 为什么要独立子系统

知识库不是文件夹，而是**文件夹之上的「检索资产层」**。裸文件夹 + 通用 grep 只能给 Agent 字节流；子系统额外沉淀**六类资产**（裸文件夹皆不能提供）：

1. 语义索引（BM25 + 向量）；
2. 来源身份 / 可刷新快照标识；
3. 可移植 locator（片段锚点 + score）；
4. 派生增强层（chunk 级问题 / 摘要 / 关键词 / 标签）；
5. 个性化 / 使用反馈状态；
6. 可观测 / 可审计（带 locator / score / 模式的结果）。

**最硬红线是权限**：必须在「结果进入模型上下文之前」按身份裁剪候选；只有专用 `search` 能在内部检索全集后、返回前留权限裁剪点（个人本地场景为空实现，符合「候选 id 是提示非白名单」的不变量）。通用文件工具结构上做不到这一点。

**同类产品印证**：Glean（按文档 / 字段权限过滤后再交大模型）、Notion AI（只搜有权限页面）、FastGPT（可编辑内容索引，是 `content_index_entry` 的产品先例）、Cursor（增量索引 + 保留关键词检索不替换 + 靠使用信号变好）、Mem0（个性化记忆是独立可检索状态层，不寄生于裸文件夹）。

#### Q2 结论二 · 越用越准三轨

| 轨道 | 内容 | 落点 | 优先级 |
| --- | --- | --- | --- |
| (a) 建索引即提升 | doc2query 反向问题（纯 BM25 约 +15%）；小块检索-大块返回；Contextual 摘要上下文化（命中失败率最高降约 2/3） | 写 `content_index_entry` + `search_text` | P0~P1 |
| (b) 使用信号自适应 | 高频命中问法回填为新问题索引（= 持续 doc2query）；融合后轻量重排；满意度加权 + 位置纠偏 + 探索配额防退化反馈环 | 复用 `content_index_entry` + 唯一新增一张轻量 `usage_event` 表 | P0~P1 |
| (c) 混合检索 + 降级 | BM25-only 设为一等模式；修复 CJK 分词 bigram；保留 hybrid + RRF + 可选 rerank；纯 BM25 叠 RM3 伪相关反馈 / 字段加权 | 检索层 + 模式透出 | P0~P1 |

多数收益集中在前两轨的前几项，且几乎全部复用已规划的表结构。

**自我改进闭环**：导入即复制 → material + content；离线索引增强 → 小块切分 + 反向问题 / 摘要 / 关键词写 `content_index_entry` 与 `search_text`；检索 → 有向量 hybrid / 无向量 BM25，返回片段 + score + locator；读上下文 → `kb__read` 按 locator 扩窗；使用反馈 → 打开 / 引用 / 复制 / 追问 / 置顶 / 删除记入 `usage_event`；再增强 → 高频问法回填 + 使用信号轻量重排（带位置纠偏），可一键清空 / 关闭自适应回纯基线。

**隐私与去偏护栏**：使用与偏好数据只存本库 `.cherry/index.sqlite`、绝不出设备；提供「查看 / 清空使用痕迹」与「关闭自适应排序」开关；把点击 / 采纳当正反馈会被位置偏置带偏，桌面单用户尤其易锁死，因此**位置纠偏 + 探索配额是与重排同时必须上的护栏**，不是可选项。

### 4.3 对 Cherry 的建议

- 工具数定为 5 个 `kb__*`，绝不暴露通用文件工具；`add/delete/refresh` 收口为 `kb__manage`；`kb__tree` / `kb__manage` 延后。
- 自适应检索的唯一新增结构是一张轻量 `usage_event` 表；其余复用已规划的 `content_index_entry` / `search_text` / `search_unit.locator`。
- 分数语义缺陷（把相关度分与排名分混为一个 0~1）必须修正（见 §2）。
- 工具契约的技术字段（能力字段、locator 不透明令牌、unsupported/conflict/forbidden 状态）落地见[技术方案](./knowledge-technical-design.md)；产品语义边界见[产品文档](./knowledge-product-spec.md)。

---

## 5. 子调研五 · 企业内网 Remote File Mode 知识库

### 5.1 背景与问题

当前 File Mode 是 filesystem-first：内容源是本机目录 `Data/KnowledgeBase/{baseId}/`、UI live scan、Agent handoff 指向本地目录、RAG 查本地 `.cherry/index.sqlite`、权限依赖本地路径边界。这套假设适合个人，但企业内网 20GB+ 共享库下，员工端无法 / 不应整库拉取。

| 当前 File Mode 假设 | 企业内网问题 |
| --- | --- |
| 内容源 = 本地真实目录 | 员工端没有 / 不应同步完整目录 |
| UI = 主进程按 baseId+relativePath 扫本地目录 | 需改远程 listing |
| Agent 读取 = workspace 指向本地目录用 filesystem MCP | 远程库非本地 workspace，无法读 |
| RAG 查询 = 查本地 `.cherry/index.sqlite` | 共享索引应服务端维护，客户端只请求结果 |
| 权限 = 依赖本地路径边界 | 必须按用户身份在服务端做 ACL / RBAC |

### 5.2 调研结论

**核心结论**：企业内网 Remote Knowledge 要保留 File Mode 的**文件语义**（看目录、找文件、读文件、继续读后几页 / 几行），但**不能保留「本地文件系统是唯一内容源」的实现假设**。正确方向是 **Remote File Mode**：本地 workspace 只做 Agent 草稿区，企业库作为 remote attached knowledge，通过服务端鉴权的 `kb_*` 工具按需读取。

- **新增形态而非替换**：知识库引入 `storageKind = local | remote`（或新增独立 `mode = remote_file`）。Local File Mode 保持本地 base root + filesystem MCP；Remote File Mode 的 source of truth 改为内网 **Knowledge Gateway**，文档身份仍用 base-relative path（`kb://baseId/relativePath`）。
- **架构组件**：Knowledge Gateway（统一鉴权 / 路由 / 审计 / 限流 / 目录与读取 API / 查询 API）+ Metadata DB（base/file/directory/chunk/version/hash/ACL/索引状态）+ Object Storage/NAS（原文与解析产物，NAS / MinIO / Ceph / S3-compatible）+ Index Workers（异步 parse/chunk/embed）+ Search Index（BM25 + 向量检索 + 过滤 + rerank 前召回）。
- **Agent 工具族 `kb_*`**：`kb_ls`（列一层目录）、`kb_glob`（按路径模式）、`kb_grep`（关键词查找）、`kb_search`（语义 + 关键词混合）、`kb_read`（行范围）、`kb_read_page`（PDF/Word/PPT 页范围）、`kb_read_chunk`（命中 chunk 及邻近）、`kb_open_preview`（短期受控预览 / 下载链接）。每次读取经服务端鉴权与裁剪。
- **典型查询链路**：用户问「报销制度里差旅住宿标准」→ `kb_search({ baseIds:['corp-kb'], query:'差旅 住宿 标准 报销' })` → 得到 `kb://corp-kb/policies/finance/travel.pdf#page=12` → `kb_read_page({ baseId:'corp-kb', path:'policies/finance/travel.pdf', pageStart:12, pageLimit:3 })` → 引用文件路径和页码作答。
- **权限与安全**：必须在服务端强制执行，不能只靠客户端过滤。base/file/chunk 携带 `tenantId/baseId/owner/groupIds/userIds/securityLabels/version`；查询先解析用户身份与群组再把 ACL 条件加入服务端过滤；读片段需对 path 二次校验可读性；预览 / 下载链接短期有效且绑定用户 / 文件 / 范围 / 用途；需审计「谁、何时、搜了什么 query、读了哪些片段、是否生成预览链接」。
- **不推荐方案及理由**：
  - 整库同步 20GB → 磁盘 / 网络 / 更新 / 权限 / 删除召回不可控；
  - SMB/NFS/WebDAV 挂载为主方案 → 延迟 / 断网 / 锁 / 缓存 / 审计 / 权限粒度 / 搜索体验变差；
  - 只同步索引 sqlite → 权限过滤 / 索引版本 / embedding 模型变更 / 删除召回 / chunk 原文读取变一致性问题；
  - 只依赖 RAG 片段不提供文件语义工具 → 无法保留目录 / 路径 / 指定文件 / 继续读取上下文的核心体验。
- **MVP 分阶段路线**：
  - MVP1 只读 Remote File Mode（能列目录 / 搜索 / 读 chunk 与页 / 展示引用路径）；
  - MVP2 Agent 工具接入（搜索 → 读片段 → 回答）；
  - MVP3 权限与审计（不同用户只看可访问内容、读取可审计）；
  - MVP4 管理员上传与增量索引（上传后后台解析索引、员工无需同步文件）；
  - 后续 受控写入与协作（Agent 写 note/wiki 或提交变更请求，而非直接改共享原文）。
- **最小接口草案（TS）**：

```ts
type RemoteKnowledgeSource = { baseId; displayName; relativePath; uri: `kb://${string}/${string}` };
type KbSearchResult = { baseId; relativePath; displayName; chunkId; text; score; page?; lineStart?; lineEnd? };
type KbReadRequest = { baseId; relativePath; offset?; limit? };
type KbReadPageRequest = { baseId; relativePath; pageStart; pageLimit };
```

### 5.3 对 Cherry 的建议（7 条）

1. 引入 `storageKind = local | remote`（或新增 `mode = remote_file`）。
2. Local 保持本地 base root + filesystem MCP 现状。
3. Remote 的 source of truth 改为内网 Knowledge Gateway，文档身份仍用 base-relative path。
4. Agent handoff 不再指向远程库，而是创建本地 scratch workspace 同时注入当前 remote KB。
5. 主进程按 `knowledgeBaseIds` 注入 remote tools（`kb_ls` / `kb_search` / `kb_read` / `kb_read_page`）。
6. UI 目录浏览接口按 `storageKind` 分派：local → `KnowledgeFileModeService`，remote → Knowledge Gateway。
7. 默认先做只读，写 / 移 / 删 / 自动整理作为后续受控能力。

落地形态（storageKind 引入、Gateway 架构、服务端 ACL、handoff scratch workspace）见[技术方案](./knowledge-technical-design.md)的 Remote File Mode 章节，本报告负责架构论证与方案评估。

---

## 6. 论文与外部依据汇编（去重合并）

> 合并各子调研引用并去重。外部检索可用性说明：File Mode+RAG 调研中 arXiv 查询 2 次分别遇 429 / 503、Gemini 综述查询超时，故部分 arXiv 未作有效外部结论来源，最终以 Web / 官方文档 + 论文 + 多角色辩论为准；工具面调研的 39 篇论文经对抗式存在性核验后纳入。

**RAG 基础 / 显式记忆与来源**
- RAG（显式非参数记忆与来源）arXiv:2005.11401

**混合检索 / 融合 / 降级**
- Fusion Functions for Hybrid Retrieval arXiv:2210.11934
- BEIR（异构检索基准）arXiv:2104.08663
- RRF（Reciprocal Rank Fusion，Cormack SIGIR'09）；Azure hybrid-search-ranking（BM25 + vector + RRF）
- MMR（最大边际相关，1998）；SQLite FTS5（基础全文检索）

**离线索引增强 / 反向问题 / 上下文化**
- doc2query / docTTTTTquery arXiv:1904.08375
- EnrichIndex arXiv:2504.03598
- QuIM-RAG arXiv:2501.02702
- Anthropic《Contextual Retrieval》

**chunk 策略**
- RAPTOR arXiv:2401.18059
- Dense X / 命题检索 arXiv:2312.06648
- Late Chunking arXiv:2409.04701
- GraphRAG arXiv:2404.16130

**查询期增强**
- HyDE arXiv:2212.10496
- Self-RAG arXiv:2310.11511
- CRAG arXiv:2401.15884
- RAG-Fusion arXiv:2402.03367

**语义召回 / 向量索引 / 重排**
- DPR arXiv:2004.04906
- SBERT arXiv:1908.10084
- E5 arXiv:2212.03533
- HNSW arXiv:1603.09320
- BERT rerank arXiv:1901.04085
- ColBERT arXiv:2004.12832

**主题建模**
- BERTopic arXiv:2203.05794
- Top2Vec arXiv:2008.09470

**使用信号 / 去偏 / 个性化 / 记忆**
- Unbiased LTR arXiv:1608.04468
- Degenerate Feedback Loops arXiv:1902.10730
- 隐式反馈是偏好样本而非真相：Joachims 2002；Hu-Koren-Volinsky 2008
- BPR arXiv:1205.2618
- LightGCN arXiv:2002.02126
- Mem0 arXiv:2504.19413

**Agentic / 综述**
- Agentic RAG 综述 arXiv:2501.09136

**Local-first / 工程依据**
- Ink & Switch《Local-first software》（本地数据为主副本）
- Hugging Face Hub 下载（`hf_hub_download` 单文件 / `snapshot_download` 整库，支持 local_dir / 缓存 / revision / dry-run）

---

## 7. 调研结论与对落地的输入

> 汇总各子调研被采纳的裁决与对产品 / 技术的输入锚点（被两篇文档链接引用的结论）。

**被采纳的核心裁决**

- 知识库定位：以真实文件夹为事实源的本地知识工作区 = Filesystem-first + BM25-first hybrid + 可选 rerank（本地默认不启用）+ bounded personalization + explainable recommendations。
- 检索：单一 `search` 后端自适应（hybrid / BM25），分数必须带类型，BM25-only 为一等模式，需修 CJK 分词。
- Agent 工具：5 个 `kb__*` 专用工具，不暴露通用文件工具；`read` 凭不透明 locator；`add/delete/refresh` 收口为 `kb__manage`。
- 知识库做成独立子系统：六类检索资产 + 权限红线（结果进模型前按身份裁剪）。
- 越用越准：三轨 P0~P1，唯一新增一张轻量 `usage_event` 表，配位置纠偏 + 探索配额护栏，数据不出设备。
- embedding / rerank（as-built 修正）：统一走 `AiService` → 用户配置 provider 的 API（与 Chat 共用凭证，`#15796`），**非**本地 ONNX；§3 的本地 Qwen3 选型未被采纳，保留为未来全离线可选路线。Qwen3-Reranker-0.6B 本地过慢已 Pass。
- 企业场景：Remote File Mode + Knowledge Gateway，保留文件语义但放弃本地 fs 唯一内容源假设，服务端强制 ACL，默认只读。

**各子调研的实施 / 阶段建议（落地路线由技术方案统一）**

| 子调研 | 阶段建议 |
| --- | --- |
| File Mode + RAG | 阶段一可信搜索闭环 → 阶段二本地语义增强 → 阶段三知识工作区智能层 |
| Remote File Mode | MVP1 只读 → MVP2 工具接入 → MVP3 权限审计 → MVP4 上传与增量索引 → 后续受控写入 |
| 本地 Embedding/Rerank | as-built 已改走 AiService→provider（非本地 ONNX）；本节本地路线留作未来全离线可选项，Qwen3-VL 多模态路线中期保留 |
| 工具面与自适应检索 | 越用越准三轨均 P0~P1，前两轨前几项优先且几乎全复用已规划表 |

这些建议是方向性输入；v2 当前阶段的 PR 拆分（2026-06-09 重规划为 3 个 PR）与 as-built 状态以[技术方案 §15](./knowledge-technical-design.md)为准，产品可感知口径以[产品文档](./knowledge-product-spec.md)为准。
