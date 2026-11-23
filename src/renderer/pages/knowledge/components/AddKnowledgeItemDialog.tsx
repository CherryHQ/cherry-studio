import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent } from '@cherrystudio/ui'
import { useExitPresence } from '@renderer/hooks/useExitPresence'
import { useAddKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import {
  type KnowledgeFileItemData,
  resolveFileEntryDataFromFile,
  resolveKnowledgeFileBatch,
  resolveKnowledgeFileMetadataEntryData,
  selectKnowledgeFileBatchOutcome
} from '@renderer/utils/knowledgeFileEntry'
import type { KnowledgeFilePreflight } from '@shared/data/presets/knowledgeFormats'
import type { KnowledgeAddItemConflict, KnowledgeAddItemInput, KnowledgeItemType } from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts } from '@shared/utils/file'

import { useKnowledgePage } from '../KnowledgePageProvider'
import { type KnowledgeUrlEntry, parseKnowledgeUrls } from '../utils/parseKnowledgeUrls'
import AddKnowledgeItemDialogFooter from './addKnowledgeItemDialog/AddKnowledgeItemDialogFooter'
import AddKnowledgeItemDialogHeader from './addKnowledgeItemDialog/AddKnowledgeItemDialogHeader'
import AddKnowledgeItemDialogSourceTabs from './addKnowledgeItemDialog/AddKnowledgeItemDialogSourceTabs'
import { DEFAULT_SOURCE_TYPE } from './addKnowledgeItemDialog/constants'
import KnowledgeAddConflictDialog from './addKnowledgeItemDialog/KnowledgeAddConflictDialog'
import { KnowledgeFilePreflightDialog } from './addKnowledgeItemDialog/KnowledgeFilePreflightDialog'
import type { NoteDraft, NoteItem, NoteSourceMode } from './addKnowledgeItemDialog/types'

type ConflictResolution = 'rename' | 'replace'

interface PendingConflictState {
  items: KnowledgeAddItemInput[]
  conflicts: KnowledgeAddItemConflict[]
  invalid?: KnowledgeUrlEntry[]
}

interface AddKnowledgeItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// `file` and `directory` skip the in-dialog panel entirely: clicking the menu item opens the OS
// picker directly and submits the selection. Only `note` / `url` still render the dialog panel.
const isDirectPickSource = (source: KnowledgeItemType) => source === 'file' || source === 'directory'

// Electron file filters use bare extensions; Main repeats actual admission checks.
const knowledgeFilePickerExtensions = knowledgeSupportedFileExts.map((ext) => ext.replace(/^\./, ''))

const describeFileMetadata = (file: { origin_name?: string; name?: string }) => file.origin_name || file.name

const AddKnowledgeItemDialog = ({ open, onOpenChange }: AddKnowledgeItemDialogProps) => {
  const { t } = useTranslation()
  const { selectedBaseId, pendingAddSource, pendingAddFiles, pendingAddDirectoryPaths, openRagConfigDrawer } =
    useKnowledgePage()
  const source = useExitPresence(open ? (pendingAddSource ?? DEFAULT_SOURCE_TYPE) : null)
  const activeSource = source.value ?? DEFAULT_SOURCE_TYPE
  const directPick = isDirectPickSource(activeSource)

  const [noteMode, setNoteMode] = useState<NoteSourceMode>('import')
  const [selectedNotes, setSelectedNotes] = useState<NoteItem[]>([])
  const [noteDraft, setNoteDraft] = useState<NoteDraft>({ title: '', content: '' })
  const [urlValue, setUrlValue] = useState('')
  const parsedUrls = useMemo(() => parseKnowledgeUrls(urlValue), [urlValue])
  const [urlAcceptedCount, setUrlAcceptedCount] = useState<number | null>(null)
  const [submitErrorMessage, setSubmitErrorMessage] = useState('')
  const [isResolvingSubmit, setIsResolvingSubmit] = useState(false)
  const [pendingConflict, setPendingConflict] = useState<PendingConflictState | null>(null)
  const conflict = useExitPresence(open ? pendingConflict : null)
  const [pendingResolution, setPendingResolution] = useState<ConflictResolution | null>(null)
  const { submit: submitKnowledgeItems, isSubmitting: isSubmittingItems } = useAddKnowledgeItems(selectedBaseId)
  const sessionRef = useRef(0)
  const [preflightResults, setPreflightResults] = useState<KnowledgeFilePreflight[] | null>(null)
  const preflightResolve = useRef<((proceed: boolean) => void) | null>(null)
  const finishPreflight = useCallback((proceed: boolean) => {
    preflightResolve.current?.(proceed)
    preflightResolve.current = null
    setPreflightResults(null)
  }, [])
  useEffect(
    () => () => {
      preflightResolve.current?.(false)
    },
    []
  )

  useEffect(() => {
    sessionRef.current += 1
    finishPreflight(false)
    if (open && pendingAddSource === 'url') {
      setIsResolvingSubmit(false)
    }
  }, [open, pendingAddSource, selectedBaseId, finishPreflight])

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

  const handleNoteSelectionChange = useCallback((notes: NoteItem[]) => {
    setSubmitErrorMessage('')
    setSelectedNotes(notes)
  }, [])

  const handleNoteModeChange = useCallback((mode: NoteSourceMode) => {
    setSubmitErrorMessage('')
    setNoteMode(mode)
  }, [])

  // Title and content update independently so neither handler closes over the draft;
  // see the note on NoteCreateContent's props.
  const handleNoteDraftTitleChange = useCallback((title: string) => {
    setSubmitErrorMessage('')
    setNoteDraft((current) => ({ ...current, title }))
  }, [])

  const handleNoteDraftContentChange = useCallback((content: string) => {
    setSubmitErrorMessage('')
    setNoteDraft((current) => ({ ...current, content }))
  }, [])

  const isSubmitting = isResolvingSubmit || isSubmittingItems

  const canSubmit = useMemo(() => {
    if (!selectedBaseId || isSubmitting) {
      return false
    }

    switch (activeSource) {
      case 'url':
        return parsedUrls.valid.length > 0
      case 'note':
        // A drafted note needs both halves: the title becomes the item's `source`
        // (schema-required, non-empty) and empty content indexes to nothing.
        return noteMode === 'create'
          ? noteDraft.title.trim().length > 0 && noteDraft.content.trim().length > 0
          : selectedNotes.length > 0
      default:
        return false
    }
  }, [
    activeSource,
    noteDraft.content,
    noteDraft.title,
    noteMode,
    selectedBaseId,
    selectedNotes.length,
    parsedUrls.valid.length,
    isSubmitting
  ])

  const buildPanelSubmitItems = useCallback(async (): Promise<KnowledgeAddItemInput[]> => {
    if (activeSource === 'url') {
      return parsedUrls.valid.map(({ value }) => ({ type: 'url' as const, data: { source: value, url: value } }))
    }

    if (activeSource === 'note') {
      if (noteMode === 'create') {
        return [{ type: 'note' as const, data: { source: noteDraft.title.trim(), content: noteDraft.content } }]
      }

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
  }, [activeSource, noteDraft.content, noteDraft.title, noteMode, selectedNotes, parsedUrls.valid])

  const submitWithStrategy = useCallback(
    async (
      items: KnowledgeAddItemInput[],
      conflictStrategy: 'detect' | ConflictResolution,
      invalid?: KnowledgeUrlEntry[],
      session?: number
    ) => {
      const result = await submitKnowledgeItems(items, conflictStrategy)
      if (session !== undefined && session !== sessionRef.current) {
        return
      }
      if (result.status === 'conflicts') {
        setPendingConflict({ items, invalid, conflicts: result.conflicts })
        return
      }
      if (invalid?.length) {
        setPendingConflict(null)
        setUrlValue(invalid.map(({ value }) => value).join('\n'))
        setUrlAcceptedCount(items.length)
        return
      }
      handleOpenChange(false)
    },
    [handleOpenChange, submitKnowledgeItems]
  )

  const handleSubmit = useCallback(() => {
    if (!canSubmit || isResolvingSubmit || pendingConflict) {
      return
    }

    const session = activeSource === 'url' ? sessionRef.current : undefined
    setSubmitErrorMessage('')
    setIsResolvingSubmit(true)

    const invalid = activeSource === 'url' ? parsedUrls.invalid : undefined
    setUrlAcceptedCount(null)
    void buildPanelSubmitItems()
      .then((items) => submitWithStrategy(items, 'detect', invalid, session))
      .catch((error) => {
        if (session !== undefined && session !== sessionRef.current) {
          return
        }
        setSubmitErrorMessage(formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error')))
      })
      .finally(() => {
        if (session === undefined || session === sessionRef.current) {
          setIsResolvingSubmit(false)
        }
      })
  }, [
    activeSource,
    buildPanelSubmitItems,
    canSubmit,
    isResolvingSubmit,
    submitWithStrategy,
    t,
    parsedUrls.invalid,
    pendingConflict
  ])

  const collectResolvedFileInputs = useCallback(
    async <T,>(
      files: T[],
      resolveItem: (item: T) => Promise<KnowledgeFileItemData>,
      describeItem: (item: T) => string | undefined
    ): Promise<KnowledgeAddItemInput[]> => {
      const fileBatch = await resolveKnowledgeFileBatch(files, resolveItem, describeItem)
      const fileOutcome = selectKnowledgeFileBatchOutcome(fileBatch)
      if (fileOutcome.fatal !== undefined) {
        throw fileOutcome.fatal
      }
      if (fileOutcome.skipped.length > 0) {
        toast.warning(t('chat.save.knowledge.error.file_partial_failed', { count: fileOutcome.skipped.length }))
      }
      if (fileOutcome.resolved.length === 0) return []
      const session = sessionRef.current
      const results = await ipcApi.request('knowledge.preflight_files', {
        baseId: selectedBaseId,
        paths: fileOutcome.resolved.map((data) => data.path)
      })
      if (session !== sessionRef.current) return []
      const proceed = await new Promise<boolean>((resolve) => {
        preflightResolve.current = resolve
        setPreflightResults(results)
      })
      if (!proceed || session !== sessionRef.current) return []
      return fileOutcome.resolved
        .filter((_, index) => results[index]?.reason === 'ok')
        .map((data) => ({ type: 'file' as const, data }))
    },
    [selectedBaseId, t]
  )

  // Collect file inputs from the OS picker (or page-level pending files, if any) and submit.
  // Returns null when the user cancels the picker so the caller can close the flow.
  const collectFileInputs = useCallback(async (): Promise<KnowledgeAddItemInput[] | null> => {
    if (pendingAddFiles?.length) {
      const supportedFiles = pendingAddFiles
      return collectResolvedFileInputs(supportedFiles, resolveFileEntryDataFromFile, (file) => file.name)
    }

    const selected = await window.api.file.select({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Knowledge', extensions: knowledgeFilePickerExtensions }]
    })

    if (!selected) {
      return null
    }

    const supportedFiles = selected
    return collectResolvedFileInputs(supportedFiles, resolveKnowledgeFileMetadataEntryData, describeFileMetadata)
  }, [collectResolvedFileInputs, pendingAddFiles])

  const collectDirectoryInputs = useCallback(async (): Promise<KnowledgeAddItemInput[] | null> => {
    const session = sessionRef.current
    const directoryPath = await window.api.file.selectFolder()

    if (!directoryPath) {
      return null
    }

    const results = await ipcApi.request('knowledge.preflight_files', {
      baseId: selectedBaseId,
      paths: [directoryPath]
    })
    if (session !== sessionRef.current) return []
    const proceed = await new Promise<boolean>((resolve) => {
      preflightResolve.current = resolve
      setPreflightResults(results)
    })
    if (
      session !== sessionRef.current ||
      !proceed ||
      results.some((file) => file.reason !== 'ok' && file.reason !== 'unsupported_format')
    )
      return []
    return [{ type: 'directory' as const, data: { source: directoryPath } }]
  }, [selectedBaseId])

  // For file/directory sources the menu click should feel like "open the OS picker": fire it once
  // on mount, then submit. A ref guards against the effect running twice (StrictMode / re-renders).
  const directPickStartedRef = useRef(false)
  useEffect(() => {
    setUrlAcceptedCount(null)
    if (!open) {
      setPendingConflict(null)
      directPickStartedRef.current = false
      return
    }
    setNoteMode('import')
    setSelectedNotes([])
    setNoteDraft({ title: '', content: '' })
    setUrlValue('')
    setSubmitErrorMessage('')
    setPendingConflict(null)
    setPendingResolution(null)
  }, [open])

  useEffect(() => {
    if (!open || !directPick || directPickStartedRef.current) {
      return
    }
    directPickStartedRef.current = true

    const run = async () => {
      const session = sessionRef.current
      setIsResolvingSubmit(true)
      try {
        let items: KnowledgeAddItemInput[] | null
        if (pendingAddDirectoryPaths?.length) {
          const fileInputs = pendingAddFiles?.length ? await collectFileInputs() : []
          if (session !== sessionRef.current) return
          if (pendingAddFiles?.length && !fileInputs?.length) {
            handleOpenChange(false)
            return
          }
          items = [
            ...(fileInputs ?? []),
            ...pendingAddDirectoryPaths.map((source) => ({ type: 'directory' as const, data: { source } }))
          ]
        } else {
          items = activeSource === 'file' ? await collectFileInputs() : await collectDirectoryInputs()
        }
        if (pendingAddDirectoryPaths?.length) {
          const results = await ipcApi.request('knowledge.preflight_files', {
            baseId: selectedBaseId,
            paths: pendingAddDirectoryPaths
          })
          if (session !== sessionRef.current) return
          const proceed = await new Promise<boolean>((resolve) => {
            preflightResolve.current = resolve
            setPreflightResults(results)
          })
          if (!proceed || results.some((file) => file.reason !== 'ok' && file.reason !== 'unsupported_format')) {
            handleOpenChange(false)
            return
          }
        }
        if (session !== sessionRef.current) return
        // Picker cancelled or nothing selectable — close the (panel-less) flow.
        if (!items || items.length === 0) {
          handleOpenChange(false)
          return
        }
        await submitWithStrategy(items, 'detect')
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error')))
        handleOpenChange(false)
      } finally {
        setIsResolvingSubmit(false)
      }
    }

    void run()
  }, [
    activeSource,
    selectedBaseId,
    collectDirectoryInputs,
    collectFileInputs,
    directPick,
    handleOpenChange,
    open,
    pendingAddDirectoryPaths,
    pendingAddFiles,
    submitWithStrategy,
    t
  ])

  const handleConflictResolve = useCallback(
    (resolution: ConflictResolution) => {
      if (!pendingConflict) {
        return
      }

      const session = activeSource === 'url' ? sessionRef.current : undefined
      setPendingResolution(resolution)
      void submitWithStrategy(pendingConflict.items, resolution, pendingConflict.invalid, session)
        .catch((error) => {
          if (session !== undefined && session !== sessionRef.current) {
            return
          }
          setPendingConflict(null)
          const message = formatErrorMessageWithPrefix(error, t('knowledge.data_source.add_dialog.submit.error'))
          // Direct-pick sources have no panel to fall back to, so report inline (toast) and close.
          if (directPick) {
            toast.error(message)
            handleOpenChange(false)
          } else {
            setSubmitErrorMessage(message)
          }
        })
        .finally(() => {
          if (session === undefined || session === sessionRef.current) {
            setPendingResolution(null)
          }
        })
    },
    [activeSource, directPick, handleOpenChange, pendingConflict, submitWithStrategy, t]
  )

  const handleConflictCancel = useCallback(() => {
    setPendingConflict(null)
    // No panel exists behind a direct-pick conflict, so cancelling ends the whole flow.
    if (directPick) {
      handleOpenChange(false)
    }
  }, [directPick, handleOpenChange])

  return (
    <>
      <KnowledgeFilePreflightDialog
        blockPartial={activeSource === 'directory' || Boolean(pendingAddDirectoryPaths?.length)}
        results={preflightResults}
        onContinue={() => finishPreflight(true)}
        onCancel={() => finishPreflight(false)}
        onConfigure={() => {
          finishPreflight(false)
          openRagConfigDrawer()
        }}
      />
      {directPick ? null : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent closeOnOverlayClick={false} size="lg" className="flex max-h-[70vh] flex-col overflow-hidden">
            <AddKnowledgeItemDialogHeader title={t('knowledge.data_source.add_dialog.title')} />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pr-1">
              {activeSource === 'url' && urlAcceptedCount !== null ? (
                <p role="status" className="mb-2 shrink-0 text-xs text-muted-foreground">
                  {t('knowledge.data_source.add_dialog.url.partial_success', {
                    accepted: urlAcceptedCount,
                    invalid: parsedUrls.invalid.length
                  })}
                </p>
              ) : null}
              <AddKnowledgeItemDialogSourceTabs
                activeSource={activeSource}
                noteMode={noteMode}
                selectedNotes={selectedNotes}
                noteDraft={noteDraft}
                urlValue={urlValue}
                urlValid={parsedUrls.valid}
                urlErrors={parsedUrls.invalid}
                disabled={isSubmitting || pendingConflict !== null}
                onNoteModeChange={handleNoteModeChange}
                onNoteToggle={handleNoteToggle}
                onNoteSelectionChange={handleNoteSelectionChange}
                onNoteDraftTitleChange={handleNoteDraftTitleChange}
                onNoteDraftContentChange={handleNoteDraftContentChange}
                onUrlValueChange={(value) => {
                  setSubmitErrorMessage('')
                  setUrlAcceptedCount(null)
                  setUrlValue(value)
                }}
              />
            </div>
            <AddKnowledgeItemDialogFooter
              activeSource={activeSource}
              canSubmit={canSubmit}
              errorMessage={submitErrorMessage}
              isSubmitting={isSubmitting}
              validUrlCount={parsedUrls.valid.length}
              // A draft submits exactly one note, and picks made before switching modes
              // are not part of it — report nothing so the footer stays quiet.
              selectedNoteCount={noteMode === 'create' ? 0 : selectedNotes.length}
              onSubmit={handleSubmit}
            />
          </DialogContent>
        </Dialog>
      )}
      <KnowledgeAddConflictDialog
        open={open && pendingConflict !== null}
        conflicts={conflict.value?.conflicts ?? []}
        pendingResolution={pendingResolution}
        onResolve={handleConflictResolve}
        onCancel={handleConflictCancel}
      />
    </>
  )
}

export default AddKnowledgeItemDialog
