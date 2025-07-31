import { SettingOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { useCommandHistory } from '@renderer/hooks/useCommandHistory'
import { usePocCommand } from '@renderer/hooks/usePocCommand'
import { usePocMessages } from '@renderer/hooks/usePocMessages'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { Button } from 'antd'
import React, { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import CherryAgentSettingsModal from './components/CherryAgentSettingsModal'
import PocCommandInput from './components/PocCommandInput'
import PocMessageList from './components/PocMessageList'
import PocStatusBar from './components/PocStatusBar'

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

  return (
    <Container id="cherry-agent-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>CherryAgent</NavbarCenter>
      </Navbar>
      <ContentContainer id={isLeftNavbar ? 'content-container' : undefined}>
        <ContentArea>
          <HeaderBar>
            <SettingsButton type="text" icon={<SettingOutlined />} onClick={handleOpenSettings} title="Settings" />
          </HeaderBar>
          <PocMessageList messages={messagesHook.messages} />
          <PocStatusBar status={getCommandStatus()} activeCommand={getCurrentCommand()} commandCount={commandCount} />
          <PocCommandInput
            onSendCommand={handleExecuteCommand}
            disabled={commandHook.isExecuting}
            // commandHistory={historyHook}
          />
        </ContentArea>
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

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const HeaderBar = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 8px 16px;
  border-bottom: 0.5px solid var(--color-border);
`

const SettingsButton = styled(Button)`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-text);
    background-color: var(--color-background-soft);
  }
`

export default CherryAgentPage
