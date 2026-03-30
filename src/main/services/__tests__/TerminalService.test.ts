import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionByIdMock = vi.fn()
const spawnMock = vi.fn()

vi.mock('node-pty', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
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
})
