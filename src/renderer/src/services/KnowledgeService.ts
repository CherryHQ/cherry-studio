import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, DEFAULT_KNOWLEDGE_THRESHOLD } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import Logger from '@renderer/config/logger'
import { ONLY_SUPPORTED_DIMENSION_PROVIDERS } from '@renderer/config/providers'
import AiProvider from '@renderer/providers/AiProvider'
import store from '@renderer/store'
import { FileMetadata, KnowledgeBase, KnowledgeBaseParams, KnowledgeReference } from '@renderer/types'
import { ExtractResults } from '@renderer/utils/extract'
import { isEmpty } from 'lodash'

import { fetchImageSummary } from './ApiService'
import { getProviderByModel } from './AssistantService'
import FileManager from './FileManager'

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
    model: base.model.id,
    dimensions: ONLY_SUPPORTED_DIMENSION_PROVIDERS.includes(base.model.provider) ? base.dimensions : undefined,
    apiKey: aiProvider.getApiKey() || 'secret',
    apiVersion: provider.apiVersion,
    baseURL: host,
    chunkSize,
    chunkOverlap: base.chunkOverlap,
    rerankBaseURL: rerankHost,
    rerankApiKey: rerankAiProvider.getApiKey() || 'secret',
    rerankModel: base.rerankModel?.id,
    rerankModelProvider: base.rerankModel?.provider,
    // topN: base.topN,
    // preprocessing: base.preprocessing,
    preprocessOrOcrProvider: base.preprocessOrOcrProvider
  }
}

export const getFileFromUrl = async (url: string): Promise<FileMetadata | null> => {
  console.log('getFileFromUrl', url)
  let fileName = ''

  if (url && url.includes('CherryStudio')) {
    if (url.includes('/Data/Files')) {
      fileName = url.split('/Data/Files/')[1]
    }

    if (url.includes('\\Data\\Files')) {
      fileName = url.split('\\Data\\Files\\')[1]
    }
  }
  console.log('fileName', fileName)
  if (fileName) {
    const actualFileName = fileName.split(/[/\\]/).pop() || fileName
    console.log('actualFileName', actualFileName)
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
  rewrite?: string
): Promise<Array<ExtractChunkData & { file: FileMetadata | null }>> => {
  try {
    const baseParams = getKnowledgeBaseParams(base)
    const documentCount = base.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT
    const threshold = base.threshold || DEFAULT_KNOWLEDGE_THRESHOLD

    // 执行搜索
    const searchResults = await window.api.knowledgeBase.search({
      search: query,
      base: baseParams
    })

    // 过滤阈值不达标的结果
    const filteredResults = searchResults.filter((item) => item.score >= threshold)

    // 如果有rerank模型，执行重排
    let rerankResults = filteredResults
    if (base.rerankModel && filteredResults.length > 0) {
      rerankResults = await window.api.knowledgeBase.rerank({
        search: rewrite || query,
        base: baseParams,
        results: filteredResults
      })
    }

    // 限制文档数量
    const limitedResults = rerankResults.slice(0, documentCount)

    // 处理文件信息
    return await Promise.all(
      limitedResults.map(async (item) => {
        const file = await getFileFromUrl(item.metadata.source)
        console.log('Knowledge search item:', item, 'File:', file)
        return { ...item, file }
      })
    )
  } catch (error) {
    Logger.error(`Error searching knowledge base ${base.name}:`, error)
    return []
  }
}

export const processKnowledgeSearch = async (
  extractResults: ExtractResults,
  knowledgeBaseIds: string[] | undefined
): Promise<KnowledgeReference[]> => {
  if (
    !extractResults.knowledge?.question ||
    extractResults.knowledge.question.length === 0 ||
    isEmpty(knowledgeBaseIds)
  ) {
    Logger.log('No valid question found in extractResults.knowledge')
    return []
  }

  const questions = extractResults.knowledge.question
  const rewrite = extractResults.knowledge.rewrite

  const bases = store.getState().knowledge.bases.filter((kb) => knowledgeBaseIds?.includes(kb.id))
  if (!bases || bases.length === 0) {
    Logger.log('Skipping knowledge search: No matching knowledge bases found.')
    return []
  }

  // 为每个知识库执行多问题搜索
  const baseSearchPromises = bases.map(async (base) => {
    // 为每个问题搜索并合并结果
    const allResults = await Promise.all(questions.map((question) => searchKnowledgeBase(question, base, rewrite)))

    // 合并结果并去重
    const flatResults = allResults.flat()
    const uniqueResults = Array.from(
      new Map(flatResults.map((item) => [item.metadata.uniqueId || item.pageContent, item])).values()
    ).sort((a, b) => b.score - a.score)

    // 转换为引用格式
    return await Promise.all(
      uniqueResults.map(async (item, index) => {
        const images = await getImagesFromResults([item])
        return {
          id: index + 1,
          content: item.pageContent,
          sourceUrl: await getKnowledgeSourceUrl(item),
          type: 'file',
          metadata: { images }
        } as KnowledgeReference
      })
    )
  })

  // 汇总所有知识库的结果
  const resultsPerBase = await Promise.all(baseSearchPromises)
  const allReferencesRaw = resultsPerBase.flat().filter((ref): ref is KnowledgeReference => !!ref)

  // 重新为引用分配ID
  return allReferencesRaw.map((ref, index) => ({
    ...ref,
    id: index + 1
  }))
}
/**
 * Extracts image metadata from search results.
 * @param results The search results containing image metadata.
 * @returns An array of resolved image metadata.
 */
export const getImagesFromResults = async (results: Array<ExtractChunkData & { file: FileMetadata | null }>) => {
  const imagePromises = results.flatMap((item) => item.metadata.images || [])
  const resolvedImages = await Promise.all(
    imagePromises.map(async (image) => {
      const file = await window.api.file.get(image)
      return file
    })
  )
  return resolvedImages.filter((img): img is FileMetadata => img !== null)
}

const ipcRenderer = window.electron.ipcRenderer

ipcRenderer.on(
  'knowledge-image-summary-batch',
  async (
    _event,
    { batchId, requests }: { batchId: string; requests: Array<{ imagePath: string; imageId: string }> }
  ) => {
    const results: Array<{ imageId: string; summary: string; error?: string }> = []

    await Promise.all(
      requests.map(async (req) => {
        try {
          const { data } = await window.api.file.base64Image(req.imagePath)
          const summary = await fetchImageSummary(data)
          results.push({ imageId: req.imageId, summary })
        } catch (error: any) {
          console.error(`[KnowledgeService Renderer]: Error fetching summary for ${req.imageId}:`, error)
          results.push({ imageId: req.imageId, summary: 'Error during summary', error: error.message })
        }
      })
    )

    ipcRenderer.send(`knowledge-image-summary-batch-reply-${batchId}`, {
      batchId,
      results
    })
  }
)
