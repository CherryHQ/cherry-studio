import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import { useShortcut, useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { Eraser } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
interface Props {
  onNewContext: () => void
}

const NewContextButton: FC<Props> = ({ onNewContext }) => {
  const newContextShortcut = useShortcutDisplay('toggle_new_context')
  const { t } = useTranslation()

  useShortcut('toggle_new_context', onNewContext)

  return (
    <Tooltip content={t('chat.input.new.context', { Command: newContextShortcut })} closeDelay={0}>
      <ActionIconButton onClick={onNewContext} icon={<Eraser size={18} />} />
    </Tooltip>
  )
}

export default NewContextButton
