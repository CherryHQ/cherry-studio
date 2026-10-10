import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import NoteSourceContent from './sources/NoteSourceContent'
import UrlSourceContent from './sources/UrlSourceContent'
import type { NoteDraft, NoteItem, NoteSourceMode } from './types'

interface AddKnowledgeItemDialogSourceTabsProps {
  activeSource: KnowledgeItemType
  noteMode: NoteSourceMode
  selectedNotes: NoteItem[]
  noteDraft: NoteDraft
  urlValue: string
  onNoteModeChange: (mode: NoteSourceMode) => void
  onNoteToggle: (note: NoteItem) => void
  onNoteSelectionChange: (notes: NoteItem[]) => void
  onNoteDraftTitleChange: (title: string) => void
  onNoteDraftContentChange: (content: string) => void
  onUrlValueChange: (value: string) => void
}

const AddKnowledgeItemDialogSourceTabs = ({
  activeSource,
  noteMode,
  selectedNotes,
  noteDraft,
  urlValue,
  onNoteModeChange,
  onNoteToggle,
  onNoteSelectionChange,
  onNoteDraftTitleChange,
  onNoteDraftContentChange,
  onUrlValueChange
}: AddKnowledgeItemDialogSourceTabsProps) => {
  // `file` / `directory` use the OS picker directly and never reach this panel.
  const renderSourceContent = (source: KnowledgeItemType) => {
    switch (source) {
      case 'note':
        return (
          <NoteSourceContent
            mode={noteMode}
            onModeChange={onNoteModeChange}
            selectedNotes={selectedNotes}
            onToggle={onNoteToggle}
            onSelectionChange={onNoteSelectionChange}
            draft={noteDraft}
            onDraftTitleChange={onNoteDraftTitleChange}
            onDraftContentChange={onNoteDraftContentChange}
          />
        )
      case 'url':
        return <UrlSourceContent value={urlValue} onValueChange={onUrlValueChange} />
      default:
        return null
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{renderSourceContent(activeSource)}</div>
    </div>
  )
}

export default AddKnowledgeItemDialogSourceTabs
