import { Tooltip } from '@cherrystudio/ui'
import { t } from 'i18next'
import { Settings2 } from 'lucide-react'
import type { FC } from 'react'

import NavbarIcon from '../../../../../components/NavbarIcon'

interface Props {
  onOpenSettings: () => void
}

const SettingsButton: FC<Props> = ({ onOpenSettings }) => {
  return (
    <Tooltip content={t('settings.parameter_settings')} delay={800}>
      <NavbarIcon onClick={onOpenSettings}>
        <Settings2 size={18} />
      </NavbarIcon>
    </Tooltip>
  )
}

export default SettingsButton
