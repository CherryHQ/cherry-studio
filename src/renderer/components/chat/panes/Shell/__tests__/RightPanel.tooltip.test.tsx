import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type RightPanelCapability, RightPanelProvider, RightPanelShortcut } from '../RightPanel'

vi.unmock('@cherrystudio/ui')

function measure(element: Element): DOMRect {
  if (element === document.documentElement || element === document.body) return new DOMRect(0, 0, 1280, 800)
  if (element.matches('[data-slot="tooltip-trigger"], [data-shell-tab-shortcut]')) {
    return new DOMRect(600, 300, 28, 28)
  }
  if (element.matches('[data-radix-popper-content-wrapper], [data-slot="tooltip-content"]')) {
    return new DOMRect(0, 0, 160, 32)
  }
  if (element.matches('span') && element.querySelector('svg')) return new DOMRect(0, 0, 12, 6)
  return new DOMRect(0, 0, 0, 0)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RightPanelShortcut tooltip', () => {
  it('opens below the shortcut when both sides have room', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return measure(this)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return measure(this).width
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return measure(this).height
    })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return measure(this).width
    })
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return measure(this).height
    })

    const label = 'Branch Management'
    const capabilities = [
      {
        component: () => null,
        resolve: () => ({ id: 'branch', instanceKey: 'branch', title: label, readiness: 'ready' })
      }
    ] satisfies readonly RightPanelCapability<null>[]
    const user = userEvent.setup()

    render(
      <RightPanelProvider capabilities={capabilities} scope={null}>
        <RightPanelShortcut tab="branch" label={label} icon={<span />} />
      </RightPanelProvider>
    )

    await user.hover(screen.getByRole('button', { name: label }))

    const tooltip = await screen.findByRole('tooltip', { name: label }, { timeout: 5000 })
    const content = tooltip.closest('[data-slot="tooltip-content"]')
    const wrapper = tooltip.closest<HTMLElement>('[data-radix-popper-content-wrapper]')
    expect(content).not.toBeNull()
    expect(wrapper).not.toBeNull()

    await waitFor(() => {
      expect(wrapper?.style.getPropertyValue('--radix-popper-anchor-width')).toBe('28px')
      expect(wrapper?.style.transform).not.toBe('translate(0, -200%)')
    })
    expect(content).toHaveAttribute('data-side', 'bottom')
  })
})
