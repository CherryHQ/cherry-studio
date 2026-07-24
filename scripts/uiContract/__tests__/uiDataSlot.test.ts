// @vitest-environment jsdom
import { Slot } from '@radix-ui/react-slot'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { type ComponentType, createElement as h, type Ref } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeDataUi } from '../runtime'
import { UiDataSlot } from '../uiDataSlot'

// React.act refuses to run outside a configured act environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(cleanup)

type AnyProps = Record<string, unknown>

/** Render the same slot/child props through real Radix Slot and UiDataSlot. */
function renderBoth(slotProps: AnyProps, childProps: AnyProps) {
  const make = (component: ComponentType<AnyProps>, testId: string) =>
    render(h(component, slotProps, h('button', { ...childProps, 'data-testid': testId }))).getByTestId(testId)
  return { fromSlot: make(Slot as ComponentType<AnyProps>, 'slot'), fromUiDataSlot: make(UiDataSlot, 'ui-data-slot') }
}

describe('UiDataSlot prop merging (parity with Radix Slot)', () => {
  it('joins className and merges style like Radix Slot', () => {
    const { fromSlot, fromUiDataSlot } = renderBoth(
      { className: 'from-slot', style: { color: 'red', margin: '1px' } },
      { className: 'from-child', style: { color: 'blue' } }
    )
    expect(fromUiDataSlot.className).toBe(fromSlot.className)
    expect(fromUiDataSlot.getAttribute('style')).toBe(fromSlot.getAttribute('style'))
  })

  it('lets child win plain props and keeps slot-only props, like Radix Slot', () => {
    const { fromSlot, fromUiDataSlot } = renderBoth(
      { id: 'slot-id', 'aria-label': 'slot-label' },
      { id: 'child-id', type: 'button' }
    )
    expect(fromUiDataSlot.id).toBe(fromSlot.id)
    expect(fromUiDataSlot.getAttribute('aria-label')).toBe(fromSlot.getAttribute('aria-label'))
    expect(fromUiDataSlot.getAttribute('type')).toBe(fromSlot.getAttribute('type'))
  })

  it('composes event handlers child-first, like Radix Slot', () => {
    const order: string[] = []
    const { fromUiDataSlot } = renderBoth({ onClick: () => order.push('slot') }, { onClick: () => order.push('child') })
    fireEvent.click(fromUiDataSlot)
    expect(order).toEqual(['child', 'slot'])
  })

  it('merges data-ui tokens instead of letting one side win', () => {
    const slotDataUi = 'chat.message'
    const childDataUi = 'part:message-content'
    const { fromSlot, fromUiDataSlot } = renderBoth({ 'data-ui': slotDataUi }, { 'data-ui': childDataUi })
    expect(fromUiDataSlot.getAttribute('data-ui')).toBe(mergeDataUi(childDataUi, slotDataUi))
    // Radix Slot would drop one side (child props win); the merge is the point.
    expect(fromSlot.getAttribute('data-ui')).toBe(childDataUi)
  })

  it('returns children untouched without slot props and ref', () => {
    const { getByTestId } = render(h(UiDataSlot, null, h('button', { 'data-testid': 'leaf', id: 'plain' })))
    const leaf = getByTestId('leaf')
    expect(leaf.id).toBe('plain')
    expect(leaf.hasAttribute('data-ui')).toBe(false)
  })

  it('throws for multiple children, like Radix Slot', () => {
    expect(() => render(h(UiDataSlot, { 'data-ui': 'chat.view' }, h('span'), h('span')))).toThrowError(
      'UiDataSlot failed to slot onto its children. Expected a single React element child.'
    )
    expect(() => render(h(Slot as ComponentType<AnyProps>, null, h('span'), h('span')))).toThrowError(
      /failed to slot onto its children/
    )
  })

  it('throws for a lone non-element child, like Radix Slot', () => {
    expect(() => render(h(UiDataSlot, { 'data-ui': 'chat.view' }, 'text'))).toThrowError(
      'UiDataSlot failed to slot onto its children. Expected a single React element child.'
    )
  })

  it('renders empty children as-is, like Radix Slot', () => {
    const { container } = render(h(UiDataSlot, { 'data-ui': 'chat.view' }, null))
    expect(container.firstChild).toBeNull()
  })
})

describe('UiDataSlot ref behavior', () => {
  it('delivers the node to both the forwarded ref and the child ref, and nulls them on unmount', () => {
    const forwarded = vi.fn()
    const childRef: { current: HTMLButtonElement | null } = { current: null }
    const view = render(
      h(UiDataSlot, { ref: forwarded, 'data-ui': 'chat.view' }, h('button', { ref: childRef, 'data-testid': 'leaf' }))
    )
    const leaf = view.getByTestId('leaf')
    expect(forwarded).toHaveBeenCalledExactlyOnceWith(leaf)
    expect(childRef.current).toBe(leaf)
    view.unmount()
    expect(forwarded).toHaveBeenLastCalledWith(null)
    expect(childRef.current).toBeNull()
  })

  it('absorbs forwarded-ref identity churn without detaching the leaf ref', () => {
    // Regression: an enclosing Radix SlotClone passes a NEW composed ref on
    // every render. The old Slot-delegating implementation re-attached the
    // leaf DOM ref each time (null/node pulses), which could self-sustain into
    // "Maximum update depth exceeded" against state-setter refs.
    const calls: unknown[] = []
    const tree = (forwarded: Ref<unknown>) =>
      h(UiDataSlot, { ref: forwarded, 'data-ui': 'chat.view' }, h('div', { 'data-testid': 'leaf' }))
    const view = render(tree((node: unknown) => void calls.push(node)))
    for (let round = 0; round < 20; round += 1) {
      view.rerender(tree((node: unknown) => void calls.push(node)))
    }
    // One attach from the first identity; later identities never pulse null/node.
    expect(calls).toEqual([view.getByTestId('leaf')])
    view.unmount()
    expect(calls).toEqual([expect.any(HTMLElement), null])
  })

  it('runs React 19 ref cleanups and nulls plain refs on unmount', () => {
    const cleanupSpy = vi.fn()
    const attached: unknown[] = []
    const childRef: { current: HTMLDivElement | null } = { current: null }
    const view = render(
      h(
        UiDataSlot,
        {
          ref: (node: unknown) => {
            attached.push(node)
            return cleanupSpy
          },
          'data-ui': 'chat.view'
        },
        h('div', { ref: childRef, 'data-testid': 'leaf' })
      )
    )
    expect(attached).toEqual([view.getByTestId('leaf')])
    expect(childRef.current).not.toBeNull()
    view.unmount()
    expect(cleanupSpy).toHaveBeenCalledOnce()
    // The cleanup-returning ref is never called with null; the plain ref is.
    expect(attached).toEqual([expect.any(HTMLElement)])
    expect(childRef.current).toBeNull()
  })
})
