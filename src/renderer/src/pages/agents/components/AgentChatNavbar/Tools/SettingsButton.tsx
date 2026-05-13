import { Tooltip } from '@cherrystudio/ui'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { t } from 'i18next'
import { Settings2 } from 'lucide-react'

interface Props {
  onOpenSettings: () => void
}

const SettingsButton = ({ onOpenSettings }: Props) => {
  return (
    <Tooltip content={t('settings.parameter_settings')} delay={800}>
      <NavbarIcon onClick={onOpenSettings}>
        <Settings2 size={18} />
      </NavbarIcon>
    </Tooltip>
  )
}

export default SettingsButton
