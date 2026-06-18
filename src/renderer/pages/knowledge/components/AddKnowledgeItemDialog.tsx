import { Dialog, DialogContent } from '@cherrystudio/ui'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileExtension } from '@renderer/utils/file'
import { resolveKnowledgeFileData, resolveKnowledgeFileMetadataEntryData } from '@renderer/utils/knowledgeFileEntry'
import type { KnowledgeAddItemInput } from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts } from '@shared/utils/file'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgePage } from '../KnowledgePageProvider'
import AddKnowledgeItemDialogFooter from './addKnowledgeItemDialog/AddKnowledgeItemDialogFooter'
import AddKnowledgeItemDialogHeader from './addKnowledgeItemDialog/AddKnowledgeItemDialogHeader'
import AddKnowledgeItemDialogSourceTabs from './addKnowledgeItemDialog/AddKnowledgeItemDialogSourceTabs'
import { DEFAULT_SOURCE_TYPE, KNOWLEDGE_ADD_ITEMS_MAX } from './addKnowledgeItemDialog/constants'
import type { NoteItem } from './addKnowledgeItemDialog/types'

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
  }, [activeSource, selectedBaseId, selectedNotes.length, urlValue])

  const buildPanelSubmitItems = useCallback(async (): Promise<KnowledgeAddItemInput[]> => {
    if (activeSource === 'url') {
      const url = urlValue.trim()
      return [{ type: 'url' as const, data: { source: url, url } }]
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
      )
    }

    return []
  }, [activeSource, selectedNotes, urlValue])

  // An interactive batch can be huge (the OS picker has no cap), but add_items rejects
  // oversized batches at the IPC boundary with a generic "Invalid input". Stop them here
  // with a friendly, source-appropriate hint — a toast for direct-pick (no panel), inline
  // otherwise. Returns true when the batch is within the limit and may be submitted.
  const ensureWithinAddLimit = useCallback(
    (items: KnowledgeAddItemInput[]): boolean => {
      if (items.length <= KNOWLEDGE_ADD_ITEMS_MAX) {
        return true
      }
      const message = t('knowledge.data_source.add_dialog.too_many_sources', { count: KNOWLEDGE_ADD_ITEMS_MAX })
      if (directPick) {
        window.toast.warning(message)
      } else {
        setSubmitErrorMessage(message)
      }
      return false
    },
    [directPick, t]
  )

  // 'detect' (first pass) surfaces the conflict dialog when same-name collisions
  // exist; 'rename'/'replace' apply the user's choice. Closes the whole dialog
  // once the batch is actually added.
  const submitWithStrategy = useCallback(
    async (items: KnowledgeAddItemInput[], conflictStrategy: 'detect' | ConflictResolution) => {
      const result = await submitKnowledgeItems(items, conflictStrategy)
      if (result.status === 'conflicts') {
        setPendingConflict({ items, conflicts: result.conflicts })
        return
      }
      handleOpenChange(false)
    },
    [handleOpenChange, submitKnowledgeItems]
  )

  const handleSubmit = useCallback(() => {
    if (!canSubmit || isResolvingSubmit) {
      return
    }

    setSubmitErrorMessage('')
    setIsResolvingSubmit(true)

    void buildPanelSubmitItems()
      .then((items) => {
        if (!ensureWithinAddLimit(items)) {
          return
        }
        return submitWithStrategy(items, 'detect')
      })
      .catch((error) => {
        setSubmitErrorMessage(formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error')))
      })
      .finally(() => {
        setIsResolvingSubmit(false)
      })
  }, [buildPanelSubmitItems, canSubmit, ensureWithinAddLimit, isResolvingSubmit, submitWithStrategy, t])

  // Collect file inputs from the OS picker (or page-level pending files, if any) and submit.
  // Returns null when the user cancels the picker so the caller can close the flow.
  const collectFileInputs = useCallback(async (): Promise<KnowledgeAddItemInput[] | null> => {
    if (pendingAddFiles?.length) {
      const supportedFiles = pendingAddFiles.filter((file) => isSupportedKnowledgeFile(file.name))
      const skippedCount = pendingAddFiles.length - supportedFiles.length
      if (skippedCount > 0) {
        window.toast.warning(t('knowledge.data_source.add_dialog.unsupported_files_skipped', { count: skippedCount }))
      }
      const fileData = await Promise.all(supportedFiles.map(resolveFileEntryDataFromFile))
      return fileData.map((data) => ({ type: 'file' as const, data }))
    }

    const selected = await window.api.file.select({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Knowledge', extensions: knowledgeFilePickerExtensions }]
    })

    if (!selected) {
      return null
    }

    const supportedFiles = selected.filter((file) => isSupportedKnowledgeFile(file.origin_name || file.name))
    const skippedCount = selected.length - supportedFiles.length
    if (skippedCount > 0) {
      window.toast.warning(t('knowledge.data_source.add_dialog.unsupported_files_skipped', { count: skippedCount }))
    }
    const fileData = await Promise.all(supportedFiles.map(resolveKnowledgeFileMetadataEntryData))
    return fileData.map((data) => ({ type: 'file' as const, data }))
  }, [pendingAddFiles, t])

  const collectDirectoryInputs = useCallback(async (): Promise<KnowledgeAddItemInput[] | null> => {
    const directoryPath = await window.api.file.selectFolder()

    if (!directoryPath) {
      return null
    }

    return [{ type: 'directory' as const, data: { source: directoryPath } }]
  }, [])

  // For file/directory sources the menu click should feel like "open the OS picker": fire it once
  // on mount, then submit. A ref guards against the effect running twice (StrictMode / re-renders).
  const directPickStartedRef = useRef(false)
  useEffect(() => {
    if (!open || !directPick || directPickStartedRef.current) {
      return
    }
    directPickStartedRef.current = true

    const run = async () => {
      setIsResolvingSubmit(true)
      try {
        const items = activeSource === 'file' ? await collectFileInputs() : await collectDirectoryInputs()
        // Picker cancelled or nothing selectable — close the (panel-less) flow.
        if (!items || items.length === 0) {
          handleOpenChange(false)
          return
        }
        // Over the per-batch limit: the hint is a toast (no panel), so close afterwards.
        if (!ensureWithinAddLimit(items)) {
          handleOpenChange(false)
          return
        }
        await submitWithStrategy(items, 'detect')
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error')))
        handleOpenChange(false)
      } finally {
        setIsResolvingSubmit(false)
      }
    }

    void run()
  }, [
    activeSource,
    collectDirectoryInputs,
    collectFileInputs,
    directPick,
    ensureWithinAddLimit,
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pe-1">
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
