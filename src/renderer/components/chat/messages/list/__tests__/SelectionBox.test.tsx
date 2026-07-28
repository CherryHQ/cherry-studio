import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SelectionBox from '../SelectionBox'

function createRect({
  left,
  top,
  width,
  height
}: {
  left: number
  top: number
  width: number
  height: number
}): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

function createMessageElement({
  checked,
  taskListChecked,
  rect
}: {
  checked?: boolean
  taskListChecked?: boolean
  rect: { left: number; top: number; width: number; height: number }
}) {
  const element = document.createElement('div')
  element.getBoundingClientRect = vi.fn(() => createRect(rect))

  if (taskListChecked !== undefined) {
    const taskListCheckbox = document.createElement('input')
    taskListCheckbox.type = 'checkbox'
    taskListCheckbox.checked = taskListChecked
    element.appendChild(taskListCheckbox)
  }

  if (checked !== undefined) {
    const checkbox = document.createElement('button')
    checkbox.setAttribute('role', 'checkbox')
    checkbox.setAttribute('aria-checked', String(checked))
    checkbox.setAttribute('data-message-select-checkbox', '')
    element.appendChild(checkbox)
  }

  return element
}

describe('SelectionBox', () => {
  it('selects messages inside the drag rectangle with Radix checkbox markup', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.getBoundingClientRect = vi.fn(() => createRect({ left: 0, top: 0, width: 300, height: 400 }))

    const selectedMessage = createMessageElement({
      checked: true,
      rect: { left: 10, top: 10, width: 100, height: 40 }
    })
    const firstUnselectedMessage = createMessageElement({
      checked: false,
      rect: { left: 10, top: 60, width: 100, height: 40 }
    })
    const secondUnselectedMessage = createMessageElement({
      checked: false,
      rect: { left: 10, top: 110, width: 100, height: 40 }
    })
    const nonSelectableMessage = createMessageElement({
      rect: { left: 10, top: 160, width: 100, height: 40 }
    })

    scrollContainer.append(selectedMessage, firstUnselectedMessage, secondUnselectedMessage, nonSelectableMessage)
    document.body.appendChild(scrollContainer)

    const messageElements = new Map([
      ['selected', selectedMessage],
      ['first-unselected', firstUnselectedMessage],
      ['second-unselected', secondUnselectedMessage],
      ['non-selectable', nonSelectableMessage]
    ])
    const handleSelectMessage = vi.fn()

    const view = render(
      <SelectionBox
        isMultiSelectMode
        scrollContainerRef={{ current: scrollContainer }}
        messageElements={messageElements}
        handleSelectMessage={handleSelectMessage}
      />
    )

    fireEvent.mouseDown(scrollContainer, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 20 })
    fireEvent.mouseMove(window, { clientX: 130, clientY: 155 })

    expect(handleSelectMessage).toHaveBeenCalledTimes(2)
    expect(handleSelectMessage).toHaveBeenNthCalledWith(1, 'first-unselected', true)
    expect(handleSelectMessage).toHaveBeenNthCalledWith(2, 'second-unselected', true)

    fireEvent.mouseUp(window)
    view.unmount()
    scrollContainer.remove()
  })

  it('does not start drag selection from the checkbox control', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.getBoundingClientRect = vi.fn(() => createRect({ left: 0, top: 0, width: 300, height: 400 }))

    const message = createMessageElement({
      checked: false,
      rect: { left: 10, top: 10, width: 100, height: 40 }
    })
    const checkbox = message.querySelector('[role="checkbox"]')!
    scrollContainer.append(message)
    document.body.appendChild(scrollContainer)

    const handleSelectMessage = vi.fn()

    const view = render(
      <SelectionBox
        isMultiSelectMode
        scrollContainerRef={{ current: scrollContainer }}
        messageElements={new Map([['message', message]])}
        handleSelectMessage={handleSelectMessage}
      />
    )

    fireEvent.mouseDown(checkbox, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 130, clientY: 55 })

    expect(handleSelectMessage).not.toHaveBeenCalled()

    view.unmount()
    scrollContainer.remove()
  })

  it('selects a message when checked task-list content appears before the unselected message checkbox', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.getBoundingClientRect = vi.fn(() => createRect({ left: 0, top: 0, width: 300, height: 400 }))

    const message = createMessageElement({
      checked: false,
      taskListChecked: true,
      rect: { left: 10, top: 10, width: 100, height: 40 }
    })
    scrollContainer.append(message)
    document.body.appendChild(scrollContainer)

    const handleSelectMessage = vi.fn()

    const view = render(
      <SelectionBox
        isMultiSelectMode
        scrollContainerRef={{ current: scrollContainer }}
        messageElements={new Map([['message', message]])}
        handleSelectMessage={handleSelectMessage}
      />
    )

    fireEvent.mouseDown(scrollContainer, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(window, { clientX: 20, clientY: 20 })
    fireEvent.mouseMove(window, { clientX: 130, clientY: 55 })

    expect(handleSelectMessage).toHaveBeenCalledTimes(1)
    expect(handleSelectMessage).toHaveBeenCalledWith('message', true)

    fireEvent.mouseUp(window)
    view.unmount()
    scrollContainer.remove()
  })
})
