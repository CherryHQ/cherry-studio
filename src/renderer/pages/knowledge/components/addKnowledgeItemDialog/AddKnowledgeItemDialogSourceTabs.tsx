import type { KnowledgeItemType } from '@shared/data/types/knowledge'

import DirectorySourceContent from './sources/DirectorySourceContent'
import FileSourceContent from './sources/FileSourceContent'
import NoteSourceContent from './sources/NoteSourceContent'
import SitemapSourceContent from './sources/SitemapSourceContent'
import UrlSourceContent from './sources/UrlSourceContent'
import type { DirectoryItem, DropzoneOnDrop } from './types'

interface AddKnowledgeItemDialogSourceTabsProps {
  activeSource: KnowledgeItemType
  selectedDirectories: DirectoryItem[]
  selectedFiles: File[]
  sitemapValue: string
  urlValue: string
  onDirectoryRemove: (directoryPath: string) => void
  onDirectorySelect: () => void | Promise<void>
  onFileDrop: DropzoneOnDrop
  onFileRemove: (fileIndex: number) => void
  onSitemapValueChange: (value: string) => void
  onUrlValueChange: (value: string) => void
}

const AddKnowledgeItemDialogSourceTabs = ({
  activeSource,
  selectedDirectories,
  selectedFiles,
  sitemapValue,
  urlValue,
  onDirectoryRemove,
  onDirectorySelect,
  onFileDrop,
  onFileRemove,
  onSitemapValueChange,
  onUrlValueChange
}: AddKnowledgeItemDialogSourceTabsProps) => {
  const renderSourceContent = (source: KnowledgeItemType) => {
    switch (source) {
      case 'file':
        return <FileSourceContent files={selectedFiles} onDrop={onFileDrop} onRemove={onFileRemove} />
      case 'note':
        return <NoteSourceContent />
      case 'directory':
        return (
          <DirectorySourceContent
            directories={selectedDirectories}
            onRemove={onDirectoryRemove}
            onSelectDirectory={onDirectorySelect}
          />
        )
      case 'url':
        return <UrlSourceContent value={urlValue} onValueChange={onUrlValueChange} />
      case 'sitemap':
        return <SitemapSourceContent value={sitemapValue} onValueChange={onSitemapValueChange} />
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
