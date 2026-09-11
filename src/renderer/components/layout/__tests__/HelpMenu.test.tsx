// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  language: 'en-US',
  openFeedback: vi.fn(),
  openReleaseNotes: vi.fn(),
  openSmartMiniApp: vi.fn()
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

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: mocks.language, resolvedLanguage: mocks.language },
    t: (key: string) => key
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
    if (layout === 'full') {
      expect(trigger).toHaveClass('min-w-0', 'overflow-hidden')
      expect(trigger.querySelector('span')).toHaveClass('min-w-0', 'truncate')
    }
  })

  it('shows four compact 32px actions and opens release notes', async () => {
    render(<HelpMenu layout="icon" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    const actions = ['help.whats_new', 'help.guide', 'help.feedback', 'help.star'].map((name) =>
      screen.getByRole('button', { name })
    )
    expect(actions).toHaveLength(4)
    actions.forEach((action) => expect(action).toHaveClass('h-8'))

    await user.click(actions[0])
    await waitFor(() => expect(mocks.openReleaseNotes).toHaveBeenCalledOnce())
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

  it('opens the repository in the system browser for the GitHub Star action', async () => {
    render(<HelpMenu layout="icon" onFeedbackClick={mocks.openFeedback} />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'help.star' }))

    await waitFor(() =>
      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'system.shell.open_website',
        'https://github.com/CherryHQ/cherry-studio'
      )
    )
    expect(mocks.openSmartMiniApp).not.toHaveBeenCalled()
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
