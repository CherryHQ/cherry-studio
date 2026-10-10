import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab/useTabsContext'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
// @vitest-environment jsdom
import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'

import { createSidebarShortcutTarget } from '../../../../utils/sidebar'
import { CORE_SIDEBAR_SHORTCUT_PROVIDERS } from '../providers'
import { SidebarShortcutRegistry } from '../registry'
import {
  resolveSidebarShortcuts,
  useResolvedSidebarShortcuts,
  useSidebarActivationGateway,
  useSidebarShortcutActivation,
  useSidebarNavigationSnapshot
} from '../runtime'
import type { ResolvedShortcut, SidebarShortcutProvider } from '../types'

function item(providerId: string, resourceId: string, activationId?: string): SidebarShortcutItem {
  const target = createSidebarShortcutTarget(providerId, resourceId, activationId)
  return { type: 'shortcut', id: `item:${providerId}:${resourceId}`, target, fallbackLabel: resourceId }
}

function resolved(target: SidebarShortcutItem['target'], label: string) {
  return new Map([[createSidebarShortcutId(target), { label, renderIcon: () => null }]])
}

function tabContext(tabs: Tab[]): TabsContextValue {
  return {
    tabs,
    activeTab: tabs[0],
    activeTabId: tabs[0].id,
    isLoading: false,
    addTab: vi.fn(),
    closeTab: vi.fn(),
    closeTabs: vi.fn(),
    setActiveTab: vi.fn(),
    updateTab: vi.fn(),
    openTab: vi.fn(() => 'new-tab'),
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    reorderTabs: vi.fn(),
    detachTab: vi.fn(),
    attachTab: vi.fn()
  }
}

/**
 * Tabs context whose operations actually run, so tests can assert the resulting navigation —
 * which tab is active, what it shows, which tabs survive — instead of which mock was called.
 * Mirrors `TabsProvider`: exact-URL reuse unless `forceNew`, and `setActiveTab` ignores unknown ids.
 */
function statefulTabContext(initial: Tab[]) {
  let nextId = 0
  const state = { tabs: initial, activeTabId: initial[0].id }
  const context: TabsContextValue = {
    ...tabContext(initial),
    get tabs() {
      return state.tabs
    },
    get activeTabId() {
      return state.activeTabId
    },
    get activeTab() {
      return state.tabs.find((tab) => tab.id === state.activeTabId)
    },
    setActiveTab: (id) => {
      if (state.tabs.some((tab) => tab.id === id)) state.activeTabId = id
    },
    updateTab: (id, updates) => {
      state.tabs = state.tabs.map((tab) => (tab.id === id ? { ...tab, ...updates } : tab))
    },
    openTab: (url, options = {}) => {
      const existing = options.forceNew
        ? undefined
        : state.tabs.find((tab) => tab.type === (options.type ?? 'route') && tab.url === url)
      if (existing) {
        state.activeTabId = existing.id
        return existing.id
      }
      const id = `opened-${++nextId}`
      state.tabs = [
        ...state.tabs,
        {
          id,
          type: options.type ?? 'route',
          url,
          title: options.title ?? url,
          icon: options.icon,
          metadata: options.metadata,
          isPinned: options.isPinned,
          lastAccessTime: 0,
          isDormant: false
        }
      ]
      state.activeTabId = id
      return id
    }
  }
  return { context, state }
}

async function activateShortcut(context: TabsContextValue, providerId: string, resourceId: string) {
  const wrapper = ({ children }: PropsWithChildren) => createElement(TabsContext, { value: context }, children)
  const { result } = renderHook(() => useSidebarActivationGateway(), { wrapper })
  const provider = CORE_SIDEBAR_SHORTCUT_PROVIDERS.find((candidate) => candidate.id === providerId)!
  await act(async () => provider.activate(createSidebarShortcutTarget(providerId, resourceId), result.current))
}

describe('sidebar conversation navigation', () => {
  it('does not reset an already active app detail route', async () => {
    const tabs = tabContext([{ id: 'files', type: 'route', url: '/app/files?entryId=file-1', title: 'File' }])
    const wrapper = ({ children }: PropsWithChildren) => createElement(TabsContext, { value: tabs }, children)
    const { result } = renderHook(() => useSidebarShortcutActivation(), { wrapper })
    const provider = CORE_SIDEBAR_SHORTCUT_PROVIDERS.find((candidate) => candidate.id === 'core.app')!
    await act(async () =>
      result.current(provider, createSidebarShortcutTarget('core.app', 'files'), {
        label: 'Files',
        renderIcon: () => null
      })
    )
    expect(tabs.updateTab).not.toHaveBeenCalled()
    expect(tabs.openTab).not.toHaveBeenCalled()
  })

  it('ignores a late ordinary activation after a newer shortcut was opened', async () => {
    let resolveFirst!: (value: unknown) => void
    MockDataApiUtils.setCustomResponse(
      '/topics/latest',
      'GET',
      new Promise((resolve) => {
        resolveFirst = resolve
      })
    )
    const tabs = tabContext([{ id: 'current', type: 'route', url: '/app/files', title: 'Files' }])
    const wrapper = ({ children }: PropsWithChildren) => createElement(TabsContext, { value: tabs }, children)
    const { result } = renderHook(() => useSidebarShortcutActivation(), { wrapper })
    const assistant = CORE_SIDEBAR_SHORTCUT_PROVIDERS.find((candidate) => candidate.id === 'core.assistant')!
    const knowledge = CORE_SIDEBAR_SHORTCUT_PROVIDERS.find((candidate) => candidate.id === 'core.knowledge-base')!
    const resource = { label: 'Resource', renderIcon: () => null }
    const first = result.current(assistant, createSidebarShortcutTarget('core.assistant', 'a'), resource)
    await act(async () => result.current(knowledge, createSidebarShortcutTarget('core.knowledge-base', 'b'), resource))
    await act(async () => {
      resolveFirst({ topic: { id: 'late-topic' } })
      await first
    })
    expect(tabs.updateTab).toHaveBeenCalledTimes(1)
    expect(tabs.updateTab).toHaveBeenLastCalledWith(
      'current',
      expect.objectContaining({ url: '/app/knowledge?baseId=b' })
    )
    MockDataApiUtils.resetMocks()
  })

  it.each(['switch', 'navigate', 'unmount'] as const)('discards a pending activation on %s', async (change) => {
    let resolveEntry!: (value: unknown) => void
    MockDataApiUtils.setCustomResponse(
      '/topics/latest',
      'GET',
      new Promise((resolve) => {
        resolveEntry = resolve
      })
    )
    const tabs = tabContext([{ id: 'current', type: 'route', url: '/app/files', title: 'Files' }])
    const wrapper = ({ children }: PropsWithChildren) => createElement(TabsContext, { value: { ...tabs } }, children)
    const { result, rerender, unmount } = renderHook(() => useSidebarShortcutActivation(), { wrapper })
    const assistant = CORE_SIDEBAR_SHORTCUT_PROVIDERS.find((candidate) => candidate.id === 'core.assistant')!
    const first = result.current(assistant, createSidebarShortcutTarget('core.assistant', 'a'), {
      label: 'Assistant',
      renderIcon: () => null
    })
    if (change === 'unmount') unmount()
    else {
      tabs.activeTab = { ...tabs.activeTab!, ...(change === 'switch' ? { id: 'other' } : { url: '/app/code' }) }
      rerender()
    }
    await act(async () => {
      resolveEntry({ topic: { id: 'late-topic' } })
      await first
    })
    expect(tabs.updateTab).not.toHaveBeenCalled()
    expect(tabs.openTab).not.toHaveBeenCalled()
    expect(tabs.setActiveTab).not.toHaveBeenCalled()
    MockDataApiUtils.resetMocks()
  })

  it.each([
    ['core.assistant', '/topics/latest', 'topic', '/app/chat?extra=1&topicId=conversation-1'],
    ['core.agent', '/agent-sessions/latest', 'session', '/app/agents?extra=1&sessionId=conversation-1']
  ] as const)(
    'reuses an existing canonical conversation for %s, but honors an explicit new tab',
    async (providerId, endpoint, field, url) => {
      MockDataApiUtils.setCustomResponse(endpoint, 'GET', { [field]: { id: 'conversation-1' } })
      const tabs = tabContext([
        { id: 'other', type: 'route', url: '/app/files', title: 'Files' },
        { id: 'conversation', type: 'route', url, title: 'Conversation' }
      ])
      const wrapper = ({ children }: PropsWithChildren) => createElement(TabsContext, { value: tabs }, children)
      const { result } = renderHook(() => useSidebarActivationGateway(), { wrapper })
      const provider = CORE_SIDEBAR_SHORTCUT_PROVIDERS.find((candidate) => candidate.id === providerId)!
      const target = createSidebarShortcutTarget(providerId, 'owner-1')

      await act(async () => provider.activate(target, result.current))
      expect(tabs.setActiveTab).toHaveBeenCalledWith('conversation')
      expect(tabs.updateTab).not.toHaveBeenCalled()
      expect(tabs.openTab).not.toHaveBeenCalled()

      await act(async () =>
        provider.activate(target, {
          ...result.current,
          openWorkspace: (destination) => result.current.openWorkspace(destination, { inNewTab: true })
        })
      )
      expect(tabs.openTab).toHaveBeenCalledWith(
        expect.stringContaining('conversation-1'),
        expect.objectContaining({ forceNew: true })
      )
      MockDataApiUtils.resetMocks()
    }
  )

  it('repurposes the active tab for an app shortcut instead of focusing another tab of that app', async () => {
    const { context, state } = statefulTabContext([
      { id: 'current', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Chat' },
      { id: 'other-agent', type: 'route', url: '/app/agents?sessionId=session-1', title: 'Agent' }
    ])

    await activateShortcut(context, 'core.app', 'agents')

    expect(state.activeTabId).toBe('current')
    expect(state.tabs.find((tab) => tab.id === 'current')?.url).toBe('/app/agents')
    expect(state.tabs.find((tab) => tab.id === 'other-agent')?.url).toBe('/app/agents?sessionId=session-1')
  })

  it.each(['translate', 'notes'])(
    'repurposes the active tab for the %s app shortcut even when a sibling tab has its exact URL',
    async (appId) => {
      const { context, state } = statefulTabContext([
        { id: 'current', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Chat' },
        { id: 'sibling', type: 'route', url: `/app/${appId}`, title: appId }
      ])

      await activateShortcut(context, 'core.app', appId)

      expect(state.activeTabId).toBe('current')
      expect(state.tabs).toHaveLength(2)
      expect(state.tabs.find((tab) => tab.id === 'current')?.url).toBe(`/app/${appId}`)
      expect(state.tabs.find((tab) => tab.id === 'sibling')?.url).toBe(`/app/${appId}`)
    }
  )

  it('opens a new tab for an app shortcut instead of focusing a sibling when the active tab is pinned', async () => {
    const { context, state } = statefulTabContext([
      { id: 'current', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Chat', isPinned: true },
      { id: 'sibling', type: 'route', url: '/app/translate', title: 'Translate' }
    ])

    await activateShortcut(context, 'core.app', 'translate')

    expect(state.tabs).toHaveLength(3)
    expect(state.activeTabId).not.toBe('sibling')
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)?.url).toBe('/app/translate')
    expect(state.tabs.find((tab) => tab.id === 'current')?.url).toBe('/app/chat?topicId=topic-1')
  })

  it('opens a new tab for an app shortcut while a mini app tab stays alive instead of focusing a sibling', async () => {
    const { context, state } = statefulTabContext([
      { id: 'mini-app', type: 'route', url: '/app/mini-app/foo', title: 'Mini App' },
      { id: 'sibling', type: 'route', url: '/app/translate', title: 'Translate' }
    ])

    await activateShortcut(context, 'core.app', 'translate')

    expect(state.activeTabId).not.toBe('sibling')
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)?.url).toBe('/app/translate')
    expect(state.tabs.find((tab) => tab.id === 'mini-app')?.url).toBe('/app/mini-app/foo')
    expect(state.tabs).toHaveLength(3)
  })

  it.each([
    ['core.mini-app', 'one', '/app/mini-app/one'],
    ['core.knowledge-base', 'one', '/app/knowledge?baseId=one'],
    [
      'core.file-entry',
      '11111111-1111-4111-8111-111111111111',
      '/app/files?entryId=11111111-1111-4111-8111-111111111111'
    ]
  ] as const)('focuses the open tab for %s', async (providerId, resourceId, url) => {
    const { context, state } = statefulTabContext([
      { id: 'current', type: 'route', url: '/app/code', title: 'Code' },
      { id: 'open', type: 'route', url, title: 'Open' }
    ])

    await activateShortcut(context, providerId, resourceId)

    expect(state.activeTabId).toBe('open')
    expect(state.tabs).toHaveLength(2)
  })

  it('does not rewrite the active tab when it already shows the shortcut resource', async () => {
    const { context, state } = statefulTabContext([
      { id: 'current', type: 'route', url: '/app/knowledge?baseId=one', title: 'KB' }
    ])

    await activateShortcut(context, 'core.knowledge-base', 'one')

    expect(state.activeTabId).toBe('current')
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({ url: '/app/knowledge?baseId=one', title: 'KB' })
  })

  it('does not duplicate a pinned agent tab that already shows the agent entry', async () => {
    MockDataApiUtils.setCustomResponse('/agent-sessions/latest', 'GET', { session: null })
    const { context, state } = statefulTabContext([
      { id: 'current', type: 'route', url: '/app/agents?agentId=owner-1', title: 'Agent', isPinned: true }
    ])

    await activateShortcut(context, 'core.agent', 'owner-1')

    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabId).toBe('current')
    MockDataApiUtils.resetMocks()
  })

  it('focuses an open code tool tab matched by param rather than by string equality', async () => {
    const { context, state } = statefulTabContext([
      { id: 'current', type: 'route', url: '/app/files', title: 'Files' },
      { id: 'code', type: 'route', url: '/app/code?foo=1&tool=pi', title: 'Code' }
    ])

    await activateShortcut(context, 'core.code-cli', 'pi')

    expect(state.activeTabId).toBe('code')
    expect(state.tabs).toHaveLength(2)
  })

  it('drops the previous conversation owner as soon as the route changes', () => {
    MockUseDataApiUtils.mockQueryData('/topics/topic-1', {
      id: 'topic-1',
      assistantId: 'assistant-1',
      name: 'Conversation',
      isNameManuallyEdited: false,
      orderKey: 'a0',
      lastActivityAt: '2026-09-15T00:00:00Z',
      createdAt: '2026-09-15T00:00:00Z',
      updatedAt: '2026-09-15T00:00:00Z'
    })
    const tabs = tabContext([{ id: 'chat', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Chat' }])
    const wrapper = ({ children }: PropsWithChildren) => createElement(TabsContext, { value: tabs }, children)
    const { result, rerender } = renderHook(() => useSidebarNavigationSnapshot(), { wrapper })
    expect(result.current.assistantId).toBe('assistant-1')
    tabs.activeTab = { ...tabs.activeTab!, url: '/app/files' }
    rerender()
    expect(result.current.assistantId).toBeUndefined()
    expect(result.current.agentId).toBeUndefined()
    MockUseDataApiUtils.resetMocks()
  })
})

describe('resolveSidebarShortcuts', () => {
  it('batches each provider once and distinguishes missing resources', async () => {
    const resolveMany = vi.fn(
      async (targets) =>
        new Map([
          [
            targets[0]!.locator.resourceId === 'one' ? createSidebarShortcutId(targets[0]) : '',
            { label: 'One', renderIcon: () => null }
          ]
        ])
    )
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: (target) => target.locator.providerId === 'test' && target.activationId === undefined,
      resolveMany,
      activate: vi.fn()
    }
    const shortcuts = [item('test', 'one'), item('test', 'missing')]

    const result = await resolveSidebarShortcuts(shortcuts, new SidebarShortcutRegistry([provider]))

    expect(resolveMany).toHaveBeenCalledTimes(1)
    expect(resolveMany.mock.calls[0][0]).toHaveLength(2)
    expect(result.map((entry) => entry.status)).toEqual(['resolved', 'missing'])
  })

  it('marks request failures, unknown providers, and unknown activations unavailable', async () => {
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: (target) => target.activationId === undefined,
      resolveMany: vi.fn().mockRejectedValue(new Error('offline')),
      activate: vi.fn()
    }

    const result = await resolveSidebarShortcuts(
      [item('test', 'one'), item('unknown', 'two'), item('test', 'three', 'run')],
      new SidebarShortcutRegistry([provider])
    )

    expect(result.map((entry) => entry.status)).toEqual(['unavailable', 'unavailable', 'unavailable'])
    expect(provider.resolveMany).toHaveBeenCalledWith([result[0].shortcut.target])
  })

  it('ignores an obsolete request after the shortcut set changes', async () => {
    const pending = new Map<string, (value: Map<string, ResolvedShortcut>) => void>()
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: () => true,
      resolveMany: vi.fn(
        (targets) =>
          new Promise<Map<string, ResolvedShortcut>>((resolve) => {
            pending.set(targets[0]!.locator.resourceId, resolve)
          })
      ),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([provider])
    const slow = item('test', 'slow')
    const fast = item('test', 'fast')
    const { result, rerender } = renderHook(({ shortcuts }) => useResolvedSidebarShortcuts(shortcuts, registry), {
      initialProps: { shortcuts: [slow] }
    })

    await waitFor(() => expect(pending.has('slow')).toBe(true))
    rerender({ shortcuts: [fast] })
    await waitFor(() => expect(pending.has('fast')).toBe(true))
    act(() => pending.get('fast')!(resolved(fast.target, 'Fast')))
    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Fast' } }))

    act(() => pending.get('slow')!(resolved(slow.target, 'Slow')))
    await act(async () => Promise.resolve())
    expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Fast' } })
  })

  it('keeps existing shortcuts resolved while their provider resolves a newly added target', async () => {
    const one = item('test', 'one')
    const two = item('test', 'two')
    let finishUpdate: (value: Map<string, ResolvedShortcut>) => void = vi.fn()
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: () => true,
      resolveMany: vi.fn((targets) => {
        if (targets.length === 1) return Promise.resolve(resolved(one.target, 'One'))
        return new Promise<Map<string, ResolvedShortcut>>((resolve) => {
          finishUpdate = resolve
        })
      }),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([provider])
    const { result, rerender } = renderHook(({ shortcuts }) => useResolvedSidebarShortcuts(shortcuts, registry), {
      initialProps: { shortcuts: [one] }
    })

    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'One' } }))
    rerender({ shortcuts: [one, two] })
    await waitFor(() => expect(provider.resolveMany).toHaveBeenCalledTimes(2))

    expect(result.current).toMatchObject([{ status: 'resolved', resource: { label: 'One' } }, { status: 'loading' }])

    act(() =>
      finishUpdate(
        new Map([
          [createSidebarShortcutId(one.target), { label: 'One', renderIcon: () => null }],
          [createSidebarShortcutId(two.target), { label: 'Two', renderIcon: () => null }]
        ])
      )
    )
    await waitFor(() => expect(result.current[1]).toMatchObject({ status: 'resolved', resource: { label: 'Two' } }))
  })

  it('only re-resolves the provider whose target set changed', async () => {
    const alpha = item('alpha', 'one')
    const beta = item('beta', 'one')
    const betaTwo = item('beta', 'two')
    let finishBetaUpdate: (value: Map<string, ResolvedShortcut>) => void = vi.fn()
    const alphaProvider: SidebarShortcutProvider = {
      id: 'alpha',
      validate: () => true,
      resolveMany: vi.fn(async () => resolved(alpha.target, 'Alpha')),
      activate: vi.fn()
    }
    const betaProvider: SidebarShortcutProvider = {
      id: 'beta',
      validate: () => true,
      resolveMany: vi.fn((targets) => {
        if (targets.length === 1) return Promise.resolve(resolved(beta.target, 'Beta'))
        return new Promise<Map<string, ResolvedShortcut>>((resolve) => {
          finishBetaUpdate = resolve
        })
      }),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([alphaProvider, betaProvider])
    const { result, rerender } = renderHook(({ shortcuts }) => useResolvedSidebarShortcuts(shortcuts, registry), {
      initialProps: { shortcuts: [alpha, beta] }
    })

    await waitFor(() => expect(result.current.every((entry) => entry.status === 'resolved')).toBe(true))
    rerender({ shortcuts: [alpha, beta, betaTwo] })
    await waitFor(() => expect(betaProvider.resolveMany).toHaveBeenCalledTimes(2))

    expect(alphaProvider.resolveMany).toHaveBeenCalledTimes(1)
    expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Alpha' } })

    act(() =>
      finishBetaUpdate(
        new Map([
          [createSidebarShortcutId(beta.target), { label: 'Beta', renderIcon: () => null }],
          [createSidebarShortcutId(betaTwo.target), { label: 'Beta Two', renderIcon: () => null }]
        ])
      )
    )
    await waitFor(() => expect(result.current[2]).toMatchObject({ status: 'resolved' }))
  })

  it('keeps stale results visible while provider invalidation re-resolves and releases the subscription', async () => {
    let invalidate = () => {}
    const cleanup = vi.fn()
    const shortcut = item('test', 'one')
    let finishRefresh: (value: Map<string, ResolvedShortcut>) => void = vi.fn()
    let isInitialResolution = true
    const provider: SidebarShortcutProvider = {
      id: 'test',
      validate: () => true,
      resolveMany: vi.fn(() => {
        if (isInitialResolution) {
          isInitialResolution = false
          return Promise.resolve(resolved(shortcut.target, 'One'))
        }
        return new Promise<Map<string, ResolvedShortcut>>((resolve) => {
          finishRefresh = resolve
        })
      }),
      subscribe: vi.fn((_targets, nextInvalidate) => {
        invalidate = nextInvalidate
        return cleanup
      }),
      activate: vi.fn()
    }
    const registry = new SidebarShortcutRegistry([provider])
    const { result, unmount } = renderHook(() => useResolvedSidebarShortcuts([shortcut], registry))

    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'One' } }))
    act(() => invalidate())
    await waitFor(() => expect(provider.resolveMany).toHaveBeenCalledTimes(2))
    expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'One' } })

    act(() => finishRefresh(resolved(shortcut.target, 'Updated')))
    await waitFor(() => expect(result.current[0]).toMatchObject({ status: 'resolved', resource: { label: 'Updated' } }))
    expect(provider.subscribe).toHaveBeenCalledWith([shortcut.target], expect.any(Function))

    unmount()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
