# Knowledge Vector Migrator Notes (V2)

## 1. 文档目的

这份文档用于说明 V2 知识库向量迁移器的职责边界和核心规则。

它关注的是：

1. V1 `embedjs` 向量库的数据来源
2. V2 目标向量存储的落点
3. 向量迁移过程中的关键字段转换
4. 文件安全、校验与跳过规则

这份文档只描述当前已经落地的迁移器行为，不展开到未来在线向量数据重建或最终 retrieval API 设计。

对应实现：

- `src/main/data/migration/v2/migrators/KnowledgeVectorMigrator.ts`
- `src/main/data/migration/v2/migrators/README-KnowledgeVectorMigrator.md`

## 2. 迁移器的职责

`KnowledgeVectorMigrator` 的职责不是迁移知识库业务主数据，而是：

1. 读取 V1 每个 knowledge base 对应的 legacy `embedjs` 向量库
2. 将旧的 chunk 向量数据转换为新的 libsql-backed `vectorstores` 布局
3. 保证新向量数据能稳定关联回已经迁移完成的 V2 `knowledge_base` / `knowledge_item`

换句话说：

1. `KnowledgeMigrator` 负责业务主数据
2. `KnowledgeVectorMigrator` 负责向量数据迁移

两者共同完成知识库的完整迁移，但 source of truth 仍然是 V2 业务表，不是向量库。

## 3. 数据来源

迁移器依赖四类输入：

### 3.1 已迁移的 knowledge base

来源：

- SQLite `knowledge_base` 表

作用：

- 提供 base 身份
- 提供 embedding `dimensions`
- 决定哪些 base 需要尝试迁移向量库

### 3.2 已迁移的 knowledge item

来源：

- SQLite `knowledge_item` 表

作用：

- 作为新的业务 item 身份来源
- 为 legacy loader identity 映射提供目标 `itemId`

### 3.3 Legacy loader metadata

来源：

- Redux `knowledge.bases[].items[]`

作用：

- 从 V1 `uniqueId` / `uniqueIds[]` 反查到已经迁移后的 `knowledge_item.id`
- 建立旧向量记录与新业务 item 的映射关系

### 3.4 Legacy vector database

来源：

- `${getDataPath()}/KnowledgeBase/<baseId>`

作用：

- 读取 V1 `embedjs` 的 `vectors` 表
- 提供原始 chunk 文本、source、vector

## 4. 目标存储

迁移目标不是继续保留旧 `embedjs` 格式，而是生成新的 vectorstores 兼容存储。

当前实现的目标结构是：

- 目标文件：沿用原 knowledge DB 路径
- 目标表：`libsql_vectorstores_embedding`

迁移器会为目标存储补齐必要 schema：

1. 主表字段
   - `id`
   - `external_id`
   - `collection`
   - `document`
   - `metadata`
   - `embeddings`
2. 普通索引
   - `external_id`
   - `collection`
3. FTS 表和触发器

## 5. 核心转换规则

### 5.1 Loader identity 映射

V1 的向量记录使用 `uniqueLoaderId` 关联 loader。

V2 迁移时，不保留这个旧字段作为最终业务标识，而是把它映射成新的 `knowledge_item.id`，并写入：

- `external_id`

映射规则：

1. 优先使用 legacy item 的 `uniqueIds[]`
2. 如果不存在，再回退到 legacy item 的 `uniqueId`
3. 只有已经成功迁移到 V2 `knowledge_item` 的 item 才能参与映射

这一步的核心目标是：让新向量记录稳定关联回 V2 的业务 item，而不是继续依赖旧 loader identity。

这里有一个重要约束：

1. 只有能够映射到 V2 `knowledge_item.id` 的 legacy 向量记录，才属于有效可迁移数据
2. 无法映射到 `knowledge_item.id` 的 legacy 向量，即使仍存在于旧 `embedjs` DB 中，也视为无效残留数据
3. 因此迁移器的目标不是“尽量保留旧向量文件中的所有内容”，而是“只保留能被当前 V2 业务表证明合法归属的向量数据”

### 5.2 Chunk 内容映射

旧向量记录中的内容字段会转换为：

- `pageContent` -> `document`
- `knowledge_item.id` -> `metadata.itemId`
- `source` -> optional `metadata.source`

当前实现不会保留所有旧 metadata，只保留迁移和检索必需的最小信息。
其中 `metadata.itemId` 与 `external_id` 保持同值，用于恢复稳定的业务 item 归属。
如果 legacy row 的 `source` 为空，则迁移结果不会补默认值，也不会强制写出 `metadata.source`。

### 5.3 Embedding 复用

迁移器不会重新做 embedding。

它会直接复用 V1 已存在的向量：

1. 从 legacy `vector` 字段读取 `F32_BLOB`
2. 反序列化为 `number[]`
3. 再写入新表的 `embeddings`

这意味着：

1. 迁移成本更低
2. 不依赖在线模型调用
3. 迁移阶段不会触发重新切块或重新嵌入

### 5.4 Chunk identity 重建

旧 chunk row 的 `id` 不会直接复用。

每一条迁移后的向量记录都会生成新的 UUID v4 `id`。

因此迁移的稳定关联语义不是依赖旧 chunk id，而是依赖：

1. `baseId`
2. `external_id` = `knowledge_item.id`
3. chunk 文本与 source 对应的向量记录

## 6. 文件安全约束

当前迁移器采用“临时文件重建 + 就地替换”的策略。

规则如下：

1. 先在原 DB 的同级路径写一个临时文件
   - `<dbPath>.vectorstore.tmp`
2. 临时文件写完整并校验成功后，再替换原文件
3. 如果当前 base 在最终替换前失败，原始 legacy DB 保持不变

这意味着：

1. 迁移过程尽量避免中途损坏原文件
2. 当前流程依赖用户在迁移前已完成 V1 备份
3. 迁移器自身不额外维护一份回滚副本

## IMPORTANT: 当前已接受的局限

以下行为是当前实现**明确接受**的限制，不应误读为“未来理想方案”：

1. base 级执行失败属于迁移失败，不属于可跳过数据
   - 如果某个 base 在重建临时库、写入目标表或替换正式文件时失败，`execute()` 会直接返回 `success: false`
   - 这类失败不会被计入 `skippedCount`，也不应只记 warning 后继续成功
2. 当前实现**不会**在知识库目录中额外保留可重试的 legacy `.bak` 文件
   - 也就是说，迁移器不会为后续自动重试维护一份原地可恢复的 V1 向量源
3. 当前替换策略仍然是“就地替换”
   - 因此一旦失败发生在“原文件已移除，但新文件还未成功落位”的窗口中，磁盘上的 legacy source 可能已经不可继续复用
4. 当前重试策略依赖用户在迁移前完成的完整 V1 备份
   - 如果迁移失败，后续再次迁移前，应先由用户手动恢复原始备份
   - 迁移器自身**不保证**失败后目录仍处于“可直接再次迁移”的状态
   - 这也是当前实现没有采用“三段式替换（old -> .bak -> new）”的直接原因
   - 当前产品策略是在开始迁移前要求用户先做一次完整文件备份
   - 因此失败恢复的 source of truth 是“用户手动恢复的迁移前备份”，不是迁移器在知识库目录内额外维护的一份临时回滚副本
5. 这一点很重要，后续可能需要继续讨论或改动
   - 如果未来项目希望支持“失败后无需手动恢复、可直接再次迁移”，那么文件替换与 backup 策略需要重新设计

## 7. 校验规则

当前实现会做至少以下校验：

1. 每个 base 的目标行数必须与 prepared row 数一致
2. 每条迁移后的记录都必须有非空 `external_id`
3. 每条迁移后的记录都必须有 `metadata.itemId`，并与 `external_id` 保持一致

如果不满足这些条件，应视为当前 base 迁移失败。

## 8. 跳过规则

以下情况会被跳过，而不是强行写入：

1. `knowledge_base` 中不存在对应 base
2. legacy DB 文件不存在
3. legacy DB 路径实际是目录
4. legacy DB 不包含 `vectors` 表
5. `uniqueLoaderId` 无法映射回已迁移的 `knowledge_item.id`
6. 向量记录缺少 `vector` 或 `vector` 为空

这些跳过通常会记录 warning，而不是让整个迁移流程全部中断。

补充说明：

1. 如果某个 base 的 legacy 向量记录最终全部被跳过，则该 base 在 V2 中会被重建为空的 vector store
2. 这不是“回滚保留旧 DB”的场景，而是预期的数据清洗结果
3. 原因是这些被跳过的记录无法稳定关联到当前 V2 `knowledge_item`，因此不再被视为有效业务向量数据

## 9. 当前边界与限制

当前迁移器只负责“向量数据重建”，不负责：

1. 重新切块
2. 重新 embedding
3. 重新生成业务 item
4. 校正旧知识库的业务配置
5. 设计最终 retrieval service 的 API

因此它的定位应该是：

- 一次性的迁移工具
- 不等同于运行时知识库索引服务

## 10. 对后续实现的影响

基于当前迁移器行为，后续 V2 运行时设计需要遵守以下前提：

1. V2 业务真相仍然来自 `knowledge_base` / `knowledge_item`
2. 新向量记录必须能通过 `external_id` 稳定关联到 `knowledge_item.id`
3. 运行时不应继续依赖 V1 `embedjs` 的 `uniqueLoaderId`
4. 如果未来需要重建索引，应按 V2 业务表重新生成，而不是继续依赖旧迁移逻辑

## 11. 与其他文档的关系

- `knowledge-backend-decisions.md`
  - 定义当前 `KnowledgeRuntimeService`、data services、queue 和 runtime/vector 边界
- `knowledge-schema.md`
  - 定义 V2 业务 schema
- 本文档
  - 专门说明向量迁移器如何把旧向量数据接到新的 V2 业务模型上

三者的关系可以简化为：

1. schema 定义业务结构
2. backend decisions 文档定义当前运行时边界
3. vector migrator 文档定义旧向量数据如何迁移进新体系

## 12. 与当前 Runtime 的衔接

当前 runtime 向量侧实现位于：

- `src/main/services/knowledge/runtime/KnowledgeRuntimeService.ts`
- `src/main/services/knowledge/vectorstore/KnowledgeVectorStoreService.ts`
- `src/main/services/knowledge/vectorstore/providers/LibSqlVectorStoreProvider.ts`

这意味着迁移后的向量数据并不是孤立的一次性产物，而是会被当前 runtime 直接按 knowledge base 打开和查询。

当前已确认的衔接点是：

1. runtime 通过 `KnowledgeVectorStoreService` 按 `base.id` 获取 store
2. 实际 store provider 是 `LibSqlVectorStoreProvider`
3. runtime 检索和写入都基于 libsql vector store

因此，迁移器与 runtime 的共同前提是：

1. V2 业务真相来自 `knowledge_base` / `knowledge_item`
2. 运行时向量文件与迁移后的向量文件都属于同一类 libsql-backed vector store 体系
3. 运行时关联业务 item 仍应以 `knowledge_item.id` 为稳定标识，而不是继续依赖 V1 loader identity
