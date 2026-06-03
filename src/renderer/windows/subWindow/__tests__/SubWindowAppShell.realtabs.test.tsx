import { useTabsContext } from '@renderer/context/TabsContext'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Drive the REAL TabsProvider (not a mocked useTabs) so the init effect runs against the
// real, identity-changing `setActiveTab`. This is what catches the runaway-render
// regression: keying the effect off `init === processedInitRef.current` must stop it from
// re-firing after its own resetNormalTabs state update. With a mocked (stable) useTabs the
// loop cannot reproduce, which is why the sibling test file can't guard this.
const mocks = vi.hoisted(() => ({ init: null as null | Record<string, unknown> }))

vi.mock('@renderer/hooks/useWindowInitData', () => ({ useWindowInitData: () => mocks.init }))
vi.mock('@renderer/components/layout/AppShellTabBar', () => ({ AppShellTabBar: () => null }))
vi.mock('@renderer/components/layout/TabRouter', () => ({ TabRouter: () => null }))
vi.mock('@renderer/components/MiniApp/MiniAppTabsPool', () => ({ default: () => null }))

import { TabsProvider } from '@renderer/context/TabsContext'

import { SubWindowAppShell } from '../SubWindowAppShell'

// Reads the live tab state out of the real provider so the test can assert what the effect
// settled on. Also acts as a render guard: it consumes the tabs context, so a runaway init
// effect (which churns the tabs state every iteration) re-renders this component on every
// loop. Throwing past a cap turns the loop into a fast, deterministic failure instead of an
// out-of-memory worker crash.
const RENDER_CAP = 40
const probe = { tabs: [] as Array<{ id: string }>, activeTabId: '', renders: 0 }
function Probe() {
  const { tabs, activeTabId } = useTabsContext()
  probe.tabs = tabs
  probe.activeTabId = activeTabId
  if (++probe.renders > RENDER_CAP) throw new Error(`runaway render: ${probe.renders}`)
  return null
}

describe('SubWindowAppShell with the real TabsProvider (loop regression)', () => {
  beforeEach(() => {
    mocks.init = null
    probe.tabs = []
    probe.activeTabId = ''
    probe.renders = 0
    MockUseCacheUtils.resetMocks()
    document.body.innerHTML = '<div id="spinner"></div>'
  })

  it('settles on a single detached mini-app tab without a runaway render', () => {
    // If the init effect re-fired on every setActiveTab identity change, React 19 would throw
    // "Maximum update depth exceeded" here and render() would reject.
    mocks.init = { tabId: 'deepseek-tab', url: '/app/mini-app/deepseek', type: 'route', isPinned: false }
    expect(() =>
      render(
        <TabsProvider>
          <SubWindowAppShell />
          <Probe />
        </TabsProvider>
      )
    ).not.toThrow()

    expect(probe.tabs.map((t) => t.id)).toEqual(['home', 'deepseek-tab'])
    expect(probe.activeTabId).toBe('deepseek-tab')
    expect(document.getElementById('spinner')).toBeNull()
  })

  it('re-inits to the new tab when a fresh init arrives on pool reuse', () => {
    mocks.init = { tabId: 'deepseek-tab', url: '/app/mini-app/deepseek', type: 'route', isPinned: false }
    const { rerender } = render(
      <TabsProvider>
        <SubWindowAppShell />
        <Probe />
      </TabsProvider>
    )
    expect(probe.activeTabId).toBe('deepseek-tab')

    // New object reference = a new detach session (the same payload reference would be a
    // re-render and must be ignored by the guard).
    mocks.init = { tabId: 'gemini-tab', url: '/app/mini-app/gemini', type: 'route', isPinned: false }
    rerender(
      <TabsProvider>
        <SubWindowAppShell />
        <Probe />
      </TabsProvider>
    )

    expect(probe.tabs.map((t) => t.id)).toEqual(['home', 'gemini-tab'])
    expect(probe.activeTabId).toBe('gemini-tab')
  })
})
