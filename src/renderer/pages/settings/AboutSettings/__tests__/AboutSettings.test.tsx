import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18nextModule from 'react-i18next'
import type * as StreamdownModule from 'streamdown'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import i18n from '@renderer/i18n/resolver'

vi.unmock('@cherrystudio/ui')

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  request: vi.fn(),
  search: {} as Record<string, unknown>,
  showDoctor: vi.fn()
}))

vi.mock('@renderer/components/doctor', () => ({
  DoctorPopup: { show: (...args: unknown[]) => mocks.showDoctor(...args) }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/about' }),
  useNavigate: () => mocks.navigate,
  useSearch: () => mocks.search
}))

vi.mock('@renderer/hooks/useAppUpdateState', () => ({
  useAppUpdateState: () => ({
    appUpdateState: {
      available: false,
      checking: false,
      downloaded: false,
      downloading: false,
      downloadProgress: 0,
      info: null
    },
    updateAppUpdateState: vi.fn(),
    checkForUpdate: vi.fn()
  })
}))

vi.mock('@renderer/hooks/useMiniAppPopup', () => ({
  useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() })
}))

vi.mock('@renderer/hooks/useOpenReleaseNotes', () => ({
  useOpenReleaseNotes: () => vi.fn()
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/components/UpdateDialogPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) =>
      key === 'settings.about.repository.button' ||
      key === 'settings.about.repository.title' ||
      key === 'settings.about.contact.title'
        ? enUS[key as keyof typeof enUS]
        : key === 'settings.doctor.entry.title'
          ? 'System diagnostics'
          : key
  })
}))

vi.mock('streamdown', async (importOriginal) => ({
  ...(await importOriginal<typeof StreamdownModule>()),
  Streamdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

// Forwards alt so empty-alt decorative logos stay hidden even without the wrapper.
vi.mock('@renderer/components/icons/LogoAvatar', () => ({
  default: ({ logo, alt }: { logo: string; alt?: string }) => <img src={logo} alt={alt} />
}))

import { AboutSettings } from '..'

const REPOSITORY_URL = 'https://github.com/CherryHQ/cherry-studio'

afterEach(cleanup)

async function renderAboutSettings() {
  render(<AboutSettings />)
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('app.get_info'))
}

describe('AboutSettings diagnostics entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = {}
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'app.get_info') return { isPortable: false, version: '2.0.0' }
      return undefined
    })
  })

  it('does not index the removed system diagnostics row', async () => {
    const { entries } = await import('../about.search')

    const diagnosticsEntry = entries.find((entry) => entry.anchorId === 'diagnostics')
    expect(diagnosticsEntry).toBeUndefined()
    expect(entries).toContainEqual({
      anchorId: 'debug-tools',
      titleKey: 'settings.about.debug.title',
      groupKey: 'settings.about.label'
    })
  })

  it('keeps system diagnostics out of About and opens the existing debug panel action', async () => {
    const user = userEvent.setup()
    await renderAboutSettings()

    expect(screen.queryByText('System diagnostics')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.about.debug.open' }))
    expect(mocks.request).toHaveBeenCalledWith('system.toggle_dev_tools')
  })

  it('opens an externally requested Doctor panel and consumes only that query', async () => {
    mocks.search = { doctor: 'report', focusId: 'support' }

    await renderAboutSettings()

    await waitFor(() => expect(mocks.showDoctor).toHaveBeenCalledWith({ initialPanel: 'report' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/about',
      search: expect.any(Function),
      replace: true
    })

    const updateSearch = mocks.navigate.mock.calls[0][0].search as (
      previous: Record<string, unknown>
    ) => Record<string, unknown>
    expect(updateSearch({ doctor: 'report', focusId: 'support' })).toEqual({ focusId: 'support' })
  })

  it('opens the feedback channel chooser without bypassing it', async () => {
    const user = userEvent.setup()
    await renderAboutSettings()

    expect(screen.queryByText('Contact')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.about.feedback.button' }))

    expect(screen.getByRole('heading', { name: 'settings.about.feedback.dialog.title' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Contact/ })).toBeVisible()
    expect(mocks.showDoctor).not.toHaveBeenCalled()
  })
})

describe('AboutSettings repository controls accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = {}
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'app.get_info') return { isPortable: false, version: '2.0.0' }
      return undefined
    })
  })

  it('names the app logo by its repository destination and hides decorative media', async () => {
    const user = userEvent.setup()
    await renderAboutSettings()

    const repositoryButton = screen.getByRole('button', { name: 'settings.about.repository' })
    expect(screen.queryByRole('button', { name: 'Cherry Studio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await user.click(repositoryButton)
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', REPOSITORY_URL)
  })
})

describe('AboutSettings repository entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = {}
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'app.get_info') return { isPortable: false, version: '2.0.0' }
      return undefined
    })
  })

  it('opens the project repository from the list entry', async () => {
    const user = userEvent.setup()
    await renderAboutSettings()

    expect(screen.getByText('Open-source project')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Support' }))

    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', REPOSITORY_URL)
  })

  it.each([
    ['zh-CN', 'https://cherryai.com.cn'],
    ['zh-TW', 'https://cherryai.com.cn'],
    ['en-US', 'https://cherryai.com'],
    ['ja-JP', 'https://cherryai.com']
  ])('opens the language-specific official website for %s', async (language, expectedUrl) => {
    const previousLanguage = i18n.language
    await i18n.changeLanguage(language)
    try {
      const user = userEvent.setup()
      await renderAboutSettings()

      for (const button of screen.getAllByRole('button', { name: 'settings.about.website.button' })) {
        await user.click(button)
      }

      expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', expectedUrl)
    } finally {
      await i18n.changeLanguage(previousLanguage)
    }
  })
})
