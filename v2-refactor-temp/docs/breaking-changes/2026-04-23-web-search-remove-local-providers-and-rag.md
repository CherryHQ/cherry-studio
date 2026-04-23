# Web Search 移除本地搜索引擎与 RAG 压缩配置

## 变更内容

- Web Search 不再支持本地搜索引擎 provider：`local-google`、`local-bing`、`local-baidu`。
- Web Search 搜索结果压缩不再支持 `rag` 模式，只保留 `none` 和 `cutoff`。
- Web Search RAG/知识库压缩相关 Preference key 被移除：
  - `chat.web_search.compression.rag_document_count`
  - `chat.web_search.compression.rag_embedding_model_id`
  - `chat.web_search.compression.rag_embedding_dimensions`
  - `chat.web_search.compression.rag_rerank_model_id`
- Web Search Renderer 运行时不再为搜索结果创建临时知识库，也不再调用知识库搜索/重排来压缩搜索结果。

## 影响范围

- 设置页不再展示本地搜索引擎和 RAG 压缩设置。
- 默认搜索 provider 或路由中残留旧 `local-*` 值时，Renderer 只做防御性展示/空态处理，不做默认 provider 迁移。
- 旧 `compressionConfig.method = 'rag'` 不再作为有效 V2 Preference 值保存。
- 独立知识库功能不受影响；本次只移除 Web Search 对知识库/RAG 压缩的依赖。

## 兼容/迁移策略

- v2 Preference 迁移中，旧 Web Search RAG 压缩方法会降级为 `none`。
- RAG 相关旧字段不会迁移进 V2 Preference schema。
- 旧 Redux store shape 暂不清理，留待 V2 收尾阶段统一移除。

## 验证点

- Web Search 设置页不再出现本地 provider 和 RAG 压缩选项。
- Web Search 压缩设置只允许 `none` / `cutoff`，修改后能正常写入 Preference。
- 旧 `method = 'rag'` 数据迁移后结果为 `none`。
- 聊天 Web Search 执行路径不再调用知识库相关 API。
- 独立知识库页面、知识库创建/搜索/重排功能仍正常。

## 关联 PR/提交

- PR: <https://github.com/CherryHQ/cherry-studio/pull/14443>
- Commit: `cddbf6440 refactor(web-search): remove rag compression`
