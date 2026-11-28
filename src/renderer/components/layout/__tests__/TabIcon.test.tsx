import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { SidebarIcon } from '@renderer/components/app/sidebarIcons'
import { type Tab, TabIdContext, TabsContext } from '@renderer/hooks/tab'
import { HomeTabRuntime } from '@renderer/pages/home/components/HomeTabRuntime'

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

it('uses the same glyph for the gateway tab and Launchpad tile', () => {
  const tab: Tab = { id: 'gateway', type: 'route', url: '/app/api-gateway', title: 'Unified Gateway' }
  const tabIcon = render(<TabIcon tab={tab} size={16} />)
  const tileIcon = render(<SidebarIcon icon="api_gateway" size={36} />)

  // Compare the decorative glyphs because a chat fallback has the same tab label.
  const tilePath = tileIcon.container.querySelector('svg path')?.getAttribute('d')
  expect(tilePath).toBeTruthy()
  expect(tabIcon.container.querySelector('svg path')).toHaveAttribute('d', tilePath)
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
  expect(container.querySelector('[data-slot="cli-icon"] svg')).toBeInTheDocument()
  expect(container.querySelector('[data-slot="cli-icon"]')).toHaveStyle({ width: '16px', height: '16px' })
})

// Catches a chat tab showing a broken image instead of the assistant's saved emoji.
it('shows the saved assistant emoji when the chat tab avatar fails to load', () => {
  function ChatTab() {
    const [tabs, setTabs] = useState<Tab[]>([{ id: 'chat', type: 'route', url: '/app/chat', title: 'Chat' }])
    const updateTab = (id: string, updates: Partial<Tab>) =>
      setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...updates } : tab)))
    return (
      <TabsContext value={{ tabs, updateTab } as never}>
        <TabIdContext value="chat">
          <HomeTabRuntime
            title="Topic"
            emoji="🦊"
            icon="file:///missing-avatar.png"
            preserveVisuals={false}
            activeTopicSource="query"
          />
        </TabIdContext>
        <TabIcon tab={tabs[0]} size={16} />
      </TabsContext>
    )
  }
  render(<ChatTab />)
  fireEvent.error(screen.getByRole('presentation'))
  expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
  expect(screen.getAllByText('🦊').length).toBeGreaterThan(0)
})
