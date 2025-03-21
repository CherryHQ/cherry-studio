import { PaperClipOutlined } from '@ant-design/icons'
import { FileType } from '@renderer/types'
import { documentExts, imageExts, textExts } from '@shared/config/constant'
import { Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  visionCapable: boolean
  files: FileType[]
  setFiles: (files: FileType[]) => void
  ToolbarButton: any
  disabled?: boolean
}

const AttachmentButton: FC<Props> = ({ visionCapable, files, setFiles, ToolbarButton, disabled }) => {
  const { t } = useTranslation()
  const extensions = visionCapable ? [...imageExts, ...documentExts, ...textExts] : [...documentExts, ...textExts]

  const onSelectFile = async () => {
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
  }

  return (
    <Tooltip placement="top" title={visionCapable ? t('chat.input.upload') : t('chat.input.upload.document')} arrow>
      <ToolbarButton type="text" className={files.length ? 'active' : ''} onClick={onSelectFile} disabled={disabled}>
        <PaperClipOutlined style={{ fontSize: 17 }} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default AttachmentButton
