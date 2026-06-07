import { Dialog, DialogContent } from '@cherrystudio/ui'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { resolveKnowledgeFileEntryData } from '@renderer/utils/knowledgeFileEntry'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

const resolveSelectedFileEntryData = async (file: File) => {
  const filePath = resolveFilePath(file)

  if (filePath instanceof Error) {
    return Promise.reject(filePath)
  }

  return resolveKnowledgeFileEntryData(filePath, file.name)
}

const AddKnowledgeItemDialog = ({ open, onOpenChange }: AddKnowledgeItemDialogProps) => {
  const { t } = useTranslation()
  const { selectedBaseId, pendingAddSource, pendingAddFiles } = useKnowledgePage()
  const [activeSource, setActiveSource] = useState(DEFAULT_SOURCE_TYPE)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedDirectories, setSelectedDirectories] = useState<DirectoryItem[]>([])
  const [urlValue, setUrlValue] = useState('')
  const [submitErrorMessage, setSubmitErrorMessage] = useState('')
  const [isResolvingSubmit, setIsResolvingSubmit] = useState(false)
  const { submit: submitKnowledgeItems, isSubmitting: isSubmittingItems } = useAddKnowledgeItems(selectedBaseId)

  const resetDialogState = useCallback(() => {
    setActiveSource(DEFAULT_SOURCE_TYPE)
    setSelectedFiles([])
    setSelectedDirectories([])
    setUrlValue('')
    setSubmitErrorMessage('')
    setIsResolvingSubmit(false)
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
      return
    }

    if (pendingAddFiles?.length) {
      setActiveSource('file')
      setSelectedFiles(pendingAddFiles)
      return
    }

    if (pendingAddSource) {
      setActiveSource(pendingAddSource)
    }
  }, [open, pendingAddFiles, pendingAddSource, resetDialogState])

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
      case 'note':
        return false
    }
  }, [activeSource, selectedBaseId, selectedDirectories.length, selectedFiles.length, urlValue])

  const handleSubmit = useCallback(() => {
    if (!canSubmit || isResolvingSubmit) {
      return
    }

    setSubmitErrorMessage('')
    setIsResolvingSubmit(true)

    const submitPromise = (() => {
      if (activeSource === 'file') {
        return Promise.all(selectedFiles.map(resolveSelectedFileEntryData)).then((fileData) =>
          submitKnowledgeItems(
            fileData.map((data) => ({
              type: 'file' as const,
              data
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

      return Promise.resolve()
    })()

    void submitPromise
      .then(() => {
        handleOpenChange(false)
      })
      .catch((error) => {
        setSubmitErrorMessage(formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error')))
      })
      .finally(() => {
        setIsResolvingSubmit(false)
      })
  }, [
    activeSource,
    canSubmit,
    handleOpenChange,
    isResolvingSubmit,
    selectedDirectories,
    selectedFiles,
    submitKnowledgeItems,
    t,
    urlValue
  ])

  const isSubmitting = isResolvingSubmit || isSubmittingItems

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" className="flex max-h-[70vh] flex-col overflow-hidden">
        <AddKnowledgeItemDialogHeader title={t('knowledge.data_source.add_dialog.title')} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-1">
          <AddKnowledgeItemDialogSourceTabs
            activeSource={activeSource}
            selectedDirectories={selectedDirectories}
            selectedFiles={selectedFiles}
            urlValue={urlValue}
            onDirectoryRemove={handleDirectoryRemove}
            onDirectorySelect={handleDirectorySelect}
            onFileDrop={handleFileDrop}
            onFileRemove={handleFileRemove}
            onUrlValueChange={(value) => {
              setSubmitErrorMessage('')
              setUrlValue(value)
            }}
          />
        </div>
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
