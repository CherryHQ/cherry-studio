import { isVisionModel } from '@renderer/config/models'
import { FileType, Model } from '@renderer/types'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Tooltip } from 'antd'
import { Paperclip } from 'lucide-react'
import { FC, useCallback, useImperativeHandle, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export interface AttachmentButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<AttachmentButtonRef | null>
  model: Model
  files: FileType[]
  setFiles: (files: FileType[]) => void
  ToolbarButton: any
  disabled?: boolean
}

const AttachmentButton: FC<Props> = ({ ref, model, files, setFiles, ToolbarButton, disabled }) => {
  const { t } = useTranslation()

  const extensions = useMemo(
    () => (isVisionModel(model) ? [...imageExts, ...documentExts, ...textExts] : [...documentExts, ...textExts]),
    [model]
  )

  const onSelectFile = useCallback(async () => {
    const _files = await window.api.file.select({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Files',
          extensions: extensions.map((i) => i.replace('.', ''))
        }
      ]
    })

    if (_files) {
      setFiles([...files, ..._files])
    }
  }, [extensions, files, setFiles])

  const openQuickPanel = useCallback(() => {
    onSelectFile()
  }, [onSelectFile])

  useImperativeHandle(ref, () => ({
    openQuickPanel
  }))

  return (
    <Tooltip
      placement="top"
      title={isVisionModel(model) ? t('chat.input.upload') : t('chat.input.upload.document')}
      arrow>
      <ToolbarButton type="text" onClick={onSelectFile} disabled={disabled}>
        <Paperclip size={18} style={{ color: files.length ? 'var(--color-primary)' : 'var(--color-icon)' }} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default AttachmentButton
