import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async () => {
  const { createContext, use } = await import('react')
  const TabsValueContext = createContext('')

  return {
    HorizontalScrollContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Tabs: ({ children, value }: { children: ReactNode; value?: string }) => (
      <TabsValueContext value={value ?? ''}>{children}</TabsValueContext>
    ),
    TabsContent: ({
      children,
      className,
      forceMount,
      value
    }: {
      children: ReactNode
      className?: string
      forceMount?: boolean
      value: string
    }) => {
      const activeValue = use(TabsValueContext)
      const active = activeValue === value
      if (!active && !forceMount) return null
      return (
        <div className={className} data-state={active ? 'active' : 'inactive'} hidden={!active}>
          {children}
        </div>
      )
    },
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: { children: ReactNode }) => children
  }
})

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({
    active,
    children,
    tone,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; children: ReactNode; tone?: string }) => (
    <button type="button" data-active={active || undefined} data-tone={tone} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@renderer/components/command', () => ({
  CommandTooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandHandler: vi.fn()
}))

vi.mock('../../../shell/RightPaneHost', () => ({
  RightPaneHost: ({ children, open }: { children?: ReactNode; open?: boolean }) => (open ? children : null)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import {
  defineRightPanelCapabilities,
  RightPanel,
  type RightPanelComponentProps,
  type RightPanelInstance,
  RightPanelProvider,
  RightPanelShortcut,
  useRightPanelActions,
  useRightPanelState
} from '../RightPanel'
import { Shell, useShellActions, useShellState } from '../Shell'

interface TestScope {
  instances: readonly RightPanelInstance[]
}

function TestPanel({ panelId }: RightPanelComponentProps<TestScope>) {
  const [count, setCount] = useState(0)

  return (
    <button type="button" data-testid={`panel-${panelId}`} onClick={() => setCount((current) => current + 1)}>
      {panelId}:{count}
    </button>
  )
}

function defineTestCapabilities(component: ComponentType<RightPanelComponentProps<TestScope>>) {
  return defineRightPanelCapabilities<TestScope>()(
    [0, 1, 2].map((index) => ({
      component,
      resolve: (scope: TestScope) => scope.instances[index] ?? null
    }))
  )
}

const CAPABILITIES = defineTestCapabilities(TestPanel)

const panelEffects = {
  cleanup: vi.fn(),
  mount: vi.fn()
}

function EffectPanel({ panelId }: RightPanelComponentProps<TestScope>) {
  useEffect(() => {
    panelEffects.mount(panelId)
    return () => panelEffects.cleanup(panelId)
  }, [panelId])

  return <div data-testid={`effect-panel-${panelId}`}>{panelId}</div>
}

const EFFECT_CAPABILITIES = defineTestCapabilities(EffectPanel)

function ControllerProbe() {
  const state = useRightPanelState()
  const actions = useRightPanelActions()
  const shellActions = useShellActions()
  const shellState = useShellState()

  return (
    <>
      <output
        data-testid="right-panel-state"
        data-shell-tab={shellState.activeTab}
        data-active={state.activePanelId ?? ''}
        data-default={state.defaultPanelId ?? ''}
        data-presentation-enabled={String(state.presentationEnabled)}
        data-presentation-open={String(state.presentationOpen)}
        data-presentation-maximized={String(state.presentationMaximized)}
      />
      <button type="button" onClick={() => actions.tryOpen('files')}>
        try files
      </button>
      <button type="button" onClick={() => actions.tryOpen('status')}>
        try status
      </button>
      <button type="button" onClick={() => actions.requestOpen('flow:one')}>
        request flow
      </button>
      <button type="button" onClick={shellActions.toggleMaximized}>
        toggle maximized
      </button>
    </>
  )
}

function TestHarness({
  defaultOpen = true,
  defaultTab = 'files',
  onOpenChange,
  present = true,
  scope,
  children
}: {
  defaultOpen?: boolean
  defaultTab?: string
  onOpenChange?: (open: boolean) => void
  present?: boolean
  scope: TestScope
  children?: ReactNode
}) {
  return (
    <Shell defaultTab={defaultTab} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <RightPanelProvider capabilities={CAPABILITIES} scope={scope} present={present}>
        <ControllerProbe />
        {children}
        <RightPanel />
      </RightPanelProvider>
    </Shell>
  )
}

const ready = (id: string, instanceKey = id): RightPanelInstance => ({
  id,
  instanceKey,
  readiness: 'ready',
  title: id
})

const pending = (id: string, instanceKey = id): RightPanelInstance => ({
  id,
  instanceKey,
  readiness: 'pending',
  title: id
})

const unavailable = (id: string, instanceKey = id): RightPanelInstance => ({
  id,
  instanceKey,
  readiness: 'unavailable',
  title: id
})

describe('RightPanel controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves a visited panel while Activity pauses and restores its effects', async () => {
    render(
      <Shell defaultTab="files" defaultOpen>
        <RightPanelProvider capabilities={EFFECT_CAPABILITIES} scope={{ instances: [ready('files'), ready('status')] }}>
          <ControllerProbe />
          <RightPanel />
        </RightPanelProvider>
      </Shell>
    )

    const filesPanel = screen.getByTestId('effect-panel-files')
    await waitFor(() => expect(panelEffects.mount).toHaveBeenCalledWith('files'))

    fireEvent.click(screen.getByRole('button', { name: 'try status' }))

    await waitFor(() => expect(panelEffects.cleanup).toHaveBeenCalledWith('files'))
    expect(screen.getByTestId('effect-panel-files')).toBe(filesPanel)
    expect(panelEffects.mount).toHaveBeenCalledWith('status')

    fireEvent.click(screen.getByRole('button', { name: 'try files' }))

    await waitFor(() => {
      expect(panelEffects.mount.mock.calls.filter(([panelId]) => panelId === 'files')).toHaveLength(2)
    })
    expect(screen.getByTestId('effect-panel-files')).toBe(filesPanel)
  })

  it('preserves a pending requested panel without presenting a ready fallback or closing', () => {
    const onOpenChange = vi.fn()

    render(<TestHarness scope={{ instances: [ready('resources'), pending('files')] }} onOpenChange={onOpenChange} />)

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-shell-tab', 'files')
    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', '')
    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-presentation-open', 'false')
    expect(screen.queryByTestId('panel-resources')).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('rejects duplicate concrete panel ids across capabilities', () => {
    const duplicateCapabilities = defineRightPanelCapabilities<TestScope>()([
      { component: TestPanel, resolve: () => ready('files') },
      { component: TestPanel, resolve: () => ready('files', 'other-instance') }
    ])

    expect(() =>
      render(
        <Shell defaultTab="files">
          <RightPanelProvider capabilities={duplicateCapabilities} scope={{ instances: [] }}>
            <div />
          </RightPanelProvider>
        </Shell>
      )
    ).toThrow('Duplicate right-panel id: files')
  })

  it('reconciles an unavailable request to the first ready entry without reporting an open-state change', () => {
    const onOpenChange = vi.fn()

    render(
      <TestHarness
        scope={{ instances: [unavailable('files'), ready('status'), ready('trace')] }}
        onOpenChange={onOpenChange}
      />
    )

    const state = screen.getByTestId('right-panel-state')
    expect(state).toHaveAttribute('data-shell-tab', 'status')
    expect(state).toHaveAttribute('data-active', 'status')
    expect(state).toHaveAttribute('data-default', 'status')
    expect(screen.getByTestId('panel-status')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-trace')).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps open intent when no entry can be presented', () => {
    const onOpenChange = vi.fn()

    render(
      <TestHarness scope={{ instances: [unavailable('files'), unavailable('status')] }} onOpenChange={onOpenChange} />
    )

    const state = screen.getByTestId('right-panel-state')
    expect(state).toHaveAttribute('data-shell-tab', 'files')
    expect(state).toHaveAttribute('data-active', '')
    expect(state).toHaveAttribute('data-presentation-open', 'false')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('reconciles to a pending default only when no ready entry exists, then presents it when ready', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <TestHarness
        defaultTab="resources"
        scope={{ instances: [unavailable('resources'), pending('files'), unavailable('status')] }}
        onOpenChange={onOpenChange}
      />
    )

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-shell-tab', 'files')
    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', '')
    expect(screen.queryByTestId('panel-files')).toBeNull()

    rerender(
      <TestHarness
        defaultTab="resources"
        scope={{ instances: [unavailable('resources'), ready('files'), unavailable('status')] }}
        onOpenChange={onOpenChange}
      />
    )

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', 'files')
    expect(screen.getByTestId('panel-files')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps a panel mounted after its first activation and removes it when it becomes unavailable', () => {
    const { rerender } = render(<TestHarness scope={{ instances: [ready('files'), ready('status')] }} />)

    fireEvent.click(screen.getByTestId('panel-files'))
    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')

    fireEvent.click(screen.getByRole('button', { name: 'try status' }))
    fireEvent.click(screen.getByTestId('panel-status'))

    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')
    expect(screen.getByTestId('panel-status')).toHaveTextContent('status:1')

    rerender(<TestHarness scope={{ instances: [ready('files'), unavailable('status')] }} />)

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', 'files')
    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')
    expect(screen.queryByTestId('panel-status')).toBeNull()
  })

  it('keeps a visited pending instance mounted but hidden until the same instance is ready again', () => {
    const { rerender } = render(<TestHarness scope={{ instances: [ready('files')] }} />)

    fireEvent.click(screen.getByTestId('panel-files'))
    fireEvent.click(screen.getByRole('button', { name: 'toggle maximized' }))

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-presentation-maximized', 'true')

    rerender(<TestHarness scope={{ instances: [pending('files')] }} />)

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', '')
    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-presentation-maximized', 'false')
    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')
    expect(screen.getByTestId('panel-files').parentElement).toHaveAttribute('hidden')

    rerender(<TestHarness scope={{ instances: [ready('files')] }} />)

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', 'files')
    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')
    expect(screen.getByTestId('panel-files').parentElement).not.toHaveAttribute('hidden')
  })

  it('hides environmental presentation without changing intent or removing a visited instance', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(<TestHarness scope={{ instances: [ready('files')] }} onOpenChange={onOpenChange} />)
    const panel = screen.getByTestId('panel-files')
    fireEvent.click(panel)

    rerender(<TestHarness present={false} scope={{ instances: [ready('files')] }} onOpenChange={onOpenChange} />)

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-shell-tab', 'files')
    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-presentation-enabled', 'false')
    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-presentation-open', 'false')
    expect(screen.getByTestId('panel-files')).toBe(panel)
    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('starts a fresh component instance when instanceKey changes', () => {
    const { rerender } = render(<TestHarness scope={{ instances: [ready('files', 'workspace-a')] }} />)

    fireEvent.click(screen.getByTestId('panel-files'))
    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')

    rerender(<TestHarness scope={{ instances: [ready('files', 'workspace-b')] }} />)

    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:0')
  })

  it('updates entry metadata without remounting the same instance', () => {
    const initial = { ...ready('files', 'workspace-a'), title: 'Files A' }
    const { rerender } = render(<TestHarness scope={{ instances: [initial] }} />)

    fireEvent.click(screen.getByTestId('panel-files'))

    rerender(<TestHarness scope={{ instances: [{ ...ready('files', 'workspace-a'), title: 'Files B' }] }} />)

    expect(screen.getByTestId('shell-tab-title')).toHaveTextContent('Files B')
    expect(screen.getByTestId('panel-files')).toHaveTextContent('files:1')
  })

  it('supports creating and requesting a dynamic instance in the same event', () => {
    function DynamicHarness() {
      const [instances, setInstances] = useState<readonly RightPanelInstance[]>([ready('files')])

      return (
        <TestHarness scope={{ instances }}>
          <DynamicOpenButton onCreate={() => setInstances((current) => [...current, ready('flow:one')])} />
        </TestHarness>
      )
    }

    render(<DynamicHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'create flow' }))

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', 'flow:one')
    expect(screen.getByTestId('panel-flow:one')).toBeInTheDocument()
  })
})

function DynamicOpenButton({ onCreate }: { onCreate: () => void }) {
  const actions = useRightPanelActions()

  return (
    <button
      type="button"
      onClick={() => {
        onCreate()
        actions.requestOpen('flow:one')
      }}>
      create flow
    </button>
  )
}

describe('RightPanelShortcut', () => {
  it('uses presentation state when toggling a ready panel', () => {
    const onOpenChange = vi.fn()

    render(
      <TestHarness defaultOpen={false} scope={{ instances: [ready('files')] }} onOpenChange={onOpenChange}>
        <RightPanelShortcut
          tab="files"
          label="Files"
          icon={<span data-testid="files-icon" />}
          openBehavior="toggle-active"
        />
      </TestHarness>
    )

    const shortcut = screen.getByRole('button', { name: 'Files' })
    expect(shortcut).not.toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(shortcut)

    expect(shortcut).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-presentation-open', 'true')

    fireEvent.click(shortcut)

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-presentation-open', 'false')
    expect(onOpenChange).toHaveBeenNthCalledWith(1, true)
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false)
  })

  it('hides unavailable shortcuts but keeps a ready target visible while another request is pending', () => {
    render(
      <TestHarness scope={{ instances: [pending('files'), ready('status'), unavailable('trace')] }}>
        <RightPanelShortcut tab="status" label="Status" icon={<span />} />
        <RightPanelShortcut tab="trace" label="Trace" icon={<span />} />
      </TestHarness>
    )

    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trace' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Status' }))

    expect(screen.getByTestId('right-panel-state')).toHaveAttribute('data-active', 'status')
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull()
  })
})
