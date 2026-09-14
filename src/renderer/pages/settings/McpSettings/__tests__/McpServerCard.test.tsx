import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { McpServer } from '@shared/data/types/mcpServer'

import McpServerCard from '../McpServerCard'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('@renderer/data/hooks/useDataApi', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, useInvalidateCache: () => mocks.invalidate }
})

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatus: () => ({ state: 'disabled', lastError: undefined })
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

describe('McpServerCard', () => {
  it('deletes a server whose card crashed through the mcp.server.remove IPC channel', async () => {
    mocks.request.mockResolvedValue(undefined)
    mocks.invalidate.mockResolvedValue(undefined)
    // Silence React's console noise for the deliberately crashed card body.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // A corrupt row (non-string name) crashes the card body; the error fallback
    // is the card's only delete entry point for such a broken server.
    const brokenServer: McpServer = {
      id: 'server-1',
      name: { corrupt: true } as unknown as string,
      type: 'stdio',
      command: 'broken',
      isActive: false
    }

    const user = userEvent.setup()
    render(<McpServerCard server={brokenServer} onEdit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /common\.delete/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(popup.confirm).toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledWith('mcp.server.remove', { serverId: 'server-1' })
    expect(mocks.invalidate).toHaveBeenCalledWith('/mcp-servers')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
