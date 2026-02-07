import { Tooltip } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { dataApiService } from '@renderer/data/DataApiService'
import { useKnowledgeBases } from '@renderer/data/hooks/useKnowledges'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { FileType } from '@renderer/types'
import { filterSupportedFiles, formatFileSize } from '@renderer/utils/file'
import type { FileItemData, KnowledgeBase, KnowledgeItem, KnowledgeItemTreeNode } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { FileSearch, FileText, Paperclip, Upload } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('AttachmentButton')

function flattenKnowledgeItems(treeNodes: KnowledgeItemTreeNode[]): KnowledgeItem[] {
  const flattened: KnowledgeItem[] = []

  const traverse = (node: KnowledgeItemTreeNode) => {
    flattened.push(node.item)
    node.children.forEach(traverse)
  }

  treeNodes.forEach(traverse)
  return flattened
}

interface Props {
  quickPanel: ToolQuickPanelApi
  couldAddImageFile: boolean
  extensions: string[]
  files: FileType[]
  setFiles: Dispatch<SetStateAction<FileType[]>>
  disabled?: boolean
}

const AttachmentButton: FC<Props> = ({ quickPanel, couldAddImageFile, extensions, files, setFiles, disabled }) => {
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const { bases: knowledgeBases } = useKnowledgeBases()
  const [selecting, setSelecting] = useState<boolean>(false)

  const openFileSelectDialog = useCallback(async () => {
    if (selecting) {
      return
    }
    // when the number of extensions is greater than 20, use *.* to avoid selecting window lag
    const useAllFiles = extensions.length > 20

    setSelecting(true)
    const _files = await window.api.file.select({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Files',
          extensions: useAllFiles ? ['*'] : extensions.map((i) => i.replace('.', ''))
        }
      ]
    })
    setSelecting(false)

    if (_files) {
      if (!useAllFiles) {
        setFiles([...files, ..._files])
        return
      }
      const supportedFiles = await filterSupportedFiles(_files, extensions)
      if (supportedFiles.length > 0) {
        setFiles([...files, ...supportedFiles])
      }

      if (supportedFiles.length !== _files.length) {
        window.toast.info(
          t('chat.input.file_not_supported_count', {
            count: _files.length - supportedFiles.length
          })
        )
      }
    }
  }, [extensions, files, selecting, setFiles, t])

  const openKnowledgeFileList = useCallback(
    async (base: KnowledgeBase) => {
      try {
        const treeItems = (await dataApiService.get(
          `/knowledge-bases/${base.id}/items` as any
        )) as KnowledgeItemTreeNode[]
        const fetchedItems = flattenKnowledgeItems(treeItems)

        const fileItems = fetchedItems
          .filter((item) => item.type === 'file' && !item.parentId)
          .map((item) => (item.data as FileItemData).file as FileType)

        quickPanelHook.open({
          title: base.name,
          list: fileItems.map((fileContent) => ({
            label: fileContent.origin_name || fileContent.name,
            description:
              formatFileSize(fileContent.size) + ' · ' + dayjs(fileContent.created_at).format('YYYY-MM-DD HH:mm'),
            icon: <FileText />,
            isSelected: files.some((f) => f.path === fileContent.path),
            action: async ({ item }) => {
              item.isSelected = !item.isSelected
              if (fileContent.path) {
                setFiles((prevFiles) => {
                  const fileExists = prevFiles.some((f) => f.path === fileContent.path)
                  if (fileExists) {
                    return prevFiles.filter((f) => f.path !== fileContent.path)
                  }
                  return [...prevFiles, fileContent]
                })
              }
            }
          })),
          symbol: QuickPanelReservedSymbol.File,
          multiple: true
        })
      } catch (error) {
        logger.error('Failed to load knowledge files for quick panel', error as Error, { baseId: base.id })
        window.toast.error(t('message.error.file.read'))
      }
    },
    [files, quickPanelHook, setFiles, t]
  )

  const items = useMemo(() => {
    return [
      {
        label: t('chat.input.upload.upload_from_local'),
        description: '',
        icon: <Upload />,
        action: () => openFileSelectDialog()
      },
      ...knowledgeBases.map((base) => {
        const length = base.documentCount ?? 0
        return {
          label: base.name,
          description: `${length} ${t('files.count')}`,
          icon: <FileSearch />,
          disabled: length === 0,
          isMenu: true,
          action: () => openKnowledgeFileList(base)
        }
      })
    ]
  }, [knowledgeBases, openFileSelectDialog, openKnowledgeFileList, t])

  const openQuickPanel = useCallback(() => {
    quickPanelHook.open({
      title: t('chat.input.upload.attachment'),
      list: items,
      symbol: QuickPanelReservedSymbol.File
    })
  }, [items, quickPanelHook, t])

  useEffect(() => {
    const disposeRootMenu = quickPanel.registerRootMenu([
      {
        label: couldAddImageFile ? t('chat.input.upload.attachment') : t('chat.input.upload.document'),
        description: '',
        icon: <Paperclip />,
        isMenu: true,
        action: () => openQuickPanel()
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.File, () => openQuickPanel())

    return () => {
      disposeRootMenu()
      disposeTrigger()
    }
  }, [couldAddImageFile, openQuickPanel, quickPanel, t])

  const ariaLabel = couldAddImageFile ? t('chat.input.upload.image_or_document') : t('chat.input.upload.document')

  return (
    <Tooltip placement="top" content={ariaLabel} closeDelay={0}>
      <ActionIconButton
        onClick={openFileSelectDialog}
        active={files.length > 0}
        disabled={disabled}
        aria-label={ariaLabel}
        icon={<Paperclip size={18} />}
      />
    </Tooltip>
  )
}

export default AttachmentButton
