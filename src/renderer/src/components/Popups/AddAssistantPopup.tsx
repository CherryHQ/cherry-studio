import { TopView } from '@renderer/components/TopView'
import { useAgents } from '@renderer/hooks/useAgents'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useSystemAgents } from '@renderer/pages/agents'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Agent, Assistant } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { Divider, Input, InputRef, Modal, Tag } from 'antd'
import { take } from 'lodash'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import EmojiIcon from '../EmojiIcon'
import { HStack } from '../Layout'
import Scrollbar from '../Scrollbar'

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
  const systemAgents = useSystemAgents()
  const loadingRef = useRef(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const agents = useMemo(() => {
    const allAgents = [...userAgents, ...systemAgents] as Agent[]
    const list = [defaultAssistant, ...allAgents.filter((agent) => !assistants.map((a) => a.id).includes(agent.id))]
    const filtered = searchText
      ? list.filter((agent) => agent.name.toLowerCase().includes(searchText.trim().toLocaleLowerCase()))
      : list

    if (searchText.trim()) {
      const newAgent: Agent = {
        id: 'new',
        name: searchText.trim(),
        prompt: '',
        topics: [],
        type: 'assistant',
        emoji: '⭐️'
      }
      return [newAgent, ...filtered]
    }
    return filtered
  }, [assistants, defaultAssistant, searchText, systemAgents, userAgents])

  // 重置选中索引当搜索或列表内容变更时
  useEffect(() => {
    setSelectedIndex(0)
  }, [agents.length, searchText])

  const onCreateAssistant = useCallback(
    async (agent: Agent) => {
      if (loadingRef.current) {
        return
      }

      loadingRef.current = true
      let assistant: Assistant

      if (agent.id === 'default') {
        assistant = { ...agent, id: uuid() }
        addAssistant(assistant)
      } else {
        assistant = await createAssistantFromAgent(agent)
      }

      setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
      resolve(assistant)
      setOpen(false)
    },
    [resolve, addAssistant, setOpen]
  ) // 添加函数内使用的依赖项
  // 键盘导航处理
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const displayedAgents = take(agents, 100)

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev >= displayedAgents.length - 1 ? 0 : prev + 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev <= 0 ? displayedAgents.length - 1 : prev - 1))
          break
        case 'Enter':
        case 'NumpadEnter':
          // 如果焦点在输入框且有搜索内容，则默认选择第一项
          if (document.activeElement === inputRef.current?.input && searchText.trim()) {
            e.preventDefault()
            onCreateAssistant(displayedAgents[selectedIndex])
          }
          // 否则选择当前选中项
          else if (selectedIndex >= 0 && selectedIndex < displayedAgents.length) {
            e.preventDefault()
            onCreateAssistant(displayedAgents[selectedIndex])
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, selectedIndex, agents, searchText, onCreateAssistant])

  // 确保选中项在可视区域
  useEffect(() => {
    if (containerRef.current) {
      const agentItems = containerRef.current.querySelectorAll('.agent-item')
      if (agentItems[selectedIndex]) {
        agentItems[selectedIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }
    }
  }, [selectedIndex])

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    resolve(undefined)
    AddAssistantPopup.hide()
  }

  useEffect(() => {
    if (!open) return

    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 20
        },
        body: {
          padding: 0
        }
      }}
      closeIcon={null}
      footer={null}>
      <HStack style={{ padding: '0 12px', marginTop: 5 }}>
        <Input
          prefix={
            <SearchIcon>
              <Search size={14} />
            </SearchIcon>
          }
          ref={inputRef}
          placeholder={t('assistants.search')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
        />
      </HStack>
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />
      <Container ref={containerRef}>
        {take(agents, 100).map((agent, index) => (
          <AgentItem
            key={agent.id}
            onClick={() => onCreateAssistant(agent)}
            className={`agent-item ${agent.id === 'default' ? 'default' : ''} ${index === selectedIndex ? 'keyboard-selected' : ''}`}
            onMouseEnter={() => setSelectedIndex(index)}>
            <HStack alignItems="center" gap={5} style={{ overflow: 'hidden', maxWidth: '100%' }}>
              <EmojiIcon emoji={agent.emoji || ''} />
              <span className="text-nowrap">{agent.name}</span>
            </HStack>
            {agent.id === 'default' && <Tag color="green">{t('agents.tag.system')}</Tag>}
            {agent.type === 'agent' && <Tag color="orange">{t('agents.tag.agent')}</Tag>}
            {agent.id === 'new' && <Tag color="green">{t('agents.tag.new')}</Tag>}
          </AgentItem>
        ))}
      </Container>
    </Modal>
  )
}

const Container = styled(Scrollbar)`
  padding: 0 12px;
  height: 50vh;
  margin-top: 10px;
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
  overflow: hidden;
  &.default {
    background-color: var(--color-background-mute);
  }
  &.keyboard-selected {
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-mute);
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
