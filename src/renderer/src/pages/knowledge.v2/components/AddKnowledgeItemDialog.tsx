import { Dialog, DialogContent } from '@cherrystudio/ui'
import type { FileMetadata } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAddKnowledgeItems } from '../hooks/useAddKnowledgeItems'
import { useKnowledgePage } from '../KnowledgePageProvider'
import AddKnowledgeItemDialogFooter from './addKnowledgeItemDialog/AddKnowledgeItemDialogFooter'
import AddKnowledgeItemDialogHeader from './addKnowledgeItemDialog/AddKnowledgeItemDialogHeader'
import AddKnowledgeItemDialogSourceTabs from './addKnowledgeItemDialog/AddKnowledgeItemDialogSourceTabs'
import { DEFAULT_SOURCE_TYPE } from './addKnowledgeItemDialog/constants'
import type { DirectoryItem, DropzoneOnDrop } from './addKnowledgeItemDialog/types'

interface AddKnowledgeItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const getDirectoryName = (directoryPath: string) => {
  const normalizedPath = directoryPath.replace(/[/\\]+$/, '')
  const name = normalizedPath.split(/[/\\]/).pop()?.trim()

  return name || normalizedPath || directoryPath
}

const resolveFilePath = (file: File): string | Error => {
  const filePath = window.api.file.getPathForFile(file)

  if (!filePath) {
    return new Error(`Failed to resolve a local path for "${file.name}"`)
  }

  return filePath
}

const resolveFileMetadata = async (file: File): Promise<FileMetadata> => {
  const filePath = resolveFilePath(file)

  if (filePath instanceof Error) {
    return Promise.reject(filePath)
  }

  const metadata = await window.api.file.get(filePath)

  if (!metadata) {
    return Promise.reject(new Error(`Failed to read file metadata for "${file.name}"`))
  }

  return metadata
}

const AddKnowledgeItemDialog = ({ open, onOpenChange }: AddKnowledgeItemDialogProps) => {
  const { t } = useTranslation()
  const { selectedBaseId } = useKnowledgePage()
  const [activeSource, setActiveSource] = useState(DEFAULT_SOURCE_TYPE)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedDirectories, setSelectedDirectories] = useState<DirectoryItem[]>([])
  const [urlValue, setUrlValue] = useState('')
  const [sitemapValue, setSitemapValue] = useState('')
  const [submitErrorMessage, setSubmitErrorMessage] = useState('')
  const { submit: submitKnowledgeItems, isSubmitting: isSubmittingItems } = useAddKnowledgeItems(selectedBaseId)

  const resetDialogState = useCallback(() => {
    setActiveSource(DEFAULT_SOURCE_TYPE)
    setSelectedFiles([])
    setSelectedDirectories([])
    setUrlValue('')
    setSitemapValue('')
    setSubmitErrorMessage('')
  }, [])

  const handleFileDrop = useCallback<DropzoneOnDrop>((acceptedFiles) => {
    setSubmitErrorMessage('')
    setSelectedFiles(acceptedFiles)
  }, [])

  const handleDirectorySelect = useCallback(async () => {
    setSubmitErrorMessage('')
    const directoryPath = await window.api.file.selectFolder()

    if (!directoryPath) {
      return
    }

    setSelectedDirectories((currentDirectories) => {
      if (currentDirectories.some((directory) => directory.path === directoryPath)) {
        return currentDirectories
      }

      return [
        ...currentDirectories,
        {
          name: getDirectoryName(directoryPath),
          path: directoryPath
        }
      ]
    })
  }, [])

  const handleFileRemove = useCallback((fileIndex: number) => {
    setSubmitErrorMessage('')
    setSelectedFiles((currentFiles) => currentFiles.filter((_, index) => index !== fileIndex))
  }, [])

  const handleDirectoryRemove = useCallback((directoryPath: string) => {
    setSubmitErrorMessage('')
    setSelectedDirectories((currentDirectories) =>
      currentDirectories.filter((directory) => directory.path !== directoryPath)
    )
  }, [])

  useEffect(() => {
    if (!open) {
      resetDialogState()
    }
  }, [open, resetDialogState])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetDialogState()
      }

      onOpenChange(nextOpen)
    },
    [onOpenChange, resetDialogState]
  )

  const canSubmit = useMemo(() => {
    if (!selectedBaseId) {
      return false
    }

    switch (activeSource) {
      case 'file':
        return selectedFiles.length > 0
      case 'directory':
        return selectedDirectories.length > 0
      case 'url':
        return urlValue.trim().length > 0
      case 'sitemap':
        return sitemapValue.trim().length > 0
      case 'note':
        return false
    }
  }, [activeSource, selectedBaseId, selectedDirectories.length, selectedFiles.length, sitemapValue, urlValue])

  const handleSubmit = useCallback(() => {
    if (!canSubmit) {
      return
    }

    setSubmitErrorMessage('')

    const submitPromise = (() => {
      if (activeSource === 'file') {
        return Promise.all(selectedFiles.map(resolveFileMetadata)).then((files) =>
          submitKnowledgeItems(
            files.map((file) => ({
              type: 'file' as const,
              data: {
                source: file.path || file.origin_name || file.name,
                file
              }
            }))
          )
        )
      }

      if (activeSource === 'directory') {
        return submitKnowledgeItems(
          selectedDirectories.map((directory) => ({
            type: 'directory' as const,
            data: {
              source: directory.path,
              path: directory.path
            }
          }))
        )
      }

      if (activeSource === 'url') {
        const url = urlValue.trim()
        return submitKnowledgeItems([
          {
            type: 'url' as const,
            data: {
              source: url,
              url
            }
          }
        ])
      }

      if (activeSource === 'sitemap') {
        const url = sitemapValue.trim()
        return submitKnowledgeItems([
          {
            type: 'sitemap' as const,
            data: {
              source: url,
              url
            }
          }
        ])
      }

      return Promise.resolve()
    })()

    void submitPromise
      .then(() => {
        handleOpenChange(false)
      })
      .catch((error) => {
        setSubmitErrorMessage(
          formatErrorMessageWithPrefix(error, t('knowledge_v2.data_source.add_dialog.submit.error'))
        )
      })
  }, [
    activeSource,
    canSubmit,
    handleOpenChange,
    selectedDirectories,
    selectedFiles,
    sitemapValue,
    submitKnowledgeItems,
    t,
    urlValue
  ])

  const isSubmitting = isSubmittingItems

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="z-401 max-h-[70vh] w-100 max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[14px] border-border bg-popover p-0 shadow-2xl">
        <AddKnowledgeItemDialogHeader
          title={t('knowledge_v2.data_source.add_dialog.title')}
          closeLabel={t('common.close')}
        />
        <AddKnowledgeItemDialogSourceTabs
          activeSource={activeSource}
          selectedDirectories={selectedDirectories}
          selectedFiles={selectedFiles}
          sitemapValue={sitemapValue}
          urlValue={urlValue}
          onDirectoryRemove={handleDirectoryRemove}
          onDirectorySelect={handleDirectorySelect}
          onFileDrop={handleFileDrop}
          onFileRemove={handleFileRemove}
          onSourceChange={setActiveSource}
          onSitemapValueChange={(value) => {
            setSubmitErrorMessage('')
            setSitemapValue(value)
          }}
          onUrlValueChange={(value) => {
            setSubmitErrorMessage('')
            setUrlValue(value)
          }}
        />
        <AddKnowledgeItemDialogFooter
          activeSource={activeSource}
          canSubmit={canSubmit}
          errorMessage={submitErrorMessage}
          isSubmitting={isSubmitting}
          selectedDirectoryCount={selectedDirectories.length}
          selectedFileCount={selectedFiles.length}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default AddKnowledgeItemDialog
