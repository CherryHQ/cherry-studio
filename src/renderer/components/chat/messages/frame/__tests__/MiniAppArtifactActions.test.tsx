import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import MiniAppArtifactActions from '../MiniAppArtifactActions'

const { request, tryOpen, confirmStub } = vi.hoisted(() => ({
  request: vi.fn(),
  tryOpen: vi.fn(),
  confirmStub: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/components/chat/panes/Shell/RightPanel', () => ({
  useOptionalRightPanelActions: () => ({ tryOpen })
}))

// The consent dialog's own suite covers its internals; here a stub drives the
// hook through the same onConfirm path so the install can complete.
vi.mock('@renderer/components/MiniApp/InstallConsentDialog', () => ({
  InstallConsentDialog: (props: { onConfirm: (decision: unknown) => void }) => (
    <button type="button" onClick={() => props.onConfirm({ grantedOptional: [] })}>
      confirm-install
    </button>
  )
}))

const { dismissedApps } = vi.hoisted(() => ({ dismissedApps: { current: [] as string[] } }))
vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [dismissedApps.current, vi.fn()]
}))

let previousLanguage: string
beforeAll(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('en-US')
})
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage)
})

beforeEach(() => {
  request.mockReset()
  tryOpen.mockReset()
  confirmStub.mockReset()
  dismissedApps.current = []
})

const HANDLE = { kind: 'path' as const, path: AbsoluteFilePathSchema.parse('/workspace/app.miniapp') }

const installPreview = {
  kind: 'install' as const,
  source: 'file' as const,
  installToken: 'tok_card',
  iconDataUrl: null,
  manifest: {
    id: 'com.example.cardapp',
    name: 'Card App',
    description: 'An authored app.',
    version: '1.0.0',
    permissions: [],
    optionalPermissions: [],
    network: []
  },
  required: [],
  optional: []
}

describe('MiniAppArtifactActions (AC7/AC8)', () => {
  it('passes the session artifact handle straight to the preview request and opens the pane', async () => {
    request.mockResolvedValueOnce({
      previewId: 'p1',
      runtimeId: 'r1',
      sessionId: 'topic-9',
      appId: 'com.example.cardapp',
      version: '1.0.0',
      packageSha256: 'sha256:x',
      openedAt: 1
    })
    render(<MiniAppArtifactActions handle={HANDLE} topicId="topic-9" />)

    await userEvent.click(screen.getByRole('button', { name: /preview and test/i }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.authoring.request_preview', {
        sessionId: 'topic-9',
        handle: HANDLE
      })
    )
    expect(tryOpen).toHaveBeenCalledWith('mini-app-previews')
  })

  it('installs through the consent flow, then offers the Launchpad decision (AC8)', async () => {
    request.mockResolvedValueOnce(installPreview) // request_install
    request.mockResolvedValueOnce({}) // install.confirm
    render(<MiniAppArtifactActions handle={HANDLE} topicId="topic-9" />)

    await userEvent.click(screen.getByRole('button', { name: /install to mini apps/i }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.authoring.request_install', {
        sessionId: 'topic-9',
        handle: HANDLE
      })
    )

    await userEvent.click(await screen.findByRole('button', { name: 'confirm-install' }))
    expect(await screen.findByText(/add to launchpad\?/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /not now/i }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('mini_app.authoring.set_launchpad', {
        appId: 'com.example.cardapp',
        action: 'dismiss'
      })
    )
  })

  it('reads back an answered Launchpad prompt: dismissed apps are not asked again (AC8)', async () => {
    dismissedApps.current = ['com.example.cardapp']
    request.mockResolvedValueOnce(installPreview)
    request.mockResolvedValueOnce({})
    render(<MiniAppArtifactActions handle={HANDLE} topicId="topic-9" />)

    await userEvent.click(screen.getByRole('button', { name: /install to mini apps/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'confirm-install' }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('mini_app.install.confirm', expect.anything()))
    expect(screen.queryByText(/add to launchpad\?/i)).toBeNull()
  })
})
