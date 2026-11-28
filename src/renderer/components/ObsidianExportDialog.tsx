import { XIcon } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { parse, stringify } from 'yaml'

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  TreeSelect,
  type TreeSelectOption
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import {
  exportMarkdownToObsidian,
  messagesToMarkdown,
  messageToMarkdown,
  messageToMarkdownWithReasoning,
  topicToMarkdown
} from '@renderer/services/ExportService'
import { toast } from '@renderer/services/toast'
import type { ExportableMessage } from '@renderer/types/messageExport'
import type { Topic } from '@renderer/types/topic'
import type { OutputFor } from '@shared/ipc/types'

const logger = loggerService.withContext('ObsidianExportDialog')

type FileInfo = OutputFor<'export.obsidian.get_files'>[number]

const ObsidianProcessingMethod = {
  APPEND: '1',
  PREPEND: '2',
  NEW_OR_OVERWRITE: '3'
} as const

type WriteMode = (typeof ObsidianProcessingMethod)[keyof typeof ObsidianProcessingMethod]
type NoteDraft = { title: string; processingMethod: WriteMode | undefined }

// Separator from Obsidian Web Clipper's `multitext` parsing (obsidianmd/obsidian-clipper, src/utils/shared.ts, MIT).
const multitextSeparator = /,(?![^[]*\]\])/

const parseTags = (input: string): string[] => {
  const value = input.trim()
  const bare = value.replace(/^\[|\]$/g, '')
  let items: string[]
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      const parsed: unknown = parse(value)
      items =
        Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
          ? parsed
          : bare.split(multitextSeparator)
    } catch {
      items = bare.split(multitextSeparator)
    }
  } else {
    items = bare.split(multitextSeparator)
  }
  return items.map((item) => item.trim().replace(/^#/, '')).filter((item) => item !== '')
}

interface PopupContainerProps {
  title: string
  obsidianTags: string | null
  processingMethod: WriteMode
  open: boolean
  resolve: (success: boolean) => void
  message?: ExportableMessage
  messages?: ExportableMessage[]
  topic?: Topic
  rawContent?: string
}

interface FormRowProps {
  label: React.ReactNode
  children: React.ReactNode
}

const FormRow = ({ label, children }: FormRowProps) => (
  <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3">
    <Label className="text-foreground">{label}</Label>
    <div className="min-w-0">{children}</div>
  </div>
)

// 转换文件信息数组为树形结构
const convertToTreeData = (files: FileInfo[]): TreeSelectOption[] => {
  const treeData: TreeSelectOption[] = [
    {
      title: i18n.t('chat.topics.export.obsidian_root_directory'),
      value: '',
      isLeaf: false,
      selectable: true
    }
  ]

  // 记录已创建的节点路径
  const pathMap: Record<string, TreeSelectOption> = {
    '': treeData[0]
  }

  // 先按类型分组，确保先处理文件夹
  const folders = files.filter((file) => file.type === 'folder')
  const mdFiles = files.filter((file) => file.type === 'markdown')

  // 按路径排序，确保父文件夹先被创建
  const sortedFolders = [...folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length)

  // 先处理所有文件夹，构建目录结构
  for (const folder of sortedFolders) {
    const parts = folder.path.split('/')
    let currentPath = ''
    let parentPath = ''

    // 遍历文件夹路径的每一部分，确保创建完整路径
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]

      // 构建当前路径
      currentPath = currentPath ? `${currentPath}/${part}` : part

      // 如果这个路径节点还没创建
      if (!pathMap[currentPath]) {
        const node = {
          title: part,
          value: currentPath,
          key: currentPath,
          isLeaf: false,
          selectable: true,
          children: []
        }

        // 获取父节点，将当前节点添加到父节点的children中
        const parentNode = pathMap[parentPath]
        if (parentNode) {
          if (!parentNode.children) {
            parentNode.children = []
          }
          parentNode.children.push(node)
        }

        pathMap[currentPath] = node
      }

      // 更新父路径为当前路径，为下一级做准备
      parentPath = currentPath
    }
  }

  // 然后处理md文件
  for (const file of mdFiles) {
    const fullPath = file.path
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'))
    const fileName = file.name

    // 获取父文件夹节点
    const parentNode = pathMap[dirPath] || pathMap['']

    // 创建文件节点
    const fileNode = {
      title: fileName,
      value: fullPath,
      isLeaf: true,
      selectable: true,
      icon: <span style={{ marginRight: 4 }}>📄</span>
    }

    // 添加到父节点
    if (!parentNode.children) {
      parentNode.children = []
    }
    parentNode.children.push(fileNode)
  }

  return treeData
}

const PopupContainer: React.FC<PopupContainerProps> = ({
  title,
  obsidianTags,
  processingMethod,
  open,
  resolve,
  message,
  messages,
  topic,
  rawContent
}) => {
  const [defaultObsidianVault] = usePreference('data.integration.obsidian.default_vault')
  const [properties, setProperties] = useState({
    tags: obsidianTags || '',
    createdAt: new Date().toISOString().split('T')[0],
    source: 'Cherry Studio'
  })
  const [newNote, setNewNote] = useState<NoteDraft>({ title, processingMethod })
  const [selection, setSelection] = useState<{ entry: FileInfo; note?: NoteDraft }>()
  const note = selection?.note ?? newNote
  const [vaults, setVaults] = useState<OutputFor<'export.obsidian.get_vaults'> | null>()
  const [chosenVault, setChosenVault] = useState<string>()
  const selectedVault =
    chosenVault ?? vaults?.find((vault) => vault.name === defaultObsidianVault)?.name ?? vaults?.[0]?.name
  const [directory, setDirectory] = useState<{ vault: string; files: FileInfo[] | null }>()
  const currentDirectory = directory?.vault === selectedVault ? directory : undefined
  const fileTreeData = useMemo(() => convertToTreeData(currentDirectory?.files ?? []), [currentDirectory])
  const loading = vaults === undefined || Boolean(selectedVault && !currentDirectory)
  const error =
    vaults === null
      ? i18n.t('chat.topics.export.obsidian_fetch_error')
      : currentDirectory?.files === null && i18n.t('chat.topics.export.obsidian_fetch_folders_error')
  const [submitting, setSubmitting] = useState(false)
  const [exportReasoning, setExportReasoning] = useState(false)

  useEffect(() => {
    void ipcApi
      .request('export.obsidian.get_vaults')
      .then(setVaults)
      .catch((error) => {
        logger.error('获取Obsidian Vault失败:', error as Error)
        setVaults(null)
      })
  }, [])

  useEffect(() => {
    if (!selectedVault) return
    let active = true
    setDirectory(undefined)
    void ipcApi
      .request('export.obsidian.get_files', { vaultName: selectedVault })
      .then((files) => {
        if (active) setDirectory({ vault: selectedVault, files })
      })
      .catch((error) => {
        if (active) {
          logger.error('获取Obsidian文件失败:', error as Error)
          setDirectory({ vault: selectedVault, files: null })
        }
      })
    return () => {
      active = false
    }
  }, [selectedVault])

  const handleOk = async () => {
    if (!selectedVault || !currentDirectory?.files) return
    setSubmitting(true)
    try {
      let markdown = ''
      if (rawContent) {
        markdown = rawContent
      } else if (topic) {
        markdown = await topicToMarkdown(topic, exportReasoning, undefined, undefined, undefined, true)
      } else if (messages && messages.length > 0) {
        markdown = await messagesToMarkdown(messages, exportReasoning, undefined, undefined, true)
      } else if (message) {
        markdown = exportReasoning
          ? await messageToMarkdownWithReasoning(message, undefined, undefined, true)
          : await messageToMarkdown(message, undefined, undefined, true)
      } else {
        markdown = ''
      }
      let content = ''
      if (note.processingMethod !== ObsidianProcessingMethod.NEW_OR_OVERWRITE) {
        content = `\n---\n${markdown}`
      } else {
        const frontMatter = stringify(
          {
            title: note.title,
            created: properties.createdAt,
            source: properties.source,
            tags: parseTags(properties.tags)
          },
          { lineWidth: 0 }
        )
        content = `---\n${frontMatter}---\n${markdown}`
      }
      if (content === '') {
        toast.error(i18n.t('chat.topics.export.obsidian_export_failed'))
        return
      }
      await navigator.clipboard.writeText(content)
      const success = await exportMarkdownToObsidian({
        ...note,
        destination: selection?.entry,
        vault: selectedVault
      })
      if (!success) {
        return
      }
      setOpen(false)
      resolve(true)
    } finally {
      setSubmitting(false)
    }
  }

  const [openState, setOpen] = useState(open)
  useEffect(() => {
    setOpen(open)
  }, [open])

  const handleCancel = () => {
    setOpen(false)
    resolve(false)
  }

  const handleChange = (key: keyof typeof properties, value: string) => {
    setProperties((previous) => ({ ...previous, [key]: value }))
  }
  const updateNote = (patch: Partial<NoteDraft>) => {
    if (selection?.note) setSelection({ ...selection, note: { ...selection.note, ...patch } })
    // A typed title also names the next new note; an existing file's write mode belongs to that file.
    if (!selection?.note || patch.title !== undefined) setNewNote((previous) => ({ ...previous, ...patch }))
  }
  const handleFileSelect = (value: string) => {
    setChosenVault(selectedVault)
    if (value === selection?.entry.path) return
    const entry = currentDirectory?.files?.find((file) => file.path === value)
    if (entry?.type === 'markdown') {
      const name = entry.name.endsWith('.md') ? entry.name.slice(0, -3) : entry.name
      setSelection({ entry, note: { title: name, processingMethod: ObsidianProcessingMethod.APPEND } })
    } else setSelection(entry ? { entry } : undefined)
  }
  const handleVaultChange = (value: string) => {
    setSelection(undefined)
    setChosenVault(value)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleCancel()
    }
  }

  const renderVaultSelector = () => {
    if (vaults === undefined) {
      return (
        <div className="flex min-h-20 items-center justify-center">
          <Spinner text={i18n.t('chat.topics.export.obsidian_loading')} />
        </div>
      )
    }

    if (vaults?.length) {
      return (
        <Select value={selectedVault} onValueChange={handleVaultChange} disabled={submitting}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={i18n.t('chat.topics.export.obsidian_vault_placeholder')} />
          </SelectTrigger>
          <SelectContent>
            {vaults.map((vault) => (
              <SelectItem key={vault.name} value={vault.name}>
                {vault.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    return (
      <EmptyState compact className="min-h-20 py-4" description={i18n.t('chat.topics.export.obsidian_no_vaults')} />
    )
  }

  const renderPathSelector = () => {
    if (loading) {
      return (
        <div className="flex min-h-9 items-center">
          <Spinner text={i18n.t('chat.topics.export.obsidian_loading')} />
        </div>
      )
    }

    if (selectedVault) {
      return (
        <TreeSelect
          value={selection?.entry.path ?? ''}
          onChange={handleFileSelect}
          placeholder={i18n.t('chat.topics.export.obsidian_path_placeholder')}
          searchPlaceholder={i18n.t('common.search')}
          emptyText={i18n.t('common.no_results')}
          expandLabel={i18n.t('common.expand')}
          collapseLabel={i18n.t('common.collapse')}
          width="100%"
          maxHeight={400}
          treeData={fileTreeData}
        />
      )
    }

    return (
      <EmptyState
        compact
        className="min-h-20 py-4"
        description={i18n.t('chat.topics.export.obsidian_select_vault_first')}
      />
    )
  }

  return (
    <Dialog open={openState} onOpenChange={handleOpenChange}>
      <DialogContent closeOnOverlayClick={false} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-[600px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{i18n.t('chat.topics.export.obsidian_atributes')}</DialogTitle>
        </DialogHeader>
        {error && <Alert className="mb-1 shrink-0" message={error} type="error" showIcon />}
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <FormRow label={i18n.t('chat.topics.export.obsidian_title')}>
            <Input
              autoFocus
              value={note.title}
              onChange={(e) => updateNote({ title: e.target.value })}
              placeholder={i18n.t('chat.topics.export.obsidian_title_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_vault')}>{renderVaultSelector()}</FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_path')}>{renderPathSelector()}</FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_tags')}>
            <Input
              value={properties.tags}
              onChange={(e) => handleChange('tags', e.target.value)}
              placeholder={i18n.t('chat.topics.export.obsidian_tags_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_created')}>
            <Input
              value={properties.createdAt}
              onChange={(e) => handleChange('createdAt', e.target.value)}
              placeholder={i18n.t('chat.topics.export.obsidian_created_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_source')}>
            <Input
              value={properties.source}
              onChange={(e) => handleChange('source', e.target.value)}
              placeholder={i18n.t('chat.topics.export.obsidian_source_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_operate')}>
            <div className="flex items-center gap-2">
              <Select
                value={note.processingMethod ?? ''}
                onValueChange={(value) => updateNote({ processingMethod: value as WriteMode })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={i18n.t('chat.topics.export.obsidian_operate_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ObsidianProcessingMethod.APPEND}>
                    {i18n.t('chat.topics.export.obsidian_operate_append')}
                  </SelectItem>
                  <SelectItem value={ObsidianProcessingMethod.PREPEND}>
                    {i18n.t('chat.topics.export.obsidian_operate_prepend')}
                  </SelectItem>
                  <SelectItem value={ObsidianProcessingMethod.NEW_OR_OVERWRITE}>
                    {i18n.t('chat.topics.export.obsidian_operate_new_or_overwrite')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!note.processingMethod}
                aria-label={i18n.t('common.clear')}
                onClick={() => updateNote({ processingMethod: undefined })}>
                <XIcon size={14} />
              </Button>
            </div>
          </FormRow>
          {!rawContent && (
            <FormRow label={i18n.t('chat.topics.export.obsidian_reasoning')}>
              <Switch checked={exportReasoning} onCheckedChange={setExportReasoning} />
            </FormRow>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={handleCancel}>
            {i18n.t('common.cancel')}
          </Button>
          <Button
            type="button"
            loading={submitting}
            disabled={!currentDirectory?.files || !note.title.trim()}
            onClick={handleOk}>
            {i18n.t('chat.topics.export.obsidian_btn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ObsidianProcessingMethod, PopupContainer }
