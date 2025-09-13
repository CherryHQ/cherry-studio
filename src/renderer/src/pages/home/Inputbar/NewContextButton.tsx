import { Tooltip } from '@heroui/react'
import { useShortcut, useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { Eraser } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onNewContext: () => void
  ToolbarButton: any
}

const NewContextButton: FC<Props> = ({ onNewContext, ToolbarButton }) => {
  const newContextShortcut = useShortcutDisplay('toggle_new_context')
  const { t } = useTranslation()

  useShortcut('toggle_new_context', onNewContext)

  return (
    <Tooltip placement="top" content={t('chat.input.new.context', { Command: newContextShortcut })} showArrow={true}>
      <ToolbarButton type="text" onClick={onNewContext}>
        <Eraser size={18} />
      </ToolbarButton>
    </Tooltip>
  )
}

export default NewContextButton
