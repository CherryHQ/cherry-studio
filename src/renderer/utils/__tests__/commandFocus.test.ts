import { describe, expect, it } from 'vitest'

import { canRunFocusedResourceCommand, isElementSuppressed } from '@renderer/utils/commandFocus'

function mount(html: string) {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

describe('canRunFocusedResourceCommand', () => {
  it('requires a connected visible element that contains the focused control', () => {
    const host = mount('<section><button type="button">Keep</button></section>')
    const section = host.querySelector('section')
    const button = host.querySelector('button')
    expect(section).toBeInstanceOf(HTMLElement)
    expect(button).toBeInstanceOf(HTMLButtonElement)
    if (!(section instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return

    expect(canRunFocusedResourceCommand(null)).toBe(false)
    expect(canRunFocusedResourceCommand(section)).toBe(false)
    button.focus()
    expect(canRunFocusedResourceCommand(section)).toBe(true)

    section.hidden = true
    expect(isElementSuppressed(section)).toBe(true)
    expect(canRunFocusedResourceCommand(section)).toBe(false)
    host.remove()
  })

  it('rejects an editable descendant and an open dialog or menu', () => {
    const host = mount('<section><input aria-label="Name" /></section><div role="dialog">Confirm</div>')
    const section = host.querySelector('section')
    const input = host.querySelector('input')
    const dialog = host.querySelector('[role="dialog"]')
    if (!(section instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(dialog instanceof HTMLElement)) {
      throw new Error('fixture missing')
    }

    input.focus()
    expect(canRunFocusedResourceCommand(section)).toBe(false)

    dialog.hidden = true
    const button = document.createElement('button')
    section.append(button)
    button.focus()
    expect(canRunFocusedResourceCommand(section)).toBe(true)

    dialog.hidden = false
    expect(canRunFocusedResourceCommand(section)).toBe(false)
    dialog.setAttribute('data-state', 'closed')
    expect(canRunFocusedResourceCommand(section)).toBe(true)

    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    host.append(menu)
    expect(canRunFocusedResourceCommand(section)).toBe(false)
    menu.setAttribute('aria-hidden', 'true')
    expect(canRunFocusedResourceCommand(section)).toBe(true)
    host.remove()
  })
})
