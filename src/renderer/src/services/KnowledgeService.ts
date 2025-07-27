import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { loggerService } from '@logger'
import { Span } from '@opentelemetry/api'
import AiProvider from '@renderer/aiCore'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, DEFAULT_KNOWLEDGE_THRESHOLD } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import store from '@renderer/store'
import { FileMetadata, KnowledgeBase, KnowledgeBaseParams, KnowledgeReference } from '@renderer/types'
import { ExtractResults } from '@renderer/utils/extract'
import { isEmpty } from 'lodash'

import { getProviderByModel } from './AssistantService'
import FileManager from './FileManager'

const logger = loggerService.withContext('RendererKnowledgeService')

export const getKnowledgeBaseParams = (base: KnowledgeBase): KnowledgeBaseParams => {
  const provider = getProviderByModel(base.model)
  const rerankProvider = getProviderByModel(base.rerankModel)
  const aiProvider = new AiProvider(provider)
  const rerankAiProvider = new AiProvider(rerankProvider)

  let host = aiProvider.getBaseURL()
  const rerankHost = rerankAiProvider.getBaseURL()
  if (provider.type === 'gemini') {
    host = host + '/v1beta/openai/'
  }

  let chunkSize = base.chunkSize
  const maxChunkSize = getEmbeddingMaxContext(base.model.id)

  if (maxChunkSize) {
    if (chunkSize && chunkSize > maxChunkSize) {
      chunkSize = maxChunkSize
    }
    if (!chunkSize && maxChunkSize < 1024) {
      chunkSize = maxChunkSize
    }
  }

  return {
    id: base.id,
    dimensions: base.dimensions,
    embedApiClient: {
      model: base.model.id,
      provider: base.model.provider,
      apiKey: aiProvider.getApiKey() || 'secret',
      apiVersion: provider.apiVersion,
      baseURL: host
    },
    chunkSize,
    chunkOverlap: base.chunkOverlap,
    rerankApiClient: {
      model: base.rerankModel?.id || '',
      provider: rerankProvider.name.toLowerCase(),
      apiKey: rerankAiProvider.getApiKey() || 'secret',
      baseURL: rerankHost
    },
    preprocessOrOcrProvider: base.preprocessOrOcrProvider,
    documentCount: base.documentCount
  }
}

export const getFileFromUrl = async (url: string): Promise<FileMetadata | null> => {
  logger.debug(`getFileFromUrl: ${url}`)
  let fileName = ''

  if (url && url.includes('CherryStudio')) {
    if (url.includes('/Data/Files')) {
      fileName = url.split('/Data/Files/')[1]
    }

    if (url.includes('\\Data\\Files')) {
      fileName = url.split('\\Data\\Files\\')[1]
    }
  }
  logger.debug(`fileName: ${fileName}`)
  if (fileName) {
    const actualFileName = fileName.split(/[/\\]/).pop() || fileName
    logger.debug(`actualFileName: ${actualFileName}`)
    const fileId = actualFileName.split('.')[0]
    const file = await FileManager.getFile(fileId)
    if (file) {
      return file
    }
  }

  return null
}

export const getKnowledgeSourceUrl = async (item: ExtractChunkData & { file: FileMetadata | null }) => {
  if (item.metadata.source.startsWith('http')) {
    return item.metadata.source
  }

  if (item.file) {
    return `[${item.file.origin_name}](http://file/${item.file.name})`
  }

  return item.metadata.source
}

export const searchKnowledgeBase = async (
  query: string,
  base: KnowledgeBase,
  rewrite?: string,
  topicId?: string,
  parentSpanId?: string,
  modelName?: string
): Promise<Array<ExtractChunkData & { file: FileMetadata | null }>> => {
  let currentSpan: Span | undefined = undefined
  try {
    const baseParams = getKnowledgeBaseParams(base)
    const documentCount = base.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT
    const threshold = base.threshold || DEFAULT_KNOWLEDGE_THRESHOLD

    if (topicId) {
      currentSpan = addSpan({
        topicId,
        name: `${base.name}-search`,
        inputs: {
          query,
          rewrite,
          base: baseParams
        },
        tag: 'Knowledge',
        parentSpanId,
        modelName
      })
    }

    // 执行搜索
    const searchResults = await window.api.knowledgeBase.search(
      {
        search: rewrite || query,
        base: baseParams
      },
      currentSpan?.spanContext()
    )

    // 过滤阈值不达标的结果
    const filteredResults = searchResults.filter((item) => item.score >= threshold)

    // 如果有rerank模型，执行重排
    let rerankResults = filteredResults
    if (base.rerankModel && filteredResults.length > 0) {
      rerankResults = await window.api.knowledgeBase.rerank(
        {
          search: rewrite || query,
          base: baseParams,
          results: filteredResults
        },
        currentSpan?.spanContext()
      )
    }

    // 限制文档数量
    const limitedResults = rerankResults.slice(0, documentCount)

    // 处理文件信息
    const result = await Promise.all(
      limitedResults.map(async (item) => {
        const file = await getFileFromUrl(item.metadata.source)
        logger.debug(`Knowledge search item: ${JSON.stringify(item)} File: ${JSON.stringify(file)}`)
        return { ...item, file }
      })
    )
    if (topicId) {
      endSpan({
        topicId,
        outputs: result,
        span: currentSpan,
        modelName
      })
    }
    return result
  } catch (error) {
    logger.error(`Error searching knowledge base ${base.name}:`, error as Error)
    if (topicId) {
      endSpan({
        topicId,
        error: error instanceof Error ? error : new Error(String(error)),
        span: currentSpan,
        modelName
      })
    }
    throw error
  }
}

export const processKnowledgeSearch = async (
  extractResults: ExtractResults,
  knowledgeBaseIds: string[] | undefined,
  topicId: string,
  parentSpanId?: string,
  modelName?: string
): Promise<KnowledgeReference[]> => {
  if (
    !extractResults.knowledge?.question ||
    extractResults.knowledge.question.length === 0 ||
    isEmpty(knowledgeBaseIds)
  ) {
    logger.info('No valid question found in extractResults.knowledge')
    return []
  }

  const questions = extractResults.knowledge.question
  const rewrite = extractResults.knowledge.rewrite

  const bases = store.getState().knowledge.bases.filter((kb) => knowledgeBaseIds?.includes(kb.id))
  if (!bases || bases.length === 0) {
    logger.info('Skipping knowledge search: No matching knowledge bases found.')
    return []
  }

  const span = addSpan({
    topicId,
    name: 'knowledgeSearch',
    inputs: {
      questions,
      rewrite,
      knowledgeBaseIds: knowledgeBaseIds
    },
    tag: 'Knowledge',
    parentSpanId,
    modelName
  })

  // 为每个知识库执行多问题搜索
  const baseSearchPromises = bases.map(async (base) => {
    // 为每个问题搜索并合并结果
    const allResults = await Promise.all(
      questions.map((question) =>
        searchKnowledgeBase(question, base, rewrite, topicId, span?.spanContext().spanId, modelName)
      )
    )

    // 合并结果并去重
    const flatResults = allResults.flat()
    const uniqueResults = Array.from(
      new Map(flatResults.map((item) => [item.metadata.uniqueId || item.pageContent, item])).values()
    ).sort((a, b) => b.score - a.score)

    // 转换为引用格式
    const result = await Promise.all(
      uniqueResults.map(
        async (item, index) =>
          ({
            id: index + 1,
            content: item.pageContent,
            sourceUrl: await getKnowledgeSourceUrl(item),
            type: 'file'
          }) as KnowledgeReference
      )
    )
    return result
  })

  // 汇总所有知识库的结果
  const resultsPerBase = await Promise.all(baseSearchPromises)
  const allReferencesRaw = resultsPerBase.flat().filter((ref): ref is KnowledgeReference => !!ref)

  endSpan({
    topicId,
    outputs: resultsPerBase,
    span,
    modelName
  })

  // 重新为引用分配ID
  return allReferencesRaw.map((ref, index) => ({
    ...ref,
    id: index + 1
  }))
}
