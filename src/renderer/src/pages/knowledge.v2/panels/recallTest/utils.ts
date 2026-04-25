import type { KnowledgeSearchResult } from '@shared/data/types/knowledge'

import type { RecallResultItem } from './types'

const MAX_HISTORY_QUERY_COUNT = 5

export const prependHistoryQuery = (queries: string[], query: string) => {
  return [query, ...queries.filter((item) => item !== query)].slice(0, MAX_HISTORY_QUERY_COUNT)
}

export const formatRecallScore = (score: number) => score.toFixed(2)

const getMetadataString = (metadata: Record<string, unknown>, key: string) => {
  const value = metadata[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

const getFileName = (filePath: string) => filePath.split(/[\\/]/).filter(Boolean).pop()

const getSourceName = (result: KnowledgeSearchResult) => {
  const fileName = getMetadataString(result.metadata, 'file_name')
  const filePath = getMetadataString(result.metadata, 'file_path')
  const source = getMetadataString(result.metadata, 'source')

  return fileName ?? (filePath ? getFileName(filePath) : undefined) ?? source ?? result.chunkId
}

const getChunkIndex = (metadata: Record<string, unknown>, index: number) => {
  const chunkIndex = metadata.chunkIndex
  return typeof chunkIndex === 'number' && Number.isFinite(chunkIndex) ? chunkIndex : index + 1
}

export const mapRecallResult = (result: KnowledgeSearchResult, index: number): RecallResultItem => {
  return {
    id: result.chunkId || `${result.itemId ?? 'result'}-${index}`,
    sourceName: getSourceName(result),
    chunkIndex: getChunkIndex(result.metadata, index),
    score: result.score,
    content: result.pageContent,
    plainText: result.pageContent
  }
}
