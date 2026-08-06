import { Input, Label } from '@cherrystudio/ui'
import RichEditor from '@renderer/components/RichEditor/RichEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { NoteDraft } from '../types'

// The toolbar wants ~800px and this dialog is 576px wide. `.ToolbarWrapper` ships as a
// single nowrap row that scrolls horizontally, which reads as clipped here, so let it
// wrap instead. Trimming it via `unregisterToolbarCommand` is not an option: Toolbar
// builds its items from `getCommandsByGroup()`, which ignores the `showInToolbar` flag
// that API sets.
const TOOLBAR_WRAP =
  '[&_.ToolbarWrapper]:flex-wrap [&_.ToolbarWrapper]:overflow-x-visible [&_.ToolbarWrapper]:whitespace-normal'

interface NoteCreateContentProps {
  draft: NoteDraft
  onTitleChange: (title: string) => void
  // Kept separate from `onTitleChange` so neither handler has to close over the
  // draft: RichEditor builds its editor once (no deps array on `useEditor`), so a
  // `{ ...draft }` spread inside the change handler could serialize a stale title.
  onContentChange: (content: string) => void
}

const NoteCreateContent = ({ draft, onTitleChange, onContentChange }: NoteCreateContentProps) => {
  const { t } = useTranslation()

  // A knowledge note is stored as text and chunked for embedding, so an image command
  // would produce an asset the indexer cannot read. Matches what NotesEditor drops.
  const handleCommandsReady = useCallback((commandAPI: Pick<RichEditorRef, 'unregisterCommand'>) => {
    commandAPI.unregisterCommand('image')
  }, [])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="min-w-0 shrink-0">
        <Label htmlFor="knowledge-note-title-input" className="mb-1.5 text-muted-foreground text-xs leading-4">
          {t('knowledge.data_source.add_dialog.note.create.title_label')}
        </Label>
        <Input
          id="knowledge-note-title-input"
          value={draft.title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={t('knowledge.data_source.add_dialog.note.create.title_placeholder')}
          className="w-full rounded-md border-border-subtle bg-background px-2.5 py-1.25 text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-0"
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Uncontrolled by design: RichEditor seeds its state from `initialContent` once,
            so echoing the draft back on every keystroke would fight the editor's cursor. */}
        <RichEditor
          initialContent={draft.content}
          onMarkdownChange={onContentChange}
          onCommandsReady={handleCommandsReady}
          placeholder={t('knowledge.data_source.add_dialog.note.create.content_placeholder')}
          className={`min-h-0 flex-1 ${TOOLBAR_WRAP}`}
          showToolbar
          isFullWidth
        />
      </div>
    </div>
  )
}

export default NoteCreateContent
