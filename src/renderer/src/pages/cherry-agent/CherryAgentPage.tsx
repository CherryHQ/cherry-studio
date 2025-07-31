import {
  DeleteOutlined,
  EditOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined,
  UserOutlined
} from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { useAgentManagement } from '@renderer/hooks/useAgentManagement'
import { useCommandHistory } from '@renderer/hooks/useCommandHistory'
import { usePocCommand } from '@renderer/hooks/usePocCommand'
import { usePocMessages } from '@renderer/hooks/usePocMessages'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import type { AgentResponse, SessionResponse } from '@types'
import { Button, Dropdown, Menu, Modal, Tooltip } from 'antd'
import React, { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import AgentManagementModal from './components/AgentManagementModal'
import CherryAgentSettingsModal from './components/CherryAgentSettingsModal'
import EnhancedCommandInput from './components/EnhancedCommandInput'
import PocMessageList from './components/PocMessageList'
import SessionManagementModal from './components/SessionManagementModal'

const CherryAgentPage: React.FC = () => {
  const { isLeftNavbar } = useNavbarPosition()

  // Initialize hooks
  const messagesHook = usePocMessages()
  const commandHook = usePocCommand()
  const historyHook = useCommandHistory()
  const agentManagement = useAgentManagement()

  // Local state for command count tracking
  const [commandCount, setCommandCount] = useState(0)
  const [currentWorkingDirectory, setCurrentWorkingDirectory] = useState<string>('/Users/weliu')
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showAgentModal, setShowAgentModal] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentResponse | null>(null)
  const [showSessionModal, setShowSessionModal] = useState(false)
  const [editingSession, setEditingSession] = useState<SessionResponse | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Handle command execution
  const handleExecuteCommand = useCallback(
    async (command: string) => {
      // Add to history
      historyHook.addToHistory(command)

      // Execute command
      const commandId = await commandHook.executeCommand(command, currentWorkingDirectory)
      if (commandId) {
        // Add user command message
        messagesHook.addUserCommand(command, commandId)
        setCommandCount((prev) => prev + 1)
      }
    },
    [commandHook, messagesHook, historyHook, currentWorkingDirectory]
  )

  // Set up output callback to connect command hook with messages hook
  useEffect(() => {
    commandHook.setOutputCallback((commandId: string, output: string, isBuffered: boolean) => {
      // When we receive buffered output, append it to messages
      // Note: The type determination (stdout vs stderr) is handled in usePocMessages
      // based on the command output type from AgentCommandService
      if (isBuffered && output) {
        messagesHook.appendOutput(commandId, output, 'output', false)
      }
    })
  }, [commandHook, messagesHook])

  // Determine current status for status bar
  const getCommandStatus = useCallback(() => {
    if (commandHook.isExecuting) {
      return 'running' as const
    }
    return 'idle' as const
  }, [commandHook.isExecuting])

  // Get current running command for display
  const getCurrentCommand = useCallback(() => {
    if (commandHook.currentCommandId) {
      const command = commandHook.getCommandInfo(commandHook.currentCommandId)
      return command?.command
    }
    return undefined
  }, [commandHook])

  // Handle settings modal
  const handleOpenSettings = useCallback(() => {
    setShowSettingsModal(true)
  }, [])

  const handleCloseSettings = useCallback(() => {
    setShowSettingsModal(false)
  }, [])

  const handleSaveSettings = useCallback((workingDirectory: string) => {
    setCurrentWorkingDirectory(workingDirectory)
  }, [])

  // Handle agent modal
  const handleCreateAgent = useCallback(() => {
    setEditingAgent(null)
    setShowAgentModal(true)
  }, [])

  const handleEditAgent = useCallback((agent: AgentResponse) => {
    setEditingAgent(agent)
    setShowAgentModal(true)
  }, [])

  const handleCloseAgentModal = useCallback(() => {
    setShowAgentModal(false)
    setEditingAgent(null)
  }, [])

  const handleSaveAgent = useCallback(
    async (agentData: AgentResponse) => {
      if (editingAgent) {
        // Update existing agent
        await agentManagement.updateAgent({
          id: editingAgent.id,
          name: agentData.name,
          description: agentData.description,
          avatar: agentData.avatar,
          instructions: agentData.instructions,
          model: agentData.model,
          tools: agentData.tools,
          knowledges: agentData.knowledges,
          configuration: agentData.configuration
        })
      } else {
        // Create new agent
        await agentManagement.createAgent({
          name: agentData.name,
          description: agentData.description,
          avatar: agentData.avatar,
          instructions: agentData.instructions,
          model: agentData.model,
          tools: agentData.tools,
          knowledges: agentData.knowledges,
          configuration: agentData.configuration
        })
      }
      handleCloseAgentModal()
    },
    [editingAgent, agentManagement, handleCloseAgentModal]
  )

  // Handle session modal
  const handleCreateSession = useCallback(() => {
    setEditingSession(null)
    setShowSessionModal(true)
  }, [])

  const handleEditSession = useCallback((session: SessionResponse) => {
    setEditingSession(session)
    setShowSessionModal(true)
  }, [])

  const handleCloseSessionModal = useCallback(() => {
    setShowSessionModal(false)
    setEditingSession(null)
  }, [])

  const handleSaveSession = useCallback(
    async (sessionData: SessionResponse) => {
      if (editingSession) {
        // Update existing session
        await agentManagement.updateSession({
          id: editingSession.id,
          user_prompt: sessionData.user_prompt,
          agent_ids: sessionData.agent_ids,
          status: sessionData.status,
          accessible_paths: sessionData.accessible_paths
        })
      } else {
        // Create new session
        const newSession = await agentManagement.createSession({
          user_prompt: sessionData.user_prompt,
          agent_ids: sessionData.agent_ids,
          status: sessionData.status || 'idle',
          accessible_paths: sessionData.accessible_paths
        })
        // Set the new session as current
        if (newSession) {
          agentManagement.setCurrentSession(newSession)
        }
      }
      handleCloseSessionModal()
    },
    [editingSession, agentManagement, handleCloseSessionModal]
  )

  const handleDeleteSession = useCallback(
    async (session: SessionResponse) => {
      Modal.confirm({
        title: 'Delete Session',
        content: `Are you sure you want to delete the session "${session.user_prompt || session.id.slice(0, 8)}"?`,
        okText: 'Delete',
        okType: 'danger',
        cancelText: 'Cancel',
        onOk: async () => {
          await agentManagement.deleteSession(session.id)
        }
      })
    },
    [agentManagement]
  )

  // Handle command cancellation
  const handleCancelCommand = useCallback(async () => {
    if (commandHook.currentCommandId) {
      const success = await commandHook.interruptCommand(commandHook.currentCommandId)
      if (success) {
        messagesHook.appendOutput(commandHook.currentCommandId, '\n[Command cancelled by user]', 'error', true)
      }
    }
  }, [commandHook, messagesHook])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  // Handle session selection
  const handleSessionSelect = useCallback(
    (session: any) => {
      agentManagement.setCurrentSession(session)
    },
    [agentManagement]
  )

  // Handle agent name change
  const handleAgentNameChange = useCallback(
    async (newName: string) => {
      if (agentManagement.currentAgent && newName !== agentManagement.currentAgent.name) {
        await agentManagement.updateAgent({
          id: agentManagement.currentAgent.id,
          name: newName
        })
      }
    },
    [agentManagement]
  )

  // Create a default agent if none exists
  useEffect(() => {
    if (!agentManagement.loadingAgents && agentManagement.agents.length === 0) {
      agentManagement.createAgent({
        name: 'My Agent',
        model: 'gpt-4',
        description: 'Default agent for command execution',
        instructions: 'You are a helpful assistant that can execute commands and help with tasks.'
      })
    }
  }, [agentManagement.loadingAgents, agentManagement.agents.length, agentManagement])

  // Set the first agent as current if none is selected
  useEffect(() => {
    if (!agentManagement.currentAgent && agentManagement.agents.length > 0) {
      agentManagement.setCurrentAgent(agentManagement.agents[0])
    }
  }, [agentManagement.currentAgent, agentManagement.agents, agentManagement])

  // Create a default session for the current agent if none exists
  useEffect(() => {
    if (agentManagement.currentAgent && !agentManagement.currentSession && !agentManagement.loadingSessions) {
      if (agentManagement.sessions.length === 0) {
        agentManagement.createSession({
          agent_ids: [agentManagement.currentAgent.id],
          user_prompt: 'New session',
          status: 'idle',
          accessible_paths: [currentWorkingDirectory]
        })
      } else {
        // Set the first session as current
        agentManagement.setCurrentSession(agentManagement.sessions[0])
      }
    }
  }, [
    agentManagement.currentAgent,
    agentManagement.currentSession,
    agentManagement.sessions,
    agentManagement.loadingSessions,
    currentWorkingDirectory,
    agentManagement
  ])

  return (
    <Container id="cherry-agent-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>CherryAgent</NavbarCenter>
      </Navbar>
      <ContentContainer id={isLeftNavbar ? 'content-container' : undefined}>
        {/* Left Sidebar - Only show when not collapsed */}
        {!sidebarCollapsed && (
          <Sidebar>
            <SidebarHeader>
              <HeaderLabel>agents</HeaderLabel>
              <HeaderActions>
                <Dropdown
                  overlay={
                    <Menu>
                      <Menu.Item key="create" icon={<PlusOutlined />} onClick={handleCreateAgent}>
                        Create Agent
                      </Menu.Item>
                      {agentManagement.currentAgent && (
                        <Menu.Item
                          key="edit"
                          icon={<UserOutlined />}
                          onClick={() => handleEditAgent(agentManagement.currentAgent!)}>
                          Edit Current Agent
                        </Menu.Item>
                      )}
                    </Menu>
                  }
                  trigger={['click']}
                  placement="bottomRight">
                  <ActionButton type="text" icon={<PlusOutlined />} size="small" title="Agent Actions" />
                </Dropdown>
                <CollapseButton type="text" icon={<MenuFoldOutlined />} onClick={toggleSidebar} size="small" />
              </HeaderActions>
            </SidebarHeader>
            <SidebarContent>
              <SectionHeader>
                <SessionsLabel>sessions</SessionsLabel>
                <Tooltip title="Create new session">
                  <ActionButton type="text" icon={<PlusOutlined />} onClick={handleCreateSession} size="small" />
                </Tooltip>
              </SectionHeader>
              <SessionsList>
                {agentManagement.sessions.map((session) => (
                  <SessionItemWrapper key={session.id}>
                    <SessionItem
                      active={agentManagement.currentSession?.id === session.id}
                      onClick={() => handleSessionSelect(session)}>
                      <SessionInfo>
                        <SessionTitle>{session.user_prompt || `Session ${session.id.slice(0, 8)}`}</SessionTitle>
                        <SessionMeta>
                          {session.agent_ids.length} agent{session.agent_ids.length !== 1 ? 's' : ''} • {session.status}
                        </SessionMeta>
                      </SessionInfo>
                    </SessionItem>
                    <SessionActions>
                      <Tooltip title="Edit session">
                        <ActionButton
                          type="text"
                          icon={<EditOutlined />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleEditSession(session)
                          }}
                          size="small"
                        />
                      </Tooltip>
                      <Tooltip title="Delete session">
                        <ActionButton
                          type="text"
                          icon={<DeleteOutlined />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteSession(session)
                          }}
                          size="small"
                          danger
                        />
                      </Tooltip>
                    </SessionActions>
                  </SessionItemWrapper>
                ))}
                {agentManagement.sessions.length === 0 && !agentManagement.loadingSessions && (
                  <EmptyState>No sessions available</EmptyState>
                )}
              </SessionsList>
            </SidebarContent>
            <SidebarFooter>
              <FooterLabel>footer</FooterLabel>
              <ActionButton
                type="text"
                icon={<SettingOutlined />}
                onClick={handleOpenSettings}
                title="Settings"
                size="small"
              />
            </SidebarFooter>
          </Sidebar>
        )}

        {/* Main Content Area */}
        <MainContent>
          {/* Agent Info Header */}
          <AgentHeader>
            {sidebarCollapsed && (
              <ToggleButton type="text" icon={<MenuUnfoldOutlined />} onClick={toggleSidebar} size="small" />
            )}
            <AgentNameInput
              value={agentManagement.currentAgent?.name || ''}
              onChange={(e) => handleAgentNameChange(e.target.value)}
              onBlur={(e) => handleAgentNameChange(e.target.value)}
              placeholder="Agent Name & some Info"
            />
          </AgentHeader>

          <MessageArea>
            <PocMessageList messages={messagesHook.messages} />
          </MessageArea>

          <InputArea>
            <EnhancedCommandInput
              status={getCommandStatus()}
              currentWorkingDirectory={currentWorkingDirectory}
              activeCommand={getCurrentCommand()}
              commandCount={commandCount}
              onSendCommand={handleExecuteCommand}
              onCancelCommand={commandHook.isExecuting ? handleCancelCommand : undefined}
              onOpenSettings={handleOpenSettings}
              disabled={commandHook.isExecuting}
            />
          </InputArea>
        </MainContent>
      </ContentContainer>
      <CherryAgentSettingsModal
        visible={showSettingsModal}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        currentWorkingDirectory={currentWorkingDirectory}
      />
      <AgentManagementModal
        visible={showAgentModal}
        onClose={handleCloseAgentModal}
        onSave={handleSaveAgent}
        agent={editingAgent}
        loading={agentManagement.loadingAgents}
      />
      <SessionManagementModal
        visible={showSessionModal}
        onClose={handleCloseSessionModal}
        onSave={handleSaveSession}
        session={editingSession}
        agents={agentManagement.agents}
        loading={agentManagement.loadingSessions}
        currentWorkingDirectory={currentWorkingDirectory}
      />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  [navbar-position='left'] & {
    max-width: calc(100vw - var(--sidebar-width));
  }
  [navbar-position='top'] & {
    max-width: 100vw;
  }
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  overflow: hidden;
`

const Sidebar = styled.div`
  width: 260px;
  min-width: 260px;
  background-color: var(--color-background);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  box-shadow: 1px 0 4px rgba(0, 0, 0, 0.05);
`

const SidebarHeader = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 56px;
  background-color: var(--color-background-soft);
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const SidebarContent = styled.div`
  flex: 1;
  padding: 20px;
  overflow-y: auto;
`

const SidebarFooter = styled.div`
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 56px;
  background-color: var(--color-background-soft);
`

const CollapseButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-hover);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
`

const ActionButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-hover);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
`

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const AgentHeader = styled.div`
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 80px;
  background: linear-gradient(135deg, var(--color-background) 0%, var(--color-background-soft) 100%);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
`

const ToggleButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  width: 36px;
  height: 36px;
  border-radius: 8px;
  transition: all 0.2s ease;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-hover);
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
`

const MessageArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 24px;
  background-color: var(--color-background);
`

const InputArea = styled.div`
  padding: 16px 24px 20px 24px;
  border-top: 1px solid var(--color-border);
  background: linear-gradient(180deg, var(--color-background-soft) 0%, var(--color-background) 100%);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
`

const HeaderLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const FooterLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
`

const SessionsLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`

const SessionsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SessionActions = styled.div`
  display: flex;
  opacity: 0;
  transition: opacity 0.2s ease;
  gap: 4px;
`

const SessionItemWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  &:hover {
    ${SessionActions} {
      opacity: 1;
    }
  }
`

const SessionItem = styled.div<{ active: boolean }>`
  flex: 1;
  padding: 12px 16px;
  border-radius: 8px;
  background-color: ${(props) => (props.active ? 'var(--color-primary)' : 'var(--color-background-soft)')};
  color: ${(props) => (props.active ? 'white' : 'var(--color-text)')};
  cursor: pointer;
  transition: all 0.2s ease;
  border: ${(props) => (props.active ? 'none' : '1px solid transparent')};
  box-shadow: ${(props) => (props.active ? '0 2px 8px rgba(24, 144, 255, 0.2)' : 'none')};
  user-select: none;

  &:hover {
    background-color: ${(props) => (props.active ? 'var(--color-primary)' : 'var(--color-background-hover)')};
    border-color: ${(props) => (props.active ? 'transparent' : 'var(--color-border)')};
    transform: translateY(-1px);
    box-shadow: ${(props) => (props.active ? '0 4px 12px rgba(24, 144, 255, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.1)')};
  }

  &:active {
    transform: translateY(0);
  }
`

const SessionInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SessionTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
`

const SessionMeta = styled.div`
  font-size: 11px;
  opacity: 0.8;
  line-height: 1;
`

const EmptyState = styled.div`
  padding: 20px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 14px;
  font-style: italic;
`

const AgentNameInput = styled.input`
  flex: 1;
  border: 2px solid var(--color-border);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 16px;
  font-weight: 500;
  background-color: var(--color-background);
  color: var(--color-text);
  outline: none;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);

  &:focus {
    border-color: var(--color-primary);
    box-shadow:
      0 0 0 3px rgba(24, 144, 255, 0.1),
      0 4px 12px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }

  &:hover {
    border-color: var(--color-primary-hover);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
  }

  &::placeholder {
    color: var(--color-text-tertiary);
    font-weight: 400;
  }
`

export default CherryAgentPage
