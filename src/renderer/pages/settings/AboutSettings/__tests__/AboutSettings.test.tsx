import '@testing-library/jest-dom/vitest'
import { mockUsePreference, MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appUpdateCheckService } from '@renderer/services/AppUpdateCheckService'
import { UpgradeChannel, type PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  request: vi.fn(),
  search: {} as Record<string, unknown>,
  showDoctor: vi.fn(),
  updateAppUpdateState: vi.fn()
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
    updateAppUpdateState: mocks.updateAppUpdateState
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'settings.doctor.entry.title' ? 'System diagnostics' : key)
  })
}))

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

// Forwards alt so empty-alt decorative logos stay hidden even without the wrapper.
vi.mock('@renderer/components/icons/LogoAvatar', () => ({
  default: ({ logo, alt }: { logo: string; alt?: string }) => <img src={logo} alt={alt} />
}))

import { AboutSettings } from '..'

const REPOSITORY_URL = 'https://github.com/CherryHQ/cherry-studio'

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

    await user.click(screen.getByRole('button', { name: 'settings.about.feedback.button' }))

    expect(screen.getByRole('heading', { name: 'settings.about.feedback.dialog.title' })).toBeVisible()
    expect(mocks.showDoctor).not.toHaveBeenCalled()
  })
})

const originalUsePreference = mockUsePreference.getMockImplementation()

function preferenceValue(key: PreferenceKeyType) {
  return MockUsePreferenceUtils.getPreferenceValue(key)
}

function betaChannelButton() {
  return screen.getByRole('button', { name: /^settings\.general\.test_plan\.beta_version\b/ })
}

function installPreferenceMock(writers: Partial<Record<PreferenceKeyType, (value: unknown) => Promise<void>>>) {
  mockUsePreference.mockImplementation((key: PreferenceKeyType) => {
    const write = writers[key]
    return [
      preferenceValue(key),
      write ??
        (async (value: unknown) => {
          MockUsePreferenceUtils.setPreferenceValue(key, value)
        })
    ]
  })
}

const WINDOW_SOURCE_META_NAME = 'logger-window-source'

function windowSourceMeta(): HTMLMetaElement | null {
  return document.querySelector(`meta[name="${WINDOW_SOURCE_META_NAME}"]`)
}

/** Same `<meta name="logger-window-source">` the main window declares in its HTML. */
function declareMainWindowSource(): { created: boolean; content: string | null } {
  let meta = windowSourceMeta()
  const created = meta === null
  const content = meta?.getAttribute('content') ?? null
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', WINDOW_SOURCE_META_NAME)
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', 'mainWindow')
  return { created, content }
}

function restoreWindowSource(snapshot: { created: boolean; content: string | null }) {
  const meta = windowSourceMeta()
  if (!meta) return
  if (snapshot.created) {
    meta.remove()
    return
  }
  if (snapshot.content === null) meta.removeAttribute('content')
  else meta.setAttribute('content', snapshot.content)
}

describe('AboutSettings channel change', () => {
  let windowSourceSnapshot: { created: boolean; content: string | null } = { created: false, content: null }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = {}
    windowSourceSnapshot = declareMainWindowSource()
    MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
    MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.RC)
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'app.get_info') return { isPortable: false, version: '2.0.0' }
      return undefined
    })
  })

  afterEach(() => {
    restoreWindowSource(windowSourceSnapshot)
    appUpdateCheckService.endManualUpdateCheck()
    appUpdateCheckService.setUpdateNotice(null)
    MockUsePreferenceUtils.resetMocks()
    if (originalUsePreference) mockUsePreference.mockImplementation(originalUsePreference)
  })

  it('clears the manual download and ignores updater events until the channel write settles', async () => {
    let releaseChannel: () => void = () => undefined
    const channelWrite = new Promise<void>((resolve) => {
      releaseChannel = resolve
    })
    const setChannel = vi.fn(async (value: unknown) => {
      MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.channel', value)
      await channelWrite
    })
    installPreferenceMock({ 'app.dist.test_plan.channel': setChannel })
    const user = userEvent.setup()
    await renderAboutSettings()
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)

    await user.click(betaChannelButton())

    expect(setChannel).toHaveBeenCalledWith(UpgradeChannel.BETA)
    expect(preferenceValue('app.dist.test_plan.channel')).toBe(UpgradeChannel.BETA)
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({
      available: false,
      info: null,
      downloaded: false,
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
    expect(appUpdateCheckService.isManualUpdateCheck()).toBe(false)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    releaseChannel()
    await waitFor(() => expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true))
    expect(preferenceValue('app.dist.test_plan.channel')).toBe(UpgradeChannel.BETA)
    expect(appUpdateCheckService.readUpdateNotice()).toBeNull()
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('waits for the pending channel write before a manual check', async () => {
    let releaseChannel: () => void = () => undefined
    const channelWrite = new Promise<void>((resolve) => {
      releaseChannel = resolve
    })
    const setChannel = vi.fn(async (value: unknown) => {
      MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.channel', value)
      await channelWrite
    })
    installPreferenceMock({ 'app.dist.test_plan.channel': setChannel })
    const user = userEvent.setup()
    await renderAboutSettings()

    await user.click(betaChannelButton())
    await user.click(screen.getByRole('button', { name: 'settings.about.checkUpdate.label' }))
    await Promise.resolve()

    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.present_check')
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({
      available: false,
      info: null,
      downloaded: false,
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })

    releaseChannel()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('app.updater.check_for_update'))
    expect(mocks.request.mock.calls.filter(([route]) => route === 'app.updater.check_for_update')).toHaveLength(1)
    expect(mocks.request.mock.calls.filter(([route]) => route === 'app.updater.present_check')).toHaveLength(0)
    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the inline update error when a test-plan write is rejected and still resumes', async () => {
    const failure = new Error('sqlite busy preference write')
    let rejectChannel: (error: Error) => void = () => undefined
    const channelWrite = new Promise<void>((_, reject) => {
      rejectChannel = reject
    })
    void channelWrite.catch(() => undefined)
    const setPlan = vi.fn(async (value: unknown) => {
      MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.enabled', value)
    })
    const setChannel = vi.fn(async (value: unknown) => {
      const previous = preferenceValue('app.dist.test_plan.channel')
      MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.channel', value)
      try {
        await channelWrite
      } catch (error) {
        MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.channel', previous)
        throw error
      }
    })
    MockUsePreferenceUtils.setPreferenceValue('app.dist.test_plan.enabled', false)
    installPreferenceMock({
      'app.dist.test_plan.enabled': setPlan,
      'app.dist.test_plan.channel': setChannel
    })
    const user = userEvent.setup()
    await renderAboutSettings()

    const testPlanSwitch = screen.getAllByRole('switch').find((element) => {
      return !document.getElementById('setting-about-auto-check-update')?.contains(element)
    })
    if (!testPlanSwitch) throw new Error('missing test plan switch')
    await user.click(testPlanSwitch)
    await Promise.resolve()

    expect(appUpdateCheckService.isActiveUpdateSession()).toBe(false)
    expect(setPlan).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')

    rejectChannel(failure)
    await waitFor(() => expect(appUpdateCheckService.isActiveUpdateSession()).toBe(true))

    expect(screen.getByRole('alert')).toHaveTextContent('settings.about.updateError')
    expect(screen.queryByText(failure.message)).not.toBeInTheDocument()
    expect(preferenceValue('app.dist.test_plan.enabled')).toBe(true)
    expect(preferenceValue('app.dist.test_plan.channel')).toBe(UpgradeChannel.RC)
    expect(setPlan).toHaveBeenCalledTimes(1)
    expect(setChannel).toHaveBeenCalledTimes(1)
    expect(mocks.request).not.toHaveBeenCalledWith('app.updater.check_for_update')
    expect(mocks.updateAppUpdateState).toHaveBeenCalledWith({
      available: false,
      info: null,
      downloaded: false,
      checking: false,
      downloading: false,
      downloadProgress: 0,
      manualCheck: false
    })
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

  it('names the GitHub icon and app logo by their repository destination and hides decorative media', async () => {
    const user = userEvent.setup()
    await renderAboutSettings()

    const repositoryButtons = screen.getAllByRole('button', { name: 'settings.about.repository' })
    expect(repositoryButtons).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Cherry Studio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await user.click(repositoryButtons[0])
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', REPOSITORY_URL)

    await user.click(repositoryButtons[1])
    expect(mocks.request).toHaveBeenCalledWith('system.shell.open_external_website', REPOSITORY_URL)
  })
})
