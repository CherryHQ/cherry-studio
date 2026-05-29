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
import i18n from '@renderer/i18n'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import {
  exportMarkdownToObsidian,
  messagesToMarkdown,
  messageToMarkdown,
  messageToMarkdownWithReasoning,
  topicToMarkdown
} from '@renderer/utils/export'
import { XIcon } from 'lucide-react'
import React, { useEffect, useState } from 'react'
const logger = loggerService.withContext('ObsidianExportDialog')

interface FileInfo {
  path: string
  type: 'folder' | 'markdown'
  name: string
}

const ObsidianProcessingMethod = {
  APPEND: '1',
  PREPEND: '2',
  NEW_OR_OVERWRITE: '3'
} as const

interface PopupContainerProps {
  title: string
  obsidianTags: string | null
  processingMethod: (typeof ObsidianProcessingMethod)[keyof typeof ObsidianProcessingMethod]
  open: boolean
  resolve: (success: boolean) => void
  message?: Message
  messages?: Message[]
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
  const [defaultObsidianVault, setDefaultObsidianVault] = usePreference('data.integration.obsidian.default_vault')
  const [state, setState] = useState({
    title,
    tags: obsidianTags || '',
    createdAt: new Date().toISOString().split('T')[0],
    source: 'Cherry Studio',
    processingMethod: processingMethod,
    folder: ''
  })
  const [hasTitleBeenManuallyEdited, setHasTitleBeenManuallyEdited] = useState(false)
  const [vaults, setVaults] = useState<Array<{ path: string; name: string }>>([])
  const [files, setFiles] = useState<FileInfo[]>([])
  const [fileTreeData, setFileTreeData] = useState<TreeSelectOption[]>([])
  const [selectedVault, setSelectedVault] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [exportReasoning, setExportReasoning] = useState(false)

  useEffect(() => {
    if (files.length > 0) {
      const treeData = convertToTreeData(files)
      setFileTreeData(treeData)
    } else {
      setFileTreeData([
        {
          title: i18n.t('chat.topics.export.obsidian_root_directory'),
          value: '',
          isLeaf: false,
          selectable: true
        }
      ])
    }
  }, [files])

  useEffect(() => {
    const fetchVaults = async () => {
      try {
        setLoading(true)
        setError(null)
        const vaultsData = await window.api.obsidian.getVaults()
        if (vaultsData.length === 0) {
          setError(i18n.t('chat.topics.export.obsidian_no_vaults'))
          setLoading(false)
          return
        }
        setVaults(vaultsData)
        const vaultToUse = defaultObsidianVault || vaultsData[0]?.name
        if (vaultToUse) {
          setSelectedVault(vaultToUse)
          const filesData = await window.api.obsidian.getFiles(vaultToUse)
          setFiles(filesData)
        }
      } catch (error) {
        logger.error('获取Obsidian Vault失败:', error as Error)
        setError(i18n.t('chat.topics.export.obsidian_fetch_error'))
      } finally {
        setLoading(false)
      }
    }
    void fetchVaults()
  }, [defaultObsidianVault, setDefaultObsidianVault])

  useEffect(() => {
    if (selectedVault) {
      const fetchFiles = async () => {
        try {
          setLoading(true)
          setError(null)
          const filesData = await window.api.obsidian.getFiles(selectedVault)
          setFiles(filesData)
        } catch (error) {
          logger.error('获取Obsidian文件失败:', error as Error)
          setError(i18n.t('chat.topics.export.obsidian_fetch_folders_error'))
        } finally {
          setLoading(false)
        }
      }
      void fetchFiles()
    }
  }, [selectedVault])

  const handleOk = async () => {
    if (!selectedVault) {
      setError(i18n.t('chat.topics.export.obsidian_no_vault_selected'))
      return
    }
    let markdown = ''
    if (rawContent) {
      markdown = rawContent
    } else if (topic) {
      markdown = await topicToMarkdown(topic, exportReasoning)
    } else if (messages && messages.length > 0) {
      markdown = await messagesToMarkdown(messages, exportReasoning)
    } else if (message) {
      markdown = exportReasoning ? await messageToMarkdownWithReasoning(message) : await messageToMarkdown(message)
    } else {
      markdown = ''
    }
    let content = ''
    if (state.processingMethod !== ObsidianProcessingMethod.NEW_OR_OVERWRITE) {
      content = `\n---\n${markdown}`
    } else {
      content = `---\ntitle: ${state.title}\ncreated: ${state.createdAt}\nsource: ${state.source}\ntags: ${state.tags}\n---\n${markdown}`
    }
    if (content === '') {
      window.toast.error(i18n.t('chat.topics.export.obsidian_export_failed'))
      return
    }
    await navigator.clipboard.writeText(content)
    void exportMarkdownToObsidian({
      ...state,
      folder: state.folder,
      vault: selectedVault
    })
    setOpen(false)
    resolve(true)
  }

  const [openState, setOpen] = useState(open)
  useEffect(() => {
    setOpen(open)
  }, [open])

  const handleCancel = () => {
    setOpen(false)
    resolve(false)
  }

  const handleChange = (key: string, value: any) => {
    setState((prevState) => ({ ...prevState, [key]: value }))
  }
  const handleTitleInputChange = (newTitle: string) => {
    handleChange('title', newTitle)
    setHasTitleBeenManuallyEdited(true)
  }
  const handleVaultChange = (value: string) => {
    setSelectedVault(value)
    setState((prevState) => ({ ...prevState, folder: '' }))
  }
  const handleFileSelect = (value: string) => {
    handleChange('folder', value)
    if (value) {
      const selectedFile = files.find((file) => file.path === value)
      if (selectedFile) {
        if (selectedFile.type === 'markdown') {
          const fileName = selectedFile.name
          const titleWithoutExt = fileName.endsWith('.md') ? fileName.substring(0, fileName.length - 3) : fileName
          handleChange('title', titleWithoutExt)
          setHasTitleBeenManuallyEdited(false)
          handleChange('processingMethod', ObsidianProcessingMethod.APPEND)
        } else {
          handleChange('processingMethod', ObsidianProcessingMethod.NEW_OR_OVERWRITE)
          if (!hasTitleBeenManuallyEdited) {
            handleChange('title', title)
          }
        }
      }
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleCancel()
    }
  }

  const renderVaultSelector = () => {
    if (loading && vaults.length === 0) {
      return (
        <div className="flex min-h-20 items-center justify-center">
          <Spinner text={i18n.t('chat.topics.export.obsidian_loading')} />
        </div>
      )
    }

    if (vaults.length > 0) {
      return (
        <Select value={selectedVault || undefined} onValueChange={handleVaultChange} disabled={loading}>
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
      <EmptyState
        compact
        preset="no-resource"
        className="min-h-20 py-4"
        description={i18n.t('chat.topics.export.obsidian_no_vaults')}
      />
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
          value={state.folder}
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
        preset="no-resource"
        className="min-h-20 py-4"
        description={i18n.t('chat.topics.export.obsidian_select_vault_first')}
      />
    )
  }

  return (
    <Dialog open={openState} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{i18n.t('chat.topics.export.obsidian_atributes')}</DialogTitle>
        </DialogHeader>
        {error && <Alert className="mb-1" message={error} type="error" showIcon />}
        <div className="space-y-4">
          <FormRow label={i18n.t('chat.topics.export.obsidian_title')}>
            <Input
              value={state.title}
              onChange={(e) => handleTitleInputChange(e.target.value)}
              placeholder={i18n.t('chat.topics.export.obsidian_title_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_vault')}>{renderVaultSelector()}</FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_path')}>{renderPathSelector()}</FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_tags')}>
            <Input
              value={state.tags}
              onChange={(e) => handleChange('tags', e.target.value)}
              placeholder={i18n.t('chat.topics.export.obsidian_tags_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_created')}>
            <Input
              value={state.createdAt}
              onChange={(e) => handleChange('createdAt', e.target.value)}
              placeholder={i18n.t('chat.topics.export.obsidian_created_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_source')}>
            <Input
              value={state.source}
              onChange={(e) => handleChange('source', e.target.value)}
              placeholder={i18n.t('chat.topics.export.obsidian_source_placeholder')}
            />
          </FormRow>
          <FormRow label={i18n.t('chat.topics.export.obsidian_operate')}>
            <div className="flex items-center gap-2">
              <Select
                value={state.processingMethod || undefined}
                onValueChange={(value) => handleChange('processingMethod', value)}>
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
                disabled={!state.processingMethod}
                aria-label={i18n.t('common.clear')}
                onClick={() => handleChange('processingMethod', undefined)}>
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
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel}>
            {i18n.t('common.cancel')}
          </Button>
          <Button type="button" disabled={vaults.length === 0 || loading || !!error} onClick={handleOk}>
            {i18n.t('chat.topics.export.obsidian_btn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ObsidianProcessingMethod, PopupContainer }
