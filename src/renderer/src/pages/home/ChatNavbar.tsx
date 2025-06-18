import { NavbarMain } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { isMac } from '@renderer/config/constant'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChat } from '@renderer/hooks/useChat'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants } from '@renderer/hooks/useStore'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { PanelLeft, PanelRight, Search } from 'lucide-react'
import { FC } from 'react'
import styled from 'styled-components'

import SelectModelButton from './components/SelectModelButton'
import UpdateAppButton from './components/UpdateAppButton'

const ChatNavbar: FC = () => {
  const { activeAssistant } = useChat()
  const { assistant } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()

  useShortcut('search_message', SearchPopup.show)

  return (
    <NavbarMain className="home-navbar" style={{ minHeight: 50 }}>
      <HStack alignItems="center" gap={8}>
        <NavbarIcon onClick={() => toggleShowAssistants()}>
          {showAssistants ? <PanelLeft size={18} /> : <PanelRight size={18} />}
        </NavbarIcon>
        <SelectModelButton assistant={assistant} />
      </HStack>
      <HStack alignItems="center" gap={8}>
        <UpdateAppButton />
        {isMac && (
          <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
            <NarrowIcon onClick={() => SearchPopup.show()}>
              <Search size={18} />
            </NarrowIcon>
          </Tooltip>
        )}
      </HStack>
    </NavbarMain>
  )
}

export const NavbarIcon = styled.div`
  -webkit-app-region: none;
  border-radius: 8px;
  height: 30px;
  padding: 0 7px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  .iconfont {
    font-size: 18px;
    color: var(--color-icon);
    &.icon-a-addchat {
      font-size: 20px;
    }
    &.icon-a-darkmode {
      font-size: 20px;
    }
    &.icon-appstore {
      font-size: 20px;
    }
  }
  .anticon {
    color: var(--color-icon);
    font-size: 16px;
  }
  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }
  &.active {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }
`

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

export default ChatNavbar
