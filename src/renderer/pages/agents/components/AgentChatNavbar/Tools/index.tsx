import { usePreference } from '@data/hooks/usePreference'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { Tooltip } from 'antd'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SettingsButton from './SettingsButton'

const Tools = () => {
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
      <SettingsButton />
      {isTopNavbar && (
        <Tooltip title={t('navbar.expand')} mouseEnterDelay={0.8}>
          <NarrowIcon onClick={handleNarrowModeToggle}>
            <i className="iconfont icon-icon-adaptive-width"></i>
          </NarrowIcon>
        </Tooltip>
      )}
      {/* TODO: Add search button back when global search supports agent messages */}
      {isTopNavbar && topicPosition === 'right' && (
        <Tooltip title={showSidebar ? t('navbar.hide_sidebar') : t('navbar.show_sidebar')} mouseEnterDelay={2}>
          <NavbarIcon onClick={toggleShowSidebar}>
            {showSidebar ? <PanelRightClose size={18} /> : <PanelLeftClose size={18} />}
          </NavbarIcon>
        </Tooltip>
      )}
    </div>
  )
}

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

export default Tools
