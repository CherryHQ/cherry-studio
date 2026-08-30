import { useMutation } from '@data/hooks/useDataApi'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.hoisted`: `vi.mock` is hoisted above every `const`, so a factory closing over a
// plain `const request` hits the TDZ on first import of the mocked module.
const { request, activity } = vi.hoisted(() => ({
  request: vi.fn(),
  activity: { entries: [] as unknown[], bytes: 0, days: 0 }
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
// An independently tested child: the real selector needs the portal container the
// global `@cherrystudio/ui` stand-in does not provide (same boundary ContextManagementSettings draws).
vi.mock('@renderer/components/DefaultModelSelector', () => ({
  DefaultModelSelector: () => <div data-testid="model-selector" />
}))
vi.mock('@renderer/components/icons/MiniAppLogoAvatar', () => ({
  default: ({ logo }: { logo: unknown }) => <img alt="" data-testid="detail-logo" data-logo={String(logo)} />
}))

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

// Neither `clearMocks` nor `restoreMocks` is set repo-wide, and several assertions here
// are "was NOT called with X" — exactly what a leftover call turns red.
beforeEach(() => {
  request.mockReset()
})

import type { MiniAppDetail } from '@shared/ipc/schemas/miniApp'

import MiniAppDetailPanel from '../MiniAppDetailPanel'

// Typed against the shared contract, so a field the owner renames breaks the fixture
// here instead of at runtime in the panel.
const detail: MiniAppDetail = {
  appId: 'com.example.mygame',
  name: 'My Game',
  description: 'A tiny sample game.',
  version: '1.0.0',
  // `'url'`, not `'file'`: cases below click "check for update", which `checkForUpdate`
  // refuses outright on a local app — the old fixture asserted an impossible combination.
  source: 'url',
  sourceUrl: 'https://example.com/mygame/manifest.json',
  // Matches `declared` below: `storage.set` is optional AND granted, so it is the one
  // the revoke case can legally click.
  // `network.fetch` goes with the hosts: the schema refuses one without the other, and the
  // panel shows the allowlist under that permission's group.
  grants: ['ai.chat', 'network.fetch', 'storage.get', 'storage.set'],
  network: ['api.mygame.com'],
  pendingAdditions: [],
  updateVersion: null,
  aiModelId: null,
  aiQuickModelId: null,
  canRollback: false,
  declared: [
    { key: 'ai.chat', optional: false, granted: true },
    { key: 'network.fetch', optional: false, granted: true },
    { key: 'storage.get', optional: false, granted: true },
    { key: 'storage.set', optional: true, granted: true }
  ],
  storage: { bytes: 2048, count: 3, bytesLimit: 1048576, countLimit: 1000 },
  file: { bytes: 10485760, count: 4, bytesLimit: 20971520, countLimit: 200 },
  packageBytes: 3 * 1024 * 1024,
  snapshotBytes: 0
}

/** Every other route resolves the detail, as before; the activity list has its own shape. */
const answerWith = (value: MiniAppDetail) =>
  request.mockImplementation((route: string) =>
    Promise.resolve(route === 'mini_app.activity.list' ? { ...activity } : value)
  )

const open = () => {
  answerWith(detail)
  render(<MiniAppDetailPanel appId={detail.appId} />)
  return waitFor(() => screen.getByRole('heading', { name: 'My Game' }))
}

describe('activity log', () => {
  const entries = [
    { v: 1, ts: 1_700_000_000_000, kind: 'call', name: 'network.fetch', outcome: 'PermissionDenied', durationMs: 1 },
    {
      v: 1,
      ts: 1_700_000_001_000,
      kind: 'call',
      name: 'clipboard.write',
      outcome: 'ok',
      durationMs: 2,
      facet: { chars: 12 }
    },
    { v: 1, ts: 1_700_000_002_000, kind: 'grant', name: 'revoke', permissions: ['clipboard.read'] }
  ]

  beforeEach(() => {
    activity.entries = entries
    activity.bytes = 2048
    activity.days = 3
  })
  afterEach(() => {
    activity.entries = []
    activity.bytes = 0
    activity.days = 0
  })

  it('shows what the whole log weighs and how many files it is kept in', async () => {
    await open()

    const size = await screen.findByTestId('activity-size')
    expect(size.textContent).toMatch(/2(\.0)? ?KB/i)
    expect(size.textContent).toContain('3')
  })

  it('shows what the app did, with refusals marked and no payload column to show', async () => {
    await open()

    const list = await screen.findByTestId('activity-list')
    expect(list.textContent).toContain('network.fetch → PermissionDenied')
    expect(list.textContent).toContain('clipboard.write → ok · chars=12')
    expect(list.textContent).toContain('clipboard.read')
    expect(
      within(list)
        .getByText(/network\.fetch/)
        .closest('li')?.className
    ).toContain('text-destructive')
    expect(
      within(list)
        .getByText(/clipboard\.write/)
        .closest('li')?.className
    ).not.toContain('text-destructive')
  })

  it('says what an update dropped and never dangles an empty "granted"', async () => {
    activity.entries = [
      {
        v: 1,
        ts: 1_700_000_003_000,
        kind: 'grant',
        name: 'update',
        version: '1.2.0',
        permissions: [],
        removed: ['ai.chat']
      },
      { v: 1, ts: 1_700_000_004_000, kind: 'grant', name: 'install', version: '1.0.0', permissions: [] }
    ]
    await open()

    const list = await screen.findByTestId('activity-list')
    expect(list.textContent).toMatch(/1\.2\.0.*(revoked|撤销).*ai\.chat/)
    expect(list.textContent).toMatch(/1\.0\.0/)
    expect(list.textContent).not.toMatch(/granted\s*(?=[^a-z]|$)|with\s*(?=[^a-z]|$)/i)
  })

  it('clears the log through the host and shows it empty', async () => {
    await open()
    await screen.findByTestId('activity-list')
    activity.entries = []
    activity.bytes = 0
    activity.days = 0

    fireEvent.click(screen.getByRole('button', { name: /clear log|清除日志/i }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('mini_app.activity.clear', { appId: detail.appId }))
    await waitFor(() => expect(screen.queryByTestId('activity-list')).toBeNull())
  })

  it('says the log could not be read instead of showing it as empty', async () => {
    // The bug this guards: the catch only logged, so a refused read rendered the same
    // "no activity yet" as a genuinely empty log — the one screen a user opens to find
    // out what an app did would quietly claim it did nothing.
    request.mockImplementation((route: string) =>
      route === 'mini_app.activity.list' ? Promise.reject(new Error('log directory is gone')) : Promise.resolve(detail)
    )
    render(<MiniAppDetailPanel appId={detail.appId} />)

    expect(await screen.findByText(/log directory is gone/)).toBeInTheDocument()
  })

  it('explains what the log is, whether or not it has lines', async () => {
    activity.entries = []
    activity.days = 0
    await open()

    expect(screen.getByLabelText(/refus|拒绝/i)).toBeInTheDocument()
  })

  it('re-reads the log when the user asks, not on its own', async () => {
    await open()
    await screen.findByTestId('activity-list')
    request.mockClear()
    activity.entries = []
    activity.days = 0

    fireEvent.click(screen.getByRole('button', { name: /^refresh$|^刷新$/i }))

    await waitFor(() => expect(screen.queryByTestId('activity-list')).toBeNull())
    expect(request.mock.calls.filter((c) => c[0] === 'mini_app.activity.list')).toHaveLength(1)
  })

  it('opens the log folder through the host', async () => {
    await open()

    fireEvent.click(screen.getByRole('button', { name: /open log folder|打开日志目录/i }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('mini_app.activity.open_folder', { appId: detail.appId }))
  })

  it('asks the host for refusals only when the filter is on', async () => {
    await open()
    await screen.findByTestId('activity-list')

    fireEvent.click(screen.getByRole('button', { name: /refusals only|只看拒绝/i }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.activity.list', {
        appId: detail.appId,
        limit: 100,
        deniedOnly: true
      })
    )
  })
})

describe('MiniAppDetailPanel', () => {
  it('offers a web app both an update check and a package replacement', async () => {
    // A package handed over by the user may replace ANY app — the version decides whether
    // that is an upgrade or a reinstall, and the source is re-pinned to what they chose.
    await open()

    expect(screen.getByRole('button', { name: /check for update/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /replace package|替换本地包/i })).toBeInTheDocument()
  })

  it('replaces the package through the install preview, pinned to this app', async () => {
    await open()
    const replaceButton = () => screen.getByRole('button', { name: /replace package|替换本地包/i })
    const previewFor = (id: string) => ({
      kind: 'install' as const,
      source: 'file' as const,
      installToken: 'tok-file',
      iconDataUrl: null,
      manifest: {
        ...detail,
        id,
        name: 'My Game',
        description: 'x',
        version: '1.0.0',
        permissions: [],
        optionalPermissions: [],
        network: []
      },
      required: [],
      optional: [],
      installed: { version: '1.0.0', source: 'url' as const, relation: 'same' as const }
    })

    // Another app's package: refused with a message, never a card — otherwise "replace"
    // is a takeover primitive for whatever file the user happened to pick.
    request.mockResolvedValueOnce(previewFor('com.example.other'))
    await userEvent.click(replaceButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/com\.example\.other/)))
    expect(screen.queryByTestId('install-preview')).toBeNull()
    expect(request).toHaveBeenCalledWith('mini_app.install.cancel_preview', { installToken: 'tok-file' })

    request.mockResolvedValueOnce(previewFor(detail.appId)).mockResolvedValueOnce({ ok: true })
    await userEvent.click(replaceButton())
    await screen.findByTestId('installed-notice')
    await userEvent.click(screen.getByRole('button', { name: /reinstall|重新安装/i }))

    expect(request).toHaveBeenCalledWith('mini_app.install.confirm', {
      installToken: 'tok-file',
      grantedOptional: [],
      reinstall: { clearData: false }
    })
    expect(request).not.toHaveBeenCalledWith('mini_app.update.pick_replacement', expect.anything())
  })

  it('offers replacing the package on a local app and never an update check', async () => {
    // §10.1: a local package has no origin to pin, so it moves only by being handed a
    // new file. Without this entry its version is frozen and the way out loses every save.
    answerWith({ ...detail, source: 'file', sourceUrl: null })
    render(<MiniAppDetailPanel appId={detail.appId} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Game' }))

    expect(screen.getByRole('button', { name: /replace package|替换本地包/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check for update/i })).toBeNull()
  })

  it('groups the panel into permissions, space, activity and settings tabs', async () => {
    await open()

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '')
    expect(tabs).toHaveLength(4)
    for (const [i, label] of [/permissions/i, /space/i, /activity/i, /settings/i].entries()) {
      expect(tabs[i]).toMatch(label)
    }
  })

  it('shows storage and file usage against their quotas', async () => {
    await open()
    expect(screen.getByTestId('storage-usage')).toHaveTextContent('3 / 1000 items')
    expect(screen.getByTestId('file-usage')).toHaveTextContent('4 / 200 items')
  })

  it('fills the usage bar by whichever quota axis is fuller', async () => {
    // 1000 one-byte keys exhaust the count with the byte budget barely touched; a bar
    // that tracked bytes alone would show an exhausted quota as nearly empty.
    answerWith({
      ...detail,
      storage: { bytes: 20 * 1024, count: 1000, bytesLimit: 1048576, countLimit: 1000 }
    })
    render(<MiniAppDetailPanel appId={detail.appId} />)
    await waitFor(() => screen.getByTestId('storage-usage'))

    const bar = screen.getByTestId('storage-usage').querySelector('[style]') as HTMLElement
    expect(bar.style.width).toBe('100%')
    // The other axis still decides when it is the fuller one: 10 of 20 MB in 4 files.
    const fileBar = screen.getByTestId('file-usage').querySelector('[style]') as HTMLElement
    expect(fileBar.style.width).toBe('50%')
  })

  it('reports a detail load failure instead of a blank panel', async () => {
    request.mockRejectedValue(new Error('no such app'))
    render(<MiniAppDetailPanel appId={detail.appId} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load details: no such app/i)
  })

  it('reports a refused action and keeps the panel usable', async () => {
    // The bug this guards: a `run()` that swallows the rejection — the user clicks
    // revoke, nothing changes, and nothing says why.
    await open()
    request.mockRejectedValueOnce(new Error('disk full'))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sandbox data · Write' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/action failed: disk full/i)
    expect(screen.getByRole('heading', { name: 'My Game' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Sandbox data · Write' })).toBeEnabled()
  })

  it('shows how much disk the app itself takes', async () => {
    await open()

    expect(screen.getByTestId('package-size')).toHaveTextContent(/3(\.0)? ?MB/i)
    expect(screen.queryByTestId('snapshot-size')).toBeNull()
  })

  it('shows the rollback snapshot only when one is retained', async () => {
    answerWith({ ...detail, snapshotBytes: 512 * 1024 })
    render(<MiniAppDetailPanel appId={detail.appId} />)

    expect(await screen.findByTestId('snapshot-size')).toHaveTextContent(/512(\.0)? ?KB/i)
  })

  it('lists granted capabilities and network domains', async () => {
    await open()
    expect(screen.getByText(/api\.mygame\.com/)).toBeInTheDocument()
  })

  it('revokes an OPTIONAL grant', async () => {
    // Deliberately not `ai.chat`: that one is `optional: false`, gets no toggle, and the
    // service refuses it — a case clicking a forbidden control only passes against a bug.
    await open()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sandbox data · Write' }))
    expect(request).toHaveBeenCalledWith('mini_app.grant.revoke', { appId: detail.appId, permission: 'storage.set' })
  })

  it('shows a REQUIRED capability ticked and fixed', async () => {
    // The negative control for the case above. A live box that always fails is worse than
    // a fixed one, and only this assertion tells the two designs apart.
    await open()
    const box = screen.getByRole('checkbox', { name: 'AI capabilities · Chat' })
    expect(box).toBeChecked()
    expect(box).toBeDisabled()
  })

  it('requires confirmation before clearing data', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: /clear data|清除数据/i }))
    expect(request).not.toHaveBeenCalledWith('mini_app.clear_data', expect.anything())

    await userEvent.click(screen.getByRole('button', { name: /confirm|确认/i }))
    expect(request).toHaveBeenCalledWith('mini_app.clear_data', { appId: detail.appId })
  })

  it('shows a rename next to the permission changes, not buried', async () => {
    // The bug this guards: implementing `identityChange` on the backend only — an
    // unrendered field is exactly as invisible as no field. (`...Once` would be eaten.)
    await open()
    vi.mocked(request).mockResolvedValueOnce({
      status: 'needs-consent',
      version: '1.1.0',
      added: ['notification.show'],
      addedOptional: [],
      removed: [],
      addedHosts: [],
      identityChange: { name: { from: 'My Game', to: 'Cherry Studio' } },
      updateToken: 'tok-3'
    })
    await userEvent.click(screen.getByRole('button', { name: /check for update/i }))

    const card = await screen.findByTestId('update-consent')
    expect(card).toHaveTextContent('My Game')
    expect(card).toHaveTextContent('Cherry Studio')
    expect(within(card).getByRole('checkbox', { name: 'Notifications · Show' })).toBeDisabled()
  })

  it('shows an icon swap too', async () => {
    await open()
    vi.mocked(request).mockResolvedValueOnce({
      status: 'ready',
      version: '1.1.0',
      addedOptional: [],
      removed: [],
      identityChange: { icon: { from: 'icon.png', to: 'new.png' } },
      updateToken: 'tok-4'
    })
    await userEvent.click(screen.getByRole('button', { name: /check for update/i }))

    expect(await screen.findByTestId('update-consent')).toHaveTextContent(/icon|图标/i)
  })

  it('offers the leaves a Cherry update added under a declared wildcard', async () => {
    // Decision A. The app declared `storage.*` before this method existed, so the
    // host — not the app, and not a runtime failure — is what asks.
    answerWith({ ...detail, pendingAdditions: ['storage.clear'] })
    render(<MiniAppDetailPanel appId={detail.appId} />)
    await screen.findByRole('heading', { name: 'My Game' })

    await userEvent.click(screen.getByRole('button', { name: /^grant$|^授予$/i }))

    expect(request).toHaveBeenCalledWith('mini_app.grant.approve_pending', { appId: detail.appId })
  })

  it('locks every package-changing control while an update is landing', async () => {
    // Uninstall, rollback, replace and a second update all race the swap; the panel
    // says "updating" with the live percentage instead of offering any of them.
    MockUseCacheUtils.setSharedCacheValue('mini_app.attention', [
      {
        appId: detail.appId,
        updateVersion: '1.1.0',
        pendingPermissions: [],
        updating: { version: '1.1.0', fraction: 0.4 }
      }
    ])
    try {
      answerWith({ ...detail, updateVersion: '1.1.0', canRollback: true })
      render(<MiniAppDetailPanel appId={detail.appId} />)
      await screen.findByRole('heading', { name: 'My Game' })

      expect(screen.getByText(/updating to 1\.1\.0 \(40%\)/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^updating/i })).toBeDisabled()
      expect(screen.queryByRole('button', { name: /update to 1\.1\.0/i })).toBeNull()
      expect(screen.getByRole('button', { name: /uninstall/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /check for update/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /replace package/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /roll back|rollback/i })).toBeDisabled()
    } finally {
      MockUseCacheUtils.setSharedCacheValue('mini_app.attention', [])
    }
  })

  it('lets the user put the host-added leaves off until next launch without granting them', async () => {
    answerWith({ ...detail, pendingAdditions: ['storage.clear'] })
    render(<MiniAppDetailPanel appId={detail.appId} />)
    await screen.findByRole('heading', { name: 'My Game' })

    await userEvent.click(screen.getByRole('button', { name: /not now|以后再说/i }))

    expect(request).toHaveBeenCalledWith('mini_app.grant.snooze_pending', { appId: detail.appId })
    expect(request).not.toHaveBeenCalledWith('mini_app.grant.approve_pending', expect.anything())
  })

  it('clears the per-app model through DataApi, not a command', async () => {
    // A plain column write belongs to `PATCH /mini-apps/:appId`; an IpcApi command here
    // would be a second write path for the same row.
    answerWith({ ...detail, aiModelId: 'openai::gpt-4o-mini' })
    render(<MiniAppDetailPanel appId={detail.appId} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Game' }))
    // The trigger handed to the most recent render is the one the click reaches.
    const { trigger } = vi.mocked(useMutation).mock.results.at(-1)!.value

    await userEvent.click(screen.getByRole('button', { name: /use default/i }))

    expect(trigger).toHaveBeenCalledWith({ params: { appId: detail.appId }, body: { aiModelId: null } })
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('set_ai_model'), expect.anything())
  })

  it('clears the quick slot from its own row and only that slot', async () => {
    answerWith({ ...detail, aiQuickModelId: 'openai::gpt-4.1-nano' })
    render(<MiniAppDetailPanel appId={detail.appId} />)
    await waitFor(() => screen.getByRole('heading', { name: 'My Game' }))
    const { trigger } = vi.mocked(useMutation).mock.results.at(-1)!.value

    // The default slot is unset, so its row offers no reset — the only button is the quick one.
    expect(within(screen.getByTestId('model-slot-default')).queryByRole('button', { name: /use default/i })).toBeNull()
    await userEvent.click(within(screen.getByTestId('model-slot-quick')).getByRole('button', { name: /use default/i }))

    expect(trigger).toHaveBeenCalledWith({ params: { appId: detail.appId }, body: { aiQuickModelId: null } })
  })

  it('renders the badge from the detail payload on first paint', async () => {
    // The bug this guards: relying on the broadcast alone. A window opened after it
    // never received one, so its first render must come from the pull path.
    answerWith({ ...detail, updateVersion: '1.1.0' })
    render(<MiniAppDetailPanel appId={detail.appId} />)

    expect(await screen.findByRole('button', { name: /new version 1\.1\.0/i })).toBeInTheDocument()
    // …and the pinned footer offers the same update beside uninstall.
    expect(screen.getByRole('button', { name: /update to 1\.1\.0/i })).toBeInTheDocument()

    // A newer version published since the dot lit: the check re-reads the detail, so the
    // chip and the footer follow the dialog instead of repeating the stale number.
    vi.mocked(request).mockResolvedValueOnce({
      status: 'ready',
      version: '1.2.0',
      addedOptional: [],
      removed: [],
      updateToken: 'tok-9'
    })
    vi.mocked(request).mockResolvedValueOnce({ ...detail, updateVersion: '1.2.0' })
    await userEvent.click(screen.getByRole('button', { name: /update to 1\.1\.0/i }))
    expect(await screen.findByTestId('update-consent')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /new version 1\.2\.0/i })).toBeInTheDocument()
  })

  it('uninstalls after the confirm dialog, and not before', async () => {
    // Both halves in one case. The negative alone passes for a button that does
    // nothing; the positive alone passes for one that skips the confirmation.
    await open()
    await userEvent.click(screen.getByRole('button', { name: /uninstall|卸载/i }))
    expect(request).not.toHaveBeenCalledWith('mini_app.uninstall', expect.anything())

    const detailLoads = request.mock.calls.filter(([route]) => route === 'mini_app.detail').length
    await userEvent.click(await screen.findByRole('button', { name: /confirm|确认/i }))

    expect(request).toHaveBeenCalledWith('mini_app.uninstall', { appId: detail.appId })
    // The row is gone: a reload here fails, logs an error and flashes it before the panel closes.
    expect(request.mock.calls.filter(([route]) => route === 'mini_app.detail')).toHaveLength(detailLoads)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('applies an update only with the token the check returned', async () => {
    // The panel must not be able to synthesize an apply: the token IS the consent
    // record, and re-deriving it reopens the swap-between-check-and-apply hole.
    await open()
    vi.mocked(request).mockResolvedValueOnce({
      status: 'ready',
      version: '1.1.0',
      addedOptional: [],
      removed: [],
      updateToken: 'tok-1'
    })
    await userEvent.click(screen.getByRole('button', { name: /check for update/i }))
    // An empty diff reads as "nothing changed", never as a blank card.
    expect(await screen.findByText(/unchanged|没有变化/i)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /update to 1\.1\.0/i }))

    expect(request).toHaveBeenCalledWith('mini_app.update.apply', { appId: detail.appId, updateToken: 'tok-1' })
  })

  it('shows the added permissions and requires an explicit confirm before applying', async () => {
    await open()
    vi.mocked(request).mockResolvedValueOnce({
      status: 'needs-consent',
      version: '1.1.0',
      added: ['ai.chat'],
      addedOptional: [],
      removed: [],
      addedHosts: ['evil.com'],
      updateToken: 'tok-2'
    })
    await userEvent.click(screen.getByRole('button', { name: /check for update/i }))

    expect(await screen.findByText(/evil\.com/)).toBeInTheDocument()
    expect(request).not.toHaveBeenCalledWith('mini_app.update.apply', expect.anything())

    // …and goes through once the added permissions are explicitly accepted. Without
    // this half, a panel whose consent button is dead passes the case above.
    await userEvent.click(screen.getByRole('button', { name: /accept|同意/i }))

    expect(request).toHaveBeenCalledWith('mini_app.update.apply', {
      appId: detail.appId,
      updateToken: 'tok-2',
      consented: true
    })
  })

  it('shows a newly OFFERED optional permission without demanding consent', async () => {
    // The half a `needs-consent` case cannot cover: `addedOptional` rides on `ready` too,
    // and a component that ignores the field entirely still passes every case above.
    await open()
    vi.mocked(request).mockResolvedValueOnce({
      status: 'ready',
      version: '1.1.0',
      addedOptional: ['notification.show'],
      removed: [],
      updateToken: 'tok-3'
    })
    await userEvent.click(screen.getByRole('button', { name: /check for update/i }))

    expect(await screen.findByRole('checkbox', { name: 'Notifications · Show' })).toBeChecked()
    await userEvent.click(await screen.findByRole('button', { name: /update to 1\.1\.0/i }))

    // NO `consented` — an optional addition never blocks. It rides along ticked instead:
    // offered optional leaves start on, and applying carries whatever is still ticked.
    expect(request).toHaveBeenCalledWith('mini_app.update.apply', {
      appId: detail.appId,
      updateToken: 'tok-3',
      grantedOptional: ['notification.show']
    })
  })
})
