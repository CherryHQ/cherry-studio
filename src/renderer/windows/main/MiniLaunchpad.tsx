import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'

export function MiniLaunchpad({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <Tooltip content={t('launchpad.apps')} placement="bottom" delay={600}>
      <NavbarIcon tone="conversation" className="[&_svg]:!size-4" aria-label={t('launchpad.apps')} onClick={onOpen}>
        <LayoutGrid strokeWidth={1.7} aria-hidden />
      </NavbarIcon>
    </Tooltip>
  )
}
