import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import { LocalAgentConfigurationSchema } from '@shared/ai/localAgent'

import { LocalAgentLogin } from '../LocalAgentLogin'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: vi.fn((route, ...args) =>
      route === 'ai.local_agents.auth_status'
        ? statusRequest(LocalAgentConfigurationSchema.parse(args[0]))
        : request(...args)
    )
  }
}))
const { request, statusRequest } = vi.hoisted(() => ({ request: vi.fn(), statusRequest: vi.fn() }))

beforeEach(() => {
  request.mockReset()
  statusRequest.mockReset().mockResolvedValue('unsupported')
  vi.mocked(ipcApi.request).mockClear()
})

const config = { protocol: 'acp' as const, enabled: true, args: [], env: {} }
const checked = {
  ok: true,
  status: 'ready',
  protocolInfo: { authMethods: [{ id: 'native-google', name: 'Google account', type: 'agent' }] }
}

describe('ACP sign-in', () => {
  it('uses the advertised method and refreshes only after authentication succeeds', async () => {
    request.mockResolvedValueOnce(checked).mockResolvedValueOnce(undefined)
    const refreshed = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
    expect(refreshed).toHaveBeenCalledWith(config)
  })

  it('shows region rejection without reporting success', async () => {
    request.mockResolvedValueOnce(checked).mockRejectedValueOnce(new Error('Not currently available in your location'))
    const refreshed = vi.fn()
    render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('当前账号所在地区暂不支持此智能体。')
    expect(refreshed).not.toHaveBeenCalled()
  })
  it('cancels an outstanding native login when the settings panel unmounts', async () => {
    request
      .mockResolvedValueOnce(checked)
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(undefined)
    const refreshed = vi.fn()
    const { unmount } = render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    fireEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(await screen.findByRole('status')).toHaveTextContent('正在登录')
    const requestId = (
      vi.mocked(ipcApi.request).mock.calls[vi.mocked(ipcApi.request).mock.calls.length - 1][1] as { requestId: string }
    ).requestId
    unmount()
    expect(ipcApi.request).toHaveBeenLastCalledWith('ai.local_agents.cancel_auth', { requestId })
    expect(refreshed).not.toHaveBeenCalled()
  })
  it('requires a masked API key and passes it to authentication and persistence without dropping existing environment', async () => {
    request
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
    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.authenticate',
      expect.objectContaining({
        config: expect.objectContaining({ env: { KEEP: 'value', GEMINI_API_KEY: 'test-key-value' } })
      })
    )
  })

  it('requires project and region for Agent Platform ADC and clears a previously configured API key', async () => {
    request
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
  it('hides the login action for terminal-only authentication', () => {
    render(
      <LocalAgentLogin
        {...props}
        authMethods={[{ id: 'terminal-login', name: 'Launch pi in the terminal', type: 'terminal' }]}
      />
    )
    expect(screen.queryByRole('link', { name: '登录帮助' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('hides login when no authentication method was advertised', () => {
    render(<LocalAgentLogin {...props} authMethods={[]} />)
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
  })
  it('detects an existing login without authentication, rechecks on focus and clears stale success on failure', async () => {
    statusRequest.mockResolvedValue('signed-in')
    render(<LocalAgentLogin {...props} authMethods={[{ id: 'cursor_login', name: 'Cursor', type: 'agent' }]} />)
    expect(await screen.findByRole('button', { name: '已登录' })).toBeVisible()
    expect(request).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '已登录' }))
    expect(screen.getByRole('heading', { name: '重新登录' })).toBeVisible()
    expect(request).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    statusRequest.mockRejectedValue(new Error('offline'))
    fireEvent(window, new Event('focus'))
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
    statusRequest.mockResolvedValue('signed-out')
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '已登录' })).not.toBeInTheDocument())
  })

  it('rechecks native status after authentication instead of remembering success', async () => {
    statusRequest.mockResolvedValue('signed-out')
    request.mockResolvedValue(undefined)
    const onAuthenticated = async () => {
      statusRequest.mockResolvedValue('signed-in')
    }
    render(
      <LocalAgentLogin
        {...props}
        onAuthenticated={onAuthenticated}
        authMethods={[{ id: 'login', name: 'Login', type: 'agent' }]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('button', { name: '已登录' })).toBeVisible()
  })

  it('uses live ACP session readiness for agents without a native account query and preserves the login action', async () => {
    const loginProps = {
      ...props,
      config: { ...config, presetId: 'codebuddy-code' },
      authMethods: [{ id: 'codebuddy-login', name: 'CodeBuddy Login', type: 'agent' as const }]
    }
    const { rerender } = render(<LocalAgentLogin {...loginProps} />)
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
    rerender(<LocalAgentLogin {...loginProps} sessionReady />)
    await userEvent.click(screen.getByRole('button', { name: '会话就绪' }))
    expect(screen.getByRole('heading', { name: '重新登录' })).toBeVisible()
    expect(request).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    rerender(<LocalAgentLogin {...loginProps} sessionReady authenticationError="Authentication required" />)
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '会话就绪' })).not.toBeInTheDocument()
    rerender(<LocalAgentLogin {...loginProps} sessionReady={false} />)
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
  })

  it('refreshes the ACP session when returning from external login without launching authentication', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        {...props}
        onRefresh={onRefresh}
        authMethods={[{ id: 'terminal-login', name: 'Terminal login', type: 'terminal' }]}
      />
    )
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(request).not.toHaveBeenCalled()
  })

  it('ignores a late status response for a different program', async () => {
    let resolve!: (status: string) => void
    statusRequest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const loginProps = { ...props, authMethods: [{ id: 'login', name: 'Login', type: 'agent' as const }] }
    const { rerender } = render(<LocalAgentLogin {...loginProps} />)
    rerender(<LocalAgentLogin {...loginProps} config={{ ...config, executableOverride: '/other/agent' }} />)
    await act(async () => resolve('signed-in'))
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '已登录' })).not.toBeInTheDocument()
  })
})
