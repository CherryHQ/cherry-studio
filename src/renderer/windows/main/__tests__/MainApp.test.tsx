import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MainApp from '../MainApp'

// Cut the heavy shell import graph (AppShell → TabRouter → routeTree.gen pulls in
// every route module); the wiring under test is the boundary around the providers.
vi.mock('@renderer/components/layout/AppShell', () => ({ AppShell: () => null }))
vi.mock('@renderer/hooks/useStorageMonitorNotification', () => ({ useStorageMonitorNotification: () => {} }))
vi.mock('../hooks/useTopicNamingErrorNotification', () => ({ useTopicNamingErrorNotification: () => {} }))
vi.mock('../hooks/useAppUpdateHandler', () => ({ useAppUpdateHandler: () => {} }))

// The outermost provider explodes during render — only a boundary that is an
// ANCESTOR of the provider stack can catch this.
vi.mock('@renderer/components/ThemeProvider', () => ({
  ThemeProvider: () => {
    throw new Error('theme provider boom')
  }
}))

describe('MainApp top-level error boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the window fatal fallback instead of a white screen when a provider throws', () => {
    const spinner = document.createElement('div')
    spinner.id = 'spinner'
    document.body.appendChild(spinner)

    render(<MainApp />)

    expect(screen.getByRole('alert')).toHaveTextContent('theme provider boom')
    // Spinner removal is WindowFatalFallback behavior: the boot spinner overlay must
    // not keep covering the fallback when the provider stack never mounted.
    expect(document.getElementById('spinner')).toBeNull()
  })
})
