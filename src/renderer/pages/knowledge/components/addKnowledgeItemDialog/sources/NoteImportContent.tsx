import { NotebookPen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Checkbox } from '@cherrystudio/ui'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { projectNotesTree } from '@renderer/services/NotesService'
import { flattenTreeToFiles } from '@renderer/services/NotesTreeService'

import type { NoteItem } from '../types'

interface NoteImportContentProps {
  selectedNotes: NoteItem[]
  onToggle: (note: NoteItem) => void
  onSelectionChange: (notes: NoteItem[]) => void
}

const NoteImportContent = ({ selectedNotes, onToggle, onSelectionChange }: NoteImportContentProps) => {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const { root, isLoading, error } = useDirectoryTree(notesPath || undefined)

  const noteFiles = useMemo(() => {
    if (!root || !notesPath) {
      return []
    }
    return flattenTreeToFiles(projectNotesTree(root, notesPath))
  }, [root, notesPath])

  const selectedPaths = useMemo(() => new Set(selectedNotes.map((note) => note.externalPath)), [selectedNotes])
  const allNotesSelected = noteFiles.every((note) => selectedPaths.has(note.externalPath))
  const someNotesSelected = noteFiles.some((note) => selectedPaths.has(note.externalPath))

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center text-foreground-tertiary text-xs leading-4">
          {t('knowledge.data_source.add_dialog.note.loading')}
        </div>
      )
    }

    // A failed tree read also leaves `root` null; surface it as an error so the user
    // is not told to "create some notes" when the real problem is a read failure.
    if (error) {
      return (
        <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center rounded-md border border-error-border bg-error-subtle p-4 text-center text-error-subtle-foreground text-xs leading-4">
          {t('notes.tree_load_failed')}
        </div>
      )
    }

    if (noteFiles.length === 0) {
      return (
        <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center rounded-md border border-border-subtle border-dashed p-4 text-center text-foreground-tertiary">
          <div className="flex min-w-0 flex-col items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-accent text-foreground-tertiary">
              <NotebookPen className="size-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-foreground text-sm leading-5">
                {t('knowledge.data_source.add_dialog.note.empty_title')}
              </p>
              <p className="max-w-60 text-xs leading-5">
                {t('knowledge.data_source.add_dialog.note.empty_description')}
              </p>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div data-testid="knowledge-source-note-list" className="min-h-0 flex-1 overflow-y-auto">
        <div role="list" className="space-y-1.5 pr-1">
          {noteFiles.map((note) => (
            <label
              key={note.externalPath}
              role="listitem"
              className="grid min-w-0 max-w-full cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,max-content)] items-center gap-1.5 overflow-hidden rounded-md bg-background-subtle px-2 py-1.5 hover:bg-accent/40">
              <Checkbox
                size="sm"
                checked={selectedPaths.has(note.externalPath)}
                onCheckedChange={() => onToggle({ name: note.name, externalPath: note.externalPath })}
              />
              <NotebookPen className="size-3.5 shrink-0 text-foreground-tertiary" />
              <span className="min-w-0 truncate text-foreground text-xs leading-4" title={note.name}>
                {note.name}
              </span>
              <span
                className="min-w-0 max-w-60 truncate text-foreground-tertiary text-xs leading-4"
                title={note.treePath}>
                {note.treePath}
              </span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs leading-4">
          {t('knowledge.data_source.add_dialog.note.description')}
        </p>
        {noteFiles.length > 0 && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-foreground text-xs leading-4">
            <Checkbox
              size="sm"
              checked={allNotesSelected ? true : someNotesSelected ? 'indeterminate' : false}
              onCheckedChange={(checked) =>
                onSelectionChange(
                  checked === true
                    ? noteFiles.map((note) => ({ name: note.name, externalPath: note.externalPath }))
                    : []
                )
              }
              aria-label={t('common.select_all')}
            />
            <span>{t('common.select_all')}</span>
          </label>
        )}
      </div>
      {renderBody()}
    </div>
  )
}

export default NoteImportContent
