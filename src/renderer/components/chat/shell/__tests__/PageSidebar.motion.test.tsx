import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, waitFor } from '@testing-library/react'
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
