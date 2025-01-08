import type { ExtractChunkData } from '@llm-tools/embedjs-interfaces'
import AiProvider from '@renderer/providers/AiProvider'
import { FileType, KnowledgeBase, KnowledgeBaseParams, Message } from '@renderer/types'
import { take } from 'lodash'

import { getProviderByModel } from './AssistantService'
import FileManager from './FileManager'

export const getKnowledgeBaseParams = (base: KnowledgeBase): KnowledgeBaseParams => {
  const provider = getProviderByModel(base.model)
  const aiProvider = new AiProvider(provider)

  let host = aiProvider.getBaseURL()

  if (provider.type === 'gemini') {
    host = host + '/v1beta/openai/'
  }

  return {
    id: base.id,
    model: base.model.id,
    dimensions: base.dimensions,
    apiKey: aiProvider.getApiKey() || 'secret',
    apiVersion: provider.apiVersion,
    baseURL: host
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

export const getKnowledgeReferences = async (base: KnowledgeBase, message: Message) => {
  const searchResults = await window.api.knowledgeBase.search({
    search: message.content,
    base: getKnowledgeBaseParams(base)
  })

  const _searchResults = await Promise.all(
    searchResults.map(async (item) => {
      const file = await getFileFromUrl(item.metadata.source)
      return { ...item, file }
    })
  )

  const references = await Promise.all(
    take(_searchResults, 6).map(async (item, index) => {
      const baseItem = base.items.find((i) => i.uniqueId === item.metadata.uniqueLoaderId)
      return {
        id: index,
        content: item.pageContent,
        sourceUrl: await getKnowledgeSourceUrl(item),
        type: baseItem?.type
      }
    })
  )

  const referencesContent = `\`\`\`json\n${JSON.stringify(references, null, 2)}\n\`\`\``

  return referencesContent
}
