import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import { Eraser } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
interface Props {
  onNewContext: () => void
}

const NewContextButton: FC<Props> = ({ onNewContext }) => {
  const { t } = useTranslation()

  return (
    <Tooltip content={t('chat.input.new.context')}>
      <ActionIconButton onClick={onNewContext} aria-label={t('chat.input.new.context')} icon={<Eraser size={18} />} />
    </Tooltip>
  )
}

export default NewContextButton
