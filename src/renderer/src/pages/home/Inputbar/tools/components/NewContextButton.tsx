import { CommandTooltip } from '@renderer/commands'
import { ActionIconButton } from '@renderer/components/Buttons'
import { Eraser } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
interface Props {
  onNewContext: () => void
}

const NewContextButton: FC<Props> = ({ onNewContext }) => {
  const { t } = useTranslation()
  const label = t('chat.input.new.context', { Command: '' }).trim()

  return (
    <CommandTooltip command="chat.context.toggle_new" label={label}>
      <ActionIconButton onClick={onNewContext} aria-label={label} icon={<Eraser size={18} />} />
    </CommandTooltip>
  )
}

export default NewContextButton
