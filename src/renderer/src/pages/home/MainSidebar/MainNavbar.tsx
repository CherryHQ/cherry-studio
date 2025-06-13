import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { isMac } from '@renderer/config/constant'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { MessageSquareDiff, Search } from 'lucide-react'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {}

const HeaderNavbar: FC<Props> = () => {
  return (
    <Container>
      <div>
        {!isMac && (
          <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
            <NarrowIcon onClick={() => SearchPopup.show()}>
              <Search size={18} />
            </NarrowIcon>
          </Tooltip>
        )}
      </div>
      <Tooltip title={t('settings.shortcuts.new_topic')} mouseEnterDelay={0.8}>
        <NavbarIcon onClick={() => EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC)}>
          <MessageSquareDiff size={18} />
        </NavbarIcon>
      </Tooltip>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  width: var(--assistant-width);
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 0;
  height: var(--navbar-height);
  min-height: var(--navbar-height);
  background-color: transparent;
  -webkit-app-region: drag;
  padding: 0 15px;
  padding-left: ${isMac ? '75px' : '15px'};
`

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
  -webkit-app-region: no-drag;
  cursor: pointer;
  &:hover {
    background-color: var(--color-list-item);
    color: var(--color-icon-white);
  }
`

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

export default HeaderNavbar
