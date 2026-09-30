import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

import { LocalAgentLogin } from '../LocalAgentLogin'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
})

const config = { protocol: 'acp' as const, enabled: true, args: [], env: {} }
const checked = {
  ok: true,
  status: 'ready',
  protocolInfo: { authMethods: [{ id: 'native-google', name: 'Google account', type: 'agent' }] }
}

describe('ACP sign-in', () => {
  it('uses the advertised method and refreshes only after authentication succeeds', async () => {
    vi.mocked(ipcApi.request).mockResolvedValueOnce(checked).mockResolvedValueOnce(undefined)
    const refreshed = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    await waitFor(() => expect(refreshed).toHaveBeenCalledOnce())
    expect(ipcApi.request).toHaveBeenLastCalledWith('ai.local_agents.authenticate', {
      requestId: expect.any(String),
      config,
      methodId: 'native-google'
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows region rejection without reporting success', async () => {
    vi.mocked(ipcApi.request)
      .mockResolvedValueOnce(checked)
      .mockRejectedValueOnce(new Error('Not currently available in your location'))
    const refreshed = vi.fn()
    render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号所在地区暂不支持此智能体。')
    expect(refreshed).not.toHaveBeenCalled()
  })
  it('cancels an outstanding native login when the settings panel unmounts', async () => {
    vi.mocked(ipcApi.request)
      .mockResolvedValueOnce(checked)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(undefined)
    const refreshed = vi.fn()
    const { unmount } = render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(await screen.findByRole('status')).toHaveTextContent('请在浏览器中完成登录')
    const requestId = (
      vi.mocked(ipcApi.request).mock.calls[vi.mocked(ipcApi.request).mock.calls.length - 1][1] as { requestId: string }
    ).requestId
    unmount()
    expect(ipcApi.request).toHaveBeenLastCalledWith('ai.local_agents.cancel_auth', { requestId })
    expect(refreshed).not.toHaveBeenCalled()
  })
  it('requires a masked API key and passes it to authentication and persistence without dropping existing environment', async () => {
    vi.mocked(ipcApi.request)
      .mockResolvedValueOnce({
        ...checked,
        protocolInfo: { authMethods: [{ id: 'gemini-api-key', name: 'Gemini API key', type: 'agent' }] }
      })
      .mockResolvedValueOnce(undefined)
    const saved = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        available
        modelsLoading={false}
        config={{ ...config, presetId: 'antigravity-acp', env: { KEEP: 'value' } }}
        disabled={false}
        onAuthenticated={saved}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    const input = screen.getByLabelText('API 密钥')
    expect(input).toHaveAttribute('type', 'password')
    const submit = screen.getAllByRole('button', { name: '登录' }).at(-1)!
    expect(submit).toBeDisabled()
    fireEvent.change(input, { target: { value: '  test-key-value  ' } })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ env: { KEEP: 'value', GEMINI_API_KEY: 'test-key-value' } })
      )
    )
    expect(ipcApi.request).toHaveBeenLastCalledWith(
      'ai.local_agents.authenticate',
      expect.objectContaining({
        config: expect.objectContaining({ env: { KEEP: 'value', GEMINI_API_KEY: 'test-key-value' } })
      })
    )
  })

  it('requires project and region for Agent Platform ADC and clears a previously configured API key', async () => {
    vi.mocked(ipcApi.request)
      .mockResolvedValueOnce({
        ...checked,
        protocolInfo: { authMethods: [{ id: 'agent-platform', name: 'Agent Platform', type: 'agent' }] }
      })
      .mockResolvedValueOnce(undefined)
    const saved = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        available
        modelsLoading={false}
        config={{ ...config, presetId: 'antigravity-acp', env: { GOOGLE_API_KEY: 'old-key' } }}
        disabled={false}
        onAuthenticated={saved}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: '' } })
    const submit = screen.getAllByRole('button', { name: '登录' }).at(-1)!
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Google Cloud 项目 ID'), { target: { value: 'project-id' } })
    fireEvent.change(screen.getByLabelText('Google Cloud 区域'), { target: { value: 'us-central1' } })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { GOOGLE_API_KEY: '', GOOGLE_CLOUD_PROJECT: 'project-id', GOOGLE_CLOUD_LOCATION: 'us-central1' }
        })
      )
    )
  })
})

const props = {
  config,
  available: true,
  disabled: false,
  modelsLoading: false,
  helpUrl: 'https://example.com/login',
  onAuthenticated: vi.fn(async () => {})
}

describe('external authentication', () => {
  it('offers a help link for terminal authentication without an ineffective login action', () => {
    render(
      <LocalAgentLogin
        {...props}
        authMethods={[{ id: 'terminal-login', name: 'Launch pi in the terminal', type: 'terminal' }]}
      />
    )
    expect(screen.getByRole('link', { name: '登录帮助' })).toHaveAttribute('href', props.helpUrl)
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('hides login when no authentication method was advertised', () => {
    render(<LocalAgentLogin {...props} authMethods={[]} />)
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
  })
})
