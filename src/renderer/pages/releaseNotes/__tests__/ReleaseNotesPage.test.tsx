import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ipcRequest: vi.fn(), language: 'zh-CN' }))

vi.stubGlobal('__APP_RELEASE_NOTES__', '<!--LANG:en-->English feature<!--LANG:zh-CN-->中文功能<!--LANG:END-->')
vi.stubGlobal('__APP_RELEASE_VERSION__', '2.0.2')
vi.stubGlobal('__APP_RELEASE_HISTORY__', [
  {
    releaseNotes: '<!--LANG:en-->Stale current<!--LANG:zh-CN-->过期当前版本<!--LANG:END-->',
    version: '2.0.2'
  },
  {
    releaseNotes: '<!--LANG:en-->Previous feature<!--LANG:zh-CN-->历史功能<!--LANG:END-->',
    version: '2.0.1'
  },
  {
    releaseNotes: '<!--LANG:en-->Older feature<!--LANG:zh-CN-->更早功能<!--LANG:END-->',
    version: '2.0.0'
  }
])

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
    mocks.ipcRequest.mockReset().mockResolvedValue(null)
    mocks.language = 'zh-CN'
  })

  it.each([
    ['zh-CN', '中文功能', 'English feature'],
    ['en-US', 'English feature', '中文功能']
  ])('shows the bundled release notes for %s', (language, expected, hidden) => {
    mocks.language = language

    render(<ReleaseNotesPage />)

    expect(screen.getByRole('heading', { name: 'Release Notes' })).toBeInTheDocument()
    expect(screen.getAllByText('v2.0.2')).toHaveLength(2)
    expect(screen.getByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    expect(screen.queryByText('Stale current')).not.toBeInTheDocument()
  })

  it('shows bundled history in version order while the release service has nothing newer', async () => {
    const user = userEvent.setup()

    render(<ReleaseNotesPage />)

    const versionTriggers = screen.getAllByRole('button')
    expect(versionTriggers.map((trigger) => trigger.textContent)).toEqual(['v2.0.2', 'v2.0.1', 'v2.0.0'])
    expect(versionTriggers[0]).toHaveAttribute('aria-expanded', 'true')
    expect(versionTriggers[1]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('历史功能')).not.toBeInTheDocument()

    await user.click(versionTriggers[1])

    expect(versionTriggers[1]).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('历史功能')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(mocks.ipcRequest).toHaveBeenCalledWith('app.updater.release_notes.get')
  })

  it('merges and expands release history from the managed update service', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockResolvedValue([
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
    const versionTriggers = screen.getAllByRole('button')
    expect(versionTriggers.map((trigger) => trigger.textContent)).toEqual(['v2.0.3', 'v2.0.2', 'v2.0.1', 'v2.0.0'])
    expect(versionTriggers[0]).toHaveAttribute('aria-expanded', 'true')
    expect(versionTriggers[1]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('中文功能')).not.toBeInTheDocument()

    await user.click(versionTriggers[1])
    expect(screen.getByText('远端当前版本')).toBeInTheDocument()
  })

  it('keeps bundled release history when the managed update service is unavailable', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('offline'))

    render(<ReleaseNotesPage />)

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledOnce())
    expect(screen.getAllByText('v2.0.2')).toHaveLength(2)
    expect(screen.getByText('中文功能')).toBeInTheDocument()
    expect(screen.queryByText('远端新功能')).not.toBeInTheDocument()
  })
})
