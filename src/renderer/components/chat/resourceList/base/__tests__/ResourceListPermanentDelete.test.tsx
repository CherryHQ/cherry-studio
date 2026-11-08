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
  const command = useResolvedCommand('resource.delete_permanently')
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
  onDelete,
  isItemEligible,
  selectedId = 'alpha',
  extra,
  inner
}: {
  items?: Item[]
  label: string
  onDelete: (item: Item) => void | Promise<void>
  isItemEligible?: (item: Item) => boolean
  selectedId?: string | null
  extra?: ReactNode
  inner?: 'button' | 'input'
}) {
  const Provider = ResourceList.Provider<Item>
  return (
    <Provider items={items} selectedId={selectedId}>
      <ResourceList.Frame aria-label={label}>
        <ResourceList.PermanentDelete isItemEligible={isItemEligible} onDelete={onDelete} />
        {extra}
        <ResourceList.Body<Item>
          ariaLabel={label}
          renderItem={(item) => (
            <ResourceList.Item item={item}>
              <span>{item.name}</span>
              {inner === 'button' && item.id === 'beta' ? <button type="button">Beta actions</button> : null}
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
  return press(target, { key: 'Backspace', code: 'Backspace', ctrlKey: true, ...init })
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

describe('ResourceList permanent delete shortcut', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  afterEach(() => {
    MockUsePreferenceUtils.resetMocks()
  })

  it('deletes the focused row and leaves the selected conversation in place', () => {
    const onDelete = vi.fn()
    renderLists(<List label="Topics" onDelete={onDelete} />)

    const box = focusRow('Topics', 1)
    const event = pressDelete(box)

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'beta', name: 'Beta' })
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('data-active-descendant', 'true')
    expect(event.defaultPrevented).toBe(true)
  })

  it('deletes a focused option while the listbox cursor and selected conversation stay on another row', () => {
    const onDelete = vi.fn()
    renderLists(<List label="Topics" onDelete={onDelete} />)
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
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'beta', name: 'Beta' })
    expect(alpha).toHaveAttribute('aria-selected', 'true')
    expect(event.defaultPrevented).toBe(true)
  })

  it('deletes the row that owns a focused non-editable descendant', () => {
    const onDelete = vi.fn()
    renderLists(<List label="Topics" inner="button" onDelete={onDelete} />)
    const button = screen.getByRole('button', { name: 'Beta actions' })
    act(() => {
      button.focus()
    })

    const event = pressDelete(button)

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'beta' })
    expect(screen.getByRole('option', { name: /Alpha/ })).toHaveAttribute('aria-selected', 'true')
    expect(event.defaultPrevented).toBe(true)
  })

  it('preserves the native shortcut when an editable descendant of the focused row is active', () => {
    const onDelete = vi.fn()
    renderLists(<List label="Topics" inner="input" onDelete={onDelete} />)
    const note = screen.getByRole('textbox', { name: 'Beta note' })
    act(() => {
      note.focus()
    })

    const event = pressDelete(note)

    expect(onDelete).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('uses a custom binding and shows that binding as the shortcut label', () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.resource.delete_permanently', {
      binding: ['CommandOrControl', 'Shift', 'Backspace'],
      enabled: true
    })
    const onDelete = vi.fn()
    renderLists(<List label="Topics" onDelete={onDelete} />)
    const box = focusRow('Topics', 0)

    const defaultChord = pressDelete(box)
    expect(onDelete).not.toHaveBeenCalled()
    expect(defaultChord.defaultPrevented).toBe(false)

    const customChord = pressDelete(box, { shiftKey: true })
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0]?.[0]).toMatchObject({ id: 'alpha' })
    expect(customChord.defaultPrevented).toBe(true)
    expect(screen.getByTestId('shortcut-label')).toHaveTextContent(isMac ? '⌘⇧Backspace' : 'Ctrl+Shift+Backspace')
  })

  it('does not consume the shortcut when the preference is disabled', () => {
    MockUsePreferenceUtils.setPreferenceValue('shortcut.resource.delete_permanently', {
      binding: ['CommandOrControl', 'Backspace'],
      enabled: false
    })
    const onDelete = vi.fn()
    renderLists(<List label="Topics" onDelete={onDelete} />)

    const event = pressDelete(focusRow('Topics', 0))

    expect(onDelete).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(screen.getByTestId('shortcut-label')).toHaveTextContent('')
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
    const onDelete = vi.fn()
    renderLists(
      <>
        {renderTarget()}
        <List label="Topics" onDelete={onDelete} />
      </>
    )
    focusRow('Topics', 1)
    const target = screen.getByLabelText(targetName)
    act(() => {
      if (target instanceof HTMLElement) target.focus()
    })

    const event = pressDelete(target)

    expect(onDelete).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('preserves the native shortcut when the focused list has no active row', () => {
    const onDelete = vi.fn()
    renderLists(<List label="Topics" onDelete={onDelete} selectedId={null} />)
    const box = listbox('Topics')
    act(() => {
      box.focus()
    })

    const event = pressDelete(box)

    expect(onDelete).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('preserves the native shortcut for blur, a hidden list, and an open modal', () => {
    const onDelete = vi.fn()
    const { container } = renderLists(
      <>
        <button type="button">Elsewhere</button>
        <List label="Topics" onDelete={onDelete} />
      </>
    )
    const box = focusRow('Topics', 1)
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    act(() => {
      elsewhere.focus()
    })
    const blurred = pressDelete(box)
    expect(onDelete).not.toHaveBeenCalled()
    expect(blurred.defaultPrevented).toBe(false)

    act(() => {
      box.focus()
    })
    const frame = container.querySelector('[data-resource-list-variant]')
    frame?.setAttribute('hidden', '')
    const hidden = pressDelete(box)
    expect(onDelete).not.toHaveBeenCalled()
    expect(hidden.defaultPrevented).toBe(false)
    frame?.removeAttribute('hidden')

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    act(() => {
      box.focus()
    })
    const modal = pressDelete(box)
    expect(onDelete).not.toHaveBeenCalled()
    expect(modal.defaultPrevented).toBe(false)
    dialog.remove()
  })

  it('does not consume the shortcut for a protected row or while a row is renaming', () => {
    const onDelete = vi.fn()
    renderLists(
      <List
        label="Topics"
        isItemEligible={(item) => item.pinned !== true}
        onDelete={onDelete}
        extra={<RenameControl itemId="beta" />}
      />
    )

    const protectedEvent = pressDelete(focusRow('Topics', 2))
    expect(onDelete).not.toHaveBeenCalled()
    expect(protectedEvent.defaultPrevented).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Rename beta' }))
    const renamingEvent = pressDelete(focusRow('Topics', 1))
    expect(onDelete).not.toHaveBeenCalled()
    expect(renamingEvent.defaultPrevented).toBe(false)
  })

  it('ignores a repeated shortcut while the delete callback is still pending', async () => {
    let finish = () => {}
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    renderLists(<List label="Topics" onDelete={onDelete} />)
    const box = focusRow('Topics', 1)

    const first = pressDelete(box)
    const second = pressDelete(box)

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(first.defaultPrevented).toBe(true)
    expect(second.defaultPrevented).toBe(false)

    await act(async () => {
      finish()
    })
    const third = pressDelete(box)
    expect(onDelete).toHaveBeenCalledTimes(2)
    expect(third.defaultPrevented).toBe(true)
  })

  it('allows another shortcut after a rejected delete and does not leak the rejection', async () => {
    const onDelete = vi.fn(() => Promise.reject(new Error('delete failed')))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      renderLists(<List label="Topics" onDelete={onDelete} />)
      const box = focusRow('Topics', 1)

      const first = pressDelete(box)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(first.defaultPrevented).toBe(true)
      expect(unhandled).toEqual([])

      const second = pressDelete(box)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(onDelete).toHaveBeenCalledTimes(2)
      expect(second.defaultPrevented).toBe(true)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('deletes only the list that currently holds focus', () => {
    const deleteTopics = vi.fn()
    const deleteSessions = vi.fn()
    renderLists(
      <>
        <List label="Topics" onDelete={deleteTopics} />
        <List
          label="Sessions"
          items={[{ id: 'session-a', name: 'Session A' }]}
          onDelete={deleteSessions}
          selectedId="session-a"
        />
      </>
    )

    pressDelete(focusRow('Sessions', 0))
    expect(deleteSessions).toHaveBeenCalledTimes(1)
    expect(deleteSessions.mock.calls[0]?.[0]).toMatchObject({ id: 'session-a' })
    expect(deleteTopics).not.toHaveBeenCalled()

    pressDelete(focusRow('Topics', 1))
    expect(deleteTopics).toHaveBeenCalledTimes(1)
    expect(deleteTopics.mock.calls[0]?.[0]).toMatchObject({ id: 'beta' })
    expect(deleteSessions).toHaveBeenCalledTimes(1)
  })
})
