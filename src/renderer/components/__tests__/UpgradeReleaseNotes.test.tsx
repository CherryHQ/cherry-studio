import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UpdateInfo } from 'builder-util-runtime'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../i18n/locales/en-us.json'
import zh from '../../i18n/locales/zh-cn.json'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.unmock('@cherrystudio/ui')
vi.stubGlobal('__APP_RELEASE_VERSION__', '2.1.6')

import { UpgradeReleaseNotes } from '../UpgradeReleaseNotes'

const i18n = createInstance()
await i18n.init({
  lng: 'en-US',
  fallbackLng: 'en-US',
  keySeparator: false,
  resources: {
    'en-US': { translation: en },
    'zh-CN': { translation: zh }
  }
})
const info = (version = '2.1.9'): UpdateInfo => ({
  version,
  releaseDate: '2026-10-31',
  files: [],
  path: '',
  sha512: '',
  releaseNotes: 'Target fallback'
})
const response = {
  fromVersion: '2.1.6',
  toVersion: '2.1.9',
  historyStatus: 'available',
  releases: [
    {
      version: '2.1.9',
      releaseNotes:
        '<!--LANG:en-->New Features\n- One\n- Two\n- Three\n- Four\n\nSecurity\n- Rotate keys<!--LANG:zh-CN-->新功能\n- 一\n- 二\n- 三\n- 四\n\n安全\n- 轮换密钥<!--LANG:END-->'
    },
    { version: '2.1.8', releaseNotes: 'New Features\n- Intermediate feature' }
  ]
}
const view = (update = info()) => (
  <I18nextProvider i18n={i18n}>
    <UpgradeReleaseNotes releaseInfo={update} />
  </I18nextProvider>
)

describe('UpgradeReleaseNotes', () => {
  beforeEach(async () => {
    request.mockReset()
    await i18n.changeLanguage('en-US')
  })

  it('starts with collapsed versions and supports independent keyboard expansion with complete localized notes', async () => {
    request.mockResolvedValue(response)
    const user = userEvent.setup()
    render(view())
    expect(await screen.findByRole('button', { name: 'v2.1.8' })).toBeVisible()
    expect(screen.queryByText(/Versions loaded/)).not.toBeInTheDocument()
    expect(screen.queryByText('2.1.6 → 2.1.9')).not.toBeInTheDocument()
    expect(screen.getByText('v2.1.6 · Current version')).toBeVisible()
    expect(screen.queryByRole('button', { name: /v2.1.6/ })).not.toBeInTheDocument()
    const target = screen.getByRole('button', { name: 'v2.1.9' })
    const intermediate = screen.getByRole('button', { name: 'v2.1.8' })
    expect(target).toHaveAttribute('aria-expanded', 'false')
    expect(intermediate).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Rotate keys')).not.toBeInTheDocument()
    expect(screen.queryByText('Intermediate feature')).not.toBeInTheDocument()
    target.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('Four')).toBeVisible()
    expect(screen.getByText('Rotate keys')).toBeVisible()
    await user.click(intermediate)
    expect(screen.getByText('Intermediate feature')).toBeVisible()
    expect(target).toHaveAttribute('aria-expanded', 'true')
    expect(intermediate).toHaveAttribute('aria-expanded', 'true')
    await user.click(target)
    expect(screen.queryByText('Four')).not.toBeInTheDocument()
    expect(screen.getByText('Intermediate feature')).toBeVisible()
    await user.click(target)
    await act(() => i18n.changeLanguage('zh-CN'))
    expect(screen.getByText('轮换密钥')).toBeVisible()
    expect(screen.getByText('四')).toBeVisible()
    expect(screen.queryByText('Rotate keys')).not.toBeInTheDocument()
  })

  it('retains target fallback on failure and replaces it with remote content after retry', async () => {
    request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response)
    const user = userEvent.setup()
    render(view())
    expect(screen.getByText('Target fallback')).toBeVisible()
    expect(await screen.findByText(en['update.history.unavailable'])).toBeVisible()
    await user.click(screen.getByRole('button', { name: en['common.retry'] }))
    const target = await screen.findByRole('button', { name: 'v2.1.9' })
    expect(target).toHaveAttribute('aria-expanded', 'false')
    await user.click(target)
    expect(screen.getByText('Rotate keys')).toBeVisible()
    expect(screen.queryByText('Target fallback')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en['common.retry'] })).not.toBeInTheDocument()
  })

  it.each(['initial fetch', 'retry'] as const)(
    'replaces same-length single-version fallback text after %s',
    async (attempt) => {
      let resolveHistory!: (value: typeof response) => void
      const pending = new Promise<typeof response>((resolve) => {
        resolveHistory = resolve
      })
      if (attempt === 'retry') request.mockRejectedValueOnce(new Error('offline'))
      request.mockReturnValueOnce(pending)
      const user = userEvent.setup()
      render(view({ ...info(), releaseNotes: '- Old fix' }))
      expect(screen.getByText('Old fix')).toBeVisible()
      if (attempt === 'retry') {
        await user.click(await screen.findByRole('button', { name: en['common.retry'] }))
      }
      await act(async () =>
        resolveHistory({
          ...response,
          releases: [
            {
              version: '2.1.9',
              releaseNotes: '<!--LANG:en-->- New fix<!--LANG:zh-CN-->- 新的修复<!--LANG:END-->'
            }
          ]
        })
      )
      await waitFor(() => expect(screen.queryByText(en['update.history.loading'])).not.toBeInTheDocument())
      expect(screen.getByText('New fix')).toBeVisible()
      expect(screen.queryByText('Old fix')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'v2.1.9' })).not.toBeInTheDocument()
    }
  )

  it('ignores an old response after the upgrade target changes', async () => {
    let resolveOld!: (value: typeof response) => void
    request.mockReturnValueOnce(
      new Promise<typeof response>((resolve) => {
        resolveOld = resolve
      })
    )
    request.mockResolvedValueOnce({
      ...response,
      toVersion: '2.1.10',
      releases: [{ version: '2.1.10', releaseNotes: 'New Features\n- New target' }, response.releases[1]]
    })
    const { rerender } = render(view())
    expect(screen.getByText('Target fallback')).toBeVisible()
    rerender(view(info('2.1.10')))
    const target = await screen.findByRole('button', { name: 'v2.1.10' })
    expect(target).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(target)
    expect(await screen.findByText('New target')).toBeVisible()
    await act(async () => resolveOld(response))
    expect(screen.getByText('New target')).toBeVisible()
    expect(screen.getByRole('button', { name: 'v2.1.10' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('Rotate keys')).not.toBeInTheDocument()
  })

  it('keeps prerelease notes usable without advertising stable history', () => {
    render(view(info('2.2.0-rc.1')))
    expect(screen.getByText('Target fallback')).toBeVisible()
    expect(screen.queryByText(/Versions loaded/)).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('reports missing target notes while preserving intermediate releases', async () => {
    request.mockResolvedValue({ ...response, releases: [response.releases[1]] })
    render(view({ ...info(), releaseNotes: undefined }))
    expect(await screen.findByText('Release notes for 2.1.9 are unavailable.')).toBeVisible()
    expect(screen.getByText('Intermediate feature')).toBeVisible()
    expect(screen.queryByText(/Versions loaded/)).not.toBeInTheDocument()
  })

  it('shows a single complete document without timeline controls or version metadata', async () => {
    request.mockResolvedValue({
      ...response,
      releases: [
        { version: '2.1.9', releaseNotes: 'Fixes\n- [Module] Example\n\n  ```text\n  - [Module] example\n  ```' }
      ]
    })
    const { container } = render(view())
    expect(await screen.findByText('Module')).toBeVisible()
    expect(screen.queryByText(/Versions loaded|Current version|2.1.6 →/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'v2.1.9' })).not.toBeInTheDocument()
    expect(container.querySelector('pre code')?.textContent).toBe('- [Module] example')
  })

  it('keeps reference destinations and footnote bodies isolated between releases', async () => {
    request.mockResolvedValue({
      ...response,
      releases: [
        {
          version: '2.1.9',
          releaseNotes: 'Fixes\n- [Details][ref] with note[^1]\n\n[ref]: https://example.com/new\n[^1]: New explanation'
        },
        {
          version: '2.1.8',
          releaseNotes: 'Fixes\n- [Details][ref] with note[^1]\n\n[ref]: https://example.com/old\n[^1]: Old explanation'
        }
      ]
    })
    const { container } = render(view())
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'v2.1.8' })
    await user.click(screen.getByRole('button', { name: 'v2.1.9' }))
    await user.click(screen.getByRole('button', { name: 'v2.1.8' }))
    const links = screen.getAllByRole('button', { name: 'Details' })
    await user.click(links[0])
    expect(await screen.findByText('https://example.com/new')).toBeVisible()
    await user.click(links[1])
    expect(await screen.findByText('https://example.com/old')).toBeVisible()
    const footnotes = [...container.querySelectorAll('[data-footnotes] li')]
    expect(footnotes).toHaveLength(2)
    expect(new Set(footnotes.map((node) => node.id)).size).toBe(2)
    expect(footnotes[0]).toHaveTextContent('New explanation')
    expect(footnotes[1]).toHaveTextContent('Old explanation')
  })
})
