import { ActionIconButton } from '@renderer/components/Buttons'
import { useShortcut, useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { Tooltip } from 'antd'
import { Eraser } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
interface Props {
  onNewContext: () => void
}

const NewContextButton: FC<Props> = ({ onNewContext }) => {
  const newContextShortcut = useShortcutDisplay('toggle_new_context')
  const { t } = useTranslation()

  useShortcut('toggle_new_context', onNewContext)

  return (
    <Tooltip
      placement="top"
      title={t('chat.input.new.context', { Command: newContextShortcut })}
      mouseLeaveDelay={0}
      arrow>
      <ActionIconButton onClick={onNewContext}>
        <Eraser size={18} />
      </ActionIconButton>
    </Tooltip>
  )
}

export default NewContextButton
