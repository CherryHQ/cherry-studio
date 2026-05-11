import { loggerService } from '@logger'
import type { Span } from '@opentelemetry/api'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, DEFAULT_KNOWLEDGE_THRESHOLD } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import { addSpan, endSpan } from '@renderer/services/SpanManagerService'
import {
  type FileMetadata,
  type KnowledgeBase,
  type KnowledgeBaseParams,
  type KnowledgeSearchResult,
  SystemProviderIds
} from '@renderer/types'
import { routeToEndpoint } from '@renderer/utils'
import { isAzureOpenAIProvider, isGeminiProvider } from '@renderer/utils/provider'
import { getRotatedProviderApiKey } from '@renderer/utils/providerAuth'
import { formatProviderApiHost } from '@renderer/utils/providerHost'
import { estimateTokenCount } from 'tokenx'

import { getProviderByModel } from './AssistantService'
import FileManager from './FileManager'

const logger = loggerService.withContext('RendererKnowledgeService')

export const getKnowledgeBaseParams = (base: KnowledgeBase): KnowledgeBaseParams => {
  const embedProviderRaw = getProviderByModel(base.model)
  const rerankProviderRaw = getProviderByModel(base.rerankModel)
  if (!embedProviderRaw) {
    throw new Error(`Knowledge base ${base.name}: embedding model provider not found`)
  }
  if (!rerankProviderRaw) {
    throw new Error(`Knowledge base ${base.name}: rerank model provider not found`)
  }
  const embedProvider = formatProviderApiHost(embedProviderRaw)
  const rerankProvider = formatProviderApiHost(rerankProviderRaw)

  let { baseURL } = routeToEndpoint(embedProvider.apiHost)

  const rerankHost = rerankProvider.apiHost
  if (isGeminiProvider(embedProvider)) {
    baseURL = baseURL + '/openai'
  } else if (isAzureOpenAIProvider(embedProvider)) {
    baseURL = baseURL + '/v1'
  } else if (embedProvider.id === SystemProviderIds.ollama) {
    // LangChain生态不需要/api结尾的URL
    baseURL = baseURL.replace(/\/api$/, '')
  }

  logger.info(`Knowledge base ${base.name} using baseURL: ${baseURL}`)

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
      apiKey: getRotatedProviderApiKey(embedProvider) || 'secret',
      baseURL
    },
    chunkSize,
    chunkOverlap: base.chunkOverlap,
    rerankApiClient: {
      model: base.rerankModel?.id || '',
      provider: rerankProvider.name.toLowerCase(),
      apiKey: getRotatedProviderApiKey(rerankProvider) || 'secret',
      baseURL: rerankHost
    },
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

export const getKnowledgeSourceUrl = async (item: KnowledgeSearchResult & { file: FileMetadata | null }) => {
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
): Promise<Array<KnowledgeSearchResult & { file: FileMetadata | null }>> => {
  // Truncate query based on embedding model's max_context to prevent embedding errors
  const maxContext = getEmbeddingMaxContext(base.model.id)
  if (maxContext) {
    const estimatedTokens = estimateTokenCount(query)
    if (estimatedTokens > maxContext) {
      const ratio = maxContext / estimatedTokens
      query = query.slice(0, Math.floor(query.length * ratio))
    }
  }

  let currentSpan: Span | undefined = undefined
  try {
    const baseParams = getKnowledgeBaseParams(base)
    const documentCount = base.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT
    const threshold = base.threshold || DEFAULT_KNOWLEDGE_THRESHOLD

    if (topicId) {
      currentSpan = await addSpan({
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

    const searchResults: KnowledgeSearchResult[] = await window.api.knowledgeBase.search(
      {
        search: query || rewrite || '',
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
