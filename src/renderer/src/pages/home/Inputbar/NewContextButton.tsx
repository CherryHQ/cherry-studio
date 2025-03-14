import { PicCenterOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut, useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onNewContext: () => void
  ToolbarButton: any
}

const NewContextButton: FC<Props> = ({ onNewContext, ToolbarButton }) => {
  const newContextShortcut = useShortcutDisplay('toggle_new_context')
  const { t } = useTranslation()
  const { showInputEstimatedTokens } = useSettings()

  useShortcut('toggle_new_context', onNewContext)

  if (!showInputEstimatedTokens) {
    return null
  }

  return (
    <Tooltip placement="top" title={t('chat.input.new.context', { Command: newContextShortcut })} arrow>
      <ToolbarButton type="text" onClick={onNewContext}>
        <PicCenterOutlined />
      </ToolbarButton>
    </Tooltip>
  )
}

export default NewContextButton
