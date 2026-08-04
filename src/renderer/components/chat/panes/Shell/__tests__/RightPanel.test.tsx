import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ErrorInfo, PropsWithChildren, ReactNode } from 'react'
import { Activity, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  useRightPanelState
} from '../RightPanel'

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
  PersistentRightPaneHost: ({
    children,
    maximized,
    open
  }: PropsWithChildren<{ maximized?: boolean; open: boolean }>) => (
    <div data-testid="right-pane-host" data-maximized={String(Boolean(maximized))} data-open={String(open)}>
      {children}
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

interface TestScope {
  firstKey: string
  firstReadiness: RightPanelReadiness
  firstHeaderMode?: 'shell' | 'content'
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
      canMaximize: true
    })
  },
  {
    component: StatefulPanel,
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
  return (
    <>
      <output data-testid="active-panel">{state.activePanelId ?? ''}</output>
      <output data-testid="presentation-open">{String(state.presentationOpen)}</output>
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
    expect(screen.getByRole('button', { name: 'common.minimize' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'open second' }))
    expect(screen.getByRole('button', { name: 'common.minimize' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.minimize' }))
    expect(screen.getByTestId('right-pane-host')).toHaveAttribute('data-maximized', 'false')
    expect(screen.queryByRole('button', { name: 'common.maximize' })).toBeNull()
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
