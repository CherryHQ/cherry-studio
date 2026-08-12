import { SegmentedControl } from '@cherrystudio/ui'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { NoteDraft, NoteItem, NoteSourceMode } from '../types'
import NoteCreateContent from './NoteCreateContent'
import NoteImportContent from './NoteImportContent'

interface NoteSourceContentProps {
  mode: NoteSourceMode
  onModeChange: (mode: NoteSourceMode) => void
  selectedNotes: NoteItem[]
  onToggle: (note: NoteItem) => void
  onSelectionChange: (notes: NoteItem[]) => void
  draft: NoteDraft
  onDraftTitleChange: (title: string) => void
  onDraftContentChange: (content: string) => void
}

const NoteSourceContent = ({
  mode,
  onModeChange,
  selectedNotes,
  onToggle,
  onSelectionChange,
  draft,
  onDraftTitleChange,
  onDraftContentChange
}: NoteSourceContentProps) => {
  const { t } = useTranslation()

  const modeOptions = useMemo(
    () => [
      { value: 'import' as const, label: t('knowledge.data_source.add_dialog.note.mode.import') },
      { value: 'create' as const, label: t('knowledge.data_source.add_dialog.note.mode.create') }
    ],
    [t]
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <SegmentedControl<NoteSourceMode>
        size="sm"
        value={mode}
        onValueChange={onModeChange}
        options={modeOptions}
        className="shrink-0 self-start"
        aria-label={t('knowledge.data_source.add_dialog.sources.note')}
      />
      {mode === 'create' ? (
        <NoteCreateContent draft={draft} onTitleChange={onDraftTitleChange} onContentChange={onDraftContentChange} />
      ) : (
        <NoteImportContent selectedNotes={selectedNotes} onToggle={onToggle} onSelectionChange={onSelectionChange} />
      )}
    </div>
  )
}

export default NoteSourceContent
