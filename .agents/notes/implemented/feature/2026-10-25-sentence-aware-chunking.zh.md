# Agent Note: 句子感知的知识库分块

Status: implemented

[English](2026-10-25-sentence-aware-chunking.md) | 中文

## 问题

原来的知识库分块器优先使用 Markdown 标题、代码围栏、段落、列表和换行作为断点，使用 22% 的回看窗口，并在 token 目标位置硬切。句末标点不是断点，`$$`、行内公式和 HTML 表格没有保护，token 预算用整篇文档的一个 chars/token 比例换算，overlap 从任意字符开始。

在 MinerU 解析的学术 PDF 上，这会产生句中断尾的 chunk，拆开 LaTeX 公式或 `<table>` 块，让重叠 chunk 从句子或公式中间开始，并超出请求预算：1024 token 的目标切出了 1718 token 的 chunk。检索评估显示，这会影响“采用什么系统模型、在哪个软件仿真”这类多事实问题。

这个决策需要处理的边界情况包括：位于偏移 0 的代码围栏、引用块或列表容器内的代码围栏、行内代码中的 `$$`、相邻表格，以及超过 token 预算的围栏代码块。

## 决策

`src/main/features/knowledge/pipeline/indexing/splitter.ts` 现在：

- 增加 `。！？；…` 和 `.!?` 句末断点，切点在标点之后，并保留收尾引号。
- 把 `$$...$$`、行内 `$...$` 和 `<table>...</table>` 视为原子块。内部的断点被忽略；落在块内的切点移到块前；落在块内的 overlap 起点移到非代码块之后，或移到此代码块内的下一行。
- 按行首配对反引号和波浪线围栏，包括偏移 0、最多三个前导空格，以及引用块或列表的容器前缀（`> ~~~sh`、`- ```sh`、`1. ```sh`、嵌套 `> >`）；同时遮蔽四个空格或 Tab 缩进的代码块。能放进预算的代码块保持原子；超过预算的代码块按行边界切分。
- 把行内代码从展示公式和行内公式检测中排除：按相同长度配对反引号；反斜杠转义只作用于候选 opener，因此 closing run 可以紧跟在反斜杠之后。未配对或内嵌的 run 不会吞掉后续完整 span；围栏分隔符按 start-inclusive 排除，两个围栏不会跨正文形成假的 inline span。
- 只在代码、表格、展示公式和行内代码之外扫描公式分隔符；先跳过排除区域再消费分隔符，因此代码中的 `$` 不会消耗后续公式的开头。
- 22% 窗口内没有断点时，回退到最近的句子或结构边界，并允许小幅向前越界到下一个句末。
- 每个选中的 chunk 用 `estimateTokenCount` 检查；超预算时二分出最大可容纳前缀，并优先取该前缀内的句子或结构边界。
- overlap 起点向前吸附到最近的句子或结构边界；切点前没有边界时放弃这段 overlap。
- `delimiter` 模式的 fallback 增加其他句末标点。原子块仍只在 `structured` 模式启用。

`contentText.slice(charStart, charEnd) === chunk.text` 仍是不变量。`chunk.ts`、`tokenLimit.ts`、`localEmbeddingTokenLimit.ts` 和索引契约没有改动。

## 考虑过的替代方案

- LangChain `@langchain/textsplitters`：返回字符串或文档，trim 后没有可靠的结束偏移。保留 verbatim 偏移契约需要额外的前向游标映射，Markdown 和公式原子性仍然要自己实现。因此不用于生产路径。
- `@chonkiejs/core`：偏移精确、API 更简单，但默认按字符计 token，没有公式/表格原子块，overlap 不对齐句子，API 还是 pre-1.0，并且带有约 25 MB 的可选 tree-sitter 包。在同一份文档上，它有 9/21 个 chunk 在正文句中结束，3 个 chunk 的展示公式不平衡。因此不采用。
- 只加标点规则，不做原子块和每 chunk token 校正：公式/表格拆分和 1718 token 的超预算仍然存在。不够。
- 把所有代码围栏都视为不可切分：代码密集的文档在 1024 目标下产生了 3,361 token 的 chunk，embedding 模型会截断。不采用。
- 保留按 token 的 overlap：overlap 落入句子中间时，chunk 开头仍是半句。不采用。

## 后果

- 只要句子能放进预算，chunk 的首尾都会落在句子或结构边界上。单句超过 `chunkSize` 时仍然需要硬切。
- 小型代码块、公式和表格保持完整。围栏或缩进代码块超过预算时按行边界切分；单行代码超过预算时硬切。公式或表格本身超过预算时仍保持原子，这是已知例外。
- overlap 起点若位于切分后的代码块中，会吸附到当前行行首（前提是仍在上一块起点之后），保留代码上下文并避免从行中间开始。没有合适边界时 overlap 会缩小或消失，且仍完整覆盖非空白内容。
- token 校正使用 `tokenx`。本地 embedding 的 tokenizer 可能不同，`refineChunksByTokenLimit` 仍是本地模型的最终保护。
- 已有索引需要 reindex 才会使用新的边界。
- `structured` 是 MinerU 和学术 Markdown 的推荐策略；`delimiter` 保持原来的原子行为。
- 独立评估使用 12 个查询和 `structured-1024-200`、`structured-512-100`、`structured-300-50` 三组配置，全部配置的 Hit@5 都是 12/12。`512/100` 最均衡（Hit@3 12/12），`1024/200` 的 Hit@1 和 MRR 最高（11/12，0.933），`300/50` 在多事实问题上排名下降。

## 验证

- Regression — `pnpm test:main src/main/features/knowledge/pipeline/indexing/__tests__/splitter.test.ts`：39 个测试通过，覆盖句末标点和收尾引号、`$$`、行内公式、表格、overlap 起点、token 校正、偏移 0 的围栏、缩进的反引号/波浪线围栏、引用块和列表前缀围栏及其收尾围栏之后的正文、四空格缩进代码、包含内嵌反引号的单行/多行行内代码、反斜杠后紧跟的 closing backtick、转义和未配对反引号、内嵌反引号之后的后续代码 span、代码中含 `$` 之后的真实公式、两个围栏之间的公式、相邻表格、超大围栏和缩进代码块、代码块按行对齐的 overlap 和 verbatim fuzz 不变量。
- Regression — `pnpm test:main src/main/features/knowledge/pipeline/indexing/__tests__/chunk.test.ts src/main/features/knowledge/pipeline/indexing/__tests__/tokenLimit.test.ts src/main/features/knowledge/pipeline/indexing/__tests__/localEmbeddingTokenLimit.test.ts src/main/features/knowledge/pipeline/vectorstore/indexStore/__tests__/KnowledgeIndexStore.integration.test.ts`：10 个测试通过，加上 splitter 共 49 个。
- Regression — `pnpm test:main src/main/features/knowledge`：651 passed，18 个原有路径 mock 失败与原始 splitter 基线一致，1 skipped。
- Regression — 改动文件的 `oxfmt --check`、`oxlint --deny-warnings` 和 `eslint` 通过。
- Regression — 评审场景探针（`chunkSize=1024`、`chunkOverlap=200`）：文档开头围栏最大 1019 token；引用块前缀围栏最大 1022；列表前缀围栏最大 1020；有序列表前缀围栏最大 1021；嵌套引用块围栏最大 1014；三个空格缩进的引用块围栏最大 1022；含多行 `echo $$` 的行内代码最大 1020；内嵌反引号之后的后续 `echo $$` 代码 span 最大 1020；包含 `echo $$` 的波浪线围栏最大 1020；两个空格缩进的波浪线围栏最大 1019；真实 span 前的转义反引号最大 1020；双反引号 span 前的未配对反引号最大 1020；反斜杠后 closing backtick 最大 1017；四空格缩进的 `echo $$` 代码块最大 1019；100 个相邻表格最大 1023；160 行、12.5k 字符的代码块切成 3 块，最大 1020 token；400 行代码块的 200-token overlap 在每个边界都保留并按行对齐；200 行缩进代码块在 `32/0` 下最大 32 token。各容器前缀围栏用例均产出 16 个 chunk，除首尾外每个 chunk 都以句末标点结尾，说明围栏内的字面 `$$` 不再让后续正文被当成展示公式。代码中含 `$` 之后的公式和两个围栏之间的公式都完整出现在一个 chunk 中。所有探针的非空白缺失字符均为 0。
- Regression — MinerU 文档的非空白覆盖：缺失字符为 0；`structured` 模式下没有 `$$` 或 `<table>` 不平衡的 chunk。
- Regression — 真实 embedding（`voyageai/voyage-multimodal-3.5`，2048 维）和 12 个查询：三组配置的答案都在 top-5；上面的排名差异可以复现。

