import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import NoteSourceContent from './sources/NoteSourceContent'
import UrlSourceContent from './sources/UrlSourceContent'
import type { NoteItem } from './types'

interface AddKnowledgeItemDialogSourceTabsProps {
  activeSource: KnowledgeItemType
  selectedNotes: NoteItem[]
  urlValue: string
  onNoteToggle: (note: NoteItem) => void
  onUrlValueChange: (value: string) => void
}

const AddKnowledgeItemDialogSourceTabs = ({
  activeSource,
  selectedNotes,
  urlValue,
  onNoteToggle,
  onUrlValueChange
}: AddKnowledgeItemDialogSourceTabsProps) => {
  // `file` / `directory` use the OS picker directly and never reach this panel.
  const renderSourceContent = (source: KnowledgeItemType) => {
    switch (source) {
      case 'note':
        return <NoteSourceContent selectedNotes={selectedNotes} onToggle={onNoteToggle} />
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
