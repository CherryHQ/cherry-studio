import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

const miniApps = vi.hoisted(() => [{ appId: 'reports', name: '财务报表', orderKey: 'a1' }])

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    openedKeepAliveMiniApps: [],
    pinned: miniApps
  })
}))
vi.mock('@renderer/components/icons/MiniAppIcon', () => ({ default: () => <span /> }))

import { SidebarAvailableContext } from '@renderer/hooks/useSidebarAvailable'

import { LaunchpadDialog } from '../LaunchpadDialog'
import { MiniLaunchpad } from '../MiniLaunchpad'

function Harness() {
  const triggerRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [destination, setDestination] = useState('home')
  return (
    <>
      <SidebarAvailableContext value={false}>
        <MiniLaunchpad
          onOpen={() => {
            triggerRef.current = document.activeElement as HTMLElement
            setOpen(true)
          }}
        />
        <LaunchpadDialog returnFocusRef={triggerRef} open={open} onOpenChange={setOpen} onOpen={setDestination} />
      </SidebarAvailableContext>
      <output aria-label="destination">{destination}</output>
    </>
  )
}

beforeAll(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
})

afterAll(() => vi.unstubAllGlobals())

afterEach(() => {
  cleanup()
  MockUsePreferenceUtils.resetMocks()
})

describe('mini launchpad', () => {
  it('opens a built-in app through the host callback and closes the popup', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '应用' }))
    await user.click(await screen.findByText('翻译'))
    expect(screen.getByLabelText('destination')).toHaveTextContent('/app/translate')
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
  })

  it('finds Chinese apps by initials, clears the filter, and opens the selected mini app', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '应用' }))
    const search = await screen.findByRole('searchbox')

    await user.type(search, 'ZSK')
    expect(screen.getByRole('button', { name: '知识库' })).toBeVisible()
    expect(screen.queryByText('翻译')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(screen.getByText('翻译')).toBeVisible()

    await user.type(search, 'cwbb')
    expect(screen.queryByRole('button', { name: '知识库' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '财务报表' }))
    expect(screen.getByLabelText('destination')).toHaveTextContent('/app/mini-app/reports')
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
  })

  it('turns a page when dragging the empty grid and dismisses on a separate click', async () => {
    const initialAppCount = miniApps.length
    miniApps.push(
      ...Array.from({ length: 24 }, (_, index) => ({
        appId: `app-${index}`,
        name: `App ${index}`,
        orderKey: `b${index}`
      }))
    )
    try {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByRole('button', { name: '应用' }))
      const dialog = screen.getByRole('dialog', { name: '启动台' })
      const grid = await within(dialog).findByRole('region', { name: '应用' })
      Object.defineProperty(grid, 'setPointerCapture', { value: () => {} })
      const pointer = (type: 'pointerdown' | 'pointerup', clientX: number) =>
        Object.assign(new MouseEvent(type, { clientX, bubbles: true }), { pointerType: 'mouse', pointerId: 1 })

      fireEvent(grid, pointer('pointerdown', 180))
      fireEvent(grid, pointer('pointerup', 90))
      fireEvent.click(grid)
      expect(within(dialog).getByRole('button', { name: /^2 \/ /, current: 'page' })).toBeVisible()

      await user.click(grid)
      expect(dialog).not.toBeInTheDocument()
    } finally {
      miniApps.splice(initialAppCount)
    }
  })

  it('dismisses with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '应用' })
    await user.click(trigger)
    await screen.findByRole('searchbox')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
  })
})
