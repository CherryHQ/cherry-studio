import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import type { FileType, KnowledgeBase, KnowledgeItem } from '@renderer/types'
import { filterSupportedFiles, formatFileSize } from '@renderer/utils/file'
import { Tooltip } from 'antd'
import dayjs from 'dayjs'
import { FileSearch, FileText, Paperclip, Upload } from 'lucide-react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useCallback, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface AttachmentButtonRef {
  openQuickPanel: () => void
  openFileSelectDialog: () => void
}

interface Props {
  ref?: React.RefObject<AttachmentButtonRef | null>
  couldAddImageFile: boolean
  extensions: string[]
  files: FileType[]
  setFiles: Dispatch<SetStateAction<FileType[]>>
  disabled?: boolean
}

const AttachmentButton: FC<Props> = ({ ref, couldAddImageFile, extensions, files, setFiles, disabled }) => {
  const { t } = useTranslation()
  const quickPanel = useQuickPanel()
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
    (base: KnowledgeBase) => {
      quickPanel.open({
        title: base.name,
        list: base.items
          .filter((file): file is KnowledgeItem => ['file'].includes(file.type))
          .map((file) => {
            const fileContent = file.content as FileType
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
                      return fileContent ? [...prevFiles, fileContent] : prevFiles
                    }
                  })
                }
              }
            }
          }),
        symbol: QuickPanelReservedSymbol.File,
        multiple: true
      })
    },
    [files, quickPanel, setFiles]
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
        const length = base.items?.filter(
          (item): item is KnowledgeItem => ['file', 'note'].includes(item.type) && typeof item.content !== 'string'
        ).length
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
    quickPanel.open({
      title: t('chat.input.upload.attachment'),
      list: items,
      symbol: QuickPanelReservedSymbol.File
    })
  }, [items, quickPanel, t])

  useImperativeHandle(ref, () => ({
    openQuickPanel,
    openFileSelectDialog
  }))

  return (
    <Tooltip
      placement="top"
      title={couldAddImageFile ? t('chat.input.upload.image_or_document') : t('chat.input.upload.document')}
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton onClick={openFileSelectDialog} active={files.length > 0} disabled={disabled}>
        <Paperclip size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default AttachmentButton
