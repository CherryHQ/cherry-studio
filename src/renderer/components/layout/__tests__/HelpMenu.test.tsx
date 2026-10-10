// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const mocks = vi.hoisted(() => ({
  language: 'en-US',
  openFeedback: vi.fn(),
  openReleaseNotes: vi.fn(),
  openSmartMiniApp: vi.fn(),
  showDoctor: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn() }) }
}))

vi.mock('@renderer/hooks/useOpenReleaseNotes', () => ({
  useOpenReleaseNotes: () => mocks.openReleaseNotes
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))

vi.mock('@renderer/components/doctor', () => ({
  DoctorPopup: { show: (...args: unknown[]) => mocks.showDoctor(...args) }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: mocks.language, resolvedLanguage: mocks.language },
    t: (key: string) => {
      if (key === 'settings.about.feedback.diagnostics.title') return 'Report a problem'
      if (key === 'settings.doctor.entry.title') return 'System diagnostics'
      return key
    }
  })
}))

import { HelpMenu } from '../HelpMenu'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mocks.language = 'en-US'
})

async function openMenu() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'help.title' }))
  await screen.findByRole('button', { name: 'help.whats_new' })
  return user
}

describe('HelpMenu', () => {
  it.each([
    ['icon', false],
    ['full', true]
  ] as const)('renders the help entry in %s sidebar layout', (layout, hasVisibleLabel) => {
    render(<HelpMenu layout={layout} onFeedbackClick={mocks.openFeedback} />)

    const trigger = screen.getByRole('button', { name: 'help.title' })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent(hasVisibleLabel ? 'help.title' : '')
  })

  it('places report a problem immediately after the guide and opens release notes', async () => {
    render(<HelpMenu layout="icon" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    expect(
      screen
        .getAllByRole('button')
        .slice(1)
        .map((action) => action.textContent)
    ).toEqual(['help.whats_new', 'help.guide', 'Report a problem', 'help.feedback', 'System diagnostics'])

    await user.click(screen.getByRole('button', { name: 'help.whats_new' }))
    await waitFor(() => expect(mocks.openReleaseNotes).toHaveBeenCalledOnce())
  })

  it('closes the help menu before opening the report panel', async () => {
    let reportEntryWasVisible = true
    mocks.showDoctor.mockImplementationOnce(() => {
      reportEntryWasVisible = screen.queryByRole('button', { name: 'Report a problem' }) !== null
      return Promise.resolve()
    })
    render(<HelpMenu layout="full" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'Report a problem' }))

    await waitFor(() => expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'report' }))
    expect(reportEntryWasVisible).toBe(false)
    expect(mocks.openFeedback).not.toHaveBeenCalled()
  })

  it('reports the help overlay lifecycle to its sidebar owner', async () => {
    const onOverlayOpenChange = vi.fn()
    render(<HelpMenu layout="full" onFeedbackClick={mocks.openFeedback} onOverlayOpenChange={onOverlayOpenChange} />)
    const user = await openMenu()

    expect(onOverlayOpenChange).toHaveBeenLastCalledWith(true)

    await user.click(screen.getByRole('button', { name: 'help.whats_new' }))

    expect(onOverlayOpenChange).toHaveBeenLastCalledWith(false)
  })

  it.each([
    ['zh-CN', 'https://docs.cherryai.com.cn/'],
    ['zh-TW', 'https://docs.cherryai.com.cn/'],
    ['en-US', 'https://docs.cherryai.com.cn/docs/en-us']
  ])('opens the language-specific guide in app content for %s', async (language, expectedUrl) => {
    mocks.language = language
    render(<HelpMenu layout="full" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'help.guide' }))

    await waitFor(() =>
      expect(mocks.openSmartMiniApp).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 'cherrystudio-guide',
          name: 'help.guide',
          url: expectedUrl
        })
      )
    )
  })

  it('requests the feedback dialog from the secondary menu action', async () => {
    render(<HelpMenu layout="full" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'help.feedback' }))

    await waitFor(() => expect(mocks.openFeedback).toHaveBeenCalledOnce())
  })

  it('opens system diagnostics checks independently of the report action', async () => {
    render(<HelpMenu layout="icon" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'System diagnostics' }))

    await waitFor(() => expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'checks' }))
  })

  it('supports keyboard activation from the focused first action', async () => {
    render(<HelpMenu layout="icon" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()
    const firstAction = screen.getByRole('button', { name: 'help.whats_new' })

    firstAction.focus()
    expect(firstAction).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(mocks.openReleaseNotes).toHaveBeenCalledOnce())
  })
})
