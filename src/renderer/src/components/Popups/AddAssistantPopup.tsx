import { SearchOutlined } from '@ant-design/icons'
import { TopView } from '@renderer/components/TopView'
import systemAgents from '@renderer/config/agents.json'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { covertAgentToAssistant } from '@renderer/services/assistant'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/event'
import { Agent, Assistant } from '@renderer/types'
import { Divider, Input, InputRef, Modal, Tag } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { HStack } from '../Layout'

interface Props {
  resolve: (value: Assistant | undefined) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { agents: userAgents } = useAgents()
  const [searchText, setSearchText] = useState('')
  const { defaultAssistant } = useDefaultAssistant()
  const { assistants, addAssistant } = useAssistants()
  const inputRef = useRef<InputRef>(null)

  const defaultAgent: Agent = useMemo(
    () => ({
      id: defaultAssistant.id,
      name: defaultAssistant.name,
      emoji: defaultAssistant.emoji || '',
      prompt: defaultAssistant.prompt,
      group: 'system'
    }),
    [defaultAssistant.emoji, defaultAssistant.id, defaultAssistant.name, defaultAssistant.prompt]
  )

  const agents = useMemo(() => {
    const allAgents = [...userAgents, ...systemAgents] as Agent[]
    const list = [defaultAgent, ...allAgents.filter((agent) => !assistants.map((a) => a.id).includes(agent.id))]
    return searchText
      ? list.filter((agent) => agent.name.toLowerCase().includes(searchText.trim().toLocaleLowerCase()))
      : list
  }, [assistants, defaultAgent, searchText, userAgents])

  const onCreateAssistant = (agent: Agent) => {
    if (agent.id !== 'default') {
      if (assistants.map((a) => a.id).includes(String(agent.id))) {
        return
      }
    }

    const assistant = covertAgentToAssistant(agent)

    addAssistant(assistant)
    setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
    resolve(assistant)
    setOpen(false)
  }

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    resolve(undefined)
    AddAssistantPopup.hide()
  }

  useEffect(() => {
    open && setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="ant-move-down"
      maskTransitionName="ant-fade"
      styles={{ content: { borderRadius: 20, padding: 0, overflow: 'hidden', paddingBottom: 20 } }}
      closeIcon={null}
      footer={null}>
      <HStack style={{ padding: '0 12px', marginTop: 5 }}>
        <Input
          prefix={
            <SearchIcon>
              <SearchOutlined />
            </SearchIcon>
          }
          ref={inputRef}
          placeholder={t('assistants.search')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
          style={{ paddingLeft: 0 }}
          bordered={false}
          size="middle"
        />
      </HStack>
      <Divider style={{ margin: 0 }} />
      <Container>
        {agents.map((agent) => (
          <AgentItem
            key={agent.id}
            onClick={() => onCreateAssistant(agent)}
            className={agent.id === 'default' ? 'default' : ''}>
            <HStack alignItems="center" gap={5}>
              {agent.emoji} {agent.name}
            </HStack>
            {agent.group === 'system' && <Tag color="green">{t('agents.tag.system')}</Tag>}
            {agent.group === 'user' && <Tag color="orange">{t('agents.tag.user')}</Tag>}
          </AgentItem>
        ))}
      </Container>
    </Modal>
  )
}

const Container = styled.div`
  padding: 0 12px;
  height: 50vh;
  margin-top: 10px;
  overflow-y: auto;
  &::-webkit-scrollbar {
    display: none;
  }
`

const AgentItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 15px;
  border-radius: 8px;
  user-select: none;
  margin-bottom: 8px;
  cursor: pointer;
  &.default {
    background-color: var(--color-background-mute);
  }
  .anticon {
    font-size: 16px;
    color: var(--color-icon);
  }
  &:hover {
    background-color: var(--color-background-mute);
  }
`

const SearchIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
`

export default class AddAssistantPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddAssistantPopup')
  }
  static show() {
    return new Promise<Assistant | undefined>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, 'AddAssistantPopup')
    })
  }
}
