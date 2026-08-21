import { WindowType } from '@main/core/window/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { ipcHandlers } from '../ipcHandlers'

const conversationIslandService = { setExpanded: vi.fn() }
const windowManager = { getWindowType: vi.fn() }
const handler = () =>
  (
    ipcHandlers as unknown as Record<
      string,
      (input: { expanded: boolean }, context: { senderId: string | null }) => Promise<void>
    >
  )['conversation_island.set_expanded']

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'ConversationIslandService') return conversationIslandService
    if (name === 'WindowManager') return windowManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

describe('conversationIslandHandlers', () => {
  it('lets only a Conversation Island sender set expanded state', async () => {
    windowManager.getWindowType.mockReturnValue(WindowType.ConversationIsland)

    expect(handler()).toBeTypeOf('function')
    await handler()({ expanded: true }, { senderId: 'island-1' })

    expect(windowManager.getWindowType).toHaveBeenCalledWith('island-1')
    expect(conversationIslandService.setExpanded).toHaveBeenCalledWith(true)
  })

  it('silently ignores a sender with another window type', async () => {
    windowManager.getWindowType.mockReturnValue(WindowType.Main)

    expect(handler()).toBeTypeOf('function')
    await handler()({ expanded: true }, { senderId: 'main-1' })

    expect(conversationIslandService.setExpanded).not.toHaveBeenCalled()
  })

  it('silently ignores a request without a managed sender', async () => {
    expect(handler()).toBeTypeOf('function')
    await handler()({ expanded: false }, { senderId: null })

    expect(windowManager.getWindowType).not.toHaveBeenCalled()
    expect(conversationIslandService.setExpanded).not.toHaveBeenCalled()
  })
})
