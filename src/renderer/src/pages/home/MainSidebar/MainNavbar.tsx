import { PanelLeftIcon } from '@renderer/components/Icons/PanelIcons'
import { isMac } from '@renderer/config/constant'
import { useShowAssistants } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { MessageSquareDiff } from 'lucide-react'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {}

const HeaderNavbar: FC<Props> = () => {
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  return (
    <Container>
      {showAssistants && (
        <NavbarIcon onClick={() => toggleShowAssistants()}>
          <PanelLeftIcon size={18} expanded={true} />
        </NavbarIcon>
      )}
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

export default HeaderNavbar
