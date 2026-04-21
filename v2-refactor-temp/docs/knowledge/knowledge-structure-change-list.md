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
   - `packages/shared/data/types/knowledge.*`
   - `packages/shared/data/api/schemas/knowledges.ts`
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

### 2. 为 `knowledge_base` 增加 `emoji`

#### 结论

- 在 `knowledge_base` 上增加 `emoji` 字段，用于知识库的 icon 展示。
- 存储方式与现有 `assistantTable` 保持一致：
  - SQLite 使用 `emoji: text()`
- 不单独引入图片、SVG、icon type 等扩展字段
- `emoji` 是知识库主数据的一部分，不放到 renderer 本地状态或临时 UI 配置里。
- API / service 层行为与 assistant 对齐：
  - `KnowledgeBase.emoji` 始终返回非空值
  - 默认值为 `📁`

#### 目的

- 支撑 Knowledge V2 左侧列表、详情头部等位置的知识库图标展示。
- 让 icon 成为可持久化业务数据，而不是 UI 层推导值。
- 与现有 assistant 的 emoji 存储模式保持一致，降低理解和实现成本。

#### 需要修改的结构

1. SQLite Schema
   - `src/main/data/db/schemas/knowledge.ts`
   - 在 `knowledgeBaseTable` 上新增：
     - `emoji: text()`

2. Shared Data Types / API Schema
   - `packages/shared/data/types/knowledge.ts`
   - `packages/shared/data/api/schemas/knowledges.ts`
   - 需要让 `KnowledgeBase`、`CreateKnowledgeBaseDto`、`UpdateKnowledgeBaseDto` 支持 `emoji`

3. Data Service / Handler 约束
   - `KnowledgeBaseService`
   - knowledge 相关 handler
   - 建议约束：
     - 仅接受单个 emoji 字符，行为与 assistant 一致
   - 与 assistant 一样，API 层保证返回值始终带 emoji

4. Migration / 兼容策略
   - 旧知识库数据当前没有 `emoji`
   - 迁移阶段允许数据库中仍为 `null`
   - 读取时由 service 层补默认值 `📁`

#### 当前不做

- 不新增 `icon`
- 不新增 `iconType`
- 不新增 `iconUrl`
- 不新增 `cover`
- 不新增 `separatorRule`

#### 影响范围

- `knowledge_base` 主数据结构
- knowledge base DataApi 输入输出契约
- renderer 中知识库列表与详情头部的图标数据来源

## 待补充

- 后续新的结构调整项继续按同样格式追加到本文档
