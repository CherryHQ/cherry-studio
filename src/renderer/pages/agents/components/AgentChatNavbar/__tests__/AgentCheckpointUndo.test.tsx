import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock, onMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  onMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn()
}))

let ipcOnHandler: ((payload: { sessionId: string; available: boolean }) => void) | undefined

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: requestMock, on: onMock },
  useIpcOn: (_event: string, handler: (payload: { sessionId: string; available: boolean }) => void) => {
    ipcOnHandler = handler
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import AgentCheckpointUndo from '../AgentCheckpointUndo'

describe('AgentCheckpointUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcOnHandler = undefined
  })

  it('renders nothing while no checkpoint is available', async () => {
    requestMock.mockResolvedValue({ available: false })
    render(<AgentCheckpointUndo sessionId="s1" />)

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('agent_checkpoint.get', { sessionId: 's1' }))
    expect(screen.queryByText('agent.checkpoint.undo_button')).not.toBeInTheDocument()
  })

  it('shows the undo button once a checkpoint is available', async () => {
    requestMock.mockResolvedValue({ available: true, createdAt: Date.now() })
    render(<AgentCheckpointUndo sessionId="s1" />)

    expect(await screen.findByText('agent.checkpoint.undo_button')).toBeInTheDocument()
  })

  it('restores the checkpoint on click and reports success', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'agent_checkpoint.get') return { available: true }
      if (route === 'agent_checkpoint.restore') return { restored: true }
      throw new Error(`unexpected route ${route}`)
    })
    const user = userEvent.setup()
    render(<AgentCheckpointUndo sessionId="s1" />)

    const button = await screen.findByText('agent.checkpoint.undo_button')
    await user.click(button)

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith('agent_checkpoint.restore', { sessionId: 's1' }))
    expect(toastSuccessMock).toHaveBeenCalledWith('agent.checkpoint.restored')
  })

  it('reports failure when restore rejects', async () => {
    requestMock.mockImplementation(async (route: string) => {
      if (route === 'agent_checkpoint.get') return { available: true }
      if (route === 'agent_checkpoint.restore') throw new Error('boom')
      throw new Error(`unexpected route ${route}`)
    })
    const user = userEvent.setup()
    render(<AgentCheckpointUndo sessionId="s1" />)

    const button = await screen.findByText('agent.checkpoint.undo_button')
    await user.click(button)

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('agent.checkpoint.restore_failed'))
  })

  it('hides the button when an update event clears availability for this session', async () => {
    requestMock.mockResolvedValue({ available: true })
    render(<AgentCheckpointUndo sessionId="s1" />)

    await screen.findByText('agent.checkpoint.undo_button')

    act(() => {
      ipcOnHandler?.({ sessionId: 's1', available: false })
    })

    await waitFor(() => expect(screen.queryByText('agent.checkpoint.undo_button')).not.toBeInTheDocument())
  })

  it('ignores an update event for a different session', async () => {
    requestMock.mockResolvedValue({ available: true })
    render(<AgentCheckpointUndo sessionId="s1" />)

    await screen.findByText('agent.checkpoint.undo_button')

    act(() => {
      ipcOnHandler?.({ sessionId: 'other-session', available: false })
    })

    expect(screen.getByText('agent.checkpoint.undo_button')).toBeInTheDocument()
  })
})
