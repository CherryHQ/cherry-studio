import { Dialog, DialogContent } from '@cherrystudio/ui'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileExtension } from '@renderer/utils/file'
import { resolveKnowledgeFileData, resolveKnowledgeFileMetadataEntryData } from '@renderer/utils/knowledgeFileEntry'
import type { KnowledgeAddItemConflict, KnowledgeAddItemInput, KnowledgeItemType } from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts } from '@shared/utils/file'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useKnowledgePage } from '../KnowledgePageProvider'
import AddKnowledgeItemDialogFooter from './addKnowledgeItemDialog/AddKnowledgeItemDialogFooter'
import AddKnowledgeItemDialogHeader from './addKnowledgeItemDialog/AddKnowledgeItemDialogHeader'
import AddKnowledgeItemDialogSourceTabs from './addKnowledgeItemDialog/AddKnowledgeItemDialogSourceTabs'
import { DEFAULT_SOURCE_TYPE } from './addKnowledgeItemDialog/constants'
import KnowledgeAddConflictDialog from './addKnowledgeItemDialog/KnowledgeAddConflictDialog'
import type { NoteItem } from './addKnowledgeItemDialog/types'

type ConflictResolution = 'rename' | 'replace'

interface PendingConflictState {
  items: KnowledgeAddItemInput[]
  conflicts: KnowledgeAddItemConflict[]
}

interface AddKnowledgeItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// `file` and `directory` skip the in-dialog panel entirely: clicking the menu item opens the OS
// picker directly and submits the selection. Only `note` / `url` still render the dialog panel.
const isDirectPickSource = (source: KnowledgeItemType) => source === 'file' || source === 'directory'

const knowledgeSupportedFileExtSet = new Set<string>(knowledgeSupportedFileExts)
// Electron's open-dialog `filters` want bare extensions (no leading dot); the set above keeps the
// dots for the post-pick safety filter.
const knowledgeFilePickerExtensions = knowledgeSupportedFileExts.map((ext) => ext.replace(/^\./, ''))

const isSupportedKnowledgeFile = (fileName: string) => knowledgeSupportedFileExtSet.has(getFileExtension(fileName))

const resolveFileEntryDataFromFile = (file: File) => {
  const filePath = window.api.file.getPathForFile(file)

  if (!filePath) {
    return Promise.reject(new Error(`Failed to resolve a local path for "${file.name}"`))
  }

  return resolveKnowledgeFileData(filePath, file.name)
}

const AddKnowledgeItemDialog = ({ open, onOpenChange }: AddKnowledgeItemDialogProps) => {
  const { t } = useTranslation()
  const { selectedBaseId, pendingAddSource, pendingAddFiles } = useKnowledgePage()
  // The dialog mounts fresh per open (the section conditionally renders it), so the requested
  // source is fixed for this lifetime — derive it instead of mirroring it into state.
  const activeSource = pendingAddSource ?? DEFAULT_SOURCE_TYPE
  const directPick = isDirectPickSource(activeSource)

  const [selectedNotes, setSelectedNotes] = useState<NoteItem[]>([])
  const [urlValue, setUrlValue] = useState('')
  const [submitErrorMessage, setSubmitErrorMessage] = useState('')
  const [isResolvingSubmit, setIsResolvingSubmit] = useState(false)
  const [pendingConflict, setPendingConflict] = useState<PendingConflictState | null>(null)
  const [pendingResolution, setPendingResolution] = useState<ConflictResolution | null>(null)
  const { submit: submitKnowledgeItems, isSubmitting: isSubmittingItems } = useAddKnowledgeItems(selectedBaseId)

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const handleNoteToggle = useCallback((note: NoteItem) => {
    setSubmitErrorMessage('')
    setSelectedNotes((currentNotes) =>
      currentNotes.some((selected) => selected.externalPath === note.externalPath)
        ? currentNotes.filter((selected) => selected.externalPath !== note.externalPath)
        : [...currentNotes, note]
    )
  }, [])

  const canSubmit = useMemo(() => {
    if (!selectedBaseId) {
      return false
    }

    switch (activeSource) {
      case 'url':
        return urlValue.trim().length > 0
      case 'note':
        return selectedNotes.length > 0
      default:
        return false
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
      .then((items) => submitWithStrategy(items, 'detect'))
      .catch((error) => {
        setSubmitErrorMessage(formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error')))
      })
      .finally(() => {
        setIsResolvingSubmit(false)
      })
  }, [buildPanelSubmitItems, canSubmit, isResolvingSubmit, submitWithStrategy, t])

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
    handleOpenChange,
    open,
    submitWithStrategy,
    t
  ])

  const handleConflictResolve = useCallback(
    (resolution: ConflictResolution) => {
      if (!pendingConflict) {
        return
      }

      setPendingResolution(resolution)
      void submitWithStrategy(pendingConflict.items, resolution)
        .catch((error) => {
          setPendingConflict(null)
          const message = formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error'))
          // Direct-pick sources have no panel to fall back to, so report inline (toast) and close.
          if (directPick) {
            window.toast.error(message)
            handleOpenChange(false)
          } else {
            setSubmitErrorMessage(message)
          }
        })
        .finally(() => {
          setPendingResolution(null)
        })
    },
    [directPick, handleOpenChange, pendingConflict, submitWithStrategy, t]
  )

  const handleConflictCancel = useCallback(() => {
    setPendingConflict(null)
    // No panel exists behind a direct-pick conflict, so cancelling ends the whole flow.
    if (directPick) {
      handleOpenChange(false)
    }
  }, [directPick, handleOpenChange])

  const isSubmitting = isResolvingSubmit || isSubmittingItems

  return (
    <>
      {directPick ? null : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent size="lg" className="flex max-h-[70vh] flex-col overflow-hidden">
            <AddKnowledgeItemDialogHeader title={t('knowledge.data_source.add_dialog.title')} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-1">
              <AddKnowledgeItemDialogSourceTabs
                activeSource={activeSource}
                selectedNotes={selectedNotes}
                urlValue={urlValue}
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
              selectedNoteCount={selectedNotes.length}
              onSubmit={handleSubmit}
            />
          </DialogContent>
        </Dialog>
      )}
      <KnowledgeAddConflictDialog
        open={pendingConflict !== null}
        conflicts={pendingConflict?.conflicts ?? []}
        pendingResolution={pendingResolution}
        onResolve={handleConflictResolve}
        onCancel={handleConflictCancel}
      />
    </>
  )
}

export default AddKnowledgeItemDialog
