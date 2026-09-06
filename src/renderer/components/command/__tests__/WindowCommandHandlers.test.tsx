import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  handlers: new Map<string, () => void>()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (command: string, handler: () => void) => {
    mocks.handlers.set(command, handler)
  }
}))

import { WindowCommandHandlers } from '../WindowCommandHandlers'

describe('WindowCommandHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
  })

  // Onboarding renders instead of AppShell and a detached sub window never mounts it, so a
  // fallback living in AppShell left the command unhandled in both.
  it('serves the DevTools command from the window itself, not from AppShell', () => {
    render(<WindowCommandHandlers />)

    const handler = mocks.handlers.get('app.devtools.toggle')
    expect(handler).toBeDefined()

    handler?.()

    expect(mocks.request).toHaveBeenCalledWith('system.toggle_dev_tools')
  })
})
