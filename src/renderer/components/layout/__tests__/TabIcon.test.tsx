import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Tab } from '@renderer/hooks/tab'

import { TabIcon } from '../TabIcon'

vi.unmock('@cherrystudio/ui')

class TestImage {
  complete = true
  naturalWidth = 0
  addEventListener() {}
  removeEventListener() {}
  set src(value: string) {
    this.naturalWidth = value.includes('/working') ? 16 : 0
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows the website favicon and falls back to a globe when it is missing or fails to load', () => {
  vi.stubGlobal('Image', TestImage)
  const tab: Tab = { id: 'browser', type: 'route', url: '/app/browser?url=https://example.com', title: 'Example' }
  const view = render(<TabIcon tab={tab} size={16} />)
  // The decorative icon has no accessible name; the globe glyph is the visual fallback contract.
  const globe = () => view.container.querySelector('svg.lucide-globe')
  expect(globe()).toBeInTheDocument()
  view.rerender(<TabIcon tab={{ ...tab, icon: 'https://example.com/working.ico' }} size={16} />)
  expect(screen.getByRole('presentation')).toHaveAttribute('src', 'https://example.com/working.ico')
  expect(globe()).not.toBeInTheDocument()
  view.rerender(<TabIcon tab={{ ...tab, icon: 'https://example.com/broken.ico' }} size={16} />)
  expect(globe()).toBeInTheDocument()
  expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
  view.rerender(<TabIcon tab={{ ...tab, icon: 'https://another.test/working.png' }} size={16} />)
  expect(screen.getByRole('presentation')).toHaveAttribute('src', 'https://another.test/working.png')
  expect(globe()).not.toBeInTheDocument()
})

it('renders CLI Web UI tabs with a local circular icon at the tab size, without a network image', () => {
  const tab: Tab = {
    id: 'kilo',
    type: 'route',
    url: '/app/mini-app/local-agent-web-kilo',
    title: 'Kilo',
    icon: 'cli:kilo'
  }
  const { container } = render(<TabIcon tab={tab} size={16} />)
  expect(container.querySelector('img')).not.toBeInTheDocument()
  expect(container.querySelector('svg')).toBeInTheDocument()
  expect(container.querySelector('[data-slot="avatar"]')).toHaveStyle({ width: '16px', height: '16px' })
})
