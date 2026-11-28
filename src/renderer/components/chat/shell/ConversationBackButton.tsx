import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'

export function ConversationBackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  const label = t('common.back')

  return (
    <Tooltip content={label} placement="bottom">
      <NavbarIcon tone="conversation" aria-label={label} onClick={onClick}>
        <ArrowLeft />
      </NavbarIcon>
    </Tooltip>
  )
}
