import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import SettingsButton from './SettingsButton'

interface Props {
  onOpenSettings: () => void
}

const Tools = ({ onOpenSettings }: Props) => {
  const { t } = useTranslation()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { isTopNavbar } = useNavbarPosition()
  const [topicPosition] = usePreference('topic.position')
  const [narrowMode, setNarrowMode] = usePreference('chat.narrow_mode')

  const handleNarrowModeToggle = () => {
    void setNarrowMode(!narrowMode)
  }

  return (
    <div className="flex items-center gap-2">
      <SettingsButton onOpenSettings={onOpenSettings} />
      {isTopNavbar && (
        <Tooltip content={t('navbar.expand')} delay={800}>
          <NavbarIcon className="max-[1000px]:hidden" onClick={handleNarrowModeToggle}>
            <i className="iconfont icon-icon-adaptive-width"></i>
          </NavbarIcon>
        </Tooltip>
      )}
      {/* TODO: Add search button back when global search supports agent messages */}
      {isTopNavbar && topicPosition === 'right' && (
        <Tooltip content={showSidebar ? t('navbar.hide_sidebar') : t('navbar.show_sidebar')} delay={2000}>
          <NavbarIcon onClick={toggleShowSidebar}>
            {showSidebar ? <PanelRightClose size={18} /> : <PanelLeftClose size={18} />}
          </NavbarIcon>
        </Tooltip>
      )}
    </div>
  )
}

export default Tools
