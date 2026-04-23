import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import type { KnowledgeDataSourceType } from '@renderer/pages/knowledge.v2/types'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from './constants'
import DirectorySourceContent from './sources/DirectorySourceContent'
import FileSourceContent from './sources/FileSourceContent'
import NoteSourceContent from './sources/NoteSourceContent'
import UrlSourceContent from './sources/UrlSourceContent'
import WebsiteSourceContent from './sources/WebsiteSourceContent'
import type { DirectoryItem, DropzoneOnDrop } from './types'

interface AddKnowledgeSourceSourceTabsProps {
  activeSource: KnowledgeDataSourceType
  selectedDirectories: DirectoryItem[]
  selectedFiles: File[]
  onDirectoryDrop: DropzoneOnDrop
  onDirectoryRemove: (directoryName: string) => void
  onFileDrop: DropzoneOnDrop
  onFileRemove: (fileIndex: number) => void
  onSourceChange: (value: KnowledgeDataSourceType) => void
}

const AddKnowledgeSourceSourceTabs = ({
  activeSource,
  selectedDirectories,
  selectedFiles,
  onDirectoryDrop,
  onDirectoryRemove,
  onFileDrop,
  onFileRemove,
  onSourceChange
}: AddKnowledgeSourceSourceTabsProps) => {
  const { t } = useTranslation()

  const renderSourceContent = (source: KnowledgeDataSourceType) => {
    switch (source) {
      case 'file':
        return <FileSourceContent files={selectedFiles} onDrop={onFileDrop} onRemove={onFileRemove} />
      case 'note':
        return <NoteSourceContent />
      case 'directory':
        return (
          <DirectorySourceContent
            directories={selectedDirectories}
            onDrop={onDirectoryDrop}
            onRemove={onDirectoryRemove}
          />
        )
      case 'url':
        return <UrlSourceContent />
      case 'website':
        return <WebsiteSourceContent />
      default:
        return null
    }
  }

  return (
    <Tabs
      value={activeSource}
      onValueChange={(value) => onSourceChange(value as KnowledgeDataSourceType)}
      variant="line"
      className="min-h-0 flex-1 gap-0">
      <div className="shrink-0 border-border/40 border-b px-3">
        <TabsList className="h-7.5 gap-0">
          {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
            <TabsTrigger
              key={source.value}
              value={source.value}
              className="h-7.25 min-w-13.5 rounded-none border-transparent border-b-[1.5px] px-2.5 text-[11px] text-muted-foreground/45 leading-4 after:hidden hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground">
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

export default AddKnowledgeSourceSourceTabs
