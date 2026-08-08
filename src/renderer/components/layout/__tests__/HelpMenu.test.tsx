// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  language: 'en-US',
  openReleaseNotes: vi.fn(),
  openSmartMiniApp: vi.fn()
}))

vi.mock('@renderer/hooks/useOpenReleaseNotes', () => ({
  useOpenReleaseNotes: () => mocks.openReleaseNotes
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: mocks.openSmartMiniApp })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: mocks.language, resolvedLanguage: mocks.language },
    t: (key: string) => key
  })
}))

vi.mock('../../feedback/FeedbackDialog', () => ({
  default: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
    <div data-testid="feedback-shell" data-open={open}>
      {open ? <div role="dialog">feedback-dialog</div> : null}
      <button type="button" onClick={() => onOpenChange(false)}>
        close-feedback
      </button>
    </div>
  )
}))

import { HelpMenu } from '../HelpMenu'

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
    render(<HelpMenu layout={layout} />)

    const trigger = screen.getByRole('button', { name: 'help.title' })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent(hasVisibleLabel ? 'help.title' : '')
  })

  it('shows four compact 32px actions and opens release notes', async () => {
    render(<HelpMenu layout="icon" />)
    const user = await openMenu()

    const actions = ['help.whats_new', 'help.guide', 'help.feedback', 'help.star'].map((name) =>
      screen.getByRole('button', { name })
    )
    expect(actions).toHaveLength(4)
    actions.forEach((action) => expect(action).toHaveClass('h-8'))

    await user.click(actions[0])
    await waitFor(() => expect(mocks.openReleaseNotes).toHaveBeenCalledOnce())
  })

  it.each([
    ['zh-CN', 'https://docs.cherryai.com.cn/'],
    ['zh-TW', 'https://docs.cherryai.com.cn/'],
    ['en-US', 'https://docs.cherryai.com.cn/docs/en-us']
  ])('opens the language-specific guide in app content for %s', async (language, expectedUrl) => {
    mocks.language = language
    render(<HelpMenu layout="full" />)
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

  it('opens the feedback dialog from the secondary menu action', async () => {
    render(<HelpMenu layout="full" />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'help.feedback' }))

    await waitFor(() => expect(screen.getByText('feedback-dialog')).toBeInTheDocument())
  })

  it('keeps the feedback component mounted after its primary dialog closes', async () => {
    render(<HelpMenu layout="full" />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'help.feedback' }))
    await user.click(await screen.findByRole('button', { name: 'close-feedback' }))

    expect(screen.getByTestId('feedback-shell')).toHaveAttribute('data-open', 'false')
  })

  it('opens the repository in app content for the GitHub Star action', async () => {
    render(<HelpMenu layout="icon" />)
    const user = await openMenu()

    await user.click(screen.getByRole('button', { name: 'help.star' }))

    await waitFor(() =>
      expect(mocks.openSmartMiniApp).toHaveBeenCalledWith({
        appId: 'cherrystudio-github',
        name: 'help.star',
        url: 'https://github.com/CherryHQ/cherry-studio',
        logo: 'github'
      })
    )
  })

  it('supports keyboard activation from the focused first action', async () => {
    render(<HelpMenu layout="icon" />)
    const user = await openMenu()
    const firstAction = screen.getByRole('button', { name: 'help.whats_new' })

    firstAction.focus()
    expect(firstAction).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(mocks.openReleaseNotes).toHaveBeenCalledOnce())
  })
})
