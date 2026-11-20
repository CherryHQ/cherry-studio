import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

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
