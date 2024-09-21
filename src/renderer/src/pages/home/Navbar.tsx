import { FormOutlined } from '@ant-design/icons'
import { Navbar, NavbarLeft, NavbarRight } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import AssistantSettingPopup from '@renderer/components/Popups/AssistantSettingPopup'
import { isMac, isWindows } from '@renderer/config/constant'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { getDefaultTopic, syncAsistantToAgent } from '@renderer/services/assistant'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/event'
import { Assistant, Topic } from '@renderer/types'
import { Switch } from 'antd'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SelectModelButton from './components/SelectModelButton'

interface Props {
  activeAssistant: Assistant
  activeTopic: Topic
  setActiveTopic: (topic: Topic) => void
}

const HeaderNavbar: FC<Props> = ({ activeAssistant, setActiveTopic }) => {
  const { assistant, updateAssistant, addTopic } = useAssistant(activeAssistant.id)
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { theme, toggleTheme } = useTheme()
  const { topicPosition } = useSettings()
  const { showTopics, toggleShowTopics } = useShowTopics()
  const { t } = useTranslation()

  const onEditAssistant = useCallback(async () => {
    const _assistant = await AssistantSettingPopup.show({ assistant })
    updateAssistant(_assistant)
    syncAsistantToAgent(_assistant)
  }, [assistant, updateAssistant])

  const addNewTopic = useCallback(() => {
    const topic = getDefaultTopic()
    addTopic(topic)
    setActiveTopic(topic)
    db.topics.add({ id: topic.id, messages: [] })
    window.message.success({ content: t('message.topic.added'), key: 'topic-added' })
    setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)
  }, [addTopic, setActiveTopic, t])

  return (
    <Navbar>
      {showAssistants && (
        <NavbarLeft style={{ justifyContent: 'space-between', borderRight: 'none', padding: '0 8px' }}>
          <NewButton onClick={toggleShowAssistants} style={{ marginLeft: isMac ? 8 : 0 }}>
            <i className="iconfont icon-hide-sidebar" />
          </NewButton>
          <NewButton onClick={addNewTopic}>
            <FormOutlined />
          </NewButton>
        </NavbarLeft>
      )}
      <NavbarRight style={{ justifyContent: 'space-between', paddingRight: isWindows ? 140 : 12, flex: 1 }}>
        <HStack alignItems="center">
          {!showAssistants && (
            <NewButton
              onClick={() => toggleShowAssistants()}
              style={{ marginRight: isMac ? 8 : 25, marginLeft: isMac ? 4 : 0 }}>
              <i className="iconfont icon-show-sidebar" />
            </NewButton>
          )}
          <TitleText style={{ marginRight: 10, cursor: 'pointer' }} className="nodrag" onClick={onEditAssistant}>
            {assistant.name}
          </TitleText>
          <SelectModelButton assistant={assistant} />
        </HStack>
        <HStack alignItems="center">
          <ThemeSwitch
            checkedChildren={<i className="iconfont icon-theme icon-dark1" />}
            unCheckedChildren={<i className="iconfont icon-theme icon-theme-light" />}
            checked={theme === 'dark'}
            onChange={toggleTheme}
          />
          {topicPosition === 'right' && (
            <NewButton onClick={toggleShowTopics}>
              <i className={`iconfont icon-${showTopics ? 'show' : 'hide'}-sidebar`} />
            </NewButton>
          )}
        </HStack>
      </NavbarRight>
    </Navbar>
  )
}

export const NewButton = styled.div`
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
    font-size: 19px;
    color: var(--color-icon);
    &.icon-a-addchat {
      font-size: 20px;
    }
    &.icon-a-darkmode {
      font-size: 20px;
    }
  }
  .anticon {
    color: var(--color-icon);
    font-size: 17px;
  }
  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }
`

const TitleText = styled.span`
  margin-left: 5px;
  font-family: Ubuntu;
  font-size: 13px;
  font-weight: 500;
`

const ThemeSwitch = styled(Switch)`
  -webkit-app-region: no-drag;
  margin-right: 10px;
  .icon-theme {
    font-size: 14px;
  }
`

export default HeaderNavbar
