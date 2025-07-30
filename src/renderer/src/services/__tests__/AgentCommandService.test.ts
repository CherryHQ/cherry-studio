import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentCommandService } from '../AgentCommandService'

// Mock the logger service
vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

// Mock the window API
const mockApi = {
  executeCommand: vi.fn(),
  interruptCommand: vi.fn(),
  getActiveProcesses: vi.fn()
}

const mockElectron = {
  ipcRenderer: {
    on: vi.fn(() => vi.fn()), // Returns a mock remover function
    removeAllListeners: vi.fn()
  }
}

Object.defineProperty(global, 'window', {
  value: {
    api: {
      poc: mockApi
    },
    electron: mockElectron
  },
  writable: true
})

describe('AgentCommandService', () => {
  let service: AgentCommandService

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the singleton instance for clean tests
    ;(AgentCommandService as any).instance = null
    service = AgentCommandService.getInstance()
    // Clear any existing command state
    service.cleanup()
  })

  it('should be a singleton', () => {
    const service1 = AgentCommandService.getInstance()
    const service2 = AgentCommandService.getInstance()
    expect(service1).toBe(service2)
  })

  it('should execute command and generate command ID', async () => {
    mockApi.executeCommand.mockResolvedValue(undefined)

    const commandId = await service.executeCommand('echo "Hello World"', '/tmp')

    expect(commandId).toMatch(/^cmd_\d+_\w+$/)
    expect(mockApi.executeCommand).toHaveBeenCalledWith({
      id: commandId,
      command: 'echo "Hello World"',
      workingDirectory: '/tmp'
    })
  })

  it('should interrupt command', async () => {
    mockApi.interruptCommand.mockResolvedValue(true)

    const result = await service.interruptCommand('test-command-id')

    expect(result).toBe(true)
    expect(mockApi.interruptCommand).toHaveBeenCalledWith('test-command-id')
  })

  it('should get active processes', async () => {
    const mockProcesses = [{ id: 'cmd_1', command: 'test', isRunning: true }]
    mockApi.getActiveProcesses.mockResolvedValue(mockProcesses)

    const processes = await service.getActiveProcesses()

    expect(processes).toEqual(mockProcesses)
    expect(mockApi.getActiveProcesses).toHaveBeenCalled()
  })

  it('should register IPC listener for command output', () => {
    // The IPC listener should be registered during service initialization
    expect(mockElectron.ipcRenderer.on).toHaveBeenCalledWith('poc:command-output', expect.any(Function))
  })

  it('should track running commands', async () => {
    mockApi.executeCommand.mockResolvedValue(undefined)

    const commandId = await service.executeCommand('ls', '/tmp')
    const runningCommands = service.getRunningCommands()

    expect(runningCommands).toHaveLength(1)
    expect(runningCommands[0].id).toBe(commandId)
    expect(runningCommands[0].command).toBe('ls')
    expect(runningCommands[0].isRunning).toBe(true)
  })

  it('should get specific command by ID', async () => {
    mockApi.executeCommand.mockResolvedValue(undefined)

    const commandId = await service.executeCommand('pwd', '/home')
    const command = service.getCommand(commandId)

    expect(command).toBeDefined()
    expect(command?.id).toBe(commandId)
    expect(command?.command).toBe('pwd')
  })

  it('should clear completed commands', async () => {
    mockApi.executeCommand.mockResolvedValue(undefined)

    const commandId = await service.executeCommand('date', '/tmp')

    // Simulate command completion
    const command = service.getCommand(commandId)
    if (command) {
      command.isRunning = false
      command.endTime = Date.now()
    }

    service.clearCompletedCommands()

    expect(service.getCommand(commandId)).toBeUndefined()
  })

  it('should handle execute command error', async () => {
    mockApi.executeCommand.mockRejectedValue(new Error('Command failed'))

    await expect(service.executeCommand('invalid-command', '/tmp')).rejects.toThrow(
      'Failed to execute command: Command failed'
    )
  })

  it('should handle interrupt command error', async () => {
    mockApi.interruptCommand.mockRejectedValue(new Error('Interrupt failed'))

    const result = await service.interruptCommand('test-command-id')

    expect(result).toBe(false)
  })

  it('should setup event listeners', () => {
    const mockListener = vi.fn()
    const unsubscribe = service.on('commandStart', mockListener)

    expect(typeof unsubscribe).toBe('function')
  })

  it('should cleanup resources', () => {
    service.cleanup()

    expect(service.getAllCommands()).toHaveLength(0)
  })
})
