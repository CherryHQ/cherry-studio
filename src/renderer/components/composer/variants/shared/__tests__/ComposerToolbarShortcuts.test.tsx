import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  launchers: [] as any[],
  dispatchLauncher: vi.fn(),
  reorderableProps: null as any
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/composer/ComposerToolRuntime', () => ({
  useComposerToolLauncherController: () => ({
    getLaunchers: vi.fn(() => mocks.launchers),
    dispatchLauncher: mocks.dispatchLauncher
  }),
  useComposerToolLauncherVersion: () => 1
}))

// Local override of the global @cherrystudio/ui mock: exposes ReorderableList props
// for reorder assertions and gives Switch the real checked/onCheckedChange API.
vi.mock('@cherrystudio/ui', () => {
  const React = require('react')
  return {
    Button: ({ children, ...props }: any) => React.createElement('button', props, children),
    Tooltip: ({ children }: { children: ReactNode }) => children,
    Popover: ({ children, open }: any) =>
      React.createElement('div', { 'data-testid': 'popover', 'data-open': String(open) }, children),
    PopoverAnchor: ({ children }: { children: ReactNode }) => children,
    PopoverContent: ({ children, 'aria-labelledby': ariaLabelledby }: any) =>
      React.createElement('div', { 'data-testid': 'popover-content', 'aria-labelledby': ariaLabelledby }, children),
    ReorderableList: (props: any) => {
      mocks.reorderableProps = props
      const rows = props.visibleItems ?? props.items
      const dragHandleProps = props.dragHandle
        ? { ref: () => {}, attributes: { role: 'button', tabIndex: 0 }, listeners: {} }
        : undefined
      return React.createElement(
        React.Fragment,
        null,
        rows.map((item: any, index: number) =>
          React.createElement(
            'div',
            { key: props.getId(item) },
            props.renderItem(item, index, { dragging: false, dragHandleProps })
          )
        )
      )
    },
    Switch: ({ checked, onCheckedChange, ...props }: any) =>
      React.createElement('input', {
        ...props,
        type: 'checkbox',
        checked,
        onChange: (event: any) => onCheckedChange?.(event.target.checked)
      })
  }
})

import { ComposerToolbarShortcuts } from '../ComposerToolbarShortcuts'

const thinkingLauncher = {
  id: 'thinking',
  kind: 'group',
  label: 'thinking-label',
  icon: <span data-testid="icon-thinking" />,
  sources: ['popover'],
  active: true
}
const webSearchLauncher = {
  id: 'web-search',
  kind: 'command',
  label: 'web-search-label',
  icon: <span data-testid="icon-web-search" />,
  sources: ['popover'],
  active: false
}
const knowledgeLauncher = {
  id: 'knowledge-base',
  kind: 'panel',
  label: 'kb-label',
  icon: <span data-testid="icon-kb" />,
  sources: ['popover']
}
const attachmentLauncher = {
  id: 'attachment',
  kind: 'dialog',
  label: 'attachment-label',
  icon: <span data-testid="icon-attachment" />,
  sources: ['popover']
}

const renderShortcuts = (overrides: Partial<Parameters<typeof ComposerToolbarShortcuts>[0]> = {}) => {
  const props = {
    pinnedIds: ['thinking', 'ghost', 'web-search'],
    onPinnedIdsChange: vi.fn(),
    onResetPinnedIds: vi.fn(),
    isDefault: false,
    customizeOpen: false,
    onCustomizeOpenChange: vi.fn(),
    inputAdapter: { focus: vi.fn() } as any,
    unifiedPanelControl: { available: true, open: vi.fn() },
    ...overrides
  }
  return { props, ...render(<ComposerToolbarShortcuts {...props} />) }
}

describe('ComposerToolbarShortcuts', () => {
  beforeEach(() => {
    mocks.launchers = [thinkingLauncher, webSearchLauncher, knowledgeLauncher]
    mocks.dispatchLauncher.mockClear()
    mocks.reorderableProps = null
  })

  it('renders only resolved pinned launchers as buttons, in preference order', () => {
    renderShortcuts()

    const thinkingButton = screen.getByRole('button', { name: 'thinking-label' })
    const webSearchButton = screen.getByRole('button', { name: 'web-search-label' })

    expect(thinkingButton.compareDocumentPosition(webSearchButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(thinkingButton).toHaveAttribute('data-active', 'true')
    // group/panel launchers announce a menu popup and are not toggles.
    expect(thinkingButton).toHaveAttribute('aria-haspopup', 'menu')
    expect(thinkingButton).not.toHaveAttribute('aria-pressed')
    // command launchers are toggles: aria-pressed, no popup.
    expect(webSearchButton).toHaveAttribute('aria-pressed', 'false')
    expect(webSearchButton).not.toHaveAttribute('aria-haspopup')
    // Unpinned and unknown ids stay off the bar.
    expect(screen.queryByRole('button', { name: 'kb-label' })).not.toBeInTheDocument()
  })

  it('announces dialog launchers with aria-haspopup="dialog" and no toggle state', () => {
    mocks.launchers = [attachmentLauncher]
    renderShortcuts({ pinnedIds: ['attachment'] })

    const attachmentButton = screen.getByRole('button', { name: 'attachment-label' })
    expect(attachmentButton).toHaveAttribute('aria-haspopup', 'dialog')
    expect(attachmentButton).not.toHaveAttribute('aria-pressed')
  })

  it('opens the unified panel for panel-kind launchers and dispatches command-kind launchers', () => {
    const { props } = renderShortcuts()

    fireEvent.click(screen.getByRole('button', { name: 'thinking-label' }))
    expect(props.unifiedPanelControl.open).toHaveBeenCalledWith({
      launcherId: 'thinking',
      searchText: 'thinking-label'
    })

    fireEvent.click(screen.getByRole('button', { name: 'web-search-label' }))
    expect(mocks.dispatchLauncher).toHaveBeenCalledWith(webSearchLauncher, {
      source: 'popover',
      inputAdapter: props.inputAdapter
    })
  })

  it('disables panel-kind launchers when the unified panel is unavailable and honors launcher disabled', () => {
    mocks.launchers = [thinkingLauncher, { ...webSearchLauncher, disabled: true }]
    renderShortcuts({
      pinnedIds: ['thinking', 'web-search'],
      unifiedPanelControl: { available: false, open: vi.fn() }
    })

    expect(screen.getByRole('button', { name: 'thinking-label' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'web-search-label' })).toBeDisabled()
  })

  it('runs custom tools through their own onSelect', () => {
    const onSelect = vi.fn()
    const { props } = renderShortcuts({
      pinnedIds: ['skills'],
      customTools: [{ id: 'skills', label: 'skills-label', icon: <span />, onSelect }]
    })

    fireEvent.click(screen.getByRole('button', { name: 'skills-label' }))
    expect(onSelect).toHaveBeenCalledWith({
      inputAdapter: props.inputAdapter,
      unifiedPanelControl: props.unifiedPanelControl
    })
  })

  it('lists pinned rows (switch on) then unpinned candidates (switch off) in the customize popover', () => {
    const { props } = renderShortcuts({ customizeOpen: true })

    const popover = screen.getByTestId('popover-content')
    const pinnedSwitch = within(popover).getByLabelText('thinking-label')
    const unpinnedSwitch = within(popover).getByLabelText('kb-label')

    expect(pinnedSwitch).toBeChecked()
    expect(unpinnedSwitch).not.toBeChecked()

    fireEvent.click(pinnedSwitch)
    expect(props.onPinnedIdsChange).toHaveBeenCalledWith(['ghost', 'web-search'])

    fireEvent.click(unpinnedSwitch)
    expect(props.onPinnedIdsChange).toHaveBeenCalledWith(['thinking', 'ghost', 'web-search', 'knowledge-base'])
  })

  it('renders a dedicated, labelled drag handle button per pinned row', () => {
    renderShortcuts({ customizeOpen: true })

    // dragHandle mode is on so the row itself is not the activator.
    expect(mocks.reorderableProps.dragHandle).toBe(true)
    // One handle per resolved pinned row (thinking + web-search; ghost is unresolved).
    const handles = screen.getAllByRole('button', { name: 'chat.input.toolbar.drag_handle' })
    expect(handles).toHaveLength(2)
    // The grip is a real, non-hidden control (not an aria-hidden span).
    handles.forEach((handle) => expect(handle).not.toHaveAttribute('aria-hidden'))
  })

  it('persists reorder results including unresolved pinned ids', () => {
    const { props } = renderShortcuts({ customizeOpen: true })

    expect(mocks.reorderableProps.items.map((row: any) => row.id)).toEqual(['thinking', 'ghost', 'web-search'])
    expect(mocks.reorderableProps.visibleItems.map((row: any) => row.id)).toEqual(['thinking', 'web-search'])

    mocks.reorderableProps.onReorder([...mocks.reorderableProps.items].reverse())
    expect(props.onPinnedIdsChange).toHaveBeenCalledWith(['web-search', 'ghost', 'thinking'])
  })

  it('restores the default pinned set, disabling the control when already at default', () => {
    const { rerender, props } = renderShortcuts({ customizeOpen: true })

    const resetButton = screen.getByRole('button', { name: 'chat.input.toolbar.restore_default' })
    expect(resetButton).toBeEnabled()
    fireEvent.click(resetButton)
    expect(props.onResetPinnedIds).toHaveBeenCalledTimes(1)

    rerender(<ComposerToolbarShortcuts {...props} isDefault />)
    expect(screen.getByRole('button', { name: 'chat.input.toolbar.restore_default' })).toBeDisabled()
  })

  it('names the customize dialog via aria-labelledby referencing the visible title', () => {
    renderShortcuts({ customizeOpen: true })

    const popover = screen.getByTestId('popover-content')
    const labelledBy = popover.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const title = document.getElementById(labelledBy!)
    expect(title).toHaveTextContent('chat.input.toolbar.customize')
  })
})
