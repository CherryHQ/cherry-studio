import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ErrorInfo, PropsWithChildren, ReactNode } from 'react'
import { Activity, useLayoutEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRightPaneWidthPolicy } from '../../../shell/paneLayout'
import { createResourcePaneCapability, type ResourcePaneConfig } from '../resourcePane'
import {
  RightPanel,
  type RightPanelCapability,
  type RightPanelComponentProps,
  RightPanelHeaderControls,
  RightPanelProvider,
  type RightPanelReadiness,
  RightPanelShortcut,
  RightPanelViewport,
  useRightPanelActions,
  useRightPanelComposerElevated,
  useRightPanelPresentationMaximized,
  useRightPanelState
} from '../RightPanel'

const LIST_POLICY = getRightPaneWidthPolicy('navigation-list')
const INSPECTOR_POLICY = getRightPaneWidthPolicy('inspector')

const commandMock = vi.hoisted(() => ({ handler: undefined as (() => void) | undefined }))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('@renderer/components/ErrorBoundary', async () => {
  const { Component } = await import('react')

  class MockErrorBoundary extends Component<
    PropsWithChildren<{ onError?: (error: Error, info: ErrorInfo) => void }>,
    { error: Error | null }
  > {
    state = { error: null }

    static getDerivedStateFromError(error: Error) {
      return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
      this.props.onError?.(error, info)
    }

    render() {
      return this.state.error ? <div role="alert">render error</div> : this.props.children
    }
  }

  return { ErrorBoundary: MockErrorBoundary }
})

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({
    children,
    active,
    tone,
    ...props
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tone?: string }>) => (
    <button type="button" data-active={active || undefined} data-tone={tone} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/icons/SidebarToggleIcons', () => ({
  RightSidebarCollapseIcon: () => <span />
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: (_command: string, handler: () => void, options: { enabled: boolean }) => {
    commandMock.handler = options.enabled ? handler : undefined
  }
}))

vi.mock('@renderer/hooks/tab', () => ({
  useIsActiveTab: () => true
}))

vi.mock('@renderer/utils/style', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

vi.mock('../../../shell/RightPaneHost', () => ({
  // Mirrors the host's phase reporting: it enters the full-width phase with the click and only
  // leaves it once the box has settled, which is what "settle pane" stands in for.
  PersistentRightPaneHost: ({
    cacheKey,
    children,
    maximized,
    maxWidth,
    minWidth,
    open,
    onFullWidthPhaseChange
  }: PropsWithChildren<{
    cacheKey?: string
    maximized?: boolean
    maxWidth?: number
    minWidth?: number
    open: boolean
    onFullWidthPhaseChange?: (active: boolean) => void
  }>) => {
    useLayoutEffect(() => {
      if (maximized) onFullWidthPhaseChange?.(true)
    }, [maximized, onFullWidthPhaseChange])

    return (
      <div
        data-testid="right-pane-host"
        data-cache-key={cacheKey}
        data-maximized={String(Boolean(maximized))}
        data-max-width={maxWidth}
        data-min-width={minWidth}
        data-open={String(open)}>
        <button type="button" onClick={() => onFullWidthPhaseChange?.(false)}>
          settle pane
        </button>
        {children}
      </div>
    )
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

interface TestScope {
  firstKey: string
  firstReadiness: RightPanelReadiness
  firstHeaderMode?: 'shell' | 'content'
  firstKeepsComposerWhenMaximized?: boolean
  firstShouldThrow?: boolean
  secondReadiness: RightPanelReadiness
}

function StatefulPanel({ panelId, scope }: RightPanelComponentProps<TestScope>) {
  const [count, setCount] = useState(0)
  if (panelId === 'first' && scope.firstShouldThrow) throw new Error('render failed')

  return (
    <>
      {panelId === 'first' && scope.firstHeaderMode === 'content' ? <RightPanelHeaderControls canMaximize /> : null}
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        {panelId}:{count}
      </button>
    </>
  )
}

const capabilities = [
  {
    component: StatefulPanel,
    resolve: (scope) => ({
      id: 'first',
      instanceKey: scope.firstKey,
      title: 'First',
      readiness: scope.firstReadiness,
      headerMode: scope.firstHeaderMode,
      canMaximize: true,
      keepsComposerWhenMaximized: scope.firstKeepsComposerWhenMaximized
    })
  },
  {
    component: StatefulPanel,
    widthPreset: 'navigation-list',
    resolve: (scope) => ({
      id: 'second',
      instanceKey: 'second',
      title: 'Second',
      readiness: scope.secondReadiness
    })
  }
] satisfies readonly RightPanelCapability<TestScope>[]

const readyScope: TestScope = {
  firstKey: 'first',
  firstReadiness: 'ready',
  secondReadiness: 'ready'
}

function ControllerProbe() {
  const state = useRightPanelState()
  const actions = useRightPanelActions()
  const presentationMaximized = useRightPanelPresentationMaximized()
  const composerElevated = useRightPanelComposerElevated()
  return (
    <>
      <output data-testid="active-panel">{state.activePanelId ?? ''}</output>
      <output data-testid="presentation-open">{String(state.presentationOpen)}</output>
      <output data-testid="presentation-maximized">{String(presentationMaximized)}</output>
      <output data-testid="composer-elevated">{String(composerElevated)}</output>
      <button type="button" onClick={() => actions.tryOpen('first')}>
        open first
      </button>
      <button type="button" onClick={() => actions.tryOpen('second')}>
        open second
      </button>
    </>
  )
}

function Harness({
  children,
  defaultOpen = false,
  present = true,
  scope = readyScope
}: {
  children?: ReactNode
  defaultOpen?: boolean
  present?: boolean
  scope?: TestScope
}) {
  return (
    <RightPanelProvider
      capabilities={capabilities}
      scope={scope}
      defaultPanelId="first"
      defaultOpen={defaultOpen}
      present={present}>
      <ControllerProbe />
      {children}
    </RightPanelProvider>
  )
}

describe('RightPanel', () => {
  beforeEach(() => {
    commandMock.handler = undefined
  })

  it('waits for a requested pending panel instead of presenting another panel', () => {
    const scope = { ...readyScope, firstReadiness: 'pending' as const }
    const { rerender } = render(
      <Harness defaultOpen scope={scope}>
        <RightPanel />
      </Harness>
    )

    expect(screen.getByTestId('active-panel')).toHaveTextContent('')
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('false')

    rerender(
      <Harness defaultOpen scope={readyScope}>
        <RightPanel />
      </Harness>
    )

    expect(screen.getByTestId('active-panel')).toHaveTextContent('first')
    expect(screen.getByText('first:0')).toBeInTheDocument()
  })

  it('keeps a visited panel instance while switching panels', () => {
    render(
      <Harness defaultOpen>
        <RightPanel />
      </Harness>
    )
    const first = screen.getByText('first:0')
    fireEvent.click(first)
    fireEvent.click(screen.getByRole('button', { name: 'open second' }))

    expect(screen.getByText('first:1')).toBe(first)
    expect(screen.getByText('second:0')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'open first' }))
    expect(screen.getByText('first:1')).toBe(first)
  })

  it('replaces state when a panel identity changes', () => {
    const { rerender } = render(
      <Harness defaultOpen>
        <RightPanel />
      </Harness>
    )
    fireEvent.click(screen.getByText('first:0'))

    rerender(
      <Harness defaultOpen scope={{ ...readyScope, firstKey: 'replacement' }}>
        <RightPanel />
      </Harness>
    )

    expect(screen.getByText('first:0')).toBeInTheDocument()
  })

  it('preserves open intent while environmental presentation is disabled', () => {
    const { rerender } = render(
      <Harness defaultOpen present={false}>
        <RightPanel />
      </Harness>
    )
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('false')

    rerender(
      <Harness defaultOpen>
        <RightPanel />
      </Harness>
    )
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('true')
  })

  it('preserves user-opened state when Activity reconnects effects', () => {
    function ActivityHarness({ visible }: { visible: boolean }) {
      return (
        <Activity mode={visible ? 'visible' : 'hidden'}>
          <Harness />
        </Activity>
      )
    }

    const { rerender } = render(<ActivityHarness visible />)
    fireEvent.click(screen.getByRole('button', { name: 'open first' }))
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('true')

    rerender(<ActivityHarness visible={false} />)
    rerender(<ActivityHarness visible />)

    expect(screen.getByTestId('presentation-open')).toHaveTextContent('true')
  })

  it('syncs open state when defaultOpen actually changes', () => {
    const { rerender } = render(<Harness />)
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('false')

    rerender(<Harness defaultOpen />)
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('true')

    rerender(<Harness />)
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('false')
  })

  it('uses one toggle behavior for shortcuts', () => {
    render(
      <Harness>
        <RightPanelShortcut tab="first" label="First" icon={<span />} />
      </Harness>
    )
    const shortcut = screen.getByRole('button', { name: 'First' })

    fireEvent.click(shortcut)
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('true')
    fireEvent.click(shortcut)
    expect(screen.getByTestId('presentation-open')).toHaveTextContent('false')
  })

  it('registers the panel keyboard shortcut once in the viewport', () => {
    render(
      <Harness>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    expect(commandMock.handler).toBeDefined()
    act(() => commandMock.handler?.())
    expect(screen.getByTestId('right-pane-host')).toHaveAttribute('data-open', 'true')
  })

  it('keeps the composer lifted from the maximize click until the pane stops covering the centre', () => {
    render(
      <Harness defaultOpen>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    expect(screen.getByTestId('composer-elevated')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('composer-elevated')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))

    // The restore drops the maximized presentation at the click, but the pane goes on covering the
    // centre: dropping the composer here sinks it behind the pane for the rest of the animation.
    expect(screen.getByTestId('presentation-maximized')).toHaveTextContent('false')
    expect(screen.getByTestId('composer-elevated')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'settle pane' }))
    expect(screen.getByTestId('composer-elevated')).toHaveTextContent('false')
  })

  it('offers maximize only for capable panels and keeps the minimize control while maximized', () => {
    render(
      <Harness defaultOpen>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('right-pane-host')).toHaveAttribute('data-maximized', 'true')
    expect(screen.getByTestId('presentation-maximized')).toHaveTextContent('true')
    expect(screen.getByRole('button', { name: 'common.minimize' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'open second' }))
    expect(screen.getByTestId('presentation-maximized')).toHaveTextContent('true')
    expect(screen.getByRole('button', { name: 'common.minimize' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    expect(screen.getByTestId('right-pane-host')).toHaveAttribute('data-maximized', 'false')
    expect(screen.getByTestId('presentation-maximized')).toHaveTextContent('false')
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()
  })

  it('drops the composer elevation for a maximized panel that owns the whole area', () => {
    render(
      <Harness defaultOpen scope={{ ...readyScope, firstKeepsComposerWhenMaximized: false }}>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    expect(screen.getByTestId('composer-elevated')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('presentation-maximized')).toHaveTextContent('true')
    expect(screen.getByTestId('composer-elevated')).toHaveTextContent('false')
  })

  it('keeps the composer elevated above a maximized panel by default', () => {
    render(
      <Harness defaultOpen>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('composer-elevated')).toHaveTextContent('true')
  })

  it('lets a content-composed panel replace the shell header', () => {
    render(
      <Harness defaultOpen scope={{ ...readyScope, firstHeaderMode: 'content' }}>
        <RightPanel />
      </Harness>
    )

    expect(screen.queryByTestId('shell-tab-list')).toBeNull()
    expect(screen.getByText('first:0')).toBeInTheDocument()
  })

  it('keeps shell controls available when a content-composed panel fails to render', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const scope = { ...readyScope, firstHeaderMode: 'content' as const }

    const { rerender } = render(
      <Harness defaultOpen scope={scope}>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    fireEvent.click(screen.getByRole('button', { name: 'common.maximize' }))
    expect(screen.getByTestId('right-pane-host')).toHaveAttribute('data-maximized', 'true')

    rerender(
      <Harness defaultOpen scope={{ ...scope, firstShouldThrow: true }}>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    expect(screen.getByRole('alert')).toHaveTextContent('render error')
    expect(screen.getByTestId('shell-tab-list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.minimize' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.close_sidebar' }))
    expect(screen.getByTestId('right-pane-host')).toHaveAttribute('data-open', 'false')

    consoleError.mockRestore()
  })

  it('sizes the pane from the presented panel, so a list and an artifact never share a width', () => {
    render(
      <Harness defaultOpen>
        <RightPanelViewport>
          <RightPanel />
        </RightPanelViewport>
      </Harness>
    )

    const host = screen.getByTestId('right-pane-host')
    expect(host).toHaveAttribute('data-cache-key', INSPECTOR_POLICY.cacheKey)
    expect(host).toHaveAttribute('data-max-width', String(INSPECTOR_POLICY.maxWidth))

    fireEvent.click(screen.getByRole('button', { name: 'open second' }))

    expect(host).toHaveAttribute('data-cache-key', LIST_POLICY.cacheKey)
    expect(host).toHaveAttribute('data-max-width', String(LIST_POLICY.maxWidth))
    expect(host).toHaveAttribute('data-min-width', String(LIST_POLICY.minWidth))
  })

  it('rejects duplicate panel ids', () => {
    const duplicateCapabilities = [capabilities[0], capabilities[0]]
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      render(
        <RightPanelProvider capabilities={duplicateCapabilities} scope={readyScope}>
          content
        </RightPanelProvider>
      )
    ).toThrow('Duplicate right-panel id: first')
  })
})

describe('createResourcePaneCapability', () => {
  it('sizes by the navigation-list preset, so the list never inherits the inspector envelope', () => {
    const capability = createResourcePaneCapability<{ resourcePane: ResourcePaneConfig | null }>()

    expect(capability.widthPreset).toBe('navigation-list')
  })
})
