import { MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { useCommandHistory } from '@renderer/hooks/useCommandHistory'
import { usePocCommand } from '@renderer/hooks/usePocCommand'
import { usePocMessages } from '@renderer/hooks/usePocMessages'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { Button } from 'antd'
import React, { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import CherryAgentSettingsModal from './components/CherryAgentSettingsModal'
import EnhancedCommandInput from './components/EnhancedCommandInput'
import PocMessageList from './components/PocMessageList'

const CherryAgentPage: React.FC = () => {
  const { isLeftNavbar } = useNavbarPosition()

  // Initialize hooks
  const messagesHook = usePocMessages()
  const commandHook = usePocCommand()
  const historyHook = useCommandHistory()

  // Local state for command count tracking
  const [commandCount, setCommandCount] = useState(0)
  const [currentWorkingDirectory, setCurrentWorkingDirectory] = useState<string>('/Users/weliu')
  const [showSettingsModal, setShowSettingsModal] = useState(false)
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
              <CollapseButton type="text" icon={<MenuFoldOutlined />} onClick={toggleSidebar} size="small" />
            </SidebarHeader>
            <SidebarContent>{/* Sidebar content can be added here later */}</SidebarContent>
            <SidebarFooter>
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
          <MainContentHeader>
            {sidebarCollapsed && (
              <ToggleButton type="text" icon={<MenuUnfoldOutlined />} onClick={toggleSidebar} size="small" />
            )}
          </MainContentHeader>
          <MessageArea>
            <PocMessageList messages={messagesHook.messages} />
          </MessageArea>
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
        </MainContent>
      </ContentContainer>
      <CherryAgentSettingsModal
        visible={showSettingsModal}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
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
  width: 240px;
  min-width: 240px;
  background-color: var(--color-background-soft);
  border-right: 0.5px solid var(--color-border);
  display: flex;
  flex-direction: column;
`

const SidebarHeader = styled.div`
  padding: 4px;
  border-bottom: 0.5px solid var(--color-border);
  display: flex;
  justify-content: flex-end;
`

const SidebarContent = styled.div`
  flex: 1;
  padding: 8px;
  overflow-y: auto;
`

const SidebarFooter = styled.div`
  padding: 4px;
  border-top: 0.5px solid var(--color-border);
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  gap: 4px;
`

const CollapseButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  width: 32px;
  height: 32px;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background);
  }
`

const ActionButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  color: var(--color-text-secondary);
  width: 100%;
  height: 32px;
  padding: 0 8px;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background);
  }
`

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const MainContentHeader = styled.div`
  padding: 4px 12px;
  border-bottom: 0.5px solid var(--color-border);
  display: flex;
  align-items: center;
  min-height: 32px;
`

const ToggleButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  width: 16px;
  height: 16px;

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-soft);
  }
`

const MessageArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px;
`

export default CherryAgentPage
