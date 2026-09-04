import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import InstallMiniAppPanel, { InstallMiniAppPicker } from '../InstallMiniAppPanel'

// `vi.hoisted`: `vi.mock` is hoisted above every `const`, so a factory closing over a
// plain `const request` hits the TDZ on first import of the mocked module.
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))

// Neither `clearMocks` nor `restoreMocks` is set repo-wide, and several assertions here
// are "was NOT called with X" — exactly what a leftover call turns red.
beforeEach(() => {
  request.mockReset()
  vi.mocked(toast.success).mockClear()
})

const MANIFEST_URL = 'https://example.com/mygame/manifest.json'

const preview = {
  kind: 'install' as const,
  source: 'file' as const,
  installToken: 'tok_01H8',
  iconDataUrl: null,
  manifest: {
    id: 'com.example.mygame',
    name: 'My Game',
    description: 'A small offline puzzle game.',
    version: '1.0.0',
    permissions: ['ai.chat', 'storage.*'],
    optionalPermissions: ['notification.show'],
    network: []
  },
  required: ['ai.chat', 'storage.delete', 'storage.get', 'storage.keys', 'storage.set'],
  optional: ['notification.show']
}

// The accessible names below are English; the mock preference default is zh-CN, so pin
// the locale (frontend-testing.md §4) and hand it back afterwards.
let previousLanguage: string
beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

describe('InstallMiniAppPanel', () => {
  it('treats a canceled file dialog as a non-event', async () => {
    // Closing the native dialog is normal use — no card, no alert, and nothing to
    // cancel later either: main registered no token for it.
    request.mockResolvedValueOnce(null)
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await userEvent.click(screen.getByLabelText(/choose|选择/i))

    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('install-preview')).toBeNull()
  })

  it('ticks every permission, fixes the required ones, and lets the user untick the rest', async () => {
    // Android's model in one list: a required leaf is a condition of installing, so its box
    // is ticked and fixed; an optional leaf starts on and is the user's to untick.
    request.mockResolvedValueOnce(preview)
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await userEvent.click(screen.getByLabelText(/choose|选择/i))

    const required = await screen.findByRole('checkbox', { name: 'AI capabilities · Chat' })
    expect(required).toBeChecked()
    expect(required).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Notifications · Show' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Notifications · Show' })).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Notifications · Show' }))
    await userEvent.click(screen.getByRole('button', { name: /install|安装/i }))
    expect(request).toHaveBeenCalledWith('mini_app.install.confirm', {
      installToken: preview.installToken,
      grantedOptional: []
    })
  })

  it('shows no network group at all for an app that declares no hosts', async () => {
    // Nothing to grant and nothing to scope: a "no network" line would be a row about a
    // permission the app never asked for.
    request.mockResolvedValueOnce(preview)
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await userEvent.click(screen.getByLabelText(/choose|选择/i))

    await screen.findByTestId('install-preview')
    expect(screen.queryByRole('checkbox', { name: 'Network · Fetch' })).toBeNull()
    expect(screen.queryByText(/allowed hosts|允许的域名/i)).toBeNull()
  })

  it('lists the declared hosts beside the network permission', async () => {
    // The allowlist is the scope of `network.fetch`, not a grant of its own, so it belongs
    // to that group's title — and only appears when the app asked for the network at all.
    request.mockResolvedValueOnce({
      ...preview,
      manifest: { ...preview.manifest, permissions: ['network.fetch'], network: ['api.mygame.com'] },
      required: ['network.fetch']
    })
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await userEvent.click(screen.getByLabelText(/choose|选择/i))

    expect(await screen.findByRole('checkbox', { name: 'Network · Fetch' })).toBeDisabled()
    expect(screen.getByText(/allowed hosts|允许的域名/i)).toBeInTheDocument()
    expect(screen.getByText(/api\.mygame\.com/)).toBeInTheDocument()
  })

  it('does not install until the user confirms', async () => {
    request.mockResolvedValueOnce(preview)
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await userEvent.click(screen.getByLabelText(/choose|选择/i))
    await screen.findByTestId('install-preview')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalledWith('mini_app.install.confirm', expect.anything())
  })

  it('installs by consuming the staging token, never by path or id', async () => {
    request.mockResolvedValueOnce(preview).mockResolvedValueOnce({ ok: true })
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await userEvent.click(screen.getByLabelText(/choose|选择/i))
    await screen.findByTestId('install-preview')
    await userEvent.click(screen.getByRole('button', { name: /install|安装/i }))

    // Only the one-time token from the preview may cross. A path or an id would let
    // the bytes change between what the user reviewed and what gets installed.
    expect(request).toHaveBeenCalledWith('mini_app.install.confirm', {
      installToken: preview.installToken,
      grantedOptional: ['notification.show']
    })
  })

  it('surfaces a refused install and takes the stale card down', async () => {
    // The token is spent on `take` whether or not the install succeeds, so the card
    // it described can no longer be confirmed: leaving it up offers a dead button, and
    // a success toast or a closed panel would tell the user the app is installed.
    const onClose = vi.fn()
    request.mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error('package hash mismatch'))
    render(<InstallMiniAppPicker onClose={onClose} />)

    await userEvent.click(screen.getByLabelText(/choose|选择/i))
    await screen.findByTestId('install-preview')
    await userEvent.click(screen.getByRole('button', { name: /install|安装/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/hash mismatch/)
    expect(screen.queryByTestId('install-preview')).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows the description above the permission list', async () => {
    // The bug this guards: a consent card that asks for AI and file access without
    // saying what the app is. The reason must precede the request.
    request.mockResolvedValue(preview)
    render(<InstallMiniAppPicker onClose={vi.fn()} />)
    await userEvent.click(screen.getByLabelText(/choose|选择/i))

    const card = await screen.findByTestId('install-preview')
    expect(card).toHaveTextContent(preview.manifest.description)
    const description = within(card).getByText(preview.manifest.description)
    const permissions = within(card).getByTestId('permissions')
    expect(description.compareDocumentPosition(permissions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('releases the pending consent when the user cancels, and keeps the picker', async () => {
    // Previewing is the cheap, common action and confirming the rare one: cancel frees
    // the one-per-window slot and keeps the ledger honest — memory tokens, no disk. The
    // consent card is its own dialog, so withdrawing it returns to the picker underneath.
    const onClose = vi.fn()
    request.mockResolvedValue(preview)
    render(<InstallMiniAppPicker onClose={onClose} />)
    await userEvent.click(screen.getByLabelText(/choose|选择/i))
    // Wait for the card: cancelling a preview still in flight takes the late-settle
    // path instead, and this case is about the button.
    const card = await screen.findByTestId('install-preview')
    // The consent dialog's own cancel — the picker underneath has one too, and that one closes the host.
    await userEvent.click(within(card.parentElement!).getByRole('button', { name: /cancel|取消/i }))

    expect(request).toHaveBeenCalledWith('mini_app.install.cancel_preview', { installToken: preview.installToken })
    expect(screen.queryByTestId('install-preview')).toBeNull()
    expect(screen.getByLabelText(/choose|选择/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('previews a url source through the same card as a file source', async () => {
    // One card for both paths — a second one's wording rots first. Both sources resolve
    // the SAME `InstallPreviewSummary`, so the file fixture serves as-is.
    request.mockResolvedValue(preview)
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText(/or install from a web address|或从网址安装/i), MANIFEST_URL)
    await userEvent.click(screen.getByRole('button', { name: /load|加载/i }))

    expect(request).toHaveBeenCalledWith('mini_app.install.preview_url', { manifestUrl: MANIFEST_URL })
    await screen.findByTestId('install-preview')

    // The half that was missing: previewing is not installing. Without this the confirm
    // button can be entirely unwired and the case still passes.
    await userEvent.click(screen.getByRole('button', { name: /install|安装/i }))
    // ONE confirm route for every source — the token carries the kind, not the caller.
    expect(request).toHaveBeenCalledWith('mini_app.install.confirm', {
      installToken: preview.installToken,
      grantedOptional: ['notification.show']
    })
  })

  it('surfaces a rejected url instead of installing it', async () => {
    // A refusal (non-HTTPS, id mismatch, origin change) must reach the user as a message
    // on the card. Swallowing it leaves a button that silently does nothing.
    request.mockRejectedValue(new Error('Only https:// manifests can be installed'))
    render(<InstallMiniAppPicker onClose={vi.fn()} />)

    // The box filled, or the click stops at the form's own required-field validation and
    // the mocked rejection is never reached — a green test that proves nothing.
    await userEvent.type(
      screen.getByLabelText(/or install from a web address|或从网址安装/i),
      'http://example.com/m.json'
    )
    await userEvent.click(screen.getByRole('button', { name: /load|加载/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/https/i)
    expect(request).not.toHaveBeenCalledWith('mini_app.install.confirm', expect.anything())
  })

  it('cancels a late url preview after the panel closed', async () => {
    // The shared settle handler on the SLOWEST source. No successor claim
    // superseded this one, so the late token DID register — only this cancel returns it.
    let resolvePreview!: (value: typeof preview) => void
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        })
    )
    const { unmount } = render(<InstallMiniAppPicker onClose={vi.fn()} />)
    await userEvent.type(screen.getByLabelText(/or install from a web address|或从网址安装/i), MANIFEST_URL)
    await userEvent.click(screen.getByRole('button', { name: /load|加载/i }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('mini_app.install.preview_url', expect.anything()))

    unmount()
    resolvePreview(preview)

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.install.cancel_preview', { installToken: preview.installToken })
    )
  })

  it('offers the load action only once the address has a scheme and a host', async () => {
    // A bare word or a scheme alone must stop at the form, or main gets a request it can
    // only reject with a message about URL syntax that says nothing the user can act on.
    render(<InstallMiniAppPicker onClose={vi.fn()} />)
    const box = screen.getByLabelText(/or install from a web address|或从网址安装/i)
    expect(screen.queryByRole('button', { name: /load|加载/i })).toBeNull()

    await userEvent.type(box, 'https://')
    expect(screen.queryByRole('button', { name: /load|加载/i })).toBeNull()

    await userEvent.type(box, 'example.com/mygame/manifest.json')

    expect(screen.getByRole('button', { name: /load|加载/i })).toBeEnabled()
    expect(request).not.toHaveBeenCalledWith('mini_app.install.preview_url', expect.anything())
  })

  it('previews a builtin source unprompted and confirms through the same route', async () => {
    request.mockResolvedValueOnce(preview)
    render(<InstallMiniAppPanel builtinAppId="com.cherrystudio.miniapp.notes" />)

    // No picker button: the user already chose by clicking the tile — the panel's job
    // is to show the consent card for THAT id, immediately.
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.install.preview_builtin', {
        appId: 'com.cherrystudio.miniapp.notes'
      })
    )
    expect(await screen.findByTestId('install-preview')).toHaveTextContent('My Game')

    await userEvent.click(screen.getByRole('button', { name: /install|安装/i }))
    expect(request).toHaveBeenCalledWith('mini_app.install.confirm', {
      installToken: preview.installToken,
      grantedOptional: ['notification.show']
    })
  })

  it('cancels a builtin preview that resolves after the panel closed', async () => {
    // Late-response compensation (28A #9): pure hygiene now — the ledger entry is a few
    // KB and would expire anyway, but it also frees the one-per-window pending slot.
    let resolvePreview!: (value: typeof preview) => void
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        })
    )
    const { unmount } = render(<InstallMiniAppPanel builtinAppId="com.cherrystudio.miniapp.notes" />)
    await waitFor(() => expect(request).toHaveBeenCalledWith('mini_app.install.preview_builtin', expect.anything()))

    unmount()
    resolvePreview(preview)

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.install.cancel_preview', { installToken: preview.installToken })
    )
  })

  describe('over an installed app', () => {
    const installedSame = {
      ...preview,
      installed: { version: '1.0.0', source: 'file' as const, relation: 'same' as const }
    }
    const installedOlder = {
      ...preview,
      installed: { version: '2.0.0', source: 'file' as const, relation: 'downgrade' as const }
    }
    const upgrade = {
      kind: 'upgrade' as const,
      appId: preview.manifest.id,
      manifest: { ...preview.manifest, version: '2.0.0' },
      iconDataUrl: null,
      source: 'url' as const,
      installed: { version: '1.0.0', source: 'file' as const },
      update: {
        status: 'needs-consent' as const,
        version: '2.0.0',
        added: ['ai.chat'],
        addedOptional: [],
        removed: [],
        addedHosts: [],
        updateToken: 'tok-up'
      }
    }
    const clearDataBox = () => screen.getByRole('checkbox', { name: /delete this mini app/i })

    it('asks before reinstalling the same version and sends the answer with the token', async () => {
      // The card must SAY it is installed, and the confirm must carry the reinstall answer —
      // a confirm without it is what main refuses as a stale client.
      request.mockResolvedValueOnce(installedSame).mockResolvedValueOnce({ ok: true })
      render(<InstallMiniAppPicker onClose={vi.fn()} />)
      await userEvent.click(screen.getByLabelText(/choose|选择/i))

      const notice = await screen.findByTestId('installed-notice')
      expect(notice).toHaveTextContent(/already installed|已安装/i)
      // Right under the identity, before the description: "already installed" comes first.
      const description = screen.getByText(preview.manifest.description)
      expect(notice.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(clearDataBox()).not.toBeChecked()
      expect(screen.queryByRole('button', { name: /^install$|^安装$/i })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: /reinstall|重新安装/i }))

      expect(request).toHaveBeenCalledWith('mini_app.install.confirm', {
        installToken: preview.installToken,
        grantedOptional: ['notification.show'],
        reinstall: { clearData: false }
      })
    })

    it('starts a downgrade with the data wipe on, and warns the moment it is turned off', async () => {
      request.mockResolvedValueOnce(installedOlder).mockResolvedValueOnce({ ok: true })
      render(<InstallMiniAppPicker onClose={vi.fn()} />)
      await userEvent.click(screen.getByLabelText(/choose|选择/i))

      await screen.findByTestId('installed-notice')
      expect(clearDataBox()).toBeChecked()
      expect(screen.queryByText(/may not work|不兼容/i)).toBeNull()
      await userEvent.click(clearDataBox())
      expect(screen.getByText(/may not work|不兼容/i)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /reinstall|重新安装/i }))

      expect(request).toHaveBeenCalledWith('mini_app.install.confirm', {
        installToken: preview.installToken,
        grantedOptional: ['notification.show'],
        reinstall: { clearData: false }
      })
    })

    it('offers a newer package as an upgrade and applies it through the update route', async () => {
      // No install token exists for an upgrade: the update token is the consent record,
      // and the same apply route the detail panel uses is the only way to spend it.
      const onClose = vi.fn()
      request.mockResolvedValueOnce(upgrade).mockResolvedValueOnce(undefined)
      render(<InstallMiniAppPicker onClose={onClose} />)
      await userEvent.click(screen.getByLabelText(/choose|选择/i))

      const notice = await screen.findByTestId('installed-notice')
      expect(notice).toHaveTextContent('1.0.0')
      expect(notice).toHaveTextContent(/source changes|来源将由/i)
      expect(screen.getByRole('checkbox', { name: 'AI capabilities · Chat' })).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: /accept|同意/i }))

      expect(request).toHaveBeenCalledWith('mini_app.update.apply', {
        appId: preview.manifest.id,
        updateToken: 'tok-up',
        consented: true
      })
      expect(request).not.toHaveBeenCalledWith('mini_app.install.confirm', expect.anything())
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })
  })
})
