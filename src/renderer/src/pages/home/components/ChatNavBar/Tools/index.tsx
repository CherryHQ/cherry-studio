import { Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CommandTooltip } from '@renderer/commands'
import NavbarIcon from '@renderer/components/NavbarIcon'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { modelGenerating } from '@renderer/hooks/useModel'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShowTopics } from '@renderer/hooks/useStore'
import type { Assistant } from '@renderer/types'
import { PanelLeftClose, PanelRightClose, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'

import SettingsButton from './SettingsButton'

interface ToolsProps {
  assistant?: Assistant
}

const Tools = ({ assistant }: ToolsProps) => {
  const { t } = useTranslation()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const { isTopNavbar } = useNavbarPosition()
  const [topicPosition] = usePreference('topic.position')
  const [narrowMode, setNarrowMode] = usePreference('chat.narrow_mode')

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    void setNarrowMode(!narrowMode)
  }

  return (
    <div className="flex items-center gap-2">
      <SettingsButton assistant={assistant} />
      {isTopNavbar && (
        <Tooltip content={t('navbar.expand')} delay={800}>
          <NarrowIcon onClick={handleNarrowModeToggle}>
            <i className="iconfont icon-icon-adaptive-width"></i>
          </NarrowIcon>
        </Tooltip>
      )}
      {isTopNavbar && (
        <CommandTooltip command="app.search" label={t('chat.assistant.search.placeholder')} delay={800}>
          <NavbarIcon onClick={() => SearchPopup.show()}>
            <Search size={18} />
          </NavbarIcon>
        </CommandTooltip>
      )}
      {isTopNavbar && topicPosition === 'right' && !showTopics && (
        <CommandTooltip command="topic.sidebar.toggle" label={t('navbar.show_sidebar')} delay={2000}>
          <NavbarIcon onClick={toggleShowTopics}>
            <PanelLeftClose size={18} />
          </NavbarIcon>
        </CommandTooltip>
      )}
      {isTopNavbar && topicPosition === 'right' && showTopics && (
        <CommandTooltip command="topic.sidebar.toggle" label={t('navbar.hide_sidebar')} delay={2000}>
          <NavbarIcon onClick={toggleShowTopics}>
            <PanelRightClose size={18} />
          </NavbarIcon>
        </CommandTooltip>
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
