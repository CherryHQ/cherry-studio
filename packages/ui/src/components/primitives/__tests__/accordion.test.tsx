// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../accordion'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('defers layout for an initially closed panel until it is opened', async () => {
  const user = userEvent.setup()
  const getBoundingClientRect = Element.prototype.getBoundingClientRect
  const getComputedStyle = window.getComputedStyle
  let hiddenPanelReads = 0
  let hiddenAnimationReads = 0
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-slot') !== 'accordion-content') return getBoundingClientRect.call(this)
    if (this.hasAttribute('hidden')) {
      hiddenPanelReads++
      return new DOMRect()
    }
    return new DOMRect(0, 0, 160, 48)
  })
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const style = getComputedStyle(element, pseudoElement)
    if (element.getAttribute('data-slot') === 'accordion-content') {
      Object.defineProperty(style, 'animationName', {
        get() {
          if (element.hasAttribute('hidden')) hiddenAnimationReads++
          return style.getPropertyValue('animation-name')
        }
      })
    }
    return style
  })

  render(
    <Accordion type="single" collapsible>
      <AccordionItem value="tools">
        <AccordionTrigger>Tool history</AccordionTrigger>
        <AccordionContent>Completed tool result</AccordionContent>
      </AccordionItem>
    </Accordion>
  )

  expect(hiddenPanelReads).toBe(0)
  expect(hiddenAnimationReads).toBe(0)
  const trigger = screen.getByRole('button', { name: 'Tool history' })
  trigger.focus()
  await user.keyboard('{Enter}')
  const panel = screen.getByRole('region', { name: 'Tool history' })
  expect(panel).toHaveTextContent('Completed tool result')
  expect(panel.style.getPropertyValue('--radix-collapsible-content-height')).toBe('48px')

  await user.keyboard('{Enter}')
  expect(screen.queryByRole('region', { name: 'Tool history' })).not.toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('region', { name: 'Tool history' })).toBeVisible()
})
