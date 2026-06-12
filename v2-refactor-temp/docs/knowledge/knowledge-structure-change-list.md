# Knowledge 待修改数据结构清单

本文档用于记录 Knowledge V2 还需要修改的数据结构项。

只记录已经确认的结构性调整，不记录未确认的 UI 推断或实现细节。

## 已确认

### 1. 复用 `groupTable`，为 `knowledge_base` 增加 `groupId`

#### 结论

- 不新增独立的 `knowledge_group` 表。
- 复用现有 `src/main/data/db/schemas/group.ts` 中的 `groupTable`。
- 在 `knowledge_base` 上增加 `groupId` 字段，关联到 `groupTable.id`。
- 如果上层为 Knowledge 创建专用分组，`group.entityType` 约定使用：
  - 建议值：`knowledge_base`
- 当前 `KnowledgeBaseService` 不额外强校验 `entityType`，行为与现有 `topic.groupId` 一致。

#### 目的

- 支撑 Knowledge V2 左侧知识库列表的分组组织能力。
- 让知识库分组成为业务数据，而不是 renderer 本地 mock 字段。
- 避免误用 `knowledge_item.groupId`：
  - `knowledge_item.groupId` 的语义仍然是 item 级来源/容器分组
  - 不能复用于知识库导航分组

#### 需要修改的结构

1. SQLite Schema
   - `src/main/data/db/schemas/knowledge.ts`
   - 在 `knowledgeBaseTable` 上新增：
     - `groupId: text().references(() => groupTable.id, { onDelete: 'set null' })`

2. Shared Data Types / API Schema
   - `src/shared/data/types/knowledge.*`
   - `src/shared/data/api/schemas/knowledges.ts`
   - 需要让 `KnowledgeBase`、`CreateKnowledgeBaseDto`、`UpdateKnowledgeBaseDto` 支持 `groupId`

3. Data Service / Handler 约束
   - `KnowledgeBaseService`
   - knowledge 相关 handler
   - 保持与 `topic.groupId` 一致：
     - service 层不额外增加 `groupId` / `entityType` 业务校验
     - create / update 对 `groupId` 直接透传，不做 trim 或空值归一化
     - 由 SQLite 外键约束负责引用完整性

4. Migration / 兼容策略
   - 旧知识库数据当前没有 `groupId`
   - 迁移阶段允许先写入 `null`
   - 是否补默认分组，后续单独确认

#### 当前不做

- 不新增 `knowledge_group` 表
- 不把 `knowledge_item.groupId` 改造成知识库分组字段
- 不做多级分组
- 不做 group 专属额外字段：
  - 如 `icon`
  - `color`
  - `isDefault`
  - `parentId`

#### 影响范围

- `knowledge_base` 主数据结构
- knowledge base DataApi 输入输出契约
- 后续 renderer 左侧分组列表的数据来源

### 2. 暂不为 `knowledge_base` 持久化图标字段

#### 结论

- 当前不在 `knowledge_base` 上持久化 `emoji` 或 `icon` 字段。
- 未来知识库会支持自定义图标，但具体结构尚未确定；等图标模型确定后再补数据字段。
- 当前知识库页面的固定图标只作为 UI 展示资产存在，不进入 DataApi / SQLite 主数据结构。

#### 目的

- 避免在 V2 开发阶段引入很快会被自定义图标替换的临时数据字段。
- 保持知识库主数据只包含当前已经确定的业务属性。

#### 需要修改的结构

1. SQLite Schema
   - `src/main/data/db/schemas/knowledge.ts`
   - `knowledgeBaseTable` 不包含 `emoji` / `icon` 字段。

2. Shared Data Types / API Schema
   - `src/shared/data/types/knowledge.ts`
   - `src/shared/data/api/schemas/knowledges.ts`
   - `KnowledgeBase`、`CreateKnowledgeBaseDto`、`UpdateKnowledgeBaseDto` 不暴露知识库图标字段。

3. Data Service / Handler 约束
   - `KnowledgeBaseService`
   - knowledge 相关 handler
   - 不接收、不生成、不返回知识库图标字段。

4. Migration / 兼容策略
   - V2 开发阶段不保留知识库 `emoji` 兼容逻辑。

#### 当前不做

- 不新增 `emoji`
- 不新增 `icon`
- 不新增 `iconType`
- 不新增 `iconUrl`
- 不新增 `cover`
- 不新增 `separatorRule`

#### 影响范围

- `knowledge_base` 主数据结构
- knowledge base DataApi 输入输出契约
- renderer 中知识库列表与详情头部的持久化图标数据来源

## 待补充

- 后续新的结构调整项继续按同样格式追加到本文档
