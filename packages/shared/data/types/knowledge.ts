import type { FileMetadata } from './file'
import type { ModelMeta } from './meta'

// ============ 枚举类型 ============

/** 知识项类型 */
export type KnowledgeItemType = 'file' | 'url' | 'note' | 'sitemap' | 'directory'

/** 处理状态 */
export type ItemStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed'

/** 处理阶段 */
export type ProcessingStage = 'preprocessing' | 'embedding'

// ============ 配置类型 ============

/** 知识库配置 */
export interface KnowledgeBaseConfig {
  chunkSize?: number
  chunkOverlap?: number
  similarityThreshold?: number
}

/** 嵌入模型元数据（扩展 ModelMeta，增加 dimensions） */
export interface EmbeddingModelMeta extends ModelMeta {
  dimensions?: number
}

// ============ Item Data 联合类型 ============

export interface FileItemData {
  type: 'file'
  file: FileMetadata
}

export interface UrlItemData {
  type: 'url'
  url: string
  name: string
}

export interface NoteItemData {
  type: 'note'
  content: string
  sourceUrl?: string
}

export interface SitemapItemData {
  type: 'sitemap'
  url: string
  name: string
}

export interface DirectoryItemData {
  type: 'directory'
  path: string
}

/** 知识项数据（Discriminated Union） */
export type KnowledgeItemData = FileItemData | UrlItemData | NoteItemData | SitemapItemData | DirectoryItemData
