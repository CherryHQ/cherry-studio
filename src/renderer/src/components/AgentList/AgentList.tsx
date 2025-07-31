import { FC, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Agent, AgentStatus } from '@renderer/types/agent'
import { Button, Dropdown, Menu } from 'antd'

interface AgentListProps {
  selectedAgentId?: string
  onAgentSelect?: (agent: Agent | null) => void
}

const AgentList: FC<AgentListProps> = ({ selectedAgentId, onAgentSelect }) => {
  const { t } = useTranslation()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [contextMenuVisible, setContextMenuVisible] = useState(false)
  const [contextMenuAgent, setContextMenuAgent] = useState<Agent | null>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loadAgents = async () => {
      try {
        setLoading(true)
        const agentList = await window.api.agent.list()
        setAgents(agentList)
      } catch (error) {
        console.error('Failed to load agents:', error)
        setAgents([])
      } finally {
        setLoading(false)
      }
    }

    loadAgents()
  }, [])

  const handleAgentClick = (agent: Agent) => {
    if (selectedAgentId === agent.id) {
      // Deselect if clicking the selected agent
      onAgentSelect?.(null)
    } else {
      onAgentSelect?.(agent)
    }
  }

  const handleAgentContextMenu = (agent: Agent, event: React.MouseEvent) => {
    event.preventDefault()
    setContextMenuAgent(agent)
    setContextMenuVisible(true)
  }

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        const nextIndex = Math.min(index + 1, agents.length - 1)
        setFocusedIndex(nextIndex)
        // Focus the next item
        const nextItem = listRef.current?.querySelector(`[data-index="${nextIndex}"]`) as HTMLElement
        nextItem?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        const prevIndex = Math.max(index - 1, 0)
        setFocusedIndex(prevIndex)
        // Focus the previous item
        const prevItem = listRef.current?.querySelector(`[data-index="${prevIndex}"]`) as HTMLElement
        prevItem?.focus()
        break
      case 'Enter':
        event.preventDefault()
        handleAgentClick(agents[index])
        break
    }
  }

  const handleCreateFirst = () => {
    // This would typically open a create agent dialog
    console.log('Create first agent')
  }

  const contextMenu = (
    <Menu>
      <Menu.Item key="edit" data-testid="context-menu-edit">
        {t('agent_list.action.edit')}
      </Menu.Item>
      <Menu.Item key="delete" data-testid="context-menu-delete">
        {t('agent_list.action.delete')}
      </Menu.Item>
    </Menu>
  )

  if (loading) {
    return (
      <div data-testid="agent-list-loading" className="agent-list-loading">
        <div>{t('agent_list.loading')}</div>
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div data-testid="agent-list-empty" className="empty-state">
        <h3>{t('agent_list.empty.title')}</h3>
        <p>{t('agent_list.empty.description')}</p>
        <Button 
          data-testid="agent-list-create-button"
          onClick={handleCreateFirst}
          type="primary"
        >
          {t('agent_list.button.create_first')}
        </Button>
      </div>
    )
  }

  // Enable virtualization for large lists (100+ agents)
  const isVirtualized = agents.length > 50

  return (
    <div>
      <div 
        ref={listRef}
        data-testid="agent-list"
        className="agent-list-container"
        role="list"
        aria-label={t('agent_list.aria.agents')}
        data-virtualized={isVirtualized}
      >
        {agents.map((agent, index) => (
          <div
            key={agent.id}
            data-testid={`agent-item-${agent.id}`}
            data-index={index}
            className={`agent-item ${selectedAgentId === agent.id ? 'selected' : ''}`}
            onClick={() => handleAgentClick(agent)}
            onContextMenu={(e) => handleAgentContextMenu(agent, e)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            tabIndex={0}
            role="listitem"
          >
            <div>
              <div style={{ fontWeight: 500, color: 'var(--color-text)', marginBottom: '4px', fontSize: '14px' }}>
                {agent.name}
              </div>
              <div style={{ color: 'var(--color-text-soft)', fontSize: '12px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.description}
              </div>
            </div>
            <div data-testid={`agent-status-${agent.status}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--color-text-soft)', textTransform: 'uppercase', fontWeight: 500 }}>
              <div 
                style={{ 
                  width: '8px', 
                  height: '8px', 
                  borderRadius: '50%',
                  backgroundColor: agent.status === AgentStatus.IDLE ? 'var(--color-success)' : 
                                   agent.status === AgentStatus.RUNNING ? 'var(--color-warning)' : 
                                   agent.status === AgentStatus.ERROR ? 'var(--color-error)' : 'var(--color-text-soft)'
                }}
              />
              {agent.status}
            </div>
          </div>
        ))}
      </div>

      {/* Display agent count for performance testing */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)', fontSize: '11px', color: 'var(--color-text-soft)', textAlign: 'center' }}>
        {agents.length}
      </div>

      {contextMenuVisible && (
        <div data-testid="agent-context-menu">
          {contextMenu}
        </div>
      )}
    </div>
  )
}

export default AgentList