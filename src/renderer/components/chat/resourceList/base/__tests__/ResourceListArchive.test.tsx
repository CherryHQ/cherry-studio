import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResourceListItemBase } from '@renderer/components/chat/resourceList/base/ResourceListContext'
import { CommandProvider } from '@renderer/components/command'
import { useResolvedCommand } from '@renderer/hooks/command'
import { isMac } from '@renderer/utils/platform'

import { ResourceList, useResourceListActions } from '../ResourceList'

type VirtualizerOptionsMock = {
  count: number
}

const virtualMocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
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
    scrollToIndex: (...args: unknown[]) => virtualMocks.scrollToIndex(...args)
  }))
}))

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: (range: { startIndex: number; endIndex: number }) =>
    Array.from({ length: range.endIndex - range.startIndex + 1 }, (_, index) => range.startIndex + index),
  useVirtualizer: virtualMocks.useVirtualizer
}))

type Item = ResourceListItemBase & { pinned?: boolean }

const ITEMS: Item[] = [
  { id: 'alpha', name: 'Alpha' },
  { id: 'beta', name: 'Beta' },
  { id: 'gamma', name: 'Gamma', pinned: true }
]

function ShortcutLabel() {
  const command = useResolvedCommand('topic.delete')
  return <output data-testid="shortcut-label">{command.shortcutLabel}</output>
}

function RenameControl({ itemId }: { itemId: string }) {
  const actions = useResourceListActions()
  return (
    <button type="button" onClick={() => actions.startRename(itemId)}>
      Rename {itemId}
    </button>
  )
}

function List({
  items = ITEMS,
  label,
  onArchive,
  isItemEligible,
  selectedId = 'alpha',
  extra,
  inner,
  active = true
}: {
  items?: Item[]
  label: string
  onArchive: (item: Item) => void | Promise<void>
  isItemEligible?: (item: Item) => boolean
  selectedId?: string | null
  extra?: ReactNode
  inner?: 'input'
  active?: boolean
}) {
  const Provider = ResourceList.Provider<Item>
  return (
    <Provider items={items} selectedId={selectedId}>
      <ResourceList.Frame aria-label={label} active={active}>
        <ResourceList.Archive isItemEligible={isItemEligible} onArchive={onArchive} />
        {extra}
        <ResourceList.Body<Item>
          ariaLabel={label}
          renderItem={(item) => (
            <ResourceList.Item item={item}>
              <span>{item.name}</span>
              {inner === 'input' && item.id === 'beta' ? <input aria-label="Beta note" /> : null}
            </ResourceList.Item>
          )}
        />
      </ResourceList.Frame>
    </Provider>
  )
}

function renderLists(children: ReactNode) {
  return render(
    <CommandProvider>
      <ShortcutLabel />
      {children}
    </CommandProvider>
  )
}

function listbox(name: string) {
  return screen.getByRole('listbox', { name })
}

function press(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function pressDelete(target: Element, init: KeyboardEventInit = {}) {
  return press(target, { key: 'Delete', code: 'Delete', ...init })
}

function focusRow(name: string, steps: number) {
  const box = listbox(name)
  act(() => {
    box.focus()
  })
  for (let index = 0; index < steps; index += 1) {
    press(box, { key: 'ArrowDown', code: 'ArrowDown' })
  }
  return box
}

describe('ResourceList archive shortcut', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('archives the focused row and leaves the selected conversation in place', () => {
    const onArchive = vi.fn()
    renderLists(<List label="Topics" onArchive={onArchive} />)

    const box = focusRow('Topics', 1)
    const event = pressDelete(box)

    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onArchive.mock.calls[0]?.[0]).toMatchObject({ id: 'beta', name: 'Beta' })
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('data-active-descendant', 'true')
    expect(event.defaultPrevented).toBe(true)
  })

  it('archives a focused option while the listbox cursor and selected conversation stay on another row', () => {
    const onArchive = vi.fn()
    renderLists(<List label="Topics" onArchive={onArchive} />)
    const box = listbox('Topics')
    const alpha = screen.getByRole('option', { name: 'Alpha' })
    const beta = screen.getByRole('option', { name: 'Beta' })
    act(() => {
      beta.focus()
    })

    const event = pressDelete(beta)

    expect(beta).toHaveFocus()
    expect(box).toHaveAttribute('aria-activedescendant', 'resource-list-option-alpha')
    expect(alpha).toHaveAttribute('aria-selected', 'true')
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onArchive.mock.calls[0]?.[0]).toMatchObject({ id: 'beta', name: 'Beta' })
    expect(event.defaultPrevented).toBe(true)
  })

  it('preserves the native shortcut when an editable descendant of the focused row is active', () => {
    const onArchive = vi.fn()
    renderLists(<List label="Topics" inner="input" onArchive={onArchive} />)
    const note = screen.getByRole('textbox', { name: 'Beta note' })
    act(() => {
      note.focus()
    })

    const event = pressDelete(note)

    expect(onArchive).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('uses a custom binding and shows that binding as the shortcut label', () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.topic.delete', {
      binding: ['CommandOrControl', 'Shift', 'Delete'],
      enabled: true
    })
    const onArchive = vi.fn()
    renderLists(<List label="Topics" onArchive={onArchive} />)
    const box = focusRow('Topics', 0)

    const defaultChord = pressDelete(box)
    expect(onArchive).not.toHaveBeenCalled()
    expect(defaultChord.defaultPrevented).toBe(false)

    const customChord = pressDelete(box, { ctrlKey: !isMac, metaKey: isMac, shiftKey: true })
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onArchive.mock.calls[0]?.[0]).toMatchObject({ id: 'alpha' })
    expect(customChord.defaultPrevented).toBe(true)
    expect(screen.getByTestId('shortcut-label')).toHaveTextContent(isMac ? '⌘⇧Delete' : 'Ctrl+Shift+Delete')
  })

  it('does not consume the shortcut when the preference is disabled', () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.topic.delete', {
      binding: ['Delete'],
      enabled: false
    })
    const onArchive = vi.fn()
    renderLists(<List label="Topics" onArchive={onArchive} />)

    const event = pressDelete(focusRow('Topics', 0))

    expect(onArchive).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByTestId('shortcut-label')).toBeEmptyDOMElement()
  })

  it.each([
    {
      name: 'an input',
      renderTarget: () => <input aria-label="Draft" />,
      targetName: 'Draft'
    },
    {
      name: 'a textarea',
      renderTarget: () => <textarea aria-label="Draft body" />,
      targetName: 'Draft body'
    },
    {
      name: 'a contenteditable',
      renderTarget: () => <div aria-label="Note" contentEditable="true" />,
      targetName: 'Note'
    }
  ])('preserves the native shortcut while $name is focused', ({ renderTarget, targetName }) => {
    const onArchive = vi.fn()
    renderLists(
      <>
        {renderTarget()}
        <List label="Topics" onArchive={onArchive} />
      </>
    )
    focusRow('Topics', 1)
    const target = screen.getByLabelText(targetName)
    act(() => {
      if (target instanceof HTMLElement) target.focus()
    })

    const event = pressDelete(target)

    expect(onArchive).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not consume the shortcut for a protected row or while a row is renaming', () => {
    const onArchive = vi.fn()
    renderLists(
      <List
        label="Topics"
        isItemEligible={(item) => item.pinned !== true}
        onArchive={onArchive}
        extra={<RenameControl itemId="beta" />}
      />
    )

    const protectedEvent = pressDelete(focusRow('Topics', 2))
    expect(onArchive).not.toHaveBeenCalled()
    expect(protectedEvent.defaultPrevented).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Rename beta' }))
    const renamingEvent = pressDelete(focusRow('Topics', 1))
    expect(onArchive).not.toHaveBeenCalled()
    expect(renamingEvent.defaultPrevented).toBe(false)
  })

  it('ignores a repeated shortcut while the archive callback is still pending', async () => {
    let finish = () => {}
    const onArchive = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    renderLists(<List label="Topics" onArchive={onArchive} />)
    const box = focusRow('Topics', 1)

    const first = pressDelete(box)
    const second = pressDelete(box)

    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(first.defaultPrevented).toBe(true)
    expect(second.defaultPrevented).toBe(false)

    await act(async () => {
      finish()
    })
    const third = pressDelete(box)
    expect(onArchive).toHaveBeenCalledTimes(2)
    expect(third.defaultPrevented).toBe(true)
  })

  it('allows another shortcut after a rejected archive and does not leak the rejection', async () => {
    const onArchive = vi.fn(() => Promise.reject(new Error('archive failed')))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      renderLists(<List label="Topics" onArchive={onArchive} />)
      const box = focusRow('Topics', 1)

      const first = pressDelete(box)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(onArchive).toHaveBeenCalledTimes(1)
      expect(first.defaultPrevented).toBe(true)
      expect(unhandled).toEqual([])

      const second = pressDelete(box)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(onArchive).toHaveBeenCalledTimes(2)
      expect(second.defaultPrevented).toBe(true)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('preserves native Delete when focus leaves the list', () => {
    const onArchive = vi.fn()
    renderLists(
      <>
        <button type="button">Elsewhere</button>
        <List label="Topics" onArchive={onArchive} />
      </>
    )
    focusRow('Topics', 1)
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    act(() => {
      elsewhere.focus()
    })

    expect(pressDelete(elsewhere).defaultPrevented).toBe(false)
    expect(onArchive).not.toHaveBeenCalled()
  })

  it('routes archive and permanent delete to their own callbacks in the same list', async () => {
    const onArchive = vi.fn()
    const onDelete = vi.fn()
    renderLists(
      <List label="Topics" onArchive={onArchive} extra={<ResourceList.PermanentDelete<Item> onDelete={onDelete} />} />
    )
    const box = focusRow('Topics', 1)

    expect(pressDelete(box).defaultPrevented).toBe(true)
    expect(onArchive).toHaveBeenCalledExactlyOnceWith(ITEMS[1])
    expect(onDelete).not.toHaveBeenCalled()
    await act(async () => {})

    const permanent = press(box, { key: 'Backspace', code: 'Backspace', ctrlKey: !isMac, metaKey: isMac })
    expect(permanent.defaultPrevented).toBe(true)
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(ITEMS[1])
    expect(onArchive).toHaveBeenCalledTimes(1)
  })
})
