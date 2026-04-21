# phase3 RAG 配置面板接入

共享约束见 [plans/README.md](./README.md)。

## 目标

让 `RAG 配置` 成为独立面板，清楚表达配置字段、表单边界和保存入口。

## 建议落位文件

- `src/renderer/src/pages/knowledge.v2/panels/ragConfig/RagConfigPanel.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/ragConfig/PreprocessSection.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/ragConfig/ChunkingSection.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/ragConfig/EmbeddingSection.tsx`
- `src/renderer/src/pages/knowledge.v2/panels/ragConfig/RetrievalSection.tsx`
- `src/renderer/src/pages/knowledge.v2/hooks/useKnowledgeV2RagConfig.ts`
- `src/renderer/src/pages/knowledge.v2/hooks/useKnowledgeV2SaveRagConfig.ts`

## 范围

- 落地 `文档预处理` 区块。
- 落地 `分块规则 (Chunking)` 区块。
- 落地 `Embedding 模型` 区块。
- 落地 `检索设置` 区块。
- 落地表单态、默认值、保存动作边界。

## 非目标

- 不混入数据源列表逻辑。
- 不把召回测试逻辑塞进本面板。
- 不自行补全 UI 稿未确认的额外高级配置区块。

## 具体任务

1. 将 `RAG 配置` 面板拆成稳定的 section 组件。
2. 为每个 section 明确它消费的字段边界。
3. 处理初始值、脏状态、保存按钮启用时机。
4. 如果某些字段缺少明确的读写边界，先回到上游定义接口，而不是在 UI 层硬编码。
5. 保证整个面板可以独立演进，不依赖数据源列表内部实现。

## 约束

- 只接已在 schema 或共享类型中有明确边界的字段：
  - `fileProcessorId`
  - `chunkSize`
  - `chunkOverlap`
  - `dimensions`
  - `embeddingModelId`
  - `rerankModelId`
  - `documentCount`
  - `threshold`
  - `searchMode`
  - `hybridAlpha`
- 如果 UI 稿和当前字段定义存在明显缺口，必须先定义上游能力。
- 不为“恢复默认”“模型维度自动刷新”这类动作写隐式副作用逻辑，动作边界要明确。
- 所有表单项都必须能解释清楚来源字段和保存目标。

## 完成标志

- `RAG 配置` 面板独立可渲染。
- section 拆分清晰，没有把整个表单塞进一个组件。
- 保存动作的输入输出边界明确。
