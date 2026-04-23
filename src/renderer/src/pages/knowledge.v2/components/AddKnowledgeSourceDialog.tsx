import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Dropzone,
  DropzoneEmptyState,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@cherrystudio/ui'
import type { KnowledgeDataSourceType } from '@renderer/pages/knowledge.v2/types'
import { formatFileSize } from '@renderer/utils/file'
import { Check, FileText, Folder, type LucideIcon, StickyNote, Upload, X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface AddKnowledgeSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface AddKnowledgeSourceDialogSourceTabsProps {
  activeSource: KnowledgeDataSourceType
  selectedDirectories: AddKnowledgeSourceDialogDirectoryItem[]
  selectedFiles: File[]
  selectedNotes: AddKnowledgeSourceDialogNoteItemKey[]
  onDirectoryDrop: NonNullable<ComponentProps<typeof Dropzone>['onDrop']>
  onDirectoryRemove: (directoryName: string) => void
  onFileDrop: NonNullable<ComponentProps<typeof Dropzone>['onDrop']>
  onFileRemove: (fileIndex: number) => void
  onNoteToggle: (noteKey: AddKnowledgeSourceDialogNoteItemKey) => void
  onSourceChange: (value: KnowledgeDataSourceType) => void
}

interface AddKnowledgeSourceDialogFileSourceContentProps {
  files: File[]
  onDrop: NonNullable<ComponentProps<typeof Dropzone>['onDrop']>
  onRemove: (fileIndex: number) => void
}

interface AddKnowledgeSourceDialogDirectoryItem {
  fileCount: number
  name: string
  totalSize: number
}

type AddKnowledgeSourceDialogNoteItemKey = (typeof NOTE_ITEM_KEYS)[number]

interface AddKnowledgeSourceDialogDirectorySourceContentProps {
  directories: AddKnowledgeSourceDialogDirectoryItem[]
  onDrop: NonNullable<ComponentProps<typeof Dropzone>['onDrop']>
  onRemove: (directoryName: string) => void
}

const KNOWLEDGE_DATA_SOURCE_TYPES: ReadonlyArray<{
  labelKey: string
  value: KnowledgeDataSourceType
}> = [
  { value: 'file', labelKey: 'knowledge_v2.data_source.add_dialog.sources.file' },
  { value: 'note', labelKey: 'knowledge_v2.data_source.add_dialog.sources.note' },
  { value: 'directory', labelKey: 'knowledge_v2.data_source.add_dialog.sources.directory' },
  { value: 'url', labelKey: 'knowledge_v2.data_source.add_dialog.sources.url' },
  { value: 'website', labelKey: 'knowledge_v2.data_source.add_dialog.sources.website' }
]

const DEFAULT_SOURCE_TYPE: KnowledgeDataSourceType = 'file'
const NOTE_ITEM_KEYS = [
  'product_requirements',
  'meeting_minutes',
  'research_notes',
  'customer_feedback',
  'release_retro'
] as const
const CONTENT_CONTAINER_CLASSNAME = 'flex min-h-0 flex-1 flex-col p-3'
const DIRECTORY_DROPZONE_ATTRIBUTE = ''
const SELECTION_LIST_CONTAINER_CLASSNAME = 'max-h-52 overflow-y-auto'
const SELECTION_LIST_CLASSNAME = 'space-y-1.5 pr-1'
const SELECTION_LIST_ITEM_CLASSNAME = 'flex items-center gap-1.5 rounded-md bg-accent/30 px-2 py-1'
const SELECTION_LIST_ITEM_REMOVE_BUTTON_CLASSNAME = 'text-muted-foreground/25 hover:text-red-500 flex-shrink-0'

const getDirectoryNameFromFile = (file: File): string | null => {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath

  if (!relativePath || !relativePath.includes('/')) {
    return null
  }

  const [directoryName] = relativePath.split('/')
  return directoryName || null
}

const buildDirectoryItems = (files: File[]): AddKnowledgeSourceDialogDirectoryItem[] => {
  const directoryItems = new Map<string, AddKnowledgeSourceDialogDirectoryItem>()

  files.forEach((file) => {
    const directoryName = getDirectoryNameFromFile(file)

    if (!directoryName) {
      return
    }

    const existingItem = directoryItems.get(directoryName)

    if (existingItem) {
      existingItem.fileCount += 1
      existingItem.totalSize += file.size
      return
    }

    directoryItems.set(directoryName, {
      name: directoryName,
      fileCount: 1,
      totalSize: file.size
    })
  })

  return Array.from(directoryItems.values())
}

const AddKnowledgeSourceDialogHeader = ({ title, closeLabel }: { title: string; closeLabel: string }) => {
  return (
    <div className="flex shrink-0 items-start justify-between px-4 pt-3 pb-2">
      <DialogTitle className="pt-0.5 font-medium text-xs leading-4">{title}</DialogTitle>
      <DialogClose asChild>
        <button
          type="button"
          aria-label={closeLabel}
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </DialogClose>
    </div>
  )
}

const AddKnowledgeSourceDialogSourceIntro = ({ title, description }: { title: string; description?: string }) => {
  return (
    <div className="space-y-0.5">
      <p className="text-[0.6875rem] text-foreground leading-4.125">{title}</p>
      {description ? <p className="text-[0.5625rem] text-muted-foreground/55 leading-3.5">{description}</p> : null}
    </div>
  )
}

const AddKnowledgeSourceDialogDropzoneCard = ({
  icon: Icon,
  onDrop,
  webkitdirectory,
  title,
  description
}: {
  icon: LucideIcon
  onDrop: NonNullable<ComponentProps<typeof Dropzone>['onDrop']>
  webkitdirectory?: ComponentProps<typeof Dropzone>['webkitdirectory']
  title: string
  description: string
}) => {
  return (
    <Dropzone
      multiple
      maxFiles={0}
      onDrop={onDrop}
      webkitdirectory={webkitdirectory}
      className="min-h-[118px] shrink-0 rounded-lg border-2 border-border/30 border-dashed bg-muted/[0.06] p-5 text-center text-foreground shadow-none hover:border-border/30 hover:bg-muted/[0.06] hover:text-foreground">
      <DropzoneEmptyState className="gap-2">
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/55">
            <Icon className="size-4" />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] leading-4">{title}</p>
            <p className="text-[10px] text-muted-foreground/60 leading-4">{description}</p>
          </div>
        </div>
      </DropzoneEmptyState>
    </Dropzone>
  )
}

const AddKnowledgeSourceDialogSelectionListItem = ({
  icon: Icon,
  iconClassName,
  meta,
  name,
  onRemove,
  removeLabel
}: {
  icon: LucideIcon
  iconClassName: string
  meta?: string
  name: string
  onRemove: () => void
  removeLabel: string
}) => {
  return (
    <div role="listitem" className={SELECTION_LIST_ITEM_CLASSNAME}>
      <Icon className={iconClassName} />

      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground leading-4">{name}</span>
      {meta ? <span className="shrink-0 text-[9px] text-muted-foreground/35 leading-4">{meta}</span> : null}

      <button
        type="button"
        aria-label={removeLabel}
        className={SELECTION_LIST_ITEM_REMOVE_BUTTON_CLASSNAME}
        onClick={onRemove}>
        <X className="size-[9px]" />
      </button>
    </div>
  )
}

const AddKnowledgeSourceDialogFileSourceContent = ({
  files,
  onDrop,
  onRemove
}: AddKnowledgeSourceDialogFileSourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <AddKnowledgeSourceDialogDropzoneCard
        icon={Upload}
        onDrop={onDrop}
        title={t('knowledge_v2.data_source.add_dialog.placeholder.title')}
        description={t('knowledge_v2.data_source.add_dialog.placeholder.supported_formats')}
      />

      {files.length > 0 ? (
        <div data-testid="knowledge-source-file-list" className={SELECTION_LIST_CONTAINER_CLASSNAME}>
          <div role="list" className={SELECTION_LIST_CLASSNAME}>
            {files.map((file, index) => (
              <AddKnowledgeSourceDialogSelectionListItem
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                icon={FileText}
                iconClassName="size-2.5 shrink-0 text-blue-500"
                name={file.name}
                meta={formatFileSize(file.size)}
                onRemove={() => onRemove(index)}
                removeLabel={t('common.delete')}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const AddKnowledgeSourceDialogNoteSourceContent = ({
  selectedNotes,
  onNoteToggle
}: {
  selectedNotes: AddKnowledgeSourceDialogNoteItemKey[]
  onNoteToggle: (noteKey: AddKnowledgeSourceDialogNoteItemKey) => void
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
      <div className="space-y-0.5">
        <p className="mb-1.5 text-[10px] text-muted-foreground/40 leading-4">
          {t('knowledge_v2.data_source.add_dialog.note.description')}
        </p>

        {NOTE_ITEM_KEYS.map((itemKey) => {
          const isSelected = selectedNotes.includes(itemKey)

          return (
            <button
              key={itemKey}
              type="button"
              aria-pressed={isSelected}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
              onClick={() => onNoteToggle(itemKey)}>
              <div
                aria-hidden="true"
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border/50'
                }`}>
                {isSelected ? <Check className="size-2.5" /> : null}
              </div>
              <StickyNote className="size-2.5 shrink-0 text-amber-500" />
              <span className="min-w-0 text-[11px] text-foreground leading-4">
                {t(`knowledge_v2.data_source.add_dialog.note.items.${itemKey}`)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const AddKnowledgeSourceDialogDirectorySourceContent = ({
  directories,
  onDrop,
  onRemove
}: AddKnowledgeSourceDialogDirectorySourceContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <AddKnowledgeSourceDialogDropzoneCard
        icon={Folder}
        onDrop={onDrop}
        webkitdirectory={DIRECTORY_DROPZONE_ATTRIBUTE}
        title={t('knowledge_v2.data_source.add_dialog.directory.title')}
        description={t('knowledge_v2.data_source.add_dialog.directory.description')}
      />

      {directories.length > 0 ? (
        <div data-testid="knowledge-source-directory-list" className={SELECTION_LIST_CONTAINER_CLASSNAME}>
          <div role="list" className={SELECTION_LIST_CLASSNAME}>
            {directories.map((directory) => (
              <AddKnowledgeSourceDialogSelectionListItem
                key={directory.name}
                icon={Folder}
                iconClassName="size-2.5 shrink-0 text-amber-500"
                name={directory.name}
                meta={`${t('knowledge_v2.meta.documents_count', { count: directory.fileCount })} · ${formatFileSize(directory.totalSize)}`}
                onRemove={() => onRemove(directory.name)}
                removeLabel={t('common.delete')}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const AddKnowledgeSourceDialogUrlSourceContent = () => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
      <div>
        <p className="mb-1.5 text-[10px] text-muted-foreground/40 leading-4">
          {t('knowledge_v2.data_source.add_dialog.url.description')}
        </p>
        <Input
          id="knowledge-source-url-input"
          placeholder={t('knowledge_v2.data_source.add_dialog.url.placeholder')}
          className="w-full rounded-md border border-border/40 bg-transparent px-2.5 py-[5px] text-[11px] text-foreground outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
        />
        <p className="mt-1 text-[9px] text-muted-foreground/25 leading-4">
          {t('knowledge_v2.data_source.add_dialog.url.help')}
        </p>
      </div>
    </div>
  )
}

const AddKnowledgeSourceDialogWebsiteSourceContent = () => {
  const { t } = useTranslation()

  return (
    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
      <div>
        <p className="mb-1.5 text-[10px] text-muted-foreground/40 leading-4">
          {t('knowledge_v2.data_source.add_dialog.website.description')}
        </p>
        <Input
          id="knowledge-source-website-input"
          placeholder={t('knowledge_v2.data_source.add_dialog.website.placeholder')}
          className="mb-2.5 w-full rounded-md border border-border/40 bg-transparent px-2.5 py-[5px] text-[11px] text-foreground outline-none transition-all focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
        />

        <div className="space-y-2 rounded-md border border-border/20 bg-muted/20 p-2.5">
          <p className="text-[9px] text-muted-foreground/40 leading-4">
            {t('knowledge_v2.data_source.add_dialog.website.settings_title')}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="knowledge-source-website-depth"
                className="mb-0.5 block text-[9px] text-muted-foreground/35 leading-4">
                {t('knowledge_v2.data_source.add_dialog.website.depth_label')}
              </label>
              <Input
                id="knowledge-source-website-depth"
                inputMode="numeric"
                readOnly
                value="2"
                className="w-full rounded border border-border/30 bg-transparent px-2 py-[4px] text-[11px] text-foreground outline-none transition-all focus:border-primary/40"
              />
            </div>

            <div>
              <label
                htmlFor="knowledge-source-website-max-pages"
                className="mb-0.5 block text-[9px] text-muted-foreground/35 leading-4">
                {t('knowledge_v2.data_source.add_dialog.website.max_pages_label')}
              </label>
              <Input
                id="knowledge-source-website-max-pages"
                inputMode="numeric"
                readOnly
                value="50"
                className="w-full rounded border border-border/30 bg-transparent px-2 py-[4px] text-[11px] text-foreground outline-none transition-all focus:border-primary/40"
              />
            </div>
          </div>

          <p className="text-[8px] text-muted-foreground/25 leading-4">
            {t('knowledge_v2.data_source.add_dialog.website.help')}
          </p>
        </div>
      </div>
    </div>
  )
}

const AddKnowledgeSourceDialogTabContent = ({
  source,
  selectedDirectories,
  selectedFiles,
  selectedNotes,
  onDirectoryDrop,
  onDirectoryRemove,
  onFileDrop,
  onFileRemove,
  onNoteToggle
}: {
  source: KnowledgeDataSourceType
  selectedDirectories: AddKnowledgeSourceDialogDirectoryItem[]
  selectedFiles: File[]
  selectedNotes: AddKnowledgeSourceDialogNoteItemKey[]
  onDirectoryDrop: NonNullable<ComponentProps<typeof Dropzone>['onDrop']>
  onDirectoryRemove: (directoryName: string) => void
  onFileDrop: NonNullable<ComponentProps<typeof Dropzone>['onDrop']>
  onFileRemove: (fileIndex: number) => void
  onNoteToggle: (noteKey: AddKnowledgeSourceDialogNoteItemKey) => void
}) => {
  switch (source) {
    case 'file':
      return (
        <AddKnowledgeSourceDialogFileSourceContent files={selectedFiles} onDrop={onFileDrop} onRemove={onFileRemove} />
      )
    case 'note':
      return <AddKnowledgeSourceDialogNoteSourceContent selectedNotes={selectedNotes} onNoteToggle={onNoteToggle} />
    case 'directory':
      return (
        <AddKnowledgeSourceDialogDirectorySourceContent
          directories={selectedDirectories}
          onDrop={onDirectoryDrop}
          onRemove={onDirectoryRemove}
        />
      )
    case 'url':
      return <AddKnowledgeSourceDialogUrlSourceContent />
    case 'website':
      return <AddKnowledgeSourceDialogWebsiteSourceContent />
    default:
      return null
  }
}

const AddKnowledgeSourceDialogSourceTabs = ({
  activeSource,
  selectedDirectories,
  selectedFiles,
  selectedNotes,
  onDirectoryDrop,
  onDirectoryRemove,
  onFileDrop,
  onFileRemove,
  onNoteToggle,
  onSourceChange
}: AddKnowledgeSourceDialogSourceTabsProps) => {
  const { t } = useTranslation()

  return (
    <Tabs
      value={activeSource}
      onValueChange={(value) => onSourceChange(value as KnowledgeDataSourceType)}
      variant="line"
      className="min-h-0 flex-1 gap-0">
      <div className="shrink-0 border-border/40 border-b px-3">
        <TabsList className="h-[30px] gap-0">
          {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
            <TabsTrigger
              key={source.value}
              value={source.value}
              className="h-[29px] min-w-[54px] rounded-none border-transparent border-b-[1.5px] px-2.5 text-[11px] text-muted-foreground/45 leading-4 after:hidden hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground">
              {t(source.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
        <TabsContent key={source.value} value={source.value} className="mt-0 flex min-h-0 flex-1 flex-col">
          <div className={CONTENT_CONTAINER_CLASSNAME}>
            <AddKnowledgeSourceDialogTabContent
              source={source.value}
              selectedDirectories={selectedDirectories}
              selectedFiles={selectedFiles}
              selectedNotes={selectedNotes}
              onDirectoryDrop={onDirectoryDrop}
              onDirectoryRemove={onDirectoryRemove}
              onFileDrop={onFileDrop}
              onFileRemove={onFileRemove}
              onNoteToggle={onNoteToggle}
            />
          </div>
        </TabsContent>
      ))}
    </Tabs>
  )
}

const AddKnowledgeSourceDialogFooter = ({
  activeSource,
  selectedDirectoryCount,
  selectedFileCount,
  selectedNoteCount
}: {
  activeSource: KnowledgeDataSourceType
  selectedDirectoryCount: number
  selectedFileCount: number
  selectedNoteCount: number
}) => {
  const { t } = useTranslation()
  const selectionCount =
    activeSource === 'file'
      ? selectedFileCount
      : activeSource === 'directory'
        ? selectedDirectoryCount
        : activeSource === 'note'
          ? selectedNoteCount
          : 0
  const selectionText =
    activeSource === 'file'
      ? t('knowledge_v2.data_source.add_dialog.footer.selected_files', { count: selectedFileCount })
      : activeSource === 'directory'
        ? t('knowledge_v2.data_source.add_dialog.footer.selected_directories', { count: selectedDirectoryCount })
        : activeSource === 'note'
          ? t('knowledge_v2.data_source.add_dialog.footer.selected_notes', { count: selectedNoteCount })
          : ''

  return (
    <div className="flex shrink-0 items-center justify-between border-border/15 border-t px-4 py-2.5">
      <span className="text-[9px] text-muted-foreground/30 leading-4">{selectionCount > 0 ? selectionText : ''}</span>

      <div className="flex gap-1.5">
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-6 min-h-6 rounded-md px-2.5 text-[11px] text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground">
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={selectionCount === 0}
          className="h-6 min-h-6 rounded-md bg-primary px-2.5 text-[11px] text-primary-foreground shadow-none transition-colors hover:bg-primary/90 disabled:opacity-40">
          {t('common.add')}
        </Button>
      </div>
    </div>
  )
}

const AddKnowledgeSourceDialogRoot = ({ open, onOpenChange }: AddKnowledgeSourceDialogProps) => {
  const { t } = useTranslation()
  const [activeSource, setActiveSource] = useState<KnowledgeDataSourceType>(DEFAULT_SOURCE_TYPE)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedDirectories, setSelectedDirectories] = useState<AddKnowledgeSourceDialogDirectoryItem[]>([])
  const [selectedNotes, setSelectedNotes] = useState<AddKnowledgeSourceDialogNoteItemKey[]>([])

  const resetDialogState = useCallback(() => {
    setActiveSource(DEFAULT_SOURCE_TYPE)
    setSelectedFiles([])
    setSelectedDirectories([])
    setSelectedNotes([])
  }, [])

  const handleFileDrop = useCallback<NonNullable<ComponentProps<typeof Dropzone>['onDrop']>>((acceptedFiles) => {
    setSelectedFiles(acceptedFiles)
  }, [])

  const handleDirectoryDrop = useCallback<NonNullable<ComponentProps<typeof Dropzone>['onDrop']>>((acceptedFiles) => {
    setSelectedDirectories(buildDirectoryItems(acceptedFiles))
  }, [])

  const handleFileRemove = useCallback((fileIndex: number) => {
    setSelectedFiles((currentFiles) => currentFiles.filter((_, index) => index !== fileIndex))
  }, [])

  const handleDirectoryRemove = useCallback((directoryName: string) => {
    setSelectedDirectories((currentDirectories) =>
      currentDirectories.filter((directory) => directory.name !== directoryName)
    )
  }, [])

  const handleNoteToggle = useCallback((noteKey: AddKnowledgeSourceDialogNoteItemKey) => {
    setSelectedNotes((currentNotes) =>
      currentNotes.includes(noteKey)
        ? currentNotes.filter((currentNote) => currentNote !== noteKey)
        : [...currentNotes, noteKey]
    )
  }, [])

  useEffect(() => {
    if (!open) {
      resetDialogState()
    }
  }, [open, resetDialogState])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetDialogState()
      }

      onOpenChange(nextOpen)
    },
    [onOpenChange, resetDialogState]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="z-[401] max-h-[70vh] w-[400px] max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-[14px] border-border bg-popover p-0 shadow-2xl">
        <AddKnowledgeSourceDialog.Header
          title={t('knowledge_v2.data_source.add_dialog.title')}
          closeLabel={t('common.close')}
        />
        <AddKnowledgeSourceDialog.SourceTabs
          activeSource={activeSource}
          selectedDirectories={selectedDirectories}
          selectedFiles={selectedFiles}
          selectedNotes={selectedNotes}
          onDirectoryDrop={handleDirectoryDrop}
          onDirectoryRemove={handleDirectoryRemove}
          onFileDrop={handleFileDrop}
          onFileRemove={handleFileRemove}
          onNoteToggle={handleNoteToggle}
          onSourceChange={setActiveSource}
        />
        <AddKnowledgeSourceDialog.Footer
          activeSource={activeSource}
          selectedDirectoryCount={selectedDirectories.length}
          selectedFileCount={selectedFiles.length}
          selectedNoteCount={selectedNotes.length}
        />
      </DialogContent>
    </Dialog>
  )
}

const AddKnowledgeSourceDialog = Object.assign(AddKnowledgeSourceDialogRoot, {
  Header: AddKnowledgeSourceDialogHeader,
  SourceTabs: AddKnowledgeSourceDialogSourceTabs,
  TabContent: AddKnowledgeSourceDialogTabContent,
  FileSourceContent: AddKnowledgeSourceDialogFileSourceContent,
  NoteSourceContent: AddKnowledgeSourceDialogNoteSourceContent,
  DirectorySourceContent: AddKnowledgeSourceDialogDirectorySourceContent,
  UrlSourceContent: AddKnowledgeSourceDialogUrlSourceContent,
  WebsiteSourceContent: AddKnowledgeSourceDialogWebsiteSourceContent,
  Footer: AddKnowledgeSourceDialogFooter
})

export default AddKnowledgeSourceDialog
