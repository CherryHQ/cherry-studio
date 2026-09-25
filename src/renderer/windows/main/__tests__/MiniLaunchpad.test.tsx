import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@cherrystudio/ui')

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({ pinned: [{ appId: 'pinned-app', name: 'Pinned application', orderKey: 'a0' }] })
}))
vi.mock('@renderer/components/icons/MiniAppIcon', () => ({ default: () => <span /> }))

import { MiniLaunchpad } from '../MiniLaunchpad'

function Harness() {
  const [destination, setDestination] = useState('home')
  return (
    <>
      <MiniLaunchpad onOpen={setDestination} />
      <output aria-label="destination">{destination}</output>
    </>
  )
}

afterEach(() => {
  cleanup()
  MockUsePreferenceUtils.resetMocks()
})

describe('mini launchpad', () => {
  it('filters pinned apps, shows empty results, and opens the selected app', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '启动台' }))
    const search = screen.getByRole('textbox', { name: '搜索应用' })
    await user.type(search, 'no-such-app')
    expect(screen.getByText('未找到应用')).toBeVisible()
    await user.clear(search)
    await user.type(search, 'pinned')
    await user.click(screen.getByRole('button', { name: 'Pinned application' }))
    expect(screen.getByLabelText('destination')).toHaveTextContent('/app/mini-app/pinned-app')
    expect(screen.queryByRole('textbox', { name: '搜索应用' })).not.toBeInTheDocument()
  })

  it('dismisses with Escape, returns focus, and clears the previous query', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '启动台' })
    await user.click(trigger)
    await user.type(screen.getByRole('textbox', { name: '搜索应用' }), 'pinned')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.click(trigger)
    expect(screen.getByRole('textbox', { name: '搜索应用' })).toHaveValue('')
  })
})
