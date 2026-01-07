import type {
  EmbeddingModelMeta,
  ItemStatus,
  KnowledgeBaseConfig,
  KnowledgeItemData,
  KnowledgeItemType,
  ProcessingStage
} from '@shared/data/types/knowledge'
import type { ModelMeta } from '@shared/data/types/meta'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './columnHelpers'

/**
 * knowledge_base 表 - 知识库元数据
 */
export const knowledgeBaseTable = sqliteTable(
  'knowledge_base',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    description: text(),

    // 嵌入模型配置
    embeddingModelId: text().notNull(),
    embeddingModelMeta: text({ mode: 'json' }).$type<EmbeddingModelMeta>(),

    // 重排模型配置
    rerankModelId: text(),
    rerankModelMeta: text({ mode: 'json' }).$type<ModelMeta>(),

    // 预处理提供者 ID
    preprocessProviderId: text(),

    // 配置 (分块大小、相似度阈值等)
    config: text({ mode: 'json' }).$type<KnowledgeBaseConfig>(),

    ...createUpdateTimestamps
  },
  (t) => [index('knowledge_base_updated_at_idx').on(t.updatedAt)]
)

/**
 * knowledge_item 表 - 知识项（文件、URL、笔记等）
 *
 * 使用 uuidPrimaryKeyOrdered (UUID v7) 以支持时间排序查询
 */
export const knowledgeItemTable = sqliteTable(
  'knowledge_item',
  {
    id: uuidPrimaryKeyOrdered(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),

    // 类型: 'file' | 'url' | 'note' | 'sitemap' | 'directory'
    type: text().$type<KnowledgeItemType>().notNull(),

    // 统一的 data 字段 (Discriminated Union)
    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    // 处理状态
    status: text().$type<ItemStatus>().default('pending'),
    stage: text().$type<ProcessingStage>(),
    progress: integer(),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    index('knowledge_item_base_id_idx').on(t.baseId),
    index('knowledge_item_status_idx').on(t.status),
    index('knowledge_item_base_updated_idx').on(t.baseId, t.updatedAt),
    check('knowledge_item_status_check', sql`${t.status} IN ('idle', 'pending', 'processing', 'completed', 'failed')`),
    check('knowledge_item_type_check', sql`${t.type} IN ('file', 'url', 'note', 'sitemap', 'directory')`)
  ]
)
