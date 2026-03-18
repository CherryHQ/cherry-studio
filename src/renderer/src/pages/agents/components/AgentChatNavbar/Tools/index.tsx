import { usePreference } from '@data/hooks/usePreference'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShowTopics } from '@renderer/hooks/useStore'
import { Tooltip } from 'antd'
import { PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SettingsButton from './SettingsButton'

const Tools = () => {
  const { t } = useTranslation()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const { isTopNavbar } = useNavbarPosition()
  const [topicPosition] = usePreference('topic.position')
  const [narrowMode, setNarrowMode] = usePreference('chat.narrow_mode')

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    setNarrowMode(!narrowMode)
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
      {isTopNavbar && (
        <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
          <NavbarIcon onClick={() => SearchPopup.show()}>
            <Search size={18} />
          </NavbarIcon>
        </Tooltip>
      )}
      {isTopNavbar && topicPosition === 'right' && !showTopics && (
        <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={2}>
          <NavbarIcon onClick={toggleShowTopics}>
            <PanelLeftClose size={18} />
          </NavbarIcon>
        </Tooltip>
      )}
      {isTopNavbar && topicPosition === 'right' && showTopics && (
        <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={2}>
          <NavbarIcon onClick={toggleShowTopics}>
            <PanelRightClose size={18} />
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
