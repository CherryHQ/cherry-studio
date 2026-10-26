import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { CliConfigFileDraft } from '@renderer/services/codeCliConfig'
import { CodeCli } from '@shared/types/codeCli'

import { LocalAgentCliConfig } from '../LocalAgentCliConfig'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('../configEditPanel/CliConfigEditor', () => ({
  CliConfigEditor: ({
    files,
    onChange,
    error
  }: {
    files: CliConfigFileDraft[]
    onChange: (files: CliConfigFileDraft[]) => void
    error?: string
  }) => (
    <>
      <textarea
        aria-label="config"
        value={files[0]?.content ?? ''}
        onChange={(event) => onChange([{ ...files[0], content: event.target.value }])}
      />
      {error && <p role="alert">{error}</p>}
    </>
  )
}))
const content =
  '{"model":"example","effortLevel":"medium","env":{"ANTHROPIC_BASE_URL":"https://example.test","ANTHROPIC_AUTH_TOKEN":"test-key","ANTHROPIC_MODEL":"example"}}'
beforeEach(() => {
  vi.mocked(ipcApi.request).mockImplementation(
    async (route) =>
      (route === 'code_cli.read_config'
        ? { files: [{ target: 'claude-settings', path: '/test/settings.json', content }] }
        : { success: true }) as never
  )
})

afterEach(async () => {
  cleanup()
  // Radix defers focus-scope disposal until the next task; finish it before jsdom is replaced.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
})

it('reads the actual file and saves parameter edits without replacing the selected provider', async () => {
  render(<LocalAgentCliConfig tool={CodeCli.CLAUDE_CODE} />)
  await userEvent.click(screen.getByRole('button', { name: 'CLI 配置文件' }))
  expect(await screen.findByRole('textbox', { name: 'config' })).toHaveValue(content)
  expect(screen.getByText('推理强度')).toBeVisible()
  expect(screen.queryByText('模型选择')).not.toBeInTheDocument()
  const next = content.replace('medium', 'high')
  fireEvent.change(screen.getByRole('textbox', { name: 'config' }), { target: { value: next } })
  await userEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(ipcApi.request).toHaveBeenLastCalledWith('code_cli.write_config', {
    cliTool: CodeCli.CLAUDE_CODE,
    files: [{ target: 'claude-settings', content: next }],
    expectedFiles: [{ target: 'claude-settings', path: '/test/settings.json', content }],
    preserveModelSource: true
  })
})

it('blocks invalid JSON and requires confirmation before discarding edits', async () => {
  render(<LocalAgentCliConfig tool={CodeCli.CLAUDE_CODE} />)
  await userEvent.click(screen.getByRole('button', { name: 'CLI 配置文件' }))
  fireEvent.change(await screen.findByRole('textbox', { name: 'config' }), { target: { value: '{invalid' } })
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '放弃修改' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('edits CodeBuddy native settings without requiring a provider configuration', async () => {
  const original = '{"language":"English","permissions":{"deny":["Read(.env)"]}}'
  const next = original.replace('English', '简体中文')
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'code_cli.read_config'
      ? { files: [{ target: 'codebuddy-settings', path: '/test/.codebuddy/settings.json', content: original }] }
      : ({ success: true } as never)
  )
  render(<LocalAgentCliConfig tool="codebuddy-code" />)
  await userEvent.click(screen.getByRole('button', { name: 'CLI 配置文件' }))
  expect(await screen.findByRole('textbox', { name: 'config' })).toHaveValue(original)
  expect(screen.queryByText('工具参数')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'config' }), { target: { value: next } })
  await userEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(ipcApi.request).toHaveBeenLastCalledWith('code_cli.write_config', {
    cliTool: 'codebuddy-code',
    files: [{ target: 'codebuddy-settings', content: next }],
    expectedFiles: [{ target: 'codebuddy-settings', path: '/test/.codebuddy/settings.json', content: original }],
    preserveModelSource: true
  })
})

it.each([
  [
    'cursor',
    'cursor-config',
    '{"permissions":{"deny":["Shell(rm)"]}}',
    '{"permissions":{"deny":["Shell(rm)","Shell(sudo)"]}}'
  ],
  ['mistral-vibe', 'vibe-config', 'active_model = "old"', 'active_model = "new"'],
  ['goose', 'goose-config', 'GOOSE_MODEL: old', 'GOOSE_MODEL: new']
] as const)('edits %s native configuration without a Cherry model adapter', async (tool, target, original, next) => {
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'code_cli.read_config'
      ? { files: [{ target, path: '/test/config', content: original }] }
      : ({ success: true } as never)
  )
  render(<LocalAgentCliConfig tool={tool} />)
  await userEvent.click(screen.getByRole('button', { name: 'CLI 配置文件' }))
  expect(await screen.findByRole('textbox', { name: 'config' })).toHaveValue(original)
  expect(screen.queryByText('工具参数')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'config' }), { target: { value: next } })
  await userEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(ipcApi.request).toHaveBeenLastCalledWith('code_cli.write_config', {
    cliTool: tool,
    files: [{ target, content: next }],
    expectedFiles: [{ target, path: '/test/config', content: original }],
    preserveModelSource: true
  })
})

it('blocks editing while Hermes WebUI is running and offers stopping it before saving', async () => {
  MockUseCacheUtils.setSharedCacheValue('feature.hermes_dashboard.status', { status: 'running' })
  vi.mocked(ipcApi.request).mockImplementation(async (route) => {
    if (route === 'code_cli.read_config')
      return { files: [{ target: 'hermes-config', path: '/test/config.yaml', content: 'model: test' }] } as never
    if (route === 'hermes_dashboard.stop') {
      MockUseCacheUtils.setSharedCacheValue('feature.hermes_dashboard.status', { status: 'stopped' })
      return { success: true } as never
    }
    return { success: true } as never
  })
  const { rerender } = render(<LocalAgentCliConfig tool={CodeCli.HERMES} />)
  await userEvent.click(screen.getByRole('button', { name: 'CLI 配置文件' }))
  expect(await screen.findByRole('status')).toHaveTextContent('请先停止 Hermes WebUI，再编辑其配置。')
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: '停止' }))
  rerender(<LocalAgentCliConfig tool={CodeCli.HERMES} />)
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  fireEvent.change(screen.getByRole('textbox', { name: 'config' }), { target: { value: 'model: next' } })
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
})
