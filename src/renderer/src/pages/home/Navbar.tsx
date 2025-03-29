import { FormOutlined, MoreOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import { Navbar, NavbarLeft, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import MinAppsPopover from '@renderer/components/Popups/MinAppsPopover'
import SearchPopup from '@renderer/components/Popups/SearchPopup'
import { isMac } from '@renderer/config/constant'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { setNarrowMode } from '@renderer/store/settings'
import { Button, Tooltip } from 'antd'
import { t } from 'i18next'
import { FC, useState } from 'react'
import styled from 'styled-components'

import SelectAssistantButton from './components/SelectAssistantButton'
import SelectModelButton from './components/SelectModelButton'
import UpdateAppButton from './components/UpdateAppButton'

const HeaderNavbar: FC = () => {
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { topicPosition, sidebarIcons, narrowMode } = useSettings()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const dispatch = useAppDispatch()
  const [showModelSelector, setShowModelSelector] = useState(true)

  useShortcut('toggle_show_assistants', () => {
    toggleShowAssistants()
  })

  useShortcut('toggle_show_topics', () => {
    if (topicPosition === 'right') {
      toggleShowTopics()
    } else {
      EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
    }
  })

  useShortcut('search_message', () => {
    SearchPopup.show()
  })

  const handleNarrowModeToggle = async () => {
    await modelGenerating()
    dispatch(setNarrowMode(!narrowMode))
  }

  return (
    <Navbar className="home-navbar">
      {showAssistants && (
        <NavbarLeft style={{ justifyContent: 'space-between', borderRight: 'none', padding: 0 }}>
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={toggleShowAssistants} style={{ marginLeft: isMac ? 16 : 0 }}>
              <i className="iconfont icon-hide-sidebar" />
            </NavbarIcon>
          </Tooltip>
          <Tooltip title={t('settings.shortcuts.new_topic')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={() => EventEmitter.emit(EVENT_NAMES.ADD_NEW_TOPIC)}>
              <FormOutlined />
            </NavbarIcon>
          </Tooltip>
        </NavbarLeft>
      )}
      <NavbarRight style={{ justifyContent: 'space-between', flex: 1 }} className="home-navbar-right">
        <HStack alignItems="center">
          {!showAssistants && (
            <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8}>
              <NavbarIcon
                onClick={() => toggleShowAssistants()}
                style={{ marginRight: 8, marginLeft: isMac ? 4 : -12 }}>
                <i className="iconfont icon-show-sidebar" />
              </NavbarIcon>
            </Tooltip>
          )}
          <HStack alignItems="center" gap={2}>
            <SelectAssistantButton />
            <Tooltip
              title={showModelSelector ? t('navbar.hide_select_model') : t('navbar.show_select_model')}
              mouseEnterDelay={0.8}>
              <ShowModelSelectorButton
                size="small"
                type="text"
                icon={showModelSelector ? <RightOutlined /> : <MoreOutlined />}
                onClick={() => setShowModelSelector(!showModelSelector)}
              />
            </Tooltip>
            {showModelSelector && <SelectModelButton />}
          </HStack>
        </HStack>
        <HStack alignItems="center" gap={8}>
          <UpdateAppButton />
          <Tooltip title={t('chat.assistant.search.placeholder')} mouseEnterDelay={0.8}>
            <NarrowIcon onClick={() => SearchPopup.show()}>
              <SearchOutlined />
            </NarrowIcon>
          </Tooltip>
          <Tooltip title={t('navbar.expand')} mouseEnterDelay={0.8}>
            <NarrowIcon onClick={handleNarrowModeToggle}>
              <i className="iconfont icon-icon-adaptive-width"></i>
            </NarrowIcon>
          </Tooltip>
          {sidebarIcons.visible.includes('minapp') && (
            <MinAppsPopover>
              <Tooltip title={t('minapp.title')} mouseEnterDelay={0.8}>
                <NarrowIcon>
                  <i className="iconfont icon-appstore" />
                </NarrowIcon>
              </Tooltip>
            </MinAppsPopover>
          )}
          {topicPosition === 'right' && (
            <NarrowIcon onClick={toggleShowTopics}>
              <i className={`iconfont icon-${showTopics ? 'show' : 'hide'}-sidebar`} />
            </NarrowIcon>
          )}
        </HStack>
      </NavbarRight>
    </Navbar>
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
`

const NarrowIcon = styled(NavbarIcon)`
  @media (max-width: 1000px) {
    display: none;
  }
`

const ShowModelSelectorButton = styled(Button)`
  -webkit-app-region: none;
  width: 18px !important;
  color: var(--color-text-3);

  &:hover {
    background-color: transparent !important;
    color: var(--color-primary) !important;
  }
`

export default HeaderNavbar
