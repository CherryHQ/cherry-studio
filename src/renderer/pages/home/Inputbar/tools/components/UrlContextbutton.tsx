import { Tooltip } from '@cherrystudio/ui'
import { ActionIconButton } from '@renderer/components/Buttons'
import { Link } from 'lucide-react'
import type { FC } from 'react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface UrlContextButtonRef {
  openQuickPanel: () => void
}

interface Props {
  ref?: React.RefObject<UrlContextButtonRef | null>
  // Kept for callsite compatibility — the toggle is now per-inputbar transient
  // state, decoupled from any persisted assistant field. Will be removed once
  // all inputbar tool consumers stop forwarding the prop.
  assistantId?: string
}

const UrlContextButton: FC<Props> = () => {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)

  const handleToggle = useCallback(() => {
    setEnabled((prev) => !prev)
  }, [])

  return (
    <Tooltip content={t('chat.input.url_context')}>
      <ActionIconButton
        onClick={handleToggle}
        active={enabled}
        aria-label={t('chat.input.url_context')}
        aria-pressed={enabled}
        icon={<Link size={18} />}
      />
    </Tooltip>
  )
}

export default memo(UrlContextButton)
