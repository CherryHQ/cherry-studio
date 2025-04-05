import { PaperClipOutlined } from '@ant-design/icons'
import { isVisionModel } from '@renderer/config/models'
import { FileType, Model } from '@renderer/types'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Tooltip } from 'antd'
import { FC, useCallback, useImperativeHandle } from 'react'
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
  const extensions = isVisionModel(model)
    ? [...imageExts, ...documentExts, ...textExts]
    : [...documentExts, ...textExts]

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
  }, [files, setFiles])

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
      <ToolbarButton type="text" className={files.length ? 'active' : ''} onClick={onSelectFile} disabled={disabled}>
        <PaperClipOutlined style={{ fontSize: 17 }} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default AttachmentButton
