import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import AiProvider from '@renderer/aiCore'
import { 
  DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, 
  DEFAULT_KNOWLEDGE_THRESHOLD,
  DEFAULT_TIME_WEIGHT,
  DEFAULT_RECENCY_DECAY_DAYS
} from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import Logger from '@renderer/config/logger'
import store from '@renderer/store'
import { FileMetadata, KnowledgeBase, KnowledgeBaseParams, KnowledgeReference } from '@renderer/types'
import { ExtractResults } from '@renderer/utils/extract'
import { isEmpty } from 'lodash'

import { getProviderByModel } from './AssistantService'
import FileManager from './FileManager'

// 时间权重计算函数
const calculateTimeWeight = (
  item: ExtractChunkData & { file: FileMetadata | null },
  base: KnowledgeBase
): number => {
  // 如果没有启用时间加权，直接返回原始分数
  if (!base.enableRecencyBoost) {
    return item.score
  }

  const timeWeight = base.timeWeight ?? DEFAULT_TIME_WEIGHT
  const semanticWeight = 1 - timeWeight
  const decayDays = base.recencyDecayDays ?? DEFAULT_RECENCY_DECAY_DAYS
  
  // 获取文档时间戳
  let documentTimestamp = Date.now()
  
  // 尝试从文件元数据获取时间
  if (item.file && item.file.created_at) {
    documentTimestamp = new Date(item.file.created_at).getTime()
  } else if (item.metadata.source && item.metadata.source.includes('created_at')) {
    // 尝试从元数据中解析时间
    const match = item.metadata.source.match(/created_at[=:](\d+)/)
    if (match) {
      documentTimestamp = parseInt(match[1])
    }
  }
  
  // 计算文档年龄（天数）
  const currentTime = Date.now()
  const ageInDays = (currentTime - documentTimestamp) / (1000 * 60 * 60 * 24)
  
  // 计算时间衰减因子（指数衰减）
  const timeDecayFactor = Math.exp(-ageInDays / decayDays)
  
  // 计算时间得分（0-1之间）
  const timeScore = timeDecayFactor
  
  // 计算最终得分：语义得分 * 语义权重 + 时间得分 * 时间权重
  const finalScore = item.score * semanticWeight + timeScore * timeWeight
  
  return Math.max(0, Math.min(1, finalScore)) // 确保得分在0-1之间
}

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
      search: rewrite || query,
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

    // 处理文件信息并计算时间权重
    const resultsWithTimeWeight = await Promise.all(
      limitedResults.map(async (item) => {
        const file = await getFileFromUrl(item.metadata.source)
        const itemWithFile = { ...item, file }
        // 计算时间权重得分
        const timeWeightedScore = calculateTimeWeight(itemWithFile, base)
        
        // 添加明显的控制台日志以验证功能
        console.log(`🎯 [时间权重优化] 文档: ${item.metadata.source}`)
        console.log(`📊 原始分数: ${item.score.toFixed(4)} → 时间权重分数: ${timeWeightedScore.toFixed(4)}`)
        console.log(`⚙️ 配置: 启用=${base.enableRecencyBoost}, 时间权重=${base.timeWeight || 0.2}, 衰减天数=${base.recencyDecayDays || 365}`)
        console.log(`---`)
        
        return { ...itemWithFile, score: timeWeightedScore }
      })
    )

    // 按时间权重得分重新排序
    return resultsWithTimeWeight.sort((a, b) => b.score - a.score)
  } catch (error) {
    Logger.error(`Error searching knowledge base ${base.name}:`, error)
    throw error
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

    // 合并结果并去重（保持时间权重得分）
    const flatResults = allResults.flat()
    const uniqueResults = Array.from(
      new Map(flatResults.map((item) => [item.metadata.uniqueId || item.pageContent, item])).values()
    ).sort((a, b) => b.score - a.score) // 按时间权重得分排序

    // 转换为引用格式
    return await Promise.all(
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
