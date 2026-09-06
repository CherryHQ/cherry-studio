import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acknowledgeMainWindowNavigationMock,
  conversationNavigationServiceMock,
  openRouteInMainWindowMock,
  markMainRendererReadyForDeliveryMock,
  protocolServiceMock,
  loggerMock
} = vi.hoisted(() => ({
  acknowledgeMainWindowNavigationMock: vi.fn(),
  conversationNavigationServiceMock: {
    focusOrOpen: vi.fn(),
    reportOwnership: vi.fn()
  },
  openRouteInMainWindowMock: vi.fn(),
  markMainRendererReadyForDeliveryMock: vi.fn(),
  protocolServiceMock: {
    onMainRendererReady: vi.fn()
  },
  loggerMock: {
    warn: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'ProtocolService') return protocolServiceMock
      if (name === 'ConversationNavigationService') return conversationNavigationServiceMock
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@main/services/mainWindowNavigation', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  acknowledgeMainWindowNavigation: acknowledgeMainWindowNavigationMock,
  openRouteInMainWindow: openRouteInMainWindowMock,
  markMainRendererReadyForDelivery: markMainRendererReadyForDeliveryMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

import { navigationHandlers } from '../navigation'

beforeEach(() => {
  vi.clearAllMocks()
})

const ctx = { senderId: 'w1' }

describe('navigationHandlers', () => {
  it('opens an allowlisted settings route in the main window', async () => {
    await navigationHandlers['navigation.open_route_in_main']({ path: '/settings/mcp/servers' }, ctx)

    expect(openRouteInMainWindowMock).toHaveBeenCalledWith('/settings/mcp/servers')
  })

  it('opens an allowlisted non-settings route in the main window', async () => {
    await navigationHandlers['navigation.open_route_in_main']({ path: '/knowledge' }, ctx)

    expect(openRouteInMainWindowMock).toHaveBeenCalledWith('/knowledge')
  })

  it('drops routes outside the allowlist with a warning', async () => {
    await navigationHandlers['navigation.open_route_in_main']({ path: '/definitely-not-a-route' }, ctx)

    expect(openRouteInMainWindowMock).not.toHaveBeenCalled()
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('notifies protocol dispatch and queued delivery when the main renderer is ready', async () => {
    await navigationHandlers['navigation.protocol_dispatch_ready'](undefined, ctx)

    expect(protocolServiceMock.onMainRendererReady).toHaveBeenCalledWith('w1')
    expect(markMainRendererReadyForDeliveryMock).toHaveBeenCalledWith('w1')
  })

  it('ignores renderer readiness from an untracked caller', async () => {
    await navigationHandlers['navigation.protocol_dispatch_ready'](undefined, { senderId: null })

    expect(protocolServiceMock.onMainRendererReady).not.toHaveBeenCalled()
    expect(markMainRendererReadyForDeliveryMock).not.toHaveBeenCalled()
  })

  it('acknowledges navigation init data for the caller window', async () => {
    await navigationHandlers['navigation.ack_open_route']({ requestId: 7 }, ctx)

    expect(acknowledgeMainWindowNavigationMock).toHaveBeenCalledWith('w1', 7)
  })

  it('delegates conversation focus-or-open with the trusted caller window id', async () => {
    const target = { conversationType: 'assistant' as const, conversationId: 'topic-1' }

    await navigationHandlers['navigation.focus_or_open_conversation']({ target, title: 'Research notes' }, ctx)

    expect(conversationNavigationServiceMock.focusOrOpen).toHaveBeenCalledWith(target, 'Research notes', 'w1')
  })

  it('reports conversation ownership against the trusted caller window id', async () => {
    await navigationHandlers['navigation.report_conversation_ownership'](
      { requestId: 'request-1', ownsTarget: true },
      ctx
    )

    expect(conversationNavigationServiceMock.reportOwnership).toHaveBeenCalledWith('request-1', 'w1', true)
  })
})
