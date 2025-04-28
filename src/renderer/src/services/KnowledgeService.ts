import type { ExtractChunkData } from '@cherrystudio/embedjs-interfaces'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT, DEFAULT_KNOWLEDGE_THRESHOLD } from '@renderer/config/constant'
import { getEmbeddingMaxContext } from '@renderer/config/embedings'
import AiProvider from '@renderer/providers/AiProvider'
import store from '@renderer/store'
import { FileType, KnowledgeBase, KnowledgeBaseParams, KnowledgeReference } from '@renderer/types'
import { ExtractResults } from '@renderer/utils/extract'
import { isEmpty } from 'lodash'

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
    dimensions: base.dimensions,
    apiKey: aiProvider.getApiKey() || 'secret',
    apiVersion: provider.apiVersion,
    baseURL: host,
    chunkSize,
    chunkOverlap: base.chunkOverlap,
    rerankBaseURL: rerankHost,
    rerankApiKey: rerankAiProvider.getApiKey() || 'secret',
    rerankModel: base.rerankModel?.id,
    rerankModelProvider: base.rerankModel?.provider,
    topN: base.topN
  }
}

export const getFileFromUrl = async (url: string): Promise<FileType | null> => {
  let fileName = ''

  if (url && url.includes('CherryStudio')) {
    if (url.includes('/Data/Files')) {
      fileName = url.split('/Data/Files/')[1]
    }

    if (url.includes('\\Data\\Files')) {
      fileName = url.split('\\Data\\Files\\')[1]
    }
  }

  if (fileName) {
    const fileId = fileName.split('.')[0]
    const file = await FileManager.getFile(fileId)
    if (file) {
      return file
    }
  }

  return null
}

export const getKnowledgeSourceUrl = async (item: ExtractChunkData & { file: FileType | null }) => {
  if (item.metadata.source.startsWith('http')) {
    return item.metadata.source
  }

  if (item.file) {
    return `[${item.file.origin_name}](http://file/${item.file.name})`
  }

  return item.metadata.source
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
    console.log('No valid question found in extractResults.knowledge')
    return []
  }
  const questions = extractResults.knowledge.question
  const rewrite = extractResults.knowledge.rewrite

  const bases = store.getState().knowledge.bases.filter((kb) => knowledgeBaseIds?.includes(kb.id))
  if (!bases || bases.length === 0) {
    console.log('Skipping knowledge search: No matching knowledge bases found.')
    return []
  }

  const referencesPromises = bases.map(async (base) => {
    try {
      const baseParams = getKnowledgeBaseParams(base)
      const documentCount = base.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT

      const allSearchResultsPromises = questions.map((question) =>
        window.api.knowledgeBase
          .search({
            search: question,
            base: baseParams
          })
          .then((results) =>
            results.filter((item) => {
              const threshold = base.threshold || DEFAULT_KNOWLEDGE_THRESHOLD
              return item.score >= threshold
            })
          )
      )

      const allSearchResults = await Promise.all(allSearchResultsPromises)

      const searchResults = Array.from(
        new Map(allSearchResults.flat().map((item) => [item.metadata.uniqueId || item.pageContent, item])).values()
      ).sort((a, b) => b.score - a.score)

      console.log(`Knowledge base ${base.name} search results:`, searchResults)

      let rerankResults = searchResults
      if (base.rerankModel && searchResults.length > 0) {
        rerankResults = await window.api.knowledgeBase.rerank({
          search: rewrite,
          base: baseParams,
          results: searchResults
        })
      }

      if (rerankResults.length > 0) {
        rerankResults = rerankResults.slice(0, documentCount)
      }

      const processdResults = await Promise.all(
        rerankResults.map(async (item) => {
          const file = await getFileFromUrl(item.metadata.source)
          return { ...item, file }
        })
      )

      const references = await Promise.all(
        processdResults.map(async (item, index) => {
          // const baseItem = base.items.find((i) => i.uniqueId === item.metadata.uniqueLoaderId)
          return {
            id: index + 1, // 搜索多个库会导致ID重复
            content: item.pageContent,
            sourceUrl: await getKnowledgeSourceUrl(item),
            type: 'file' // 需要映射 baseItem.type是'localPathLoader' -> 'file'
          } as KnowledgeReference
        })
      )
      return references
    } catch (error) {
      console.error(`Error searching knowledge base ${base.name}:`, error)
      return []
    }
  })

  const resultsPerBase = await Promise.all(referencesPromises)

  const allReferencesRaw = resultsPerBase.flat().filter((ref): ref is KnowledgeReference => !!ref)
  // 重新为引用分配ID
  const references = allReferencesRaw.map((ref, index) => ({
    ...ref,
    id: index + 1
  }))
  return references
}
