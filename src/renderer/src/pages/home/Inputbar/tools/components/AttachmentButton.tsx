import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import type { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBases'
import { useKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { FileMetadata } from '@renderer/types'
import { filterSupportedFiles, formatFileSize } from '@renderer/utils/file'
import type { KnowledgeBase, KnowledgeItemOf } from '@shared/data/types/knowledge'
import dayjs from 'dayjs'
import { FileSearch, FileText, Paperclip, Upload } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  couldAddImageFile: boolean
  extensions: string[]
  files: FileMetadata[]
  setFiles: Dispatch<SetStateAction<FileMetadata[]>>
  disabled?: boolean
}

const AttachmentButton: FC<Props> = ({ quickPanel, couldAddImageFile, extensions, files, setFiles, disabled }) => {
  const { t } = useTranslation()
  const {
    open: openQuickPanelPanel,
    updateList: updateQuickPanelList,
    isVisible: isQuickPanelVisible,
    symbol: quickPanelSymbol,
    multiple: quickPanelMultiple
  } = useQuickPanel()
  const { bases: knowledgeBases } = useKnowledgeBases()
  const [selecting, setSelecting] = useState<boolean>(false)
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('')
  const { items: selectedKnowledgeItems, isLoading: isKnowledgeItemsLoading } =
    useKnowledgeItems(selectedKnowledgeBaseId)

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

  const createKnowledgeFileItems = useCallback(
    (items: KnowledgeItemOf<'file'>[]) =>
      items.map<QuickPanelListItem>((item) => {
        const fileContent = item.data.file
        return {
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
                } else {
                  return [...prevFiles, fileContent]
                }
              })
            }
          }
        }
      }),
    [files, setFiles]
  )

  const openKnowledgeFileList = useCallback(
    (base: KnowledgeBase) => {
      setSelectedKnowledgeBaseId(base.id)
      openQuickPanelPanel({
        title: base.name,
        list: [
          {
            label: t('common.loading'),
            description: '',
            icon: <FileText />,
            disabled: true
          }
        ],
        symbol: QuickPanelReservedSymbol.File,
        multiple: true
      })
    },
    [openQuickPanelPanel, t]
  )

  useEffect(() => {
    if (
      !selectedKnowledgeBaseId ||
      !isQuickPanelVisible ||
      quickPanelSymbol !== QuickPanelReservedSymbol.File ||
      !quickPanelMultiple
    ) {
      return
    }

    const fileItems = selectedKnowledgeItems.filter(
      (item): item is KnowledgeItemOf<'file'> => item.type === 'file' && item.status === 'completed'
    )

    if (isKnowledgeItemsLoading) {
      updateQuickPanelList([
        {
          label: t('common.loading'),
          description: '',
          icon: <FileText />,
          disabled: true
        }
      ])
      return
    }

    updateQuickPanelList(
      fileItems.length > 0
        ? createKnowledgeFileItems(fileItems)
        : [
            {
              label: t('common.no_results'),
              description: '',
              icon: <FileText />,
              disabled: true
            }
          ]
    )
  }, [
    createKnowledgeFileItems,
    isKnowledgeItemsLoading,
    isQuickPanelVisible,
    quickPanelMultiple,
    quickPanelSymbol,
    selectedKnowledgeBaseId,
    selectedKnowledgeItems,
    t,
    updateQuickPanelList
  ])

  const items = useMemo(() => {
    return [
      {
        label: t('chat.input.upload.upload_from_local'),
        description: '',
        icon: <Upload />,
        action: () => openFileSelectDialog()
      },
      ...knowledgeBases.map((base) => {
        return {
          label: base.name,
          description: '',
          icon: <FileSearch />,
          disabled: base.status !== 'completed',
          isMenu: true,
          action: () => openKnowledgeFileList(base)
        }
      })
    ]
  }, [knowledgeBases, openFileSelectDialog, openKnowledgeFileList, t])

  const openQuickPanel = useCallback(() => {
    openQuickPanelPanel({
      title: t('chat.input.upload.attachment'),
      list: items,
      symbol: QuickPanelReservedSymbol.File
    })
  }, [items, openQuickPanelPanel, t])

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
    <Tooltip placement="top" content={ariaLabel}>
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
