import { Dialog, DialogContent } from '@cherrystudio/ui'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileExtension } from '@renderer/utils/file'
import { resolveKnowledgeFileData } from '@renderer/utils/knowledgeFileEntry'
import { knowledgeSupportedFileExts } from '@shared/config/constant'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgePage } from '../KnowledgePageProvider'
import AddKnowledgeItemDialogFooter from './addKnowledgeItemDialog/AddKnowledgeItemDialogFooter'
import AddKnowledgeItemDialogHeader from './addKnowledgeItemDialog/AddKnowledgeItemDialogHeader'
import AddKnowledgeItemDialogSourceTabs from './addKnowledgeItemDialog/AddKnowledgeItemDialogSourceTabs'
import { DEFAULT_SOURCE_TYPE } from './addKnowledgeItemDialog/constants'
import type { DirectoryItem, DropzoneOnDrop, NoteItem } from './addKnowledgeItemDialog/types'

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

  return resolveKnowledgeFileData(filePath, file.name)
}

const knowledgeSupportedFileExtSet = new Set<string>(knowledgeSupportedFileExts)

const filterSupportedKnowledgeFiles = (files: File[]) =>
  files.filter((file) => knowledgeSupportedFileExtSet.has(getFileExtension(file.name)))

// Dedupe the in-dialog selection by each file's on-disk path. Two files that share a name
// but live in different folders are distinct sources and must both be addable (the backend
// auto-renames same-named files on disk via reserveImportedFileRelativePath); only the exact
// same file dropped twice collapses to one. Keying by name+size+lastModified instead wrongly
// dropped a copy of the same file living in another folder.
const getSelectedFileKey = (file: File) => window.api.file.getPathForFile(file)

const AddKnowledgeItemDialog = ({ open, onOpenChange }: AddKnowledgeItemDialogProps) => {
  const { t } = useTranslation()
  const { selectedBaseId, pendingAddSource, pendingAddFiles } = useKnowledgePage()
  const [activeSource, setActiveSource] = useState(DEFAULT_SOURCE_TYPE)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedDirectories, setSelectedDirectories] = useState<DirectoryItem[]>([])
  const [selectedNotes, setSelectedNotes] = useState<NoteItem[]>([])
  const [urlValue, setUrlValue] = useState('')
  const [submitErrorMessage, setSubmitErrorMessage] = useState('')
  const [isResolvingSubmit, setIsResolvingSubmit] = useState(false)
  const { submit: submitKnowledgeItems, isSubmitting: isSubmittingItems } = useAddKnowledgeItems(selectedBaseId)

  const resetDialogState = useCallback(() => {
    setActiveSource(DEFAULT_SOURCE_TYPE)
    setSelectedFiles([])
    setSelectedDirectories([])
    setSelectedNotes([])
    setUrlValue('')
    setSubmitErrorMessage('')
    setIsResolvingSubmit(false)
  }, [])

  const handleFileDrop = useCallback<DropzoneOnDrop>(
    (acceptedFiles) => {
      setSubmitErrorMessage('')
      const supportedFiles = filterSupportedKnowledgeFiles(acceptedFiles)
      // The dropzone has no `accept` filter, so every dropped/picked file reaches us here and the
      // extension allow-list is the single gate. Surface the dropped-minus-kept delta so the user
      // learns nothing was silently skipped (matching the page-level pending-files entry point).
      const skippedCount = acceptedFiles.length - supportedFiles.length
      if (skippedCount > 0) {
        window.toast.warning(t('knowledge.data_source.add_dialog.unsupported_files_skipped', { count: skippedCount }))
      }
      setSelectedFiles((currentFiles) => {
        const existingKeys = new Set(currentFiles.map(getSelectedFileKey))
        const newFiles = supportedFiles.filter((file) => !existingKeys.has(getSelectedFileKey(file)))
        return [...currentFiles, ...newFiles]
      })
    },
    [t]
  )

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

  const handleNoteToggle = useCallback((note: NoteItem) => {
    setSubmitErrorMessage('')
    setSelectedNotes((currentNotes) =>
      currentNotes.some((selected) => selected.externalPath === note.externalPath)
        ? currentNotes.filter((selected) => selected.externalPath !== note.externalPath)
        : [...currentNotes, note]
    )
  }, [])

  useEffect(() => {
    if (!open) {
      resetDialogState()
      return
    }

    if (pendingAddFiles?.length) {
      setActiveSource('file')
      const supportedFiles = filterSupportedKnowledgeFiles(pendingAddFiles)
      const skippedCount = pendingAddFiles.length - supportedFiles.length
      if (skippedCount > 0) {
        window.toast.warning(t('knowledge.data_source.add_dialog.unsupported_files_skipped', { count: skippedCount }))
      }
      setSelectedFiles(supportedFiles)
      return
    }

    if (pendingAddSource) {
      setActiveSource(pendingAddSource)
    }
  }, [open, pendingAddFiles, pendingAddSource, resetDialogState, t])

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
        return selectedNotes.length > 0
    }
  }, [activeSource, selectedBaseId, selectedDirectories.length, selectedFiles.length, selectedNotes.length, urlValue])

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

      if (activeSource === 'note') {
        return Promise.all(
          selectedNotes.map(async (note) => {
            // Name the note in the failure so a read error (e.g. it was moved or
            // deleted while the dialog was open) points at the specific source.
            const content = await window.api.file.readExternal(note.externalPath).catch((cause) => {
              throw new Error(`${note.name}: ${cause instanceof Error ? cause.message : String(cause)}`)
            })
            return { type: 'note' as const, data: { source: note.name, content } }
          })
        ).then((items) => submitKnowledgeItems(items))
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
    selectedNotes,
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
            selectedNotes={selectedNotes}
            urlValue={urlValue}
            onDirectoryRemove={handleDirectoryRemove}
            onDirectorySelect={handleDirectorySelect}
            onFileDrop={handleFileDrop}
            onFileRemove={handleFileRemove}
            onNoteToggle={handleNoteToggle}
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
          selectedNoteCount={selectedNotes.length}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default AddKnowledgeItemDialog
