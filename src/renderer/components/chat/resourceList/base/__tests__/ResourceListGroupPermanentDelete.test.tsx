import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandProvider } from '@renderer/components/command'
import { useResolvedCommand } from '@renderer/hooks/command'
import { isMac } from '@renderer/utils/platform'

import { ResourceList, type ResourceListGroup, type ResourceListItemBase } from '../ResourceList'

type VirtualizerOptionsMock = {
  count: number
}

const virtualMocks = vi.hoisted(() => ({
  useVirtualizer: vi.fn((options: VirtualizerOptionsMock) => ({
    getTotalSize: () => options.count * 40,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: `row-${index}`,
        size: 40,
        start: index * 40
      })),
    isScrolling: false,
    measure: vi.fn(),
    measureElement: vi.fn(),
    scrollElement: null,
    scrollToIndex: vi.fn()
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: (range: { startIndex: number; endIndex: number }) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, index) => range.startIndex + index),
  useVirtualizer: virtualMocks.useVirtualizer
}))

type Item = ResourceListItemBase & { bucket: string }

const ITEMS: Item[] = [
  { id: 'topic-ada', name: 'Topic Ada', bucket: 'ada' },
  { id: 'topic-pin', name: 'Topic Pin', bucket: 'pinned-owner' },
  { id: 'topic-locked', name: 'Topic Locked', bucket: 'protected' },
  { id: 'topic-synth', name: 'Topic Synth', bucket: 'synth' }
]

function groupFor(item: Item): ResourceListGroup {
  if (item.bucket === 'synth') return { id: 'synth', label: 'Synthetic', synthetic: true }
  if (item.bucket === 'protected') return { id: 'protected', label: 'Protected' }
  if (item.bucket === 'pinned-owner') return { id: 'pinned-owner', label: 'Pinned owner' }
  return { id: 'ada', label: 'Ada' }
}

function ShortcutLabel() {
  const command = useResolvedCommand('resource.delete_permanently')
  return <output data-testid="shortcut-label">{command.shortcutLabel}</output>
}

function List({
  onOwnerDelete,
  onRowDelete = vi.fn(),
  eligible = (group: ResourceListGroup) => group.id !== 'protected',
  renameField = false
}: {
  onOwnerDelete: (group: ResourceListGroup) => void | Promise<void>
  onRowDelete?: (item: Item) => void | Promise<void>
  eligible?: (group: ResourceListGroup) => boolean
  renameField?: boolean
}) {
  const Provider = ResourceList.Provider<Item>
  return (
    <Provider
      items={ITEMS}
      selectedId="topic-ada"
      groupBy={groupFor}
      onGroupHeaderDeletePermanently={onOwnerDelete}
      isGroupHeaderPermanentDeleteEligible={eligible}
      getGroupHeaderAction={
        renameField ? (group) => (group.id === 'ada' ? <input aria-label="Rename Ada" /> : null) : undefined
      }>
      <ResourceList.Frame aria-label="Topics">
        <ResourceList.PermanentDelete onDelete={onRowDelete} />
        <ResourceList.VirtualItems<Item>
          renderItem={(item) => (
            <ResourceList.Item item={item}>
              <span>{item.name}</span>
            </ResourceList.Item>
          )}
        />
      </ResourceList.Frame>
    </Provider>
  )
}

function renderList(children: ReactNode) {
  return render(
    <CommandProvider>
      <ShortcutLabel />
      {children}
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

function focusHeader(name: string) {
  const button = screen.getByRole('button', { name })
  act(() => {
    button.focus()
  })
  return button
}

describe('group header permanent delete shortcut', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('deletes the focused owner and leaves the child row alone', () => {
    const onOwnerDelete = vi.fn()
    const onRowDelete = vi.fn()
    renderList(<List onOwnerDelete={onOwnerDelete} onRowDelete={onRowDelete} />)

    const event = pressDelete(focusHeader('Ada'))

    expect(onOwnerDelete).toHaveBeenCalledTimes(1)
    expect(onOwnerDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'ada', label: 'Ada' })
    expect(onRowDelete).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole('option', { name: 'Topic Ada' })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not delete the owner when a child row is focused', () => {
    const onOwnerDelete = vi.fn()
    const onRowDelete = vi.fn()
    renderList(<List onOwnerDelete={onOwnerDelete} onRowDelete={onRowDelete} />)

    const row = screen.getByRole('option', { name: 'Topic Ada' })
    act(() => {
      row.focus()
    })
    pressDelete(row)

    expect(onOwnerDelete).not.toHaveBeenCalled()
    expect(onRowDelete).toHaveBeenCalledTimes(1)
    expect(onRowDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'topic-ada' })
  })

  it('allows a pinned owner and skips protected, synthetic, hidden, input, and modal targets', () => {
    const onOwnerDelete = vi.fn()
    const { rerender } = renderList(<List onOwnerDelete={onOwnerDelete} renameField />)

    pressDelete(focusHeader('Pinned owner'))
    expect(onOwnerDelete).toHaveBeenCalledTimes(1)
    expect(onOwnerDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'pinned-owner' })

    const protectedEvent = pressDelete(focusHeader('Protected'))
    expect(onOwnerDelete).toHaveBeenCalledTimes(1)
    expect(protectedEvent.defaultPrevented).toBe(false)

    const syntheticEvent = pressDelete(focusHeader('Synthetic'))
    expect(onOwnerDelete).toHaveBeenCalledTimes(1)
    expect(syntheticEvent.defaultPrevented).toBe(false)

    const ada = focusHeader('Ada')
    const header = ada.closest('.group\\/resource-list-group')
    expect(header).toBeInstanceOf(HTMLElement)
    if (header instanceof HTMLElement) header.hidden = true
    expect(pressDelete(ada).defaultPrevented).toBe(false)
    if (header instanceof HTMLElement) header.hidden = false

    const input = screen.getByRole('textbox', { name: 'Rename Ada' })
    act(() => {
      input.focus()
    })
    expect(pressDelete(input).defaultPrevented).toBe(false)

    rerender(
      <CommandProvider>
        <ShortcutLabel />
        <div role="dialog">Confirm</div>
        <List onOwnerDelete={onOwnerDelete} />
      </CommandProvider>
    )
    expect(pressDelete(focusHeader('Ada')).defaultPrevented).toBe(false)
    expect(onOwnerDelete).toHaveBeenCalledTimes(1)
  })

  it('uses a custom binding and ignores a disabled binding', () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.resource.delete_permanently', {
      binding: ['CommandOrControl', 'Shift', 'Backspace'],
      enabled: true
    })
    const onOwnerDelete = vi.fn()
    const view = renderList(<List onOwnerDelete={onOwnerDelete} />)
    const header = focusHeader('Ada')

    expect(pressDelete(header).defaultPrevented).toBe(false)
    expect(pressDelete(header, { shiftKey: true }).defaultPrevented).toBe(true)
    expect(onOwnerDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('shortcut-label')).toHaveTextContent(isMac ? '⌘⇧Backspace' : 'Ctrl+Shift+Backspace')

    MockUsePreferenceUtils.setPreferenceValue('shortcut.resource.delete_permanently', {
      binding: ['CommandOrControl', 'Backspace'],
      enabled: false
    })
    view.rerender(
      <CommandProvider>
        <ShortcutLabel />
        <List onOwnerDelete={onOwnerDelete} />
      </CommandProvider>
    )
    expect(pressDelete(focusHeader('Ada')).defaultPrevented).toBe(false)
    expect(onOwnerDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('shortcut-label')).toHaveTextContent('')
  })

  it('ignores a repeated shortcut until the owner delete settles', async () => {
    let settle: (() => void) | undefined
    const onOwnerDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    renderList(<List onOwnerDelete={onOwnerDelete} />)
    const header = focusHeader('Ada')

    pressDelete(header)
    pressDelete(header)
    expect(onOwnerDelete).toHaveBeenCalledTimes(1)

    await act(async () => {
      settle?.()
    })
    pressDelete(header)
    expect(onOwnerDelete).toHaveBeenCalledTimes(2)
  })
})
