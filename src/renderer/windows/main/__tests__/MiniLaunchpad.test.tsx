import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    openedKeepAliveMiniApps: [],
    pinned: [{ appId: 'pinned-app', name: 'Pinned application', orderKey: 'a0' }]
  })
}))
vi.mock('@renderer/components/icons/MiniAppIcon', () => ({ default: () => <span /> }))

import { MinimalModeContext } from '@renderer/hooks/useMinimalMode'

import { MiniLaunchpad } from '../MiniLaunchpad'

function Harness() {
  const [destination, setDestination] = useState('home')
  return (
    <>
      <MinimalModeContext
        value={{
          enabled: true,
          isHome: true,
          homeKind: 'agent',
          switchHome: () => {},
          returnHome: () => {},
          openFeature: setDestination
        }}>
        <MiniLaunchpad onOpen={setDestination} />
      </MinimalModeContext>
      <output aria-label="destination">{destination}</output>
    </>
  )
}

afterEach(() => {
  cleanup()
  MockUsePreferenceUtils.resetMocks()
})

describe('mini launchpad', () => {
  it('shows apps without search and closes after opening the selected app', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '启动台' }))
    await screen.findByRole('button', { name: 'Pinned application' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '应用' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '小程序' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '助手' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '智能体' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Pinned application' }))
    expect(screen.getByLabelText('destination')).toHaveTextContent('/app/mini-app/pinned-app')
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
  })

  it('opens a built-in app through the host callback and closes the popup', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '启动台' }))
    await user.click(await screen.findByRole('button', { name: '翻译' }))
    expect(screen.getByLabelText('destination')).toHaveTextContent('/app/translate')
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
  })

  it('dismisses with Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '启动台' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog', { name: '启动台' })).not.toBeInTheDocument()
  })
})
