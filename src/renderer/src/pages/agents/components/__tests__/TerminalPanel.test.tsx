import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TerminalPanel from '../TerminalPanel'

type TerminalEvent = {
  data: string
  exitCode?: number
  exited?: boolean
  sessionId: string
}

const terminalInstances: Array<{
  dispose: ReturnType<typeof vi.fn>
  loadAddon: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  options: Record<string, unknown>
  write: ReturnType<typeof vi.fn>
}> = []

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    proposeDimensions: vi.fn(() => ({
      cols: 80,
      rows: 24
    }))
  }))
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation((options: Record<string, unknown>) => {
    const instance = {
      dispose: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn(() => ({
        dispose: vi.fn()
      })),
      open: vi.fn(),
      options: { ...options },
      write: vi.fn()
    }

    terminalInstances.push(instance)
    return instance
  })
}))

describe('TerminalPanel', () => {
  const createMock = vi.fn()
  const killMock = vi.fn()
  const onError = vi.fn()
  const onExited = vi.fn()
  const onDataCleanupMocks: Array<ReturnType<typeof vi.fn>> = []
  const terminalEventHandlers: Array<(event: TerminalEvent) => void> = []

  beforeEach(() => {
    terminalInstances.length = 0
    onDataCleanupMocks.length = 0
    terminalEventHandlers.length = 0
    createMock.mockReset()
    killMock.mockReset()
    onError.mockReset()
    onExited.mockReset()

    createMock.mockResolvedValue({ success: true })
    killMock.mockResolvedValue(undefined)

    Object.assign(window, {
      api: {
        terminal: {
          create: createMock,
          kill: killMock,
          onData: vi.fn((handler: (event: TerminalEvent) => void) => {
            terminalEventHandlers.push(handler)
            const cleanup = vi.fn()
            cleanup.mockImplementation(() => {
              const index = terminalEventHandlers.indexOf(handler)
              if (index >= 0) {
                terminalEventHandlers.splice(index, 1)
              }
            })
            onDataCleanupMocks.push(cleanup)
            return cleanup
          }),
          resize: vi.fn(),
          write: vi.fn()
        }
      }
    })
  })

  it('recreates the PTY when sessionId changes while the panel stays mounted', async () => {
    const view = render(
      <TerminalPanel sessionId="session-1" cwd="/workspace-1" visible onError={onError} onExited={onExited} />
    )

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith('session-1', '/workspace-1', 80, 24)
    })

    view.rerender(
      <TerminalPanel sessionId="session-2" cwd="/workspace-2" visible onError={onError} onExited={onExited} />
    )

    await waitFor(() => {
      expect(killMock).toHaveBeenCalledWith('session-1')
    })

    await waitFor(() => {
      expect(createMock).toHaveBeenLastCalledWith('session-2', '/workspace-2', 80, 24)
    })

    expect(onDataCleanupMocks[0]).toHaveBeenCalled()
    expect(terminalInstances[0]?.dispose).toHaveBeenCalled()
  })

  it('disposes listeners and xterm instance before reopening an exited session', async () => {
    const view = render(
      <TerminalPanel sessionId="session-1" cwd="/workspace-1" visible onError={onError} onExited={onExited} />
    )

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1)
    })

    terminalEventHandlers[0]?.({
      sessionId: 'session-1',
      data: '\r\n[Process exited with code 0]\r\n',
      exited: true,
      exitCode: 0
    })

    expect(onExited).toHaveBeenCalledTimes(1)
    expect(onDataCleanupMocks[0]).toHaveBeenCalledTimes(1)
    expect(terminalInstances[0]?.dispose).toHaveBeenCalledTimes(1)

    view.rerender(
      <TerminalPanel sessionId="session-1" cwd="/workspace-1" visible={false} onError={onError} onExited={onExited} />
    )
    view.rerender(
      <TerminalPanel sessionId="session-1" cwd="/workspace-1" visible onError={onError} onExited={onExited} />
    )

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2)
    })

    expect(terminalEventHandlers).toHaveLength(1)
  })
})
