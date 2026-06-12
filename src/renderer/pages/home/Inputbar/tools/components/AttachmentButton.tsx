import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { FileMetadata } from '@renderer/types'
import { filterSupportedFiles } from '@renderer/utils/file'
import { Paperclip, Upload } from 'lucide-react'
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
  const { open: openQuickPanelPanel } = useQuickPanel()
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

  // NOTE: Attaching a knowledge-base file to the chat input is temporarily
  // disconnected. It previously bridged a v2 knowledge item into the legacy
  // `FileMetadata` shape (via Knowledge.getFileMetadata) that the chat
  // attachment pipeline still consumes. Reconnecting it cleanly depends on
  // migrating that pipeline off `FileMetadata` onto FileEntry/FileHandle — a
  // cross-domain change tracked in knowledge-todo.md and
  // v2-refactor-temp/docs/file-manager/filemetadata-consumer-audit.md.
  const items = useMemo(() => {
    return [
      {
        label: t('chat.input.upload.upload_from_local'),
        description: '',
        icon: <Upload />,
        action: () => openFileSelectDialog()
      }
    ]
  }, [openFileSelectDialog, t])

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
