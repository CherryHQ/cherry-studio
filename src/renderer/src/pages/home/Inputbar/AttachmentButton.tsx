import { FileType } from '@renderer/types'
import { filterSupportedFiles } from '@renderer/utils/file'
import { Tooltip } from 'antd'
import { Paperclip } from 'lucide-react'
import { FC, useCallback, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface AttachmentButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<AttachmentButtonRef | null>
  couldAddImageFile: boolean
  extensions: string[]
  files: FileType[]
  setFiles: (files: FileType[]) => void
  ToolbarButton: any
  disabled?: boolean
}

const AttachmentButton: FC<Props> = ({
  ref,
  couldAddImageFile,
  extensions,
  files,
  setFiles,
  ToolbarButton,
  disabled
}) => {
  const { t } = useTranslation()
  const [selecting, setSelecting] = useState<boolean>(false)

  const onSelectFile = useCallback(async () => {
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

  const openQuickPanel = useCallback(() => {
    onSelectFile()
  }, [onSelectFile])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip
      placement="top"
      title={couldAddImageFile ? t('chat.input.upload.label') : t('chat.input.upload.document')}
      mouseLeaveDelay={0}
      arrow
    >
      <ToolbarButton type="text" onClick={onSelectFile} disabled={disabled}>
        <Paperclip size={18} style={{ color: files.length ? 'var(--color-primary)' : 'var(--color-icon)' }} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default AttachmentButton
