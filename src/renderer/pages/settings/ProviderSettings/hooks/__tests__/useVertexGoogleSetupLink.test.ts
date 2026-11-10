import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import { parseVertexGoogleSetup, useVertexGoogleSetupLink } from '../useVertexGoogleSetupLink'

const { navigateMock, patchProviderMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  patchProviderMock: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

const setup = { project: 'my-project', location: 'global', clientId: 'cid', clientSecret: 'cs' }
const AUTH_CONFIG_PATH = '/providers/vertexai/auth-config'

const renderSetupLink = (payload: unknown) => {
  const onSelectProvider = vi.fn()
  renderHook(() => useVertexGoogleSetupLink(JSON.stringify(payload), onSelectProvider))
  return { onSelectProvider }
}

beforeEach(() => {
  vi.clearAllMocks()
  MockDataApiUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  patchProviderMock.mockResolvedValue(undefined)
  MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/providers/:providerId', patchProviderMock)
  MockDataApiUtils.setCustomResponse(AUTH_CONFIG_PATH, 'GET', null)
})

describe('parseVertexGoogleSetup', () => {
  it('trims values and rejects blank fields, a missing client secret and non-JSON payloads', () => {
    expect(parseVertexGoogleSetup(JSON.stringify({ ...setup, project: '  my-project ' }))).toEqual(setup)
    expect(parseVertexGoogleSetup(JSON.stringify({ ...setup, clientSecret: undefined }))).toBeNull()
    expect(parseVertexGoogleSetup(JSON.stringify({ ...setup, project: '   ' }))).toBeNull()
    expect(parseVertexGoogleSetup('not json')).toBeNull()
  })
})

describe('useVertexGoogleSetupLink', () => {
  it('fills in Google sign-in on the built-in Vertex AI provider after confirmation, without signing in', async () => {
    const { onSelectProvider } = renderSetupLink(setup)

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(patchProviderMock).toHaveBeenCalledWith({
      params: { providerId: 'vertexai' },
      body: {
        isEnabled: true,
        authConfig: {
          type: 'iam-gcp',
          project: 'my-project',
          location: 'global',
          credentials: { type: 'authorized_user', clientId: 'cid', clientSecret: 'cs' }
        }
      }
    })
    expect(onSelectProvider).toHaveBeenCalledWith('vertexai')
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider', search: { id: 'vertexai' }, replace: true })
    expect(toast.success).toHaveBeenCalledWith('settings.provider.vertex_ai.setup_link.applied')
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('ignores a providerId in the payload and still targets the built-in Vertex AI provider', async () => {
    renderSetupLink({ ...setup, providerId: 'someone-elses-provider' })

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(patchProviderMock).toHaveBeenCalledWith(expect.objectContaining({ params: { providerId: 'vertexai' } }))
  })

  it('saves nothing and leaves the link out of history when the person cancels', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    const { onSelectProvider } = renderSetupLink(setup)

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider', replace: true }))
    expect(patchProviderMock).not.toHaveBeenCalled()
    expect(onSelectProvider).not.toHaveBeenCalled()
  })

  it('rejects an invalid payload without asking or saving', async () => {
    renderSetupLink({ ...setup, clientId: '' })

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.provider.vertex_ai.setup_link.invalid'))
    expect(popup.confirm).not.toHaveBeenCalled()
    expect(patchProviderMock).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider', replace: true })
  })

  it('warns in the dialog that a stored service account key will be replaced', async () => {
    MockDataApiUtils.setCustomResponse(AUTH_CONFIG_PATH, 'GET', {
      type: 'iam-gcp',
      project: 'old-project',
      location: 'us-central1',
      credentials: { privateKey: 'pk', clientEmail: 'sa@old-project.iam.gserviceaccount.com' }
    })
    renderSetupLink(setup)

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledTimes(1))
    render(vi.mocked(popup.confirm).mock.calls[0][0].content as ReactElement)
    expect(screen.getByText('settings.provider.vertex_ai.setup_link.replace_service_account')).toBeInTheDocument()
  })

  it('keeps a person signed in with the same client signed in and says so', async () => {
    MockDataApiUtils.setCustomResponse(AUTH_CONFIG_PATH, 'GET', {
      type: 'iam-gcp',
      project: 'my-project',
      location: 'global',
      credentials: { type: 'authorized_user', clientId: 'cid', clientSecret: 'cs', signedIn: true }
    })
    renderSetupLink(setup)

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('settings.provider.vertex_ai.setup_link.applied_signed_in')
    )
    render(vi.mocked(popup.confirm).mock.calls[0][0].content as ReactElement)
    expect(screen.queryByText(/setup_link\.replace_/)).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('signs out of Google before a link with a different client replaces a signed-in session', async () => {
    MockDataApiUtils.setCustomResponse(AUTH_CONFIG_PATH, 'GET', {
      type: 'iam-gcp',
      project: 'my-project',
      location: 'global',
      credentials: { type: 'authorized_user', clientId: 'old-cid', clientSecret: 'old-cs', signedIn: true }
    })
    renderSetupLink(setup)

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(ipcApi.request).toHaveBeenCalledWith('oauth.logout', { providerId: 'vertexai' })
    expect(vi.mocked(ipcApi.request).mock.invocationCallOrder[0]).toBeLessThan(
      patchProviderMock.mock.invocationCallOrder[0]
    )
  })

  it('does not apply a link with a different client when signing out fails', async () => {
    MockDataApiUtils.setCustomResponse(AUTH_CONFIG_PATH, 'GET', {
      type: 'iam-gcp',
      project: 'my-project',
      location: 'global',
      credentials: { type: 'authorized_user', clientId: 'old-cid', clientSecret: 'old-cs', signedIn: true }
    })
    vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('logout failed'))
    renderSetupLink(setup)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.provider.save_failed'))
    expect(patchProviderMock).not.toHaveBeenCalled()
  })
})
