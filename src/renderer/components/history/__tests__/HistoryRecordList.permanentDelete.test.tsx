import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { CommandProvider } from '@renderer/components/command'
import { useResolvedCommand } from '@renderer/hooks/command'
import { isMac } from '@renderer/utils/platform'

import { HistoryRecordList } from '../components/HistoryRecordList'
import type { HistoryRecordDescriptor } from '../historyRecordsDescriptor'

vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: <T,>({
    children,
    header,
    list
  }: {
    children: (item: T, index: number) => ReactNode
    header?: ReactNode
    list: T[]
  }) => (
    <div>
      {header}
      {list.map((item, index) => (
        <div key={(item as { id: string }).id}>{children(item, index)}</div>
      ))}
    </div>
  )
}))

type Row = { id: string; name: string; pinned?: boolean; busy?: boolean; hiddenAction?: boolean }

const permanentAction = (mode: 'assistant' | 'agent', row: Row): ResolvedAction => ({
  id: mode === 'assistant' ? 'topic.delete-permanently' : 'session.delete-permanently',
  commandId: mode === 'assistant' ? 'topic.delete-permanently' : 'session.delete-permanently',
  label: 'Delete Permanently',
  danger: true,
  availability: {
    visible: !row.pinned && !row.hiddenAction,
    enabled: !row.busy
  },
  children: []
})

function descriptor(
  mode: 'assistant' | 'agent',
  onAction: (id: string, actionId: string) => void | Promise<void>,
  options?: { renamingId?: string }
): HistoryRecordDescriptor<Row> {
  return {
    mode,
    getId: (item) => item.id,
    isPinned: () => false,
    getSourceId: () => 'source',
    matchesSearch: () => true,
    onBulkDelete: async () => ({ succeeded: [], failed: [] }),
    onActiveRecordChange: () => undefined,
    renderRowState: options?.renamingId
      ? (item, render) => render({ isRenaming: item.id === options.renamingId })
      : undefined,
    getName: (item) => item.name,
    getUpdatedAt: () => '2026-05-14T10:00:00.000Z',
    getSourceLabel: () => 'Source',
    renderAvatar: () => <span>A</span>,
    rowHeight: 32,
    getSelectLabel: (item) => `Select ${item.name}`,
    getRowActions: (item) => ({
      actions: [permanentAction(mode, item)],
      onAction: (action) => onAction(item.id, action.id)
    }),
    onOpen: () => undefined,
    onTogglePin: () => undefined,
    renderRowMenu: (_item, row: ReactElement) => row,
    sources: [],
    renderSourceFilter: () => null,
    onRename: () => undefined,
    strings: {
      sourceLabel: 'Source',
      searchPlaceholder: 'Search',
      titleColumnLabel: 'Title',
      emptyTitle: 'Empty',
      emptyDescription: 'None',
      loadingTitle: 'Loading',
      loadingDescription: 'Loading',
      pinLabel: 'Pin',
      unpinLabel: 'Unpin',
      deleteLabel: 'Archive',
      renameDialogTitle: 'Rename'
    }
  }
}

function ShortcutLabel() {
  const command = useResolvedCommand('resource.delete_permanently')
  return <output data-testid="shortcut-label">{command.shortcutLabel}</output>
}

function renderHistory(
  mode: 'assistant' | 'agent',
  onAction: (id: string, actionId: string) => void | Promise<void>,
  extra?: ReactNode,
  options?: { renamingId?: string; rows?: Row[] }
) {
  const rows = options?.rows ?? [
    { id: 'alpha', name: 'Alpha' },
    { id: 'beta', name: 'Beta' }
  ]
  return render(
    <CommandProvider>
      <ShortcutLabel />
      {extra}
      <HistoryRecordList
        descriptor={descriptor(mode, onAction, options)}
        items={rows}
        isLoading={false}
        isSelected={(id) => id === 'alpha'}
        selectAllState={false}
        selectionDisabled={false}
        onToggleSelection={() => undefined}
        onToggleSelectAll={() => undefined}
        onTogglePin={async () => undefined}
      />
    </CommandProvider>
  )
}

function pressDelete(target: Element, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Backspace',
    code: 'Backspace',
    ctrlKey: true,
    ...init
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

describe.each(['assistant', 'agent'] as const)('history %s focused permanent delete', (mode) => {
  const actionId = mode === 'assistant' ? 'topic.delete-permanently' : 'session.delete-permanently'

  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('deletes the focused row and ignores the selected row', () => {
    const onAction = vi.fn()
    renderHistory(mode, onAction)
    const beta = screen.getByRole('button', { name: 'Beta' })
    act(() => {
      beta.focus()
    })

    const event = pressDelete(beta)

    expect(onAction).toHaveBeenCalledExactlyOnceWith('beta', actionId)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does nothing when focus is outside the rows', () => {
    const onAction = vi.fn()
    renderHistory(mode, onAction, <button type="button">Outside</button>)
    const outside = screen.getByRole('button', { name: 'Outside' })
    act(() => {
      outside.focus()
    })

    const event = pressDelete(outside)

    expect(onAction).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('uses a custom binding and ignores a disabled binding', () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.resource.delete_permanently', {
      binding: ['CommandOrControl', 'Shift', 'Backspace'],
      enabled: true
    })
    const onAction = vi.fn()
    const view = renderHistory(mode, onAction)
    const alpha = screen.getByRole('button', { name: 'Alpha' })
    act(() => {
      alpha.focus()
    })

    expect(pressDelete(alpha).defaultPrevented).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
    expect(pressDelete(alpha, { shiftKey: true }).defaultPrevented).toBe(true)
    expect(onAction).toHaveBeenCalledExactlyOnceWith('alpha', actionId)
    expect(screen.getByTestId('shortcut-label')).toHaveTextContent(isMac ? '⌘⇧Backspace' : 'Ctrl+Shift+Backspace')

    onAction.mockClear()
    MockUsePreferenceUtils.setPreferenceValue('shortcut.resource.delete_permanently', {
      binding: ['CommandOrControl', 'Backspace'],
      enabled: false
    })
    view.rerender(
      <CommandProvider>
        <ShortcutLabel />
        <HistoryRecordList
          descriptor={descriptor(mode, onAction)}
          items={[
            { id: 'alpha', name: 'Alpha' },
            { id: 'beta', name: 'Beta' }
          ]}
          isLoading={false}
          isSelected={() => false}
          selectAllState={false}
          selectionDisabled={false}
          onToggleSelection={() => undefined}
          onToggleSelectAll={() => undefined}
          onTogglePin={async () => undefined}
        />
      </CommandProvider>
    )
    act(() => {
      screen.getByRole('button', { name: 'Alpha' }).focus()
    })
    expect(pressDelete(screen.getByRole('button', { name: 'Alpha' })).defaultPrevented).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('preserves the shortcut while an editable field is focused', () => {
    const onAction = vi.fn()
    renderHistory(mode, onAction, <input aria-label="Draft" />)
    const draft = screen.getByRole('textbox', { name: 'Draft' })
    act(() => {
      draft.focus()
    })
    expect(pressDelete(draft).defaultPrevented).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('preserves the shortcut while the focused row is renaming', () => {
    const onAction = vi.fn()
    renderHistory(mode, onAction, undefined, { renamingId: 'beta' })
    const beta = screen.getByRole('button', { name: 'Beta' })
    act(() => {
      beta.focus()
    })
    expect(pressDelete(beta).defaultPrevented).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('preserves the shortcut while a dialog is open', () => {
    const onAction = vi.fn()
    renderHistory(mode, onAction, <div role="dialog">Open</div>)
    const beta = screen.getByRole('button', { name: 'Beta' })
    act(() => {
      beta.focus()
    })
    expect(pressDelete(beta).defaultPrevented).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('preserves the shortcut for a hidden row', () => {
    const onAction = vi.fn()
    renderHistory(mode, onAction)
    const beta = screen.getByRole('button', { name: 'Beta' })
    const row = beta.closest('[role="row"]') as HTMLElement
    act(() => {
      beta.focus()
      row.hidden = true
    })
    expect(pressDelete(beta).defaultPrevented).toBe(false)
    expect(onAction).not.toHaveBeenCalled()
  })

  it('preserves the shortcut when the permanent action is pinned away or busy', () => {
    const onAction = vi.fn()
    renderHistory(mode, onAction, undefined, {
      rows: [
        { id: 'alpha', name: 'Alpha', pinned: true },
        { id: 'beta', name: 'Beta', busy: true }
      ]
    })
    for (const name of ['Alpha', 'Beta']) {
      const button = screen.getByRole('button', { name })
      act(() => {
        button.focus()
      })
      expect(pressDelete(button).defaultPrevented).toBe(false)
    }
    expect(onAction).not.toHaveBeenCalled()
  })

  it('returns one in-flight promise and ignores a duplicate shortcut', async () => {
    let resolveDelete: (() => void) | undefined
    const onAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
    )
    renderHistory(mode, onAction)
    const alpha = screen.getByRole('button', { name: 'Alpha' })
    act(() => {
      alpha.focus()
    })

    pressDelete(alpha)
    pressDelete(alpha)
    expect(onAction).toHaveBeenCalledOnce()

    await act(async () => {
      resolveDelete?.()
    })
    pressDelete(alpha)
    expect(onAction).toHaveBeenCalledTimes(2)
  })
})
