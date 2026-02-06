/**
 * Centralized hook for knowledge item add actions.
 * Consolidates all add logic from individual item components.
 */

import { loggerService } from '@logger'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { useFiles } from '@renderer/hooks/useFiles'
import {
  useKnowledgeDirectories,
  useKnowledgeFiles,
  useKnowledgeNotes,
  useKnowledgeSitemaps,
  useKnowledgeUrls
} from '@renderer/hooks/useKnowledge'
import FileManager from '@renderer/services/FileManager'
import { bookExts, documentExts, textExts, thirdPartyApplicationExts } from '@shared/config/constant'
import type { KnowledgeBase, SitemapItemData, UrlItemData } from '@shared/data/types/knowledge'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TabKey } from './useKnowledgeTabs'

const logger = loggerService.withContext('useKnowledgeAddActions')

const fileTypes = [...bookExts, ...thirdPartyApplicationExts, ...documentExts, ...textExts]

interface UseKnowledgeAddActionsArgs {
  base: KnowledgeBase | null
}

interface AddAction {
  handler: () => Promise<void>
  disabled: boolean
  loading: boolean
}

type AddActions = Record<TabKey, AddAction>

export const useKnowledgeAddActions = ({ base }: UseKnowledgeAddActionsArgs): AddActions => {
  const { t } = useTranslation()
  const baseId = base?.id || ''

  // Common disabled state - V2 bases are valid when they have an embeddingModelId
  const baseDisabled = !base?.embeddingModelId

  // Hooks for each type
  const { addFiles, isAddingFiles } = useKnowledgeFiles(baseId)
  const { addNote, isAddingNote } = useKnowledgeNotes(baseId)
  const { addDirectory, isAddingDirectory } = useKnowledgeDirectories(baseId)
  const { urlItems, addUrl, isAddingUrl } = useKnowledgeUrls(baseId)
  const { sitemapItems, addSitemap, isAddingSitemap } = useKnowledgeSitemaps(baseId)

  // File selection hook
  const { onSelectFile, selecting: isSelectingFile } = useFiles({ extensions: fileTypes })

  // File add handler
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
      addFiles(uploadedFiles)
    } catch (error) {
      logger.error('handleAddFile:failed', error as Error, {
        baseId,
        durationMs: Date.now() - startedAt
      })
      throw error
    }
  }, [baseDisabled, isSelectingFile, onSelectFile, baseId, addFiles])

  // Note add handler
  const handleAddNote = useCallback(async () => {
    if (baseDisabled || isAddingNote) {
      return
    }

    const note = await RichEditPopup.show({
      content: '',
      modalProps: {
        title: t('knowledge.add_note')
      }
    })
    note && addNote(note)
  }, [baseDisabled, isAddingNote, t, addNote])

  // Directory add handler
  const handleAddDirectory = useCallback(async () => {
    if (baseDisabled || isAddingDirectory) {
      return
    }

    const path = await window.api.file.selectFolder()
    logger.info('Selected directory:', { path })
    path && addDirectory(path)
  }, [baseDisabled, isAddingDirectory, addDirectory])

  // URL add handler
  const handleAddUrl = useCallback(async () => {
    if (baseDisabled || isAddingUrl) {
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

    if (urlInput) {
      // Split input by newlines and filter out empty lines
      const urls = urlInput.split('\n').filter((url) => url.trim())

      for (const url of urls) {
        try {
          new URL(url.trim())
          const trimmedUrl = url.trim()
          const hasUrl = urlItems.some((item) => (item.data as UrlItemData).url === trimmedUrl)
          if (!hasUrl) {
            addUrl(trimmedUrl)
          } else {
            window.toast.success(t('knowledge.url_added'))
          }
        } catch (e) {
          // Skip invalid URLs silently
          continue
        }
      }
    }
  }, [baseDisabled, isAddingUrl, t, urlItems, addUrl])

  // Sitemap add handler
  const handleAddSitemap = useCallback(async () => {
    if (baseDisabled || isAddingSitemap) {
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

    if (url) {
      try {
        new URL(url)
        const hasUrl = sitemapItems.some((item) => (item.data as SitemapItemData).url === url)
        if (hasUrl) {
          window.toast.success(t('knowledge.sitemap_added'))
          return
        }
        addSitemap(url)
      } catch (e) {
        logger.error(`Invalid Sitemap URL: ${url}`)
      }
    }
  }, [baseDisabled, isAddingSitemap, t, sitemapItems, addSitemap])

  return useMemo(
    () => ({
      files: {
        handler: handleAddFile,
        disabled: baseDisabled,
        loading: isSelectingFile || isAddingFiles
      },
      notes: {
        handler: handleAddNote,
        disabled: baseDisabled,
        loading: isAddingNote
      },
      directories: {
        handler: handleAddDirectory,
        disabled: baseDisabled,
        loading: isAddingDirectory
      },
      urls: {
        handler: handleAddUrl,
        disabled: baseDisabled,
        loading: isAddingUrl
      },
      sitemaps: {
        handler: handleAddSitemap,
        disabled: baseDisabled,
        loading: isAddingSitemap
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
      isAddingFiles,
      isAddingNote,
      isAddingDirectory,
      isAddingUrl,
      isAddingSitemap
    ]
  )
}
