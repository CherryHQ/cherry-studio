import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ipcRequest: vi.fn(), language: 'zh-CN' }))

const bundled = {
  version: '2.0.2',
  releases: [
    { version: '2.0.2', releaseNotes: '<!--LANG:en-->English feature<!--LANG:zh-CN-->中文功能<!--LANG:END-->' },
    { version: '2.0.1', releaseNotes: '<!--LANG:en-->Previous feature<!--LANG:zh-CN-->历史功能<!--LANG:END-->' },
    { version: '2.0.0', releaseNotes: '<!--LANG:en-->Older feature<!--LANG:zh-CN-->更早功能<!--LANG:END-->' }
  ]
}
let remote: Promise<unknown>

vi.mock('@renderer/components/ReleaseNotes', () => ({
  ReleaseNotes: ({ content }: { content: string }) => <div>{content}</div>
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn() }) }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'settings.about.releases.title' ? 'Release Notes' : key),
    i18n: { language: mocks.language, resolvedLanguage: mocks.language }
  })
}))

import ReleaseNotesPage from '../ReleaseNotesPage'

describe('ReleaseNotesPage', () => {
  beforeEach(() => {
    remote = Promise.resolve(null)
    mocks.ipcRequest
      .mockReset()
      .mockImplementation((route: string) =>
        route === 'app.updater.bundled_release_notes.get' ? Promise.resolve(bundled) : remote
      )
    mocks.language = 'zh-CN'
  })

  it.each([
    ['zh-CN', '中文功能', 'English feature'],
    ['en-US', 'English feature', '中文功能']
  ])('shows the bundled release notes for %s', async (language, expected, hidden) => {
    mocks.language = language

    render(<ReleaseNotesPage />)

    expect(screen.getByRole('heading', { name: 'Release Notes' })).toBeInTheDocument()
    expect(await screen.findByText(mocks.language === 'zh-CN' ? '中文功能' : 'English feature')).toBeInTheDocument()
    expect(screen.getAllByText('v2.0.2')).toHaveLength(2)
    expect(screen.getByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    expect(screen.queryByText('Stale current')).not.toBeInTheDocument()
  })

  it('shows bundled history in version order while the release service has nothing newer', async () => {
    const user = userEvent.setup()

    render(<ReleaseNotesPage />)

    const versionTriggers = await screen.findAllByRole('button')
    expect(versionTriggers.map((trigger) => trigger.textContent)).toEqual(['v2.0.2', 'v2.0.1', 'v2.0.0'])
    expect(versionTriggers[0]).toHaveAttribute('aria-expanded', 'true')
    expect(versionTriggers[1]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('历史功能')).not.toBeInTheDocument()

    await user.click(versionTriggers[1])

    expect(versionTriggers[1]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('历史功能')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('merges and expands release history from the managed update service', async () => {
    const user = userEvent.setup()
    remote = Promise.resolve([
      {
        releaseNotes: '<!--LANG:en-->Remote feature<!--LANG:zh-CN-->远端新功能<!--LANG:END-->',
        version: '2.0.3'
      },
      {
        releaseNotes: '<!--LANG:en-->Remote current<!--LANG:zh-CN-->远端当前版本<!--LANG:END-->',
        version: '2.0.2'
      }
    ])

    render(<ReleaseNotesPage />)

    expect(await screen.findByText('远端新功能')).toBeInTheDocument()
    const versionTriggers = await screen.findAllByRole('button')
    expect(versionTriggers.map((trigger) => trigger.textContent)).toEqual(['v2.0.3', 'v2.0.2', 'v2.0.1', 'v2.0.0'])
    expect(versionTriggers[0]).toHaveAttribute('aria-expanded', 'true')
    expect(versionTriggers[1]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('中文功能')).not.toBeInTheDocument()

    await user.click(versionTriggers[1])
    expect(screen.getByText('远端当前版本')).toBeInTheDocument()
  })

  it('keeps bundled release history when the managed update service is unavailable', async () => {
    remote = Promise.reject(new Error('offline'))

    render(<ReleaseNotesPage />)

    expect(await screen.findByText(mocks.language === 'zh-CN' ? '中文功能' : 'English feature')).toBeInTheDocument()
    expect(screen.getAllByText('v2.0.2')).toHaveLength(2)
    expect(screen.getByText('中文功能')).toBeInTheDocument()
    expect(screen.queryByText('远端新功能')).not.toBeInTheDocument()
  })
  it('shows local notes without waiting for the network', async () => {
    remote = new Promise(() => {})
    render(<ReleaseNotesPage />)
    expect(await screen.findByText('中文功能')).toBeInTheDocument()
  })

  it('retains the current prerelease when remote history only has stable versions', async () => {
    const prerelease = { version: '2.1.0-rc.1', releaseNotes: 'Current prerelease' }
    mocks.ipcRequest.mockImplementation((route: string) =>
      Promise.resolve(
        route === 'app.updater.bundled_release_notes.get'
          ? { version: prerelease.version, releases: [prerelease, ...bundled.releases] }
          : bundled.releases
      )
    )
    render(<ReleaseNotesPage />)
    expect(await screen.findByText('Current prerelease')).toBeInTheDocument()
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('v2.1.0-rc.1')
  })

  it('reports an unreadable local resource even when the network never responds', async () => {
    mocks.ipcRequest.mockImplementation((route: string) =>
      route === 'app.updater.bundled_release_notes.get'
        ? Promise.reject(new Error('missing resource'))
        : new Promise(() => {})
    )
    render(<ReleaseNotesPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('common.error')
  })
})
