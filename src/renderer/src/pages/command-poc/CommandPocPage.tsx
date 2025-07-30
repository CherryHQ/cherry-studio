import React, { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

import { usePocCommand } from '@renderer/hooks/usePocCommand'
import { usePocMessages } from '@renderer/hooks/usePocMessages'
import { useCommandHistory } from '@renderer/hooks/useCommandHistory'
import PocCommandInput from './components/PocCommandInput'
import PocHeader from './components/PocHeader'
import PocMessageList from './components/PocMessageList'
import PocStatusBar from './components/PocStatusBar'

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  background: var(--color-background);
`

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const CommandPocPage: React.FC = () => {
  // Initialize hooks
  const messagesHook = usePocMessages()
  const commandHook = usePocCommand()
  const historyHook = useCommandHistory()

  // Local state for command count tracking
  const [commandCount, setCommandCount] = useState(0)
  const [currentWorkingDirectory] = useState<string>(process.cwd())

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

  return (
    <PageContainer>
      <PocHeader currentWorkingDirectory={currentWorkingDirectory} />
      <ContentArea>
        <PocMessageList messages={messagesHook.messages} />
        <PocStatusBar
          status={getCommandStatus()}
          activeCommand={getCurrentCommand()}
          commandCount={commandCount}
        />
        <PocCommandInput
          onSendCommand={handleExecuteCommand}
          disabled={commandHook.isExecuting}
          commandHistory={historyHook}
        />
      </ContentArea>
    </PageContainer>
  )
}

export default CommandPocPage
