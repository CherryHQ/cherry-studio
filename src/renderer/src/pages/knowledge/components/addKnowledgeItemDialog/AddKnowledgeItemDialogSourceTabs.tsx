import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import type { KnowledgeItemType } from '@shared/data/types/knowledge'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from './constants'
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
  onSourceChange: (value: KnowledgeItemType) => void
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
  onSourceChange,
  onSitemapValueChange,
  onUrlValueChange
}: AddKnowledgeItemDialogSourceTabsProps) => {
  const { t } = useTranslation()

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
    <Tabs
      value={activeSource}
      onValueChange={(value) => onSourceChange(value as KnowledgeItemType)}
      variant="line"
      className="min-h-0 flex-1 gap-0">
      <div className="shrink-0 border-border/40 border-b px-3">
        <TabsList className="h-7.5 gap-0">
          {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
            <TabsTrigger
              key={source.value}
              value={source.value}
              className="h-7.25 min-w-13.5 rounded-none border-transparent border-b-[1.5px] px-2.5 text-muted-foreground/45 leading-4 after:hidden hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground">
              {t(source.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
        <TabsContent key={source.value} value={source.value} className="mt-0 flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col p-3">{renderSourceContent(source.value)}</div>
        </TabsContent>
      ))}
    </Tabs>
  )
}

export default AddKnowledgeItemDialogSourceTabs
