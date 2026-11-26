import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

const miniApps = vi.hoisted(() => [{ appId: 'pinned-app', name: 'Pinned application', orderKey: 'a0' }])

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
        <LaunchpadDialog
          returnFocusRef={triggerRef}
          open={open}
          onOpenChange={setOpen}
          onOpen={setDestination}
          minimal
        />
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
  it('searches apps and closes after opening the selected app', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '应用' }))
    await screen.findByRole('button', { name: 'Pinned application' }, { timeout: 5000 })
    await user.type(screen.getByRole('searchbox'), 'Pinned')
    expect(screen.queryByRole('button', { name: '翻译' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '助手' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '智能体' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Pinned application' }))
    expect(screen.getByLabelText('destination')).toHaveTextContent('/app/mini-app/pinned-app')
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
  })

  it('opens a built-in app through the host callback and closes the popup', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '应用' }))
    await user.click(await screen.findByRole('button', { name: '翻译' }))
    expect(screen.getByLabelText('destination')).toHaveTextContent('/app/translate')
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
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
