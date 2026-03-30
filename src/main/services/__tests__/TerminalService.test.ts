import { IpcChannel } from '@shared/IpcChannel'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionByIdMock = vi.fn()
const spawnMock = vi.fn()
const getDataPathMock = vi.fn(() => '/tmp/cherry-data')
const makeSureDirExistsMock = vi.fn()
const ipcHandleMock = vi.fn()
const loggerInfoMock = vi.fn()
const loggerWarnMock = vi.fn()
const loggerErrorMock = vi.fn()
const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => ipcHandleMock(...args)
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: (...args: unknown[]) => loggerInfoMock(...args),
      warn: (...args: unknown[]) => loggerWarnMock(...args),
      error: (...args: unknown[]) => loggerErrorMock(...args)
    })
  }
}))

vi.mock('@main/utils', () => ({
  getDataPath: () => getDataPathMock(),
  makeSureDirExists: (...args: unknown[]) => makeSureDirExistsMock(...args)
}))

vi.mock('@main/services/agents', () => ({
  sessionService: {
    getSessionById: (...args: unknown[]) => getSessionByIdMock(...args)
  }
}))

import { terminalService } from '../TerminalService'

const createPtyMock = () => ({
  kill: vi.fn(),
  onData: vi.fn(),
  onExit: vi.fn(),
  resize: vi.fn(),
  write: vi.fn()
})

describe('TerminalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registeredHandlers.clear()
    ipcHandleMock.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(channel, handler)
    })
    terminalService.killAll()
    terminalService.init({
      isDestroyed: () => false,
      webContents: {
        send: vi.fn()
      }
    } as never)
  })

  it('uses the session workspace when renderer does not provide cwd', async () => {
    spawnMock.mockReturnValue(createPtyMock())
    getSessionByIdMock.mockResolvedValue({
      accessible_paths: ['/allowed/workspace'],
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      id: 'session-1',
      model: 'openai:gpt-4o'
    })

    const result = await terminalService.create('session-1')

    expect(result).toEqual({ success: true })
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        cwd: '/allowed/workspace'
      })
    )
  })

  it('rejects cwd values outside the session accessible paths', async () => {
    getSessionByIdMock.mockResolvedValue({
      accessible_paths: ['/allowed/workspace'],
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      id: 'session-1',
      model: 'openai:gpt-4o'
    })

    const result = await terminalService.create('session-1', '/outside/workspace')

    expect(result.success).toBe(false)
    expect(result.error).toContain('accessible paths')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('falls back to the default agent workspace when accessible paths are empty', async () => {
    spawnMock.mockReturnValue(createPtyMock())
    getSessionByIdMock.mockResolvedValue({
      accessible_paths: [],
      agent_id: 'agent_123456789',
      agent_type: 'claude-code',
      id: 'session-1',
      model: 'openai:gpt-4o'
    })

    const result = await terminalService.create('session-1')

    expect(result).toEqual({ success: true })
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        cwd: '/tmp/cherry-data/Agents/123456789'
      })
    )
    expect(makeSureDirExistsMock).toHaveBeenCalledWith('/tmp/cherry-data/Agents/123456789')
  })

  it('rejects invalid IPC payloads before touching terminal state', async () => {
    const pty = createPtyMock()
    spawnMock.mockReturnValue(pty)
    getSessionByIdMock.mockResolvedValue({
      accessible_paths: ['/allowed/workspace'],
      agent_id: 'agent-1',
      agent_type: 'claude-code',
      id: 'session-1',
      model: 'openai:gpt-4o'
    })

    await terminalService.create('session-1')

    const createHandler = registeredHandlers.get(IpcChannel.Terminal_Create)
    const writeHandler = registeredHandlers.get(IpcChannel.Terminal_Write)
    const resizeHandler = registeredHandlers.get(IpcChannel.Terminal_Resize)
    const killHandler = registeredHandlers.get(IpcChannel.Terminal_Kill)

    await expect(createHandler?.({}, 123, '/tmp', 80, 24)).resolves.toEqual({
      success: false,
      error: 'Invalid terminal session id'
    })
    expect(() => writeHandler?.({}, null, 'echo test')).not.toThrow()
    expect(() => resizeHandler?.({}, 'session-1', '80', 24)).not.toThrow()
    expect(() => killHandler?.({}, {})).not.toThrow()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(pty.write).not.toHaveBeenCalled()
    expect(pty.resize).not.toHaveBeenCalled()
    expect(pty.kill).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalled()
  })
})
