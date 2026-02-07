import { loggerService } from '@logger'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { dataApiService } from '@renderer/data/DataApiService'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeItems } from '@renderer/data/hooks/useKnowledgeData'
import { useFiles } from '@renderer/hooks/useFiles'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import type { CreateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import type {
  DirectoryContainerData,
  FileItemData,
  KnowledgeBase,
  NoteItemData,
  SitemapItemData,
  UrlItemData
} from '@shared/data/types/knowledge'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TabKey } from '../constants/tabs'

const logger = loggerService.withContext('useKnowledgeAddActions')

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

interface UseKnowledgeAddActionsArgs {
  base: KnowledgeBase | null
  activeKey: TabKey
}

interface AddAction {
  handler: () => Promise<void>
  disabled: boolean
  loading: boolean
}

interface DirectoryBuildResult {
  directoryItem: CreateKnowledgeItemDto
  childItems: CreateKnowledgeItemDto[]
}

const buildDirectoryPayload = async (
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

export const useKnowledgeAddActions = ({ base, activeKey }: UseKnowledgeAddActionsArgs): AddAction => {
  const { t } = useTranslation()
  const baseId = base?.id || ''

  const baseDisabled = !base?.embeddingModelId
  const { items } = useKnowledgeItems(baseId)
  const { onSelectFile, selecting: isSelectingFile } = useFiles({ extensions: fileTypes })

  const urlItems = useMemo(() => items.filter((item) => item.type === 'url'), [items])
  const sitemapItems = useMemo(() => items.filter((item) => item.type === 'sitemap'), [items])

  const { trigger: createItemsApi, isLoading: isCreatingItems } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  const handleAddFile = useCallback(async () => {
    if (baseDisabled || isSelectingFile) {
      return
    }

    const selectedFiles = await onSelectFile({ multipleSelections: true })
    if (selectedFiles.length === 0) {
      return
    }

    logger.debug('processFiles', selectedFiles)
    const startedAt = Date.now()
    logger.info('handleAddFile:start', { baseId, count: selectedFiles.length })

    try {
      const uploadedFiles = await FileManager.uploadFiles(selectedFiles)
      logger.info('handleAddFile:done', {
        baseId,
        count: uploadedFiles.length,
        durationMs: Date.now() - startedAt
      })

      const payload: CreateKnowledgeItemDto[] = uploadedFiles.map((file) => ({
        type: 'file',
        data: { file } satisfies FileItemData
      }))

      await createItemsApi({
        body: { items: payload }
      })
    } catch (error) {
      logger.error('handleAddFile:failed', error as Error, {
        baseId,
        durationMs: Date.now() - startedAt
      })
      throw error
    }
  }, [baseDisabled, isSelectingFile, onSelectFile, baseId, createItemsApi])

  const handleAddNote = useCallback(async () => {
    if (baseDisabled || isCreatingItems) {
      return
    }

    const note = await RichEditPopup.show({
      content: '',
      modalProps: {
        title: t('knowledge.add_note')
      }
    })

    if (!note) {
      return
    }

    await createItemsApi({
      body: {
        items: [
          {
            type: 'note',
            data: { content: note } satisfies NoteItemData
          }
        ]
      }
    })
  }, [baseDisabled, isCreatingItems, t, createItemsApi])

  const handleAddDirectory = useCallback(async () => {
    if (baseDisabled || isCreatingItems) {
      return
    }

    const path = await window.api.file.selectFolder()
    logger.info('Selected directory:', { path })

    if (!path) {
      return
    }

    try {
      const payload = await buildDirectoryPayload(path)

      if (!payload) {
        window.toast.info('No files found in the selected directory.')
        return
      }

      const directoryResult = await createItemsApi({
        body: { items: [payload.directoryItem] }
      })

      const directory = directoryResult.items[0]
      if (!directory) {
        return
      }

      if (payload.childItems.length > 0) {
        try {
          await createItemsApi({
            body: {
              items: payload.childItems.map((item) => ({
                ...item,
                parentId: directory.id
              }))
            }
          })
        } catch (childError) {
          logger.error('Failed to create child items, cleaning up directory container', childError as Error)
          await dataApiService.delete(`/knowledge-items/${directory.id}`)
          throw childError
        }
      }
    } catch (error) {
      logger.error('Failed to add directory via v2 API', error as Error)
      throw error
    }
  }, [baseDisabled, isCreatingItems, createItemsApi])

  const handleAddUrl = useCallback(async () => {
    if (baseDisabled || isCreatingItems) {
      return
    }

    const urlInput = await PromptPopup.show({
      title: t('knowledge.add_url'),
      message: '',
      inputPlaceholder: t('knowledge.url_placeholder'),
      inputProps: {
        rows: 10,
        onPressEnter: () => {}
      }
    })

    if (!urlInput) {
      return
    }

    const urls = urlInput.split('\n').filter((url) => url.trim())

    for (const url of urls) {
      try {
        new URL(url.trim())
        const trimmedUrl = url.trim()
        const hasUrl = urlItems.some((item) => (item.data as UrlItemData).url === trimmedUrl)
        if (!hasUrl) {
          await createItemsApi({
            body: {
              items: [
                {
                  type: 'url',
                  data: { url: trimmedUrl, name: trimmedUrl } satisfies UrlItemData
                }
              ]
            }
          })
        } else {
          window.toast.success(t('knowledge.url_added'))
        }
      } catch {
        continue
      }
    }
  }, [baseDisabled, isCreatingItems, t, urlItems, createItemsApi])

  const handleAddSitemap = useCallback(async () => {
    if (baseDisabled || isCreatingItems) {
      return
    }

    const url = await PromptPopup.show({
      title: t('knowledge.add_sitemap'),
      message: '',
      inputPlaceholder: t('knowledge.sitemap_placeholder'),
      inputProps: {
        maxLength: 1000,
        rows: 1
      }
    })

    if (!url) {
      return
    }

    try {
      new URL(url)
      const hasUrl = sitemapItems.some((item) => (item.data as SitemapItemData).url === url)
      if (hasUrl) {
        window.toast.success(t('knowledge.sitemap_added'))
        return
      }

      await createItemsApi({
        body: {
          items: [
            {
              type: 'sitemap',
              data: { url, name: url } satisfies SitemapItemData
            }
          ]
        }
      })
    } catch {
      logger.error(`Invalid Sitemap URL: ${url}`)
    }
  }, [baseDisabled, isCreatingItems, t, sitemapItems, createItemsApi])

  const actionsByTab = useMemo<Record<TabKey, AddAction>>(
    () => ({
      files: {
        handler: handleAddFile,
        disabled: baseDisabled,
        loading: isSelectingFile || isCreatingItems
      },
      notes: {
        handler: handleAddNote,
        disabled: baseDisabled,
        loading: isCreatingItems
      },
      directories: {
        handler: handleAddDirectory,
        disabled: baseDisabled,
        loading: isCreatingItems
      },
      urls: {
        handler: handleAddUrl,
        disabled: baseDisabled,
        loading: isCreatingItems
      },
      sitemaps: {
        handler: handleAddSitemap,
        disabled: baseDisabled,
        loading: isCreatingItems
      }
    }),
    [
      handleAddFile,
      handleAddNote,
      handleAddDirectory,
      handleAddUrl,
      handleAddSitemap,
      baseDisabled,
      isSelectingFile,
      isCreatingItems
    ]
  )

  return actionsByTab[activeKey]
}
