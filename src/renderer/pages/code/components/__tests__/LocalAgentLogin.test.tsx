import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastViewport } from '@cherrystudio/ui/components/primitives/toast'
import { ipcApi } from '@renderer/ipc'
import { LocalAgentConfigurationSchema } from '@shared/ai/localAgent'

import { LocalAgentLogin, clearLocalAgentAuthStatusCache } from '../LocalAgentLogin'

vi.unmock('@cherrystudio/ui')
vi.unmock('@renderer/services/toast')
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: vi.fn((route, ...args) =>
      route === 'ai.local_agents.read_account'
        ? statusRequest(LocalAgentConfigurationSchema.parse(args[0]))
        : request(...args)
    )
  },
  useIpcOn: vi.fn((event: string, handler: (payload: unknown) => void) => {
    ipcHandlers.set(event, handler)
  })
}))
const { request, statusRequest, ipcHandlers } = vi.hoisted(() => ({
  request: vi.fn(),
  statusRequest: vi.fn(),
  ipcHandlers: new Map<string, (payload: unknown) => void>()
}))

beforeEach(() => {
  clearLocalAgentAuthStatusCache()
  request.mockReset()
  statusRequest.mockReset().mockResolvedValue({ status: 'unsupported' })
  ipcHandlers.clear()
  vi.mocked(ipcApi.request).mockClear()
})

const config = { enabled: true, args: [], env: {} }
const checked = {
  ok: true,
  status: 'ready',
  protocolInfo: { authMethods: [{ id: 'native-google', name: 'Google account', type: 'agent' }] }
}

describe('Cursor sign-in', () => {
  it('keeps the key masked and saves it only after verification succeeds', async () => {
    statusRequest.mockResolvedValue({ status: 'signed-out' })
    const account = { methodId: 'cursor_api_key', accountId: 'validated-account' }
    request.mockRejectedValueOnce(new Error('Invalid API key')).mockResolvedValueOnce(account)
    const saved = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'cursor', env: { KEEP: 'value' } }}
        authMethods={[]}
        onAuthenticated={saved}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(screen.getByRole('button', { name: 'Cursor · 登录' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Cursor API 密钥' }))
    const input = screen.getByLabelText('API 密钥')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.type(input, 'invalid-key')
    await userEvent.click(screen.getByRole('button', { name: /^登录$/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid API key')
    expect(saved).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByLabelText('API 密钥'))
    await userEvent.type(screen.getByLabelText('API 密钥'), '  valid-key  ')
    await userEvent.click(screen.getByRole('button', { name: /^登录$/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(saved).toHaveBeenCalledWith(
      { ...config, presetId: 'cursor', env: { KEEP: 'value', CURSOR_API_KEY: 'valid-key' } },
      account
    )
  })

  it('removes the saved key when switching to browser login', async () => {
    statusRequest.mockResolvedValue({ status: 'signed-out' })
    request.mockResolvedValue(undefined)
    const saved = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'cursor', env: { KEEP: 'value', CURSOR_API_KEY: 'expired-key' } }}
        authMethods={[]}
        onAuthenticated={saved}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cursor · 登录' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(saved).toHaveBeenCalledWith({ ...config, presetId: 'cursor', env: { KEEP: 'value' } }, undefined)
  })
})

describe('ACP sign-in', () => {
  it.each([
    ['glm-acp-agent', ['z-ai-api-key', 'z_ai_api_key']],
    ['qwen', ['openai']],
    ['deepseek-harness', []]
  ] as const)('hides sign-in when %s only uses externally configured credentials', (presetId, ids) => {
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId }}
        authMethods={ids.map((id) => ({ id, name: id, type: 'agent' as const }))}
      />
    )
    expect(screen.queryByRole('button', { name: /登录/ })).not.toBeInTheDocument()
  })

  it('keeps a real account flow offered alongside an external API key', async () => {
    request.mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'qwen' }}
        authMethods={[
          { id: 'openai', name: 'Use OpenAI API key', type: 'agent' },
          { id: 'qwen-oauth', name: 'Qwen OAuth', type: 'agent' }
        ]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith(
        'ai.local_agents.authenticate',
        expect.objectContaining({ methodId: 'qwen-oauth' })
      )
    )
  })

  it('localizes known login methods while preserving custom methods and their native IDs', async () => {
    request.mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        available
        modelsLoading={false}
        config={{ ...config, presetId: 'codebuddy-code' }}
        disabled={false}
        authMethods={[
          { id: 'internal', name: 'Login with WeChat', type: 'agent' },
          { id: 'custom-sso', name: 'Company SSO', type: 'agent' }
        ]}
        onAuthenticated={async () => {}}
      />
    )
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(screen.getByRole('button', { name: 'Company SSO' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '微信' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.authenticate',
      expect.objectContaining({ methodId: 'internal' })
    )
  })

  it('keeps a completed CodeBuddy sign-in visible when the model catalog is unavailable', async () => {
    request.mockResolvedValue(undefined)
    statusRequest.mockResolvedValue({ status: 'signed-out' })
    const loginProps = {
      ...props,
      config: { ...config, presetId: 'codebuddy-code' },
      authMethods: [{ id: 'internal', name: 'Login with WeChat', type: 'agent' as const }],
      onAuthenticated: async () => {
        statusRequest.mockResolvedValue({ status: 'signed-in', account: { displayName: 'Example User' } })
      }
    }
    const { unmount } = render(<LocalAgentLogin {...loginProps} />)
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(await screen.findByRole('button', { name: '已登录' })).toBeVisible()
    unmount()
    render(<LocalAgentLogin {...loginProps} />)
    expect(screen.getByRole('button', { name: '已登录' })).toBeVisible()
  })

  it('ignores authentication that completes after cancellation and does not persist credentials', async () => {
    const pending = Promise.withResolvers<void>()
    request.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const saved = vi.fn()
    render(
      <LocalAgentLogin
        available
        modelsLoading={false}
        config={config}
        disabled={false}
        authMethods={[{ id: 'native-google', name: 'Google account', type: 'agent' }]}
        onAuthenticated={saved}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('status')).toHaveTextContent('正在登录')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await act(async () => pending.resolve())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saved).not.toHaveBeenCalled()
    expect(ipcApi.request).toHaveBeenCalledWith(
      'ai.local_agents.cancel_auth',
      expect.objectContaining({ requestId: expect.any(String) })
    )
  })

  it('uses the advertised method and refreshes only after authentication succeeds', async () => {
    request.mockResolvedValueOnce(checked).mockResolvedValueOnce(undefined)
    const refreshed = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '已登录' })).toBeVisible()
    expect(refreshed).toHaveBeenCalledWith(config, undefined)
  })

  it('shows region rejection without reporting success', async () => {
    request.mockResolvedValueOnce(checked).mockRejectedValueOnce(new Error('Not currently available in your location'))
    const refreshed = vi.fn()
    render(
      <LocalAgentLogin available modelsLoading={false} config={config} disabled={false} onAuthenticated={refreshed} />
    )
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
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
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
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
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    const input = screen.getByLabelText('API 密钥')
    expect(input).toHaveAttribute('type', 'password')
    const submit = screen.getAllByRole('button', { name: '登录' }).at(-1)!
    expect(submit).toBeDisabled()
    await userEvent.type(input, '  test-key-value  ')
    await userEvent.click(submit)
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ env: { KEEP: 'value', GEMINI_API_KEY: 'test-key-value' } }),
        undefined
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
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    await userEvent.clear(screen.getByLabelText('API 密钥'))
    const submit = screen.getAllByRole('button', { name: '登录' }).at(-1)!
    expect(submit).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Google Cloud 项目 ID'), 'project-id')
    await userEvent.type(screen.getByLabelText('Google Cloud 区域'), 'us-central1')
    await userEvent.click(submit)
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { GOOGLE_API_KEY: '', GOOGLE_CLOUD_PROJECT: 'project-id', GOOGLE_CLOUD_LOCATION: 'us-central1' }
        }),
        undefined
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
  it('lets a signed-in Codex user switch to terminal reauthentication', async () => {
    statusRequest.mockResolvedValue({ status: 'signed-in' })
    const onTerminalLogin = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'codex' }}
        authMethods={[]}
        onTerminalLogin={onTerminalLogin}
      />
    )
    await userEvent.click(await screen.findByRole('button', { name: '已登录' }))
    expect(onTerminalLogin).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('menuitem', { name: '重新登录' }))
    expect(await screen.findByRole('button', { name: /ChatGPT 账号/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '改用终端登录' }))
    expect(onTerminalLogin).toHaveBeenCalledOnce()
  })

  it('supports Codex in-app API key sign-in without launching a terminal', async () => {
    request.mockResolvedValue(undefined)
    const onAuthenticated = vi.fn().mockResolvedValue(undefined)
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'codex' }}
        authMethods={[]}
        onTerminalLogin={vi.fn()}
        onAuthenticated={onAuthenticated}
      />
    )
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    await userEvent.click(screen.getByRole('button', { name: /OpenAI API 密钥/ }))
    const input = screen.getByLabelText('API 密钥')
    await userEvent.type(input, '  sk-codex-123  ')
    await userEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!)
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith(
        'ai.local_agents.authenticate',
        expect.objectContaining({ methodId: 'codex-api-key', secret: 'sk-codex-123' })
      )
    )
    expect(onAuthenticated).toHaveBeenCalledOnce()
  })

  it('keeps the device code available if copying fails and confirms a successful retry', async () => {
    const pending = Promise.withResolvers<void>()
    request.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const onAuthenticated = vi.fn().mockResolvedValue(undefined)
    const onTerminalLogin = vi.fn().mockResolvedValue(undefined)
    render(
      <>
        <LocalAgentLogin
          {...props}
          config={{ ...config, presetId: 'opencode' }}
          authMethods={[{ id: 'opencode-login', name: 'OpenCode', type: 'agent' }]}
          onTerminalLogin={onTerminalLogin}
          onAuthenticated={onAuthenticated}
        />
        <ToastViewport />
      </>
    )
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(screen.getByRole('button', { name: /在终端中配置 OpenCode Go 或其他服务/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /OpenCode Console/ }))

    const authCall = vi.mocked(ipcApi.request).mock.calls.find(([route]) => route === 'ai.local_agents.authenticate')
    const requestId = (authCall?.[1] as { requestId: string } | undefined)?.requestId
    expect(requestId).toBeTruthy()
    expect(onTerminalLogin).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('正在等待浏览器授权')

    await act(async () => {
      ipcHandlers.get('ai.local_agents.auth_prompt')?.({
        requestId,
        url: 'https://opencode.ai/console/device?user_code=GZNF-ZXWC',
        code: 'GZNF-ZXWC'
      })
    })
    expect(screen.getByText('GZNF-ZXWC')).toBeVisible()
    expect(screen.getByRole('link', { name: '打开浏览器登录' })).toHaveAttribute(
      'href',
      'https://opencode.ai/console/device?user_code=GZNF-ZXWC'
    )

    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Clipboard permission denied', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined)
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      await userEvent.click(screen.getByRole('button', { name: '复制验证码' }))
      expect(await screen.findByText('复制失败')).toBeVisible()
      expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument()
      expect(screen.getByText('GZNF-ZXWC')).toBeVisible()

      await userEvent.click(screen.getByRole('button', { name: '复制验证码' }))
      expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible()
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }

    await act(async () => pending.resolve())
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce())
  })

  it.each([
    ['claude', /Claude 订阅账号/, 'claude-subscription'],
    ['kimi', /Kimi 国内版/, 'kimi-cn']
  ] as const)('opens %s browser sign-in without starting a terminal', async (presetId, label, methodId) => {
    request.mockResolvedValue(undefined)
    const onTerminalLogin = vi.fn()
    render(<LocalAgentLogin {...props} config={{ ...config, presetId }} onTerminalLogin={onTerminalLogin} />)
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    await userEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.authenticate', expect.objectContaining({ methodId }))
    )
    expect(onTerminalLogin).not.toHaveBeenCalled()
  })

  it('opens an explicitly supported native terminal login without reporting authentication success', async () => {
    const pending = Promise.withResolvers<void>()
    const onTerminalLogin = vi.fn(() => pending.promise)
    const onAuthenticated = vi.fn()
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'poolside' }}
        authMethods={[]}
        onTerminalLogin={onTerminalLogin}
        onAuthenticated={onAuthenticated}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled()
    await act(async () => pending.resolve())
    expect(onTerminalLogin).toHaveBeenCalledOnce()
    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /已登录/ })).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('shows a terminal launch failure without persisting credentials', async () => {
    const onAuthenticated = vi.fn()
    render(
      <LocalAgentLogin
        {...props}
        authMethods={[]}
        onAuthenticated={onAuthenticated}
        onTerminalLogin={async () => {
          throw new Error('Terminal unavailable')
        }}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Terminal unavailable')
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

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

  it('waits for a live Antigravity session before offering login for a cached authentication method', () => {
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'antigravity-acp' }}
        modelsLoading
        authMethods={[{ id: 'oauth-personal', name: 'Google', type: 'agent' }]}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('加载中')
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument()
  })

  it('reuses cached Antigravity signed-in status when revisiting while models refresh, and flips if auth fails', () => {
    const antigravityProps = {
      ...props,
      config: { ...config, presetId: 'antigravity-acp' },
      authMethods: [{ id: 'oauth-personal', name: 'Google', type: 'agent' as const }]
    }
    const { unmount } = render(<LocalAgentLogin {...antigravityProps} freshCatalog={{ models: [] }} />)
    expect(screen.getByRole('button', { name: '已登录' })).toBeVisible()
    unmount()

    const { rerender } = render(<LocalAgentLogin {...antigravityProps} modelsLoading freshCatalog={undefined} />)
    expect(screen.queryByText('加载中')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已登录' })).toBeVisible()

    rerender(
      <LocalAgentLogin
        {...antigravityProps}
        modelsLoading={false}
        freshCatalog={undefined}
        authenticationError="Authentication required"
      />
    )
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
  })

  it('detects an existing login without authentication, rechecks on focus and clears stale success on failure', async () => {
    statusRequest.mockResolvedValue({ status: 'signed-in' })
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'cursor' }}
        authMethods={[{ id: 'cursor_login', name: 'Cursor', type: 'agent' }]}
      />
    )
    expect(await screen.findByRole('button', { name: '已登录' })).toBeVisible()
    expect(request).not.toHaveBeenCalled()
    statusRequest.mockRejectedValue(new Error('offline'))
    fireEvent(window, new Event('focus'))
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '已登录' })).not.toBeInTheDocument()
  })

  it('rechecks native status after authentication instead of remembering success', async () => {
    statusRequest.mockResolvedValue({ status: 'signed-out' })
    request.mockResolvedValue(undefined)
    const onAuthenticated = async () => {
      statusRequest.mockResolvedValue({ status: 'signed-in' })
    }
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'cursor' }}
        onAuthenticated={onAuthenticated}
        authMethods={[]}
      />
    )
    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cursor · 登录' }))
    expect(await screen.findByRole('button', { name: '已登录' })).toBeVisible()
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

  it('shows Amp as signed in when returning from a successful terminal login', async () => {
    statusRequest.mockResolvedValue({ status: 'signed-out' })
    render(
      <LocalAgentLogin
        {...props}
        config={{ ...config, presetId: 'amp-acp' }}
        authMethods={[]}
        onTerminalLogin={async () => {}}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: '登录' }))
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
    statusRequest.mockResolvedValue({ status: 'signed-in', account: { email: 'current@example.test' } })
    fireEvent(window, new Event('focus'))

    await userEvent.click(await screen.findByRole('button', { name: '已登录' }))
    expect(within(screen.getByRole('menu')).getByText('current@example.test')).toBeVisible()
  })

  it('ignores a late status response for a different program', async () => {
    let resolve!: (result: { status: 'signed-in' }) => void
    statusRequest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const loginProps = {
      ...props,
      config: { ...config, presetId: 'qoder' },
      authMethods: [{ id: 'login', name: 'Login', type: 'agent' as const }]
    }
    const { rerender } = render(<LocalAgentLogin {...loginProps} />)
    rerender(<LocalAgentLogin {...loginProps} config={{ ...loginProps.config, executableOverride: '/other/agent' }} />)
    await act(async () => resolve({ status: 'signed-in' }))
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /已登录/ })).not.toBeInTheDocument()
  })
})
