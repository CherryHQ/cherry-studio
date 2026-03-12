import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import type { DirectoryContainerData, FileItemData } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('buildDirectoryPayload')

export interface DirectoryBuildResult {
  directoryItem: CreateKnowledgeItemDto
  childItems: CreateKnowledgeItemDto[]
}

export const buildDirectoryPayload = async (
  directoryPath: string,
  options?: { maxEntries?: number; recursive?: boolean }
): Promise<DirectoryBuildResult | null> => {
  const maxEntries = options?.maxEntries ?? 100000
  const recursive = options?.recursive ?? true

  const filePaths = await window.api.file.listDirectory(directoryPath, {
    recursive,
    includeFiles: true,
    includeDirectories: false,
    includeHidden: false,
    maxEntries,
    searchPattern: '.'
  })

  if (filePaths.length === 0) {
    return null
  }

  const files = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        return await window.api.file.get(filePath)
      } catch (error) {
        logger.warn('Failed to read file metadata for directory item', error as Error, { filePath })
        return null
      }
    })
  )

  const validFiles = files.filter((file): file is FileMetadata => file !== null)
  if (validFiles.length === 0) {
    return null
  }

  return {
    directoryItem: {
      type: 'directory',
      data: {
        path: directoryPath,
        recursive
      } satisfies DirectoryContainerData
    },
    childItems: validFiles.map((file) => ({
      type: 'file',
      data: { file } satisfies FileItemData
    }))
  }
}
