import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, render, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { PageSidebar } from '../PageSidebar'
import { RESOURCE_LIST_PANE_CACHE_KEY } from '../paneLayout'

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  MockUseCacheUtils.setPersistCacheValue(RESOURCE_LIST_PANE_CACHE_KEY, 200)
})

afterEach(() => {
  MockUseCacheUtils.resetMocks()
  document.documentElement.style.removeProperty('--assistants-width')
})

it.each(['settled', 'in-flight'] as const)('preserves the %s sidebar collapse across tab switches', async (phase) => {
  const Sidebar = ({ visible, open }: { visible: boolean; open: boolean }) => (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <PageSidebar open={open} width={240}>
        content
      </PageSidebar>
    </Activity>
  )
  const { container, rerender } = render(<Sidebar visible open />)
  const pane = container.querySelector<HTMLElement>('[data-resource-list-pane]')!

  rerender(<Sidebar visible open={false} />)
  if (phase === 'settled') {
    await waitFor(() => expect(pane.style.width).toBe('0px'))
  } else {
    await waitFor(() => {
      expect(Number.parseFloat(pane.style.width)).toBeGreaterThan(0)
      expect(Number.parseFloat(pane.style.width)).toBeLessThan(240)
    })
  }
  rerender(<Sidebar visible={false} open={false} />)
  rerender(<Sidebar visible open={false} />)
  await act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await waitFor(() => {
    expect(pane.style.width).toBe('0px')
    expect(pane.style.opacity).toBe('0')
    expect(pane).toHaveAttribute('aria-hidden', 'true')
    expect(pane).toHaveAttribute('inert')
  })

  rerender(<Sidebar visible open />)
  await waitFor(() => {
    expect(pane.style.width).toBe('240px')
    expect(pane.style.opacity).toBe('1')
  })
})

it('does not let an interrupted collapse overwrite the latest target on reconnect', async () => {
  const Sidebar = ({ visible, open }: { visible: boolean; open: boolean }) => (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <PageSidebar open={open} width={240}>
        content
      </PageSidebar>
    </Activity>
  )
  const { container, rerender } = render(<Sidebar visible open />)
  const pane = container.querySelector<HTMLElement>('[data-resource-list-pane]')!

  rerender(<Sidebar visible open={false} />)
  await waitFor(() => {
    expect(Number.parseFloat(pane.style.width)).toBeGreaterThan(0)
    expect(Number.parseFloat(pane.style.width)).toBeLessThan(240)
  })
  rerender(<Sidebar visible={false} open={false} />)
  rerender(<Sidebar visible open />)
  await act(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await waitFor(() => {
    expect(pane.style.width).toBe('240px')
    expect(pane.style.opacity).toBe('1')
    expect(pane).toHaveAttribute('aria-hidden', 'false')
  })
})

it('keeps the restored width through the next transition', async () => {
  const Sidebar = ({ visible, open = true }: { visible: boolean; open?: boolean }) => (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <PageSidebar open={open}>content</PageSidebar>
    </Activity>
  )

  const { container, rerender } = render(<Sidebar visible />)
  const pane = container.querySelector<HTMLElement>('[data-resource-list-pane]')!

  MockUseCacheUtils.setPersistCacheValue(RESOURCE_LIST_PANE_CACHE_KEY, 283)
  rerender(<Sidebar visible={false} />)
  rerender(<Sidebar visible />)
  await waitFor(() => {
    expect(document.documentElement.style.getPropertyValue('--assistants-width')).toBe('283px')
    expect(pane.style.width).toBe('var(--assistants-width)')
  })

  rerender(<Sidebar visible open={false} />)
  await waitFor(() => expect(pane.style.opacity).toBe('0'))
  rerender(<Sidebar visible />)
  await waitFor(() => {
    expect(pane.style.width).toBe('var(--assistants-width)')
    expect(pane.style.opacity).toBe('1')
  })
})
