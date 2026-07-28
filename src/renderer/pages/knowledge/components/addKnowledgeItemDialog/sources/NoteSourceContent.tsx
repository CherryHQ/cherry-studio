import { Checkbox } from '@cherrystudio/ui'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { projectNotesTree } from '@renderer/services/NotesService'
import type { NotesTreeNode } from '@renderer/types/note'
import { NotebookPen } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { NoteItem } from '../types'

interface NoteSourceContentProps {
  selectedNotes: NoteItem[]
  onToggle: (note: NoteItem) => void
}

/** Flatten the notes tree to its markdown files; folders only carry structure here. */
function collectNoteFiles(nodes: NotesTreeNode[]): NotesTreeNode[] {
  const files: NotesTreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      files.push(node)
    } else if (node.children) {
      files.push(...collectNoteFiles(node.children))
    }
  }
  return files
}

const NoteSourceContent = ({ selectedNotes, onToggle }: NoteSourceContentProps) => {
  const { t } = useTranslation()
  const { notesPath } = useNotesSettings()
  const { root, isLoading, error } = useDirectoryTree(notesPath || undefined)

  const noteFiles = useMemo(() => {
    if (!root || !notesPath) {
      return []
    }
    return collectNoteFiles(projectNotesTree(root, notesPath))
  }, [root, notesPath])

  const selectedPaths = useMemo(() => new Set(selectedNotes.map((note) => note.externalPath)), [selectedNotes])

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center text-foreground-muted text-xs leading-4">
          {t('knowledge.data_source.add_dialog.note.loading')}
        </div>
      )
    }

    // A failed tree read also leaves `root` null; surface it as an error so the user
    // is not told to "create some notes" when the real problem is a read failure.
    if (error) {
      return (
        <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center rounded-md border border-error-border bg-error-bg p-4 text-center text-error-text text-xs leading-4">
          {t('notes.tree_load_failed')}
        </div>
      )
    }

    if (noteFiles.length === 0) {
      return (
        <div className="flex min-h-24 min-w-0 flex-1 items-center justify-center rounded-md border border-border-muted border-dashed p-4 text-center text-foreground-muted">
          <div className="flex min-w-0 flex-col items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-accent text-foreground-muted">
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
              <NotebookPen className="size-3.5 shrink-0 text-foreground-muted" />
              <span className="min-w-0 truncate text-foreground text-xs leading-4" title={note.name}>
                {note.name}
              </span>
              <span className="min-w-0 max-w-60 truncate text-foreground-muted text-xs leading-4" title={note.treePath}>
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
      <p className="text-foreground-muted text-xs leading-4">
        {t('knowledge.data_source.add_dialog.note.description')}
      </p>
      {renderBody()}
    </div>
  )
}

export default NoteSourceContent
