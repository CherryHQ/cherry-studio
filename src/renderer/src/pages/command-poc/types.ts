// POC-specific TypeScript interfaces for command execution

export interface PocMessage {
  id: string
  type: 'user-command' | 'output' | 'error' | 'system'
  content: string
  timestamp: number
  commandId?: string  // Links output to originating command
  isComplete: boolean // For streaming messages
}

export interface PocCommandExecution {
  id: string
  command: string
  startTime: number
  endTime?: number
  exitCode?: number
  isRunning: boolean
}

// IPC Communication interfaces
export interface PocExecuteCommandRequest {
  id: string
  command: string
  workingDirectory: string
}

export interface PocCommandOutput {
  commandId: string
  type: 'stdout' | 'stderr' | 'exit' | 'error'
  data: string
  exitCode?: number
}

// IPC Channel constants
export const IPC_CHANNELS = {
  EXECUTE_COMMAND: 'poc-execute-command',
  COMMAND_OUTPUT: 'poc-command-output',
  INTERRUPT_COMMAND: 'poc-interrupt-command'
} as const