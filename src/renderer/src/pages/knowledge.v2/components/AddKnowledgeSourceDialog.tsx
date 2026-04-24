import { Dialog, DialogContent } from '@cherrystudio/ui'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAddKnowledgeSourceFile } from '../hooks/useAddKnowledgeSourceFile'
import { useKnowledgePage } from '../KnowledgePageProvider'
import AddKnowledgeSourceDialogFooter from './addKnowledgeSourceDialog/AddKnowledgeSourceDialogFooter'
import AddKnowledgeSourceDialogHeader from './addKnowledgeSourceDialog/AddKnowledgeSourceDialogHeader'
import AddKnowledgeSourceSourceTabs from './addKnowledgeSourceDialog/AddKnowledgeSourceSourceTabs'
import { DEFAULT_SOURCE_TYPE } from './addKnowledgeSourceDialog/constants'
import type { DirectoryItem, DropzoneOnDrop } from './addKnowledgeSourceDialog/types'
import { buildDirectoryItems } from './addKnowledgeSourceDialog/utils/buildDirectoryItems'

interface AddKnowledgeSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const AddKnowledgeSourceDialog = ({ open, onOpenChange }: AddKnowledgeSourceDialogProps) => {
  const { t } = useTranslation()
  const { selectedBaseId } = useKnowledgePage()
  const [activeSource, setActiveSource] = useState(DEFAULT_SOURCE_TYPE)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedDirectories, setSelectedDirectories] = useState<DirectoryItem[]>([])
  const { submit: submitFileSource, isSubmitting } = useAddKnowledgeSourceFile(selectedBaseId, selectedFiles)

  const resetDialogState = useCallback(() => {
    setActiveSource(DEFAULT_SOURCE_TYPE)
    setSelectedFiles([])
    setSelectedDirectories([])
  }, [])

  const handleFileDrop = useCallback<DropzoneOnDrop>((acceptedFiles) => {
    setSelectedFiles(acceptedFiles)
  }, [])

  const handleDirectoryDrop = useCallback<DropzoneOnDrop>((acceptedFiles) => {
    setSelectedDirectories(buildDirectoryItems(acceptedFiles))
  }, [])

  const handleFileRemove = useCallback((fileIndex: number) => {
    setSelectedFiles((currentFiles) => currentFiles.filter((_, index) => index !== fileIndex))
  }, [])

  const handleDirectoryRemove = useCallback((directoryName: string) => {
    setSelectedDirectories((currentDirectories) =>
      currentDirectories.filter((directory) => directory.name !== directoryName)
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

  const canSubmit = activeSource === 'file' && selectedFiles.length > 0 && Boolean(selectedBaseId)

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      return
    }

    try {
      await submitFileSource()
      window.toast.success(
        t('knowledge_v2.data_source.add_dialog.submit.success', {
          defaultValue: '文件已添加到知识库'
        })
      )
      handleOpenChange(false)
    } catch (error) {
      window.toast.error(
        formatErrorMessageWithPrefix(
          error,
          t('knowledge_v2.data_source.add_dialog.submit.error', {
            defaultValue: '添加文件数据源失败'
          })
        )
      )
    }
  }, [canSubmit, handleOpenChange, submitFileSource, t])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="z-401 max-h-[70vh] w-100 max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[14px] border-border bg-popover p-0 shadow-2xl">
        <AddKnowledgeSourceDialogHeader
          title={t('knowledge_v2.data_source.add_dialog.title')}
          closeLabel={t('common.close')}
        />
        <AddKnowledgeSourceSourceTabs
          activeSource={activeSource}
          selectedDirectories={selectedDirectories}
          selectedFiles={selectedFiles}
          onDirectoryDrop={handleDirectoryDrop}
          onDirectoryRemove={handleDirectoryRemove}
          onFileDrop={handleFileDrop}
          onFileRemove={handleFileRemove}
          onSourceChange={setActiveSource}
        />
        <AddKnowledgeSourceDialogFooter
          activeSource={activeSource}
          canSubmit={canSubmit}
          isSubmitting={isSubmitting}
          selectedDirectoryCount={selectedDirectories.length}
          selectedFileCount={selectedFiles.length}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default AddKnowledgeSourceDialog
