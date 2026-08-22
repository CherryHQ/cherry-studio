import { render, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { PageSidebar } from '../PageSidebar'

const cache = vi.hoisted(() => ({ width: 200 }))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [cache.width, vi.fn()]
}))

afterEach(() => {
  cache.width = 200
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

  cache.width = 283
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
