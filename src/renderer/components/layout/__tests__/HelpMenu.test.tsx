// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { ThemeContext } from '@renderer/hooks/useTheme'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

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

import { AppearanceMenu } from '../AppearanceMenu'
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
  it('opens on hover without stealing focus and lets the pointer enter the submenu', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Settings</button>
        <HelpMenu onFeedbackClick={mocks.openFeedback} />
      </>
    )
    const settings = screen.getByRole('button', { name: 'Settings' })
    settings.focus()

    await user.hover(screen.getByRole('button', { name: 'help.title' }))
    const feedback = await screen.findByRole('button', { name: 'help.feedback' })
    expect(settings).toHaveFocus()

    await user.hover(feedback)
    await user.click(feedback)
    await waitFor(() => expect(mocks.openFeedback).toHaveBeenCalledOnce())
  })

  it('closes when the pointer leaves both the trigger and the submenu', async () => {
    const user = userEvent.setup()
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
    const trigger = screen.getByRole('button', { name: 'help.title' })

    await user.hover(trigger)
    await screen.findByRole('button', { name: 'help.whats_new' })
    await user.unhover(trigger)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'help.whats_new' })).not.toBeInTheDocument())
  })

  it('opens with ArrowRight and returns focus to the trigger on Escape', async () => {
    const user = userEvent.setup()
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
    const trigger = screen.getByRole('button', { name: 'help.title' })
    trigger.focus()

    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('button', { name: 'help.whats_new' })).toHaveFocus()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'help.whats_new' })).not.toBeInTheDocument()
  })

  it('keeps help usable and restores focus on Escape after a keyboard-to-hover handoff', async () => {
    const user = userEvent.setup()
    render(
      <ThemeContext
        value={{ theme: ThemeMode.dark, settedTheme: ThemeMode.dark, setTheme: vi.fn(), toggleTheme: vi.fn() }}>
        <AppearanceMenu />
        <HelpMenu onFeedbackClick={mocks.openFeedback} />
      </ThemeContext>
    )
    screen.getByRole('button', { name: 'settings.appearance.title' }).focus()
    await user.keyboard('{ArrowRight}')
    const currentTheme = await screen.findByRole('button', { name: 'settings.theme.dark', pressed: true })
    expect(currentTheme).toHaveFocus()

    await user.hover(currentTheme)
    await user.hover(screen.getByRole('button', { name: 'help.title' }))
    const feedback = await screen.findByRole('button', { name: 'help.feedback' })
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'settings.appearance.title' })).not.toBeInTheDocument()
    )
    await user.hover(feedback)

    expect(screen.getByRole('button', { name: 'help.feedback' })).toBeVisible()
    await user.keyboard('{Escape}')
    const helpTrigger = screen.getByRole('button', { name: 'help.title' })
    await waitFor(() => expect(helpTrigger).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('button', { name: 'help.whats_new' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'help.feedback' }))
    await waitFor(() => expect(mocks.openFeedback).toHaveBeenCalledOnce())
  })

  it('places report a problem immediately after the guide and opens release notes', async () => {
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
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
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'Report a problem' }))

    await waitFor(() => expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'report' }))
    expect(reportEntryWasVisible).toBe(false)
    expect(mocks.openFeedback).not.toHaveBeenCalled()
  })

  it.each([
    ['zh-CN', 'https://docs.cherryai.com.cn/'],
    ['zh-TW', 'https://docs.cherryai.com.cn/'],
    ['en-US', 'https://docs.cherryai.com.cn/docs/en-us']
  ])('opens the language-specific guide in app content for %s', async (language, expectedUrl) => {
    mocks.language = language
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
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
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'help.feedback' }))

    await waitFor(() => expect(mocks.openFeedback).toHaveBeenCalledOnce())
  })

  it('opens system diagnostics checks independently of the report action', async () => {
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'System diagnostics' }))

    await waitFor(() => expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'checks' }))
  })

  it('supports keyboard activation from the focused first action', async () => {
    render(<HelpMenu onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()
    const firstAction = screen.getByRole('button', { name: 'help.whats_new' })

    firstAction.focus()
    expect(firstAction).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(mocks.openReleaseNotes).toHaveBeenCalledOnce())
  })
})
