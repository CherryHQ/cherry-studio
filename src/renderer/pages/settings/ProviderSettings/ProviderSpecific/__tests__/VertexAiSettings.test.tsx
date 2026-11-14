import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { popup } from '@renderer/services/popup'
import type { AuthConfig } from '@shared/data/types/provider'

import VertexAiSettings from '../VertexAiSettings'

const { requestMock, patchProviderMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  patchProviderMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => requestMock(...args) }
}))

const SERVICE_ACCOUNT_CONFIG: AuthConfig = {
  type: 'iam-gcp',
  project: 'sa-project',
  location: 'us-central1',
  credentials: { privateKey: 'stored-key', clientEmail: 'sa@sa-project.iam.gserviceaccount.com' }
}

const SIGNED_IN_GOOGLE_CONFIG: AuthConfig = {
  type: 'iam-gcp',
  project: 'google-project',
  location: 'global',
  credentials: {
    type: 'authorized_user',
    clientId: 'cid',
    clientSecret: 'cs',
    account: 'me@example.com',
    signedIn: true
  }
}

const SIGNED_OUT_GOOGLE_CONFIG: AuthConfig = {
  ...SIGNED_IN_GOOGLE_CONFIG,
  credentials: { type: 'authorized_user', clientId: 'cid', clientSecret: 'cs', signedIn: false }
}

const renderWithStoredConfig = (authConfig: AuthConfig) => {
  MockUseDataApiUtils.mockQueryData('/providers/:providerId/auth-config', authConfig)
  return render(<VertexAiSettings providerId="vertexai" />)
}

const savedAuthConfig = (callIndex = 0) => patchProviderMock.mock.calls[callIndex][0].body.authConfig

const callOrder = (channel: string) =>
  requestMock.mock.invocationCallOrder[requestMock.mock.calls.findIndex(([c]) => c === channel)]

const changeClientId = async (user: ReturnType<typeof userEvent.setup>, clientId: string) => {
  const field = screen.getByLabelText('settings.provider.vertex_ai.google.client_id')
  await user.clear(field)
  if (clientId) await user.type(field, clientId)
  await user.tab()
}

const typeServiceAccountKey = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'settings.provider.vertex_ai.auth_method.service_account' }))
  await user.type(screen.getByLabelText('settings.provider.vertex_ai.service_account.client_email'), 'sa@typed.iam')
  await user.type(screen.getByLabelText('settings.provider.vertex_ai.service_account.private_key'), 'typed-key')
  await user.tab()
}

const enterGoogleClient = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'settings.provider.vertex_ai.auth_method.google' }))
  await user.type(screen.getByLabelText('settings.provider.vertex_ai.google.client_id'), 'new-cid')
  await user.type(screen.getByLabelText('settings.provider.vertex_ai.google.client_secret'), 'new-cs')
  await user.tab()
}

beforeEach(() => {
  vi.clearAllMocks()
  MockUseDataApiUtils.resetMocks()
  patchProviderMock.mockResolvedValue(undefined)
  MockUseDataApiUtils.mockMutationWithTrigger('PATCH', '/providers/:providerId', patchProviderMock)
  requestMock.mockImplementation((channel: string) => {
    if (channel === 'oauth.has_token') return Promise.resolve(true)
    if (channel === 'oauth.get_account') return Promise.resolve({ accountId: 'me@example.com' })
    if (channel === 'oauth.logout') return Promise.resolve(undefined)
    throw new Error(`unexpected channel: ${channel}`)
  })
})

describe('VertexAiSettings sign-in method', () => {
  it('only changes the view when the picker switches methods', async () => {
    const user = userEvent.setup()
    renderWithStoredConfig(SERVICE_ACCOUNT_CONFIG)

    await user.click(screen.getByRole('button', { name: 'settings.provider.vertex_ai.auth_method.google' }))

    expect(screen.getByLabelText('settings.provider.vertex_ai.google.client_id')).toBeInTheDocument()
    expect(patchProviderMock).not.toHaveBeenCalled()
  })

  it('keeps the stored service account key when the person cancels replacing it with Google sign-in', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    renderWithStoredConfig(SERVICE_ACCOUNT_CONFIG)

    await enterGoogleClient(user)

    await waitFor(() => expect(popup.confirm).toHaveBeenCalledTimes(1))
    expect(patchProviderMock).not.toHaveBeenCalled()
  })

  it('replaces the stored service account key with the Google client once confirmed', async () => {
    const user = userEvent.setup()
    renderWithStoredConfig(SERVICE_ACCOUNT_CONFIG)

    await enterGoogleClient(user)

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(popup.confirm).toHaveBeenCalledTimes(1)
    expect(patchProviderMock).toHaveBeenCalledWith({
      params: { providerId: 'vertexai' },
      body: {
        authConfig: {
          type: 'iam-gcp',
          project: 'sa-project',
          location: 'us-central1',
          credentials: { type: 'authorized_user', clientId: 'new-cid', clientSecret: 'new-cs' }
        }
      }
    })
  })

  it('signs out of Google before saving a pasted service account key over a signed-in session', async () => {
    const user = userEvent.setup()
    renderWithStoredConfig(SIGNED_IN_GOOGLE_CONFIG)

    await user.click(screen.getByRole('button', { name: 'settings.provider.vertex_ai.auth_method.service_account' }))
    await user.click(screen.getByLabelText('settings.provider.vertex_ai.service_account.json_input'))
    await user.paste(
      JSON.stringify({ private_key: 'new-key', client_email: 'sa@new.iam.gserviceaccount.com', project_id: 'new' })
    )

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(popup.confirm).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith('oauth.logout', { providerId: 'vertexai' })
    expect(callOrder('oauth.logout')).toBeLessThan(patchProviderMock.mock.invocationCallOrder[0])
    expect(patchProviderMock).toHaveBeenCalledWith({
      params: { providerId: 'vertexai' },
      body: {
        authConfig: {
          type: 'iam-gcp',
          project: 'new',
          location: 'global',
          credentials: { privateKey: 'new-key', clientEmail: 'sa@new.iam.gserviceaccount.com' }
        }
      }
    })
  })

  it('asks before a service account key replaces a stored Google client that is not signed in', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    renderWithStoredConfig(SIGNED_OUT_GOOGLE_CONFIG)

    await typeServiceAccountKey(user)

    await waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'settings.provider.vertex_ai.auth_method.replace_google_title' })
      )
    )
    expect(patchProviderMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('settings.provider.vertex_ai.service_account.client_email')).toHaveValue('')
  })

  it.each([
    { state: 'signed out', authConfig: SIGNED_OUT_GOOGLE_CONFIG, signsOut: false },
    { state: 'signed in', authConfig: SIGNED_IN_GOOGLE_CONFIG, signsOut: true }
  ])(
    'saves a typed service account key over a $state Google client once confirmed',
    async ({ authConfig, signsOut }) => {
      const user = userEvent.setup()
      renderWithStoredConfig(authConfig)

      await typeServiceAccountKey(user)

      await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
      expect(savedAuthConfig().credentials).toEqual({ privateKey: 'typed-key', clientEmail: 'sa@typed.iam' })
      const logoutRequested = requestMock.mock.calls.some(([channel]) => channel === 'oauth.logout')
      expect(logoutRequested).toBe(signsOut)
      if (signsOut) expect(callOrder('oauth.logout')).toBeLessThan(patchProviderMock.mock.invocationCallOrder[0])
    }
  )
})

describe('VertexAiSettings OAuth client changes', () => {
  it('keeps the session and the stored client when the person cancels changing the client ID', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    renderWithStoredConfig(SIGNED_IN_GOOGLE_CONFIG)

    await changeClientId(user, 'other-cid')

    await waitFor(() =>
      expect(popup.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'settings.provider.vertex_ai.google.change_client_title' })
      )
    )
    expect(requestMock).not.toHaveBeenCalledWith('oauth.logout', expect.anything())
    expect(patchProviderMock).not.toHaveBeenCalled()
    expect(screen.getByLabelText('settings.provider.vertex_ai.google.client_id')).toHaveValue('cid')
  })

  it('signs out of Google before saving a different client ID once confirmed', async () => {
    const user = userEvent.setup()
    renderWithStoredConfig(SIGNED_IN_GOOGLE_CONFIG)

    await changeClientId(user, 'other-cid')

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(requestMock).toHaveBeenCalledWith('oauth.logout', { providerId: 'vertexai' })
    expect(callOrder('oauth.logout')).toBeLessThan(patchProviderMock.mock.invocationCallOrder[0])
    expect(savedAuthConfig()).toEqual({
      type: 'iam-gcp',
      project: 'google-project',
      location: 'global',
      credentials: { type: 'authorized_user', clientId: 'other-cid', clientSecret: 'cs' }
    })
  })

  it('saves nothing while the client ID of a stored Google client is blank', async () => {
    const user = userEvent.setup()
    renderWithStoredConfig(SIGNED_IN_GOOGLE_CONFIG)

    await changeClientId(user, '')

    expect(popup.confirm).not.toHaveBeenCalled()
    expect(patchProviderMock).not.toHaveBeenCalled()
  })

  it('shows a client saved elsewhere after the person cancelled replacing the service account key', async () => {
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    const user = userEvent.setup()
    const { rerender } = renderWithStoredConfig(SERVICE_ACCOUNT_CONFIG)
    await enterGoogleClient(user)
    await waitFor(() => expect(popup.confirm).toHaveBeenCalledTimes(1))

    // A setup link applied while settings stay open.
    MockUseDataApiUtils.mockQueryData('/providers/:providerId/auth-config', {
      ...SIGNED_OUT_GOOGLE_CONFIG,
      credentials: { type: 'authorized_user', clientId: 'link-cid', clientSecret: 'link-cs', signedIn: false }
    })
    rerender(<VertexAiSettings providerId="vertexai" />)

    expect(screen.getByLabelText('settings.provider.vertex_ai.google.client_id')).toHaveValue('link-cid')
  })
})

describe('VertexAiSettings project and location', () => {
  it('keeps the stored service account key when the location changes', async () => {
    const user = userEvent.setup()
    renderWithStoredConfig(SERVICE_ACCOUNT_CONFIG)

    await user.click(screen.getByPlaceholderText('settings.provider.vertex_ai.location_placeholder'))
    await user.click(screen.getByRole('option', { name: 'europe-west4' }))

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(savedAuthConfig()).toEqual({
      type: 'iam-gcp',
      project: 'sa-project',
      location: 'europe-west4',
      credentials: { privateKey: 'stored-key', clientEmail: 'sa@sa-project.iam.gserviceaccount.com' }
    })
  })

  it('keeps the stored Google client, not an unsaved blank draft, when the project changes', async () => {
    const user = userEvent.setup()
    renderWithStoredConfig(SIGNED_IN_GOOGLE_CONFIG)
    await changeClientId(user, '')

    const project = screen.getByPlaceholderText('settings.provider.vertex_ai.project_id_placeholder')
    await user.clear(project)
    await user.type(project, 'next-project')
    await user.tab()

    await waitFor(() => expect(patchProviderMock).toHaveBeenCalledTimes(1))
    expect(savedAuthConfig()).toEqual({
      type: 'iam-gcp',
      project: 'next-project',
      location: 'global',
      credentials: { type: 'authorized_user', clientId: 'cid', clientSecret: 'cs' }
    })
  })
})
